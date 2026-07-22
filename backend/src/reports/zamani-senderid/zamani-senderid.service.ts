import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';

const STAGE        = 'stage_zamani_senderid';
const DATASET_NAME = 'Zamani Sender ID';

// The correct (exclusive) route for Zamani traffic. Anything terminated to a different vendor is
// mis-routed. Zamani destination = operator "Niger Orange (zamani)" (MccMnc 614004).
export const ZAMANI_VENDOR_CONNECTION_ID = 564;
const ZAMANI_OPERATOR = 'Niger Orange (zamani)';

// One row per MT message DESTINED to Zamani (any vendor — no vendor filter, unlike the daily
// zamani_traffic report), for a rolling ~48h window. StageService runs this in rolling-overlap
// incremental mode: first load backfills from {{SINCE}}; each ~5-min cycle re-pulls the last
// OVERLAP_MINUTES (by submit_datetime) so late-arriving DLRs settle; rows older than the retention
// window are pruned. The Zamani Sender-ID alerts + report read this table for their time windows.
//
// Scoped by DESTINATION (operator = Zamani), so mis-routed traffic (vendor <> 564) is INCLUDED and
// flagged via is_misrouted — that is exactly what the daily zamani_traffic report cannot see.
const SEED_SQL = `
SELECT
    CONVERT(date, mt.SubmitDateTime)                                    AS [date],
    CONVERT(VARCHAR(23), mt.SubmitDateTime, 126) + 'Z'                  AS submit_datetime,
    mt.TerminatedSenderId                                               AS terminated_senderid,
    cc.Name                                                             AS customer_connection,
    CONCAT(am.FirstName, ' ', am.LastName)                             AS account_manager,
    mvc.Name                                                            AS vendor_connection,
    mt.MtVendorConnectionId                                             AS mt_vendor_connection_id,
    CASE WHEN mt.MtVendorConnectionId = ${ZAMANI_VENDOR_CONNECTION_ID} THEN 0 ELSE 1 END AS is_misrouted,
    mmd.OperatorName                                                    AS operator,
    ds.DlrStatus                                                        AS dlr_status,
    CASE WHEN ds.DlrStatus = 'Delivered' THEN 1 ELSE 0 END             AS is_delivered
FROM SMSCEdr.dbo.MTEdr mt WITH(NOLOCK)
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc WITH(NOLOCK)
    ON cc.CustomerConnectionId = mt.CustomerConnectionId
LEFT JOIN SMSCPhoenix.dbo.Company comp WITH(NOLOCK)
    ON comp.CompanyId = cc.CompanyId
LEFT JOIN SMSCPhoenix.dbo.Users am WITH(NOLOCK)
    ON am.UserId = comp.SalesAccountManagerId
LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc WITH(NOLOCK)
    ON mvc.MtVendorConnectionId = mt.MtVendorConnectionId
LEFT JOIN SMSCPhoenix.dbo.MccMncDb mmd WITH(NOLOCK)
    ON mmd.MccMnc = mt.MccMnc
LEFT JOIN SMSCPhoenix.dbo.DlrStatus ds WITH(NOLOCK)
    ON ds.DlrStatusId = mt.DlrStatusId
WHERE mt.SubmitDateTime >= '{{SINCE}}'
  AND mmd.OperatorName = '${ZAMANI_OPERATOR}'
`;

// Rolling-overlap config (read by StageService via raw SQL).
const OVERLAP_MINUTES = 40;  // re-pull the last 40 min each cycle → late DLRs settle within it
const RETENTION_DAYS  = 2;   // keep ~today..2 days back → always ≥24h for the new-SD lookback
const SCHEDULE_CRON   = '*/5 * * * *';

const SEED_COLUMNS = [
  { key: 'date',                   label: 'Date',            type: 'date',      description: 'UTC calendar date of the message; grouping and retention-prune key.' },
  { key: 'submit_datetime',        label: 'Submit Time',     type: 'timestamp', description: 'UTC timestamp the message was submitted; indexed, drives all window queries.' },
  { key: 'terminated_senderid',    label: 'Sender ID',       type: 'text',      description: 'Originator / sender ID on the messages.' },
  { key: 'customer_connection',    label: 'Aggregator',      type: 'text',      description: 'Customer connection (aggregator) sending the traffic.' },
  { key: 'account_manager',        label: 'Account Manager', type: 'text',      description: "Customer's sales account manager (full name)." },
  { key: 'vendor_connection',      label: 'Vendor',          type: 'text',      description: 'Terminating vendor connection the message was routed to.' },
  { key: 'mt_vendor_connection_id', label: 'Vendor ID',      type: 'numeric',   description: 'Terminating vendor connection id; 564 = correct Zamani route.' },
  { key: 'is_misrouted',           label: 'Mis-routed',      type: 'numeric',   description: 'Flag 1/0: Zamani-destined but routed to a vendor other than 564.' },
  { key: 'operator',               label: 'Operator',        type: 'text',      description: 'Destination operator (Zamani).' },
  { key: 'dlr_status',             label: 'DLR Status',      type: 'text',      description: 'Delivery-receipt status of the message.' },
  { key: 'is_delivered',           label: 'Delivered',       type: 'numeric',   description: 'Flag 1/0: DLR status = Delivered. Volume is counted as messages (rows).' },
];

@Injectable()
export class ZamaniSenderIdService implements OnModuleInit {
  private readonly logger = new Logger(ZamaniSenderIdService.name);
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
      this.logger.error('Zamani Sender ID dataset seed failed', err as Error);
    }
  }

  get datasetId(): string | null {
    return this._datasetId;
  }

  private async ensureDatasetRecord(): Promise<void> {
    const existing = await this.datasetRepo.findOne({ where: { stageTableName: STAGE } });

    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged  = existing.sqlQuery !== SEED_SQL;
      const metaChanged = JSON.stringify(existing.columnMetadata) !== JSON.stringify(SEED_COLUMNS);
      const cronChanged = existing.scheduleCron !== SCHEDULE_CRON;
      if (sqlChanged || metaChanged || cronChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery:       SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
        });
        this.logger.log('Updated Zamani Sender ID dataset SQL, column metadata and schedule');
      }
    } else {
      const asmsc = await this.dsRepo.findOne({ where: { name: 'ASMSC' } });
      if (!asmsc) {
        this.logger.warn('ASMSC datasource not found — Zamani Sender ID dataset not seeded');
        return;
      }
      this.logger.log('Seeding Zamani Sender ID dataset…');
      const saved = await this.datasetRepo.save(
        this.datasetRepo.create({
          name:           DATASET_NAME,
          description:    'Per-message Zamani-destination traffic (any vendor) from ASMSC, rolling ~48h at 5-min overlap. Powers the Zamani Sender-ID report + alerts (routing, spike/AIT, new/stopped SD, delivery).',
          sourceDb:       'mssql',
          dataSourceId:   asmsc.id,
          sqlQuery:       SEED_SQL,
          stageTableName: STAGE,
          columnMetadata: SEED_COLUMNS as any,
          scheduleCron:   SCHEDULE_CRON,
          isActive:       true,
          createdBy:      null,
        }),
      );
      this._datasetId = saved.id;
      this.logger.log('Zamani Sender ID dataset record created');
    }

    // Rolling-overlap incremental config (columns not on the entity → raw SQL, idempotent).
    if (this._datasetId) {
      await this.dataSource.query(
        `UPDATE datasets
           SET incremental_overlap_minutes  = $2,
               incremental_timestamp_column = 'submit_datetime',
               retention_days               = $3,
               incremental_lookback_days    = NULL
         WHERE id = $1`,
        [this._datasetId, OVERLAP_MINUTES, RETENTION_DAYS],
      ).catch((e: Error) => this.logger.error(`Failed to set Zamani Sender ID overlap config: ${e.message}`));
    }
  }

  private async ensureStageTable(): Promise<void> {
    const typeMap: Record<string, string> = {
      numeric: 'NUMERIC', date: 'DATE', text: 'TEXT', timestamp: 'TIMESTAMPTZ',
    };

    const [row] = await this.dataSource.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
      [STAGE],
    );

    if (!row?.exists) {
      this.logger.log(`Creating stage table: ${STAGE}`);
      const colDefs = SEED_COLUMNS.map((c) => `"${c.key}" ${typeMap[c.type] ?? 'TEXT'}`).join(', ');
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${STAGE} (
          id           BIGSERIAL   PRIMARY KEY,
          refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ${colDefs}
        )
      `);
    } else {
      const existingCols: { column_name: string }[] = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [STAGE],
      );
      const existingSet = new Set(existingCols.map((r) => r.column_name));
      const wanted = new Set(SEED_COLUMNS.map((c) => c.key));
      for (const col of SEED_COLUMNS) {
        if (!existingSet.has(col.key)) {
          await this.dataSource.query(
            `ALTER TABLE ${STAGE} ADD COLUMN IF NOT EXISTS "${col.key}" ${typeMap[col.type] ?? 'TEXT'}`,
          );
          this.logger.log(`Added missing column "${col.key}" to ${STAGE}`);
        }
      }
      for (const name of existingSet) {
        if (name !== 'id' && name !== 'refreshed_at' && !wanted.has(name)) {
          await this.dataSource.query(`ALTER TABLE ${STAGE} DROP COLUMN IF EXISTS "${name}"`);
          this.logger.log(`Dropped obsolete column "${name}" from ${STAGE}`);
        }
      }
    }

    // Indexes (idempotent): timestamp range scans, prune/grouping, and sender-ID window queries.
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_submit ON ${STAGE} (submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (date DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_sid ON ${STAGE} (terminated_senderid, submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_misrouted ON ${STAGE} (is_misrouted, submit_datetime DESC)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_${STAGE}_refreshed ON ${STAGE} (refreshed_at DESC)`);
  }

  /**
   * Aggregate per Sender ID over [from,to] (ISO-8601 UTC). Both optional; omitted → whole window.
   * Used by the Zamani Sender-ID report page.
   */
  async getData(from?: string, to?: string): Promise<any> {
    const rows: any[] = await this.dataSource.query(
      `SELECT
         terminated_senderid                                              AS sender_id,
         MAX(customer_connection)                                         AS aggregator,
         MAX(account_manager)                                             AS account_manager,
         COUNT(*)::bigint                                                 AS submitted,
         SUM(is_delivered)::bigint                                        AS delivered,
         SUM(is_misrouted)::bigint                                        AS misrouted,
         MIN(submit_datetime)                                            AS first_seen,
         MAX(submit_datetime)                                            AS last_seen
       FROM ${STAGE}
       WHERE ($1::timestamptz IS NULL OR submit_datetime >= $1::timestamptz)
         AND ($2::timestamptz IS NULL OR submit_datetime <= $2::timestamptz)
       GROUP BY terminated_senderid
       ORDER BY submitted DESC`,
      [from ?? null, to ?? null],
    );
    return rows.map((r) => ({
      ...r,
      submitted: Number(r.submitted),
      delivered: Number(r.delivered),
      misrouted: Number(r.misrouted),
      dlr_pct: Number(r.submitted) > 0 ? +(Number(r.delivered) * 100 / Number(r.submitted)).toFixed(2) : 0,
    }));
  }
}
