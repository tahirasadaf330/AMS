import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE = 'stage_innovatio_traffic';
const DATASET_NAME = 'Innovatio Traffic Report';
const ASMSC_DATASOURCE_NAME = 'ASMSC';

// Report scope — SMS traffic terminated via this supplier to this destination network,
// whole UTC days. Kept as constants for easy tweaks (exported for the daily alert seed).
export const VENDOR_NAME = 'Innovatio';
export const MCCMNC = '614004'; // Niger — Airtel

// History is kept from this fixed start date and grows daily: the stage is INCREMENTAL
// (incremental_initial_date + incremental_lookback_days on the dataset row). The engine's first
// load (empty table) pulls from START_DATE; every later run re-pulls only the last LOOKBACK_DAYS
// (the engine deletes stage rows WHERE "date" >= lookback and re-inserts — which is why the day
// column is named "date": the incremental delete in StageService is keyed to that name).
const START_DATE = '2026-03-01';
const LOOKBACK_DAYS = 3;

// TIMEZONE: aSMSC stores SubmitDateTime in UTC (verified: MAX(SubmitDateTime) tracks GETUTCDATE(),
// not the server's Pacific GETDATE()). AMS is UTC end-to-end, so day buckets are UTC days and all
// window bounds MUST be computed from GETUTCDATE() — never GETDATE(), whose Pacific date lags UTC by
// 7-8h and made the newest day resolve a day late. Yesterday-UTC is complete at 00:00 UTC, so the
// daily refresh runs shortly after, at 00:30 UTC.
const SCHEDULE_CRON = '30 0 * * *';
// Older seeded defaults, migrated once to SCHEDULE_CRON (user-customised crons are never touched):
// '30 1 * * *' (original), '30 9 * * *' (interim Pacific-midnight fix).
const LEGACY_CRONS = ['30 1 * * *', '30 9 * * *'];

// Whole UTC days from {{LOOKBACK_DATE}} (engine-substituted: START_DATE on the initial empty-table
// load, today-LOOKBACK_DAYS on daily runs) up to but excluding today — partial days never enter the
// stage. SubmitDateTime is UTC (see TIMEZONE note), so CAST(SubmitDateTime AS DATE) is a true UTC
// day and the upper bound uses GETUTCDATE(). MTEdr keeps only ~2-3 days live, so the archive UNION
// covers the rest. Volume = SUM(PartsSent), same convention as the SMS Report.
const SEED_SQL = `
WITH M AS (
    SELECT CAST(mt.SubmitDateTime AS DATE) AS d,
           mt.CustomerConnectionId, mt.TerminatedSenderId, mt.PartsSent, mt.MtVendorConnectionId
    FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= '{{LOOKBACK_DATE}}'
      AND mt.SubmitDateTime <  CAST(CAST(GETUTCDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
    UNION ALL
    SELECT CAST(mt.SubmitDateTime AS DATE),
           mt.CustomerConnectionId, mt.TerminatedSenderId, mt.PartsSent, mt.MtVendorConnectionId
    FROM SMSCArchiveEdr.dbo.ArchiveMtEdr mt WITH(NOLOCK)
    WHERE mt.SubmitDateTime >= '{{LOOKBACK_DATE}}'
      AND mt.SubmitDateTime <  CAST(CAST(GETUTCDATE() AS DATE) AS DATETIME)
      AND mt.MccMnc = '${MCCMNC}'
)
SELECT
    m.d                     AS [date],
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
  { key: 'date',      label: 'Day',       type: 'date',    description: `UTC calendar date of the traffic (message submit time, stored in UTC by aSMSC); history kept from ${START_DATE}, one new day appended daily.` },
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
      const incrChanged = existing.incrementalLookbackDays !== LOOKBACK_DAYS
        || existing.incrementalInitialDate !== START_DATE;
      if (sqlChanged || metaChanged || incrChanged || existing.name !== DATASET_NAME) {
        await this.datasetRepo.update(existing.id, {
          name:                    DATASET_NAME,
          sqlQuery:                SEED_SQL,
          columnMetadata:          SEED_COLUMNS as any,
          incrementalLookbackDays: LOOKBACK_DAYS,
          incrementalInitialDate:  START_DATE,
        });
        this.logger.log('Updated Innovatio Traffic Report dataset SQL, column metadata and incremental config');
      }
      // One-time migration off older seeded defaults (see LEGACY_CRONS) to the UTC-aligned schedule.
      // Only rewrites known old defaults, never a user-customised schedule.
      if (existing.scheduleCron && LEGACY_CRONS.includes(existing.scheduleCron)) {
        await this.datasetRepo.update(existing.id, { scheduleCron: SCHEDULE_CRON });
        this.logger.log(`Migrated Innovatio Traffic Report schedule to ${SCHEDULE_CRON} (UTC-day aligned)`);
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
        name:                    DATASET_NAME,
        description:             `SMS traffic terminated via supplier ${VENDOR_NAME} to MCC/MNC ${MCCMNC} — whole UTC days from ${START_DATE}, one day appended daily; per day / client / sender ID.`,
        sourceDb:                'mssql',
        dataSourceId:            asmsc.id,
        sqlQuery:                SEED_SQL,
        stageTableName:          STAGE,
        columnMetadata:          SEED_COLUMNS as any,
        scheduleCron:            SCHEDULE_CRON, // daily at 00:30 UTC, right after the UTC day closes; user-adjustable in the UI
        isActive:                true,
        createdBy:               null,
        incrementalLookbackDays: LOOKBACK_DAYS,
        incrementalInitialDate:  START_DATE,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log('Innovatio Traffic Report dataset record created');
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = { numeric: 'NUMERIC', date: 'DATE', text: 'TEXT' };

    // Legacy migration: the original schema named the day column "day", but StageService's
    // incremental delete is keyed to a column literally named "date" — so the old table must go.
    // It only holds derived data; the next (initial) incremental load rebuilds it from START_DATE.
    const legacy = await this.dataSource.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'day'`,
      [STAGE],
    );
    if (legacy.length) {
      await this.dataSource.query(`DROP TABLE IF EXISTS ${STAGE}`);
      this.logger.warn(`Dropped legacy ${STAGE} ("day" column schema) — rebuilt as "date" for incremental mode`);
    }

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
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} ("date" DESC)`,
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
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} ("date" DESC)`,
    );
  }

  /** Report payload for one selected day (default: the newest loaded day). */
  async getData(day?: string): Promise<any> {
    try {
      // Day picker options: every UTC day present in the stage, newest first. (The stage column is
      // named "date" for StageService's incremental delete; the API keeps exposing day/days.)
      const dayRows: any[] = await this.dataSource.query(
        `SELECT DISTINCT "date" AS day FROM ${STAGE} WHERE "date" IS NOT NULL ORDER BY "date" DESC`,
      );
      const days = dayRows.map((r) => toYMD(r.day));
      if (!days.length) {
        return { datasetId: this._datasetId, day: null, days: [], rows: [], byClient: [], bySender: [],
                 lastRefreshed: null, summary: this.emptySummary(), scope: { vendor: VENDOR_NAME, mccmnc: MCCMNC } };
      }
      const wanted = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && days.includes(day) ? day : days[0];

      const [stageRows, byClient, bySender, [refreshRow]] = await Promise.all([
        this.dataSource.query(
          `SELECT "date" AS day, client, sender_id, volume FROM ${STAGE}
            WHERE "date" = $1::date ORDER BY volume DESC NULLS LAST, client ASC`, [wanted]),
        this.dataSource.query(
          `SELECT client, SUM(volume)::bigint AS volume FROM ${STAGE}
            WHERE "date" = $1::date GROUP BY client ORDER BY SUM(volume) DESC, client ASC`, [wanted]),
        this.dataSource.query(
          `SELECT sender_id, SUM(volume)::bigint AS volume FROM ${STAGE}
            WHERE "date" = $1::date GROUP BY sender_id ORDER BY SUM(volume) DESC, sender_id ASC`, [wanted]),
        this.dataSource.query(`SELECT MAX(refreshed_at) AS last_refreshed FROM ${STAGE}`),
      ]);

      const rows = (stageRows as any[]).map((r: any) => ({
        day: toYMD(r.day), client: r.client ?? null, sender_id: r.sender_id ?? null, volume: Number(r.volume ?? 0),
      }));

      return {
        datasetId: this._datasetId,
        day: wanted,
        days,
        rows,
        byClient: (byClient as any[]).map((r: any) => ({ client: r.client ?? null, volume: Number(r.volume ?? 0) })),
        bySender: (bySender as any[]).map((r: any) => ({ sender_id: r.sender_id ?? null, volume: Number(r.volume ?? 0) })),
        lastRefreshed: refreshRow?.last_refreshed ?? null,
        summary: {
          day:         wanted,
          totalVolume: rows.reduce((a, r) => a + r.volume, 0),
          clients:     new Set(rows.map((r) => r.client)).size,
          senders:     new Set(rows.map((r) => r.sender_id)).size,
          rowsCount:   rows.length,
        },
        scope: { vendor: VENDOR_NAME, mccmnc: MCCMNC },
      };
    } catch (err) {
      this.logger.error(`Failed to read ${STAGE}: ${(err as Error).message}`);
      return { datasetId: this._datasetId, day: null, days: [], rows: [], byClient: [], bySender: [],
               lastRefreshed: null, summary: this.emptySummary(), scope: { vendor: VENDOR_NAME, mccmnc: MCCMNC } };
    }
  }

  private emptySummary() {
    return { day: null, totalVolume: 0, clients: 0, senders: 0, rowsCount: 0 };
  }
}
