import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE_LIVE = 'stage_apple_traffic_live';
const STAGE_HIST = 'stage_apple_traffic_hist';

// Column names below must match what StageService.sanitizeRowKeys() produces:
// non-alphanumeric chars → '_', then lowercase. MSSQL returns original PascalCase
// names unless aliased. Keep aliases only for computed/aggregated columns.
const LIVE_SQL = `
SELECT
    mt.TerminatedMsisdn,
    mt.TerminatedSenderId,
    mt.MccMnc,
    CONVERT(VARCHAR(23), mt.SubmitDateTime, 126) AS SubmitDateTime
FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
WHERE mt.SubmitDateTime >= DATEADD(MINUTE, -5, GETUTCDATE())
`;

const HIST_SQL = `
SELECT
    CONVERT(VARCHAR(23),
        DATEADD(MINUTE, DATEDIFF(MINUTE, 0, mt.SubmitDateTime) / 5 * 5, 0),
    126)                                AS bucket,
    mt.MccMnc,
    mt.TerminatedSenderId,
    COUNT(*)                            AS msg_count,
    COUNT(DISTINCT mt.TerminatedMsisdn) AS unique_msisdn
FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
WHERE mt.SubmitDateTime >= DATEADD(DAY, -5, GETUTCDATE())
GROUP BY
    DATEADD(MINUTE, DATEDIFF(MINUTE, 0, mt.SubmitDateTime) / 5 * 5, 0),
    mt.MccMnc,
    mt.TerminatedSenderId
`;

// Keys match sanitizeRowKeys output: lowercase, non-alphanumeric → '_'
// PascalCase MSSQL names: TerminatedMsisdn→terminatedmsisdn, MccMnc→mccmnc, etc.
// Computed aliases (bucket, msg_count, unique_msisdn) are already lowercase.
const LIVE_COLUMNS = [
  { key: 'terminatedmsisdn',   label: 'MSISDN',      type: 'text'      },
  { key: 'terminatedsenderid', label: 'Sender ID',   type: 'text'      },
  { key: 'mccmnc',             label: 'MCC-MNC',     type: 'text'      },
  { key: 'submitdatetime',     label: 'Submit Time', type: 'timestamp' },
];

const HIST_COLUMNS = [
  { key: 'bucket',             label: 'Bucket',       type: 'timestamp' },
  { key: 'mccmnc',             label: 'MCC-MNC',      type: 'text'      },
  { key: 'terminatedsenderid', label: 'Sender ID',    type: 'text'      },
  { key: 'msg_count',          label: 'Messages',     type: 'numeric'   },
  { key: 'unique_msisdn',      label: 'Unique MSISDN', type: 'numeric'  },
];

@Injectable()
export class AppleTrafficService implements OnModuleInit {
  private readonly logger = new Logger(AppleTrafficService.name);
  private _liveDatasetId: string | null = null;
  private _histDatasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureDatasetRecords();
      await this.ensureStageTable(STAGE_LIVE, LIVE_COLUMNS);
      await this.ensureStageTable(STAGE_HIST, HIST_COLUMNS);
    } catch (err) {
      this.logger.error('Apple Traffic dataset seed failed', err);
    }
  }

  private async ensureDatasetRecords(): Promise<void> {
    const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — Apple Traffic datasets not seeded');
      return;
    }

    this._liveDatasetId = await this.upsertDataset({
      stageName:   STAGE_LIVE,
      name:        'Apple Traffic Live',
      description: 'Apple Traffic — raw rows from last 5 minutes of MTEdr.',
      sql:         LIVE_SQL,
      columns:     LIVE_COLUMNS,
      cron:        '*/5 * * * *',
      asmscId:     asmsc.id,
    });

    this._histDatasetId = await this.upsertDataset({
      stageName:   STAGE_HIST,
      name:        'Apple Traffic History',
      description: 'Apple Traffic — 5-min aggregated buckets over last 5 days from MTEdr.',
      sql:         HIST_SQL,
      columns:     HIST_COLUMNS,
      cron:        '0 */2 * * *',
      asmscId:     asmsc.id,
    });
  }

  private async upsertDataset(opts: {
    stageName: string; name: string; description: string;
    sql: string; columns: any[]; cron: string; asmscId: string;
  }): Promise<string> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: opts.stageName } });

    if (existing) {
      const sqlChanged  = existing.sqlQuery !== opts.sql;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(opts.columns);
      const nameChanged = existing.name !== opts.name;
      if (sqlChanged || metaChanged || nameChanged) {
        await this.datasetRepo.update(existing.id, {
          name:           opts.name,
          sqlQuery:       opts.sql,
          columnMetadata: opts.columns as any,
        });
        this.logger.log(`Updated ${opts.name} dataset`);
      }
      return existing.id;
    }

    this.logger.log(`Seeding ${opts.name} dataset…`);
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           opts.name,
        description:    opts.description,
        sourceDb:       'mssql',
        dataSourceId:   opts.asmscId,
        sqlQuery:       opts.sql,
        stageTableName: opts.stageName,
        columnMetadata: opts.columns as any,
        scheduleCron:   opts.cron,
        isActive:       true,
        createdBy:      null,
      }),
    );
    this.logger.log(`${opts.name} dataset record created`);
    return saved.id;
  }

  private async ensureStageTable(stage: string, columns: typeof LIVE_COLUMNS): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };

    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [stage],
    );

    if (!row?.exists) {
      this.logger.log(`Creating stage table: ${stage}`);
      const colDefs = columns.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${stage} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${stage}_refreshed ON ${stage} (refreshed_at DESC)`,
      );
      this.logger.log(`Stage table ${stage} created`);
      return;
    }

    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [stage],
    );
    const existingSet = new Set(existing.map((r) => r.column_name));
    for (const col of columns) {
      if (!existingSet.has(col.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${stage} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
        );
        this.logger.log(`Added missing column "${col.key}" to ${stage}`);
      }
    }
  }

  async getData(): Promise<any> {
    const [liveRows, histRows, liveRefresh, histRefresh] = await Promise.all([
      this.dataSource.query(`SELECT * FROM ${STAGE_LIVE} ORDER BY refreshed_at DESC`)
        .catch((e: any) => { this.logger.error('live query failed:', e.message); return []; }),
      this.dataSource.query(`SELECT * FROM ${STAGE_HIST} ORDER BY bucket DESC`)
        .catch((e: any) => { this.logger.error('hist query failed:', e.message); return []; }),
      this.dataSource.query(`SELECT MAX(refreshed_at) AS ts FROM ${STAGE_LIVE}`)
        .catch((e: any) => { this.logger.error('live refresh query failed:', e.message); return [{}]; }),
      this.dataSource.query(`SELECT MAX(refreshed_at) AS ts FROM ${STAGE_HIST}`)
        .catch((e: any) => { this.logger.error('hist refresh query failed:', e.message); return [{}]; }),
    ]);

    const toIso = (v: any): string | null => {
      if (!v) return null;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') return v;
      return String(v);
    };

    return {
      liveDatasetId:    this._liveDatasetId,
      histDatasetId:    this._histDatasetId,
      live:             liveRows.map((r: any) => ({
        terminated_msisdn:    r.terminatedmsisdn    ?? null,
        terminated_sender_id: r.terminatedsenderid  ?? null,
        mcc_mnc:              r.mccmnc              ?? null,
        submit_datetime:      r.submitdatetime      ?? null,
      })),
      hist:             histRows.map((r: any) => ({
        bucket:               r.bucket              ?? null,
        mcc_mnc:              r.mccmnc              ?? null,
        terminated_sender_id: r.terminatedsenderid  ?? null,
        msg_count:            Number(r.msg_count    ?? 0),
        unique_msisdn:        Number(r.unique_msisdn ?? 0),
      })),
      liveRefreshedAt:  toIso(liveRefresh[0]?.ts),
      histRefreshedAt:  toIso(histRefresh[0]?.ts),
    };
  }
}
