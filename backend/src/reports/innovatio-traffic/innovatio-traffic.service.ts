import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE = 'stage_innovatio_traffic';
const DATASET_NAME = 'Innovatio Traffic Report';
const ASMSC_DATASOURCE_NAME = 'ASMSC';

// Report scope — SMS traffic terminated via this supplier to this destination network,
// for the WHOLE of yesterday (SQL Server local date). Kept as constants for easy tweaks.
const VENDOR_NAME = 'Innovatio';
const MCCMNC = '614004'; // Niger — Airtel

// Whole-yesterday snapshot, refreshed daily after the day closes (full-replace by the generic
// StageService — no incremental columns). MTEdr keeps only ~2-3 days live, so the archive UNION
// covers retention boundaries. Volume = SUM(PartsSent), same convention as the SMS Report.
const SEED_SQL = `
WITH M AS (
    SELECT CAST(mt.SubmitDateTime AS DATE) AS d,
           mt.CustomerConnectionId, mt.TerminatedSenderId, mt.PartsSent, mt.MtVendorConnectionId
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= CAST(DATEADD(day, -1, CAST(GETDATE() AS DATE)) AS DATETIME)
      AND mt.SubmitDateTime <  CAST(CAST(GETDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
    UNION ALL
    SELECT CAST(mt.SubmitDateTime AS DATE),
           mt.CustomerConnectionId, mt.TerminatedSenderId, mt.PartsSent, mt.MtVendorConnectionId
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= CAST(DATEADD(day, -1, CAST(GETDATE() AS DATE)) AS DATETIME)
      AND mt.SubmitDateTime <  CAST(CAST(GETDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
)
SELECT
    m.d                     AS [day],
    comp.Name               AS [client],
    m.TerminatedSenderId    AS [sender_id],
    SUM(m.PartsSent)        AS [volume]
FROM M m
JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK) ON mvc.MtVendorConnectionId = m.MtVendorConnectionId
JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK) ON cc.CustomerConnectionId  = m.CustomerConnectionId
JOIN SMSCPhoenix.dbo.Company comp           WITH(NOLOCK) ON comp.CompanyId           = cc.CompanyId
WHERE mvc.Name = '${VENDOR_NAME}'
  AND comp.CompanyDeleted = 0
GROUP BY m.d, comp.Name, m.TerminatedSenderId
ORDER BY SUM(m.PartsSent) DESC`;

const SEED_COLUMNS = [
  { key: 'day',       label: 'Day',       type: 'date',    description: 'Calendar date of the traffic (message submit date); the report covers the whole of yesterday.' },
  { key: 'client',    label: 'Client',    type: 'text',    description: 'Customer company that sent the traffic.' },
  { key: 'sender_id', label: 'SenderId',  type: 'text',    description: 'Terminated sender ID the messages were delivered under.' },
  { key: 'volume',    label: 'Volume',    type: 'numeric', description: `Message parts sent via ${VENDOR_NAME} to MCC/MNC ${MCCMNC}; SUM(PartsSent).` },
];

/** DATE columns come back as JS Dates at LOCAL midnight; read local parts (see sms-report toYMD). */
function toYMD(v: unknown): string {
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v ?? '').slice(0, 10);
}

@Injectable()
export class InnovatioTrafficService implements OnModuleInit {
  private readonly logger = new Logger(InnovatioTrafficService.name);
  private _datasetId: string | null = null;

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
      await this.ensureDatasetRecord();
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error('Innovatio Traffic Report dataset seed failed', err);
    }
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });
    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged || existing.name !== DATASET_NAME) {
        await this.datasetRepo.update(existing.id, {
          name:           DATASET_NAME,
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log('Updated Innovatio Traffic Report dataset SQL and column metadata');
      }
      return;
    }

    const asmsc = await this.dsRepo.findOne({ where: { name: ASMSC_DATASOURCE_NAME } });
    if (!asmsc) {
      this.logger.warn('ASMSC datasource not found — Innovatio Traffic Report dataset not seeded');
      return;
    }

    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name:           DATASET_NAME,
        description:    `Yesterday's SMS traffic terminated via supplier ${VENDOR_NAME} to MCC/MNC ${MCCMNC}, per client and sender ID.`,
        sourceDb:       'mssql',
        dataSourceId:   asmsc.id,
        sqlQuery:       SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron:   '30 1 * * *', // daily, after yesterday closes; user-adjustable in the UI
        isActive:       true,
        createdBy:      null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Innovatio Traffic Report dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };
    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [STAGE],
    );
    if (!row?.exists) {
      const colDefs = SEED_COLUMNS.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${STAGE} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`,
      );
      this.logger.log(`Stage table ${STAGE} created`);
      return;
    }
    const existing: { column_name: string }[] = await this.dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [STAGE],
    );
    const have = new Set(existing.map((r) => r.column_name));
    for (const c of SEED_COLUMNS) {
      if (!have.has(c.key)) {
        await this.dataSource.query(
          `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${c.key}" ${typeMap[c.type] ?? 'TEXT'}`,
        );
      }
    }
  }

  async getData(): Promise<any> {
    const stageRows: any[] = await this.dataSource
      .query(`SELECT day, client, sender_id, volume, refreshed_at FROM ${STAGE} ORDER BY volume DESC NULLS LAST, client ASC`)
      .catch((err: Error) => {
        this.logger.error(`Failed to read ${STAGE}: ${err.message}`);
        return [];
      });

    let lastRefreshed: string | null = null;
    const rows = stageRows.map((r: any) => {
      if (r.refreshed_at && (!lastRefreshed || r.refreshed_at > lastRefreshed)) lastRefreshed = r.refreshed_at;
      return {
        day:       toYMD(r.day),
        client:    r.client ?? null,
        sender_id: r.sender_id ?? null,
        volume:    Number(r.volume ?? 0),
      };
    });

    return {
      datasetId: this._datasetId,
      rows,
      lastRefreshed,
      summary: {
        day:         rows[0]?.day ?? null,
        totalVolume: rows.reduce((a, r) => a + r.volume, 0),
        clients:     new Set(rows.map((r) => r.client)).size,
        senders:     new Set(rows.map((r) => r.sender_id)).size,
        rowsCount:   rows.length,
      },
      scope: { vendor: VENDOR_NAME, mccmnc: MCCMNC },
    };
  }
}
