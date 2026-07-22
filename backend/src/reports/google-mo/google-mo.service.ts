import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import * as ExcelJS from "exceljs";
import { Dataset } from "../../common/entities/dataset.entity";
import { ExternalDataSource } from "../../common/entities/data-source.entity";
import { CredentialsService } from "../../credentials/credentials.service";

const STAGE = "google_mo_traffic";
const ESTIMATES_TABLE = "google_mo_estimates";
const COST_TABLE = "google_mo_cost";
const ASMSC_DATASOURCE_NAME = "ASMSC";
const DATASET_NAME = "Google MO Traffic";

// Aggregated daily MSSQL query — each row = one date/mccmnc/country/operator/vendor/customer combination.
// Column names match sanitizeRowKeys() output (lowercase, non-alnum → stripped).
const SEED_SQL = `\
WITH MoData AS (
    SELECT
        mo.ReceivedDateTime,
        mo.MccMnc,
        mo.CustomerCost,
        mo.VendorCost,
        mo.MtVendorConnectionId,
        mo.CustomerConnectionId
    FROM SMSCEdr.dbo.MoEdr AS mo WITH(NOLOCK)
    WHERE mo.MccMnc IS NOT NULL
      AND mo.ReceivedDateTime >= DATEADD(MONTH, -6, GETDATE())

    UNION ALL

    SELECT
        mo.ReceivedDateTime,
        mo.MccMnc,
        mo.CustomerCost,
        mo.VendorCost,
        mo.MtVendorConnectionId,
        mo.CustomerConnectionId
    FROM SMSCArchiveEdr.dbo.ArchiveMoEdr AS mo WITH(NOLOCK)
    WHERE mo.MccMnc IS NOT NULL
      AND mo.ReceivedDateTime >= DATEADD(MONTH, -6, GETDATE())
)
SELECT
    CAST(mo.ReceivedDateTime AS DATE)                                                              AS ReceivedDate,
    CAST(mo.MccMnc AS NVARCHAR(20))                                                               AS MccMnc,
    c.CountryName,
    mmd.OperatorName,
    mvc.name                                                                                       AS VendorName,
    cc.Name                                                                                        AS CustomerName,
    COUNT(*)                                                                                       AS Volume,
    ROUND(SUM(ISNULL(mo.CustomerCost, 0)), 5)                                                     AS Revenue,
    ROUND(SUM(CASE WHEN c.CountryName = 'Ghana'
                   THEN ISNULL(mo.VendorCost, 0) * 0.091
                   ELSE ISNULL(mo.VendorCost, 0) END), 5)                                        AS VendorCost,
    ROUND(SUM(CASE WHEN c.CountryName = 'Ghana'
                   THEN (ISNULL(mo.CustomerCost, 0) - ISNULL(mo.VendorCost, 0) * 0.091)
                   ELSE (ISNULL(mo.CustomerCost, 0) - ISNULL(mo.VendorCost, 0)) END), 5)         AS Margin
FROM MoData AS mo
LEFT JOIN SMSCPhoenix.dbo.MccMncDb           mmd ON mmd.MccMnc               = mo.MccMnc
LEFT JOIN SMSCPhoenix.dbo.Countries          c   ON c.CountryId              = mmd.CountryId
LEFT JOIN SMSCPhoenix.dbo.MtVendorConnection mvc ON mvc.MtVendorConnectionId = mo.MtVendorConnectionId
LEFT JOIN SMSCPhoenix.dbo.CustomerConnections cc  ON cc.CustomerConnectionId  = mo.CustomerConnectionId
WHERE cc.Name NOT IN ('test_asmsc', 'test_asmsc1')
GROUP BY
    CAST(mo.ReceivedDateTime AS DATE),
    mo.MccMnc,
    c.CountryName,
    mmd.OperatorName,
    mvc.name,
    cc.Name
ORDER BY ReceivedDate DESC, CountryName, OperatorName`;

const SEED_COLUMNS = [
  { key: "receiveddate", label: "Date", type: "date", description: "Calendar date the MO traffic was received; grouping key." },
  { key: "mccmnc", label: "MCC/MNC", type: "text", description: "Combined mobile country + network code of the origin operator." },
  { key: "countryname", label: "Country Name", type: "text", description: "Origin country name (from MCC/MNC lookup)." },
  { key: "operatorname", label: "Operator Name", type: "text", description: "Origin mobile operator name (from MCC/MNC lookup)." },
  { key: "vendorname", label: "Vendor Name", type: "text", description: "Vendor/supplier connection carrying the MO traffic." },
  { key: "customername", label: "Customer Name", type: "text", description: "Customer receiving the Google MO traffic." },
  { key: "volume", label: "Volume", type: "numeric", description: "Number of MO messages that day; precomputed SUM." },
  { key: "revenue", label: "Revenue", type: "numeric", description: "Customer revenue in USD; precomputed SUM." },
  { key: "vendorcost", label: "Vendor Cost", type: "numeric", description: "Vendor cost in USD; precomputed SUM." },
  { key: "margin", label: "Margin", type: "numeric", description: "Revenue minus vendor cost in USD; precomputed." },
];

@Injectable()
export class GoogleMoService implements OnModuleInit {
  private readonly logger = new Logger(GoogleMoService.name);
  private _datasetId: string | null = null;

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Dataset)
    private readonly datasetRepo: Repository<Dataset>,
    @InjectRepository(ExternalDataSource)
    private readonly dsRepo: Repository<ExternalDataSource>,
    private readonly credentialsService: CredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAuxTables();
    await this.seedDataset();
  }

  // ── Bootstrap ──────────────────────────────────────────────────

  private async ensureAuxTables(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${ESTIMATES_TABLE} (
          id          SERIAL PRIMARY KEY,
          country     TEXT UNIQUE NOT NULL,
          estimation  NUMERIC(18,2) NOT NULL DEFAULT 0,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Upgrade column type for pre-existing installations that used BIGINT
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = '${ESTIMATES_TABLE}'
              AND column_name = 'estimation'
              AND data_type = 'bigint'
          ) THEN
            ALTER TABLE ${ESTIMATES_TABLE} ALTER COLUMN estimation TYPE NUMERIC(18,2);
          END IF;
        END $$;
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS ${COST_TABLE} (
          id            SERIAL PRIMARY KEY,
          country       TEXT NOT NULL,
          year          INTEGER NOT NULL,
          month         INTEGER NOT NULL,
          monthly_cost  NUMERIC(18,4) NOT NULL DEFAULT 0,
          miscellaneous NUMERIC(18,4) NOT NULL DEFAULT 0,
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT google_mo_cost_ym_country UNIQUE (country, year, month)
        )
      `);
    } catch (err) {
      this.logger.error("Failed to ensure aux tables", err);
    }
  }

  private async seedDataset(): Promise<void> {
    try {
      const datasourceId = await this.ensureAsmscDatasource();
      await this.ensureDatasetRecord(datasourceId);
      await this.ensureStageTable();
    } catch (err) {
      this.logger.error("Google MO dataset seed failed", err);
    }
  }

  private async ensureAsmscDatasource(): Promise<string> {
    const existing = await this.dsRepo.findOne({
      where: { name: ASMSC_DATASOURCE_NAME },
    });
    if (existing) return existing.id;

    this.logger.log("Seeding ASMSC datasource…");
    const encryptedPass = this.credentialsService.encrypt("G)798884098550at**");
    const created = await this.dsRepo.save(
      this.dsRepo.create({
        name: ASMSC_DATASOURCE_NAME,
        type: "mssql",
        host: "10.10.8.219",
        port: 1433,
        db: "SMSCPhoenix",
        username: "ROUser1",
        password: encryptedPass,
        sslMode: "disable",
        isActive: true,
        createdBy: null,
      }),
    );
    this.logger.log(`ASMSC datasource created: ${created.id}`);
    return created.id;
  }

  private async ensureDatasetRecord(datasourceId: string): Promise<void> {
    const existing = await this.datasetRepo.findOne({
      where: { stageTableName: STAGE },
    });
    if (existing) {
      this._datasetId = existing.id;
      const sqlChanged = existing.sqlQuery !== SEED_SQL;
      const metaChanged =
        JSON.stringify(existing.columnMetadata) !==
        JSON.stringify(SEED_COLUMNS);
      if (sqlChanged || metaChanged) {
        await this.datasetRepo.update(existing.id, {
          sqlQuery: SEED_SQL,
          columnMetadata: SEED_COLUMNS as any,
        });
        this.logger.log("Updated Google MO Traffic dataset SQL/metadata");
      }
      return;
    }

    this.logger.log("Seeding Google MO Traffic dataset…");
    const saved = await this.datasetRepo.save(
      this.datasetRepo.create({
        name: DATASET_NAME,
        description:
          "Google MO traffic from SMSCPhoenix — daily aggregated volume, revenue, vendor cost and margin by country/operator/customer.",
        sourceDb: "mssql",
        dataSourceId: datasourceId,
        sqlQuery: SEED_SQL,
        stageTableName: STAGE,
        columnMetadata: SEED_COLUMNS as any,
        scheduleCron: "0 */6 * * *",
        isActive: true,
        createdBy: null,
      }),
    );
    this._datasetId = saved.id;
    this.logger.log("Google MO Traffic dataset record created");
  }

  /** True if the given dataset is the Google MO Traffic dataset (matched by stage table / name). */
  isGoogleMoDataset(dataset: {
    stageTableName?: string | null;
    name?: string | null;
  }): boolean {
    return dataset?.stageTableName === STAGE || dataset?.name === DATASET_NAME;
  }

  private async ensureStageTable(): Promise<void> {
    const [row] = await this.dataSource.query(
      `SELECT to_regclass($1)::text AS tbl`,
      [STAGE],
    );
    if (row?.tbl) return;

    this.logger.log(`Creating stage table: ${STAGE}`);
    const typeMap: Record<string, string> = {
      numeric: "NUMERIC",
      date: "DATE",
      text: "TEXT",
    };
    const colDefs = SEED_COLUMNS.map(
      (c) => `"${c.key}" ${typeMap[c.type] ?? "TEXT"}`,
    ).join(", ");

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
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_date ON ${STAGE} (receiveddate DESC)`,
    );
    await this.dataSource.query(
      `CREATE INDEX IF NOT EXISTS idx_${STAGE}_country ON ${STAGE} (countryname, receiveddate DESC)`,
    );
    this.logger.log(`Stage table ${STAGE} created`);
  }

  // ── Helpers ────────────────────────────────────────────────────

  private async stageExists(): Promise<boolean> {
    const [row] = await this.dataSource.query(
      `SELECT to_regclass($1)::text AS tbl`,
      [STAGE],
    );
    return !!row?.tbl;
  }

  private fmtDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  private diffPct(o: unknown, n: unknown): number {
    const ov = Number(o ?? 0);
    const nv = Number(n ?? 0);
    if (ov === 0) return nv !== 0 ? 100 : 0;
    return Number(((nv - ov) / Math.abs(ov)) * 100);
  }

  private sumTotals(rows: any[]) {
    return rows.reduce(
      (acc: any, r: any) => ({
        volume: acc.volume + Number(r.volume ?? 0),
        revenue: acc.revenue + Number(r.revenue ?? 0),
        vendor_cost: acc.vendor_cost + Number(r.vendor_cost ?? 0),
        margin: acc.margin + Number(r.margin ?? 0),
      }),
      { volume: 0, revenue: 0, vendor_cost: 0, margin: 0 },
    );
  }

  // ── Filters ────────────────────────────────────────────────────

  async getFilters() {
    if (!(await this.stageExists())) {
      return {
        datasetId: this._datasetId,
        mccmncs: [],
        customers: [],
        countries: [],
        operators: [],
        vendors: [],
        latestDate: null,
        lastRefreshed: null,
        availableDates: [],
        availableYears: [],
        availableMonths: [],
      };
    }

    // mccmncs / countries / operators are pre-filtered to Google_DIR + non-Iristel for Data Table dropdowns
    const GDIR = `customername = 'Google_DIR' AND COALESCE(vendorname, '') <> 'Iristel_p2p'`;

    const [
      mccmncs,
      customers,
      countries,
      operators,
      vendors,
      [latest],
      [refresh],
      dates,
      years,
      months,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT mccmnc       AS v FROM ${STAGE} WHERE ${GDIR} AND mccmnc IS NOT NULL       ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT customername AS v FROM ${STAGE} WHERE customername IS NOT NULL ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT countryname  AS v FROM ${STAGE} WHERE ${GDIR} AND countryname IS NOT NULL  ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT operatorname AS v FROM ${STAGE} WHERE ${GDIR} AND operatorname IS NOT NULL ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT vendorname   AS v FROM ${STAGE} WHERE vendorname IS NOT NULL   ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT MAX(receiveddate)::text AS d FROM ${STAGE}`,
      ),
      this.dataSource.query(
        `SELECT MAX(refreshed_at)::text AS ts FROM ${STAGE}`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT receiveddate::text AS d FROM ${STAGE} ORDER BY 1 DESC LIMIT 90`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT year AS y FROM ${COST_TABLE} ORDER BY 1 DESC`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT month AS m FROM ${COST_TABLE} WHERE year = EXTRACT(YEAR FROM CURRENT_DATE)::int ORDER BY 1`,
      ),
    ]);

    return {
      datasetId: this._datasetId,
      mccmncs: mccmncs.map((r: any) => r.v),
      customers: customers.map((r: any) => r.v),
      countries: countries.map((r: any) => r.v),
      operators: operators.map((r: any) => r.v),
      vendors: vendors.map((r: any) => r.v),
      latestDate: latest?.d ?? null,
      lastRefreshed: refresh?.ts ?? null,
      availableDates: dates.map((r: any) => r.d),
      availableYears: years.map((r: any) => r.y),
      availableMonths: months.map((r: any) => r.m),
    };
  }

  // ── Data Table ─────────────────────────────────────────────────
  // Hard filters always applied: customername = 'Google_DIR' AND vendor NOT iristel
  // Date range defaults to last 5 days (today − 4 .. today) when not provided.
  // mccmnc / country / operator are optional user-selected filters.

  async getData(params: {
    date_start?: string;
    date_end?: string;
    mccmnc?: string;
    country?: string;
    operator?: string;
  }) {
    if (!(await this.stageExists()))
      return { rows: [], totals: null, trends: [], operatorSummary: [] };

    const today = new Date();
    const fiveAgo = new Date(today);
    fiveAgo.setDate(today.getDate() - 4);
    const dateStart = params.date_start || this.fmtDate(fiveAgo);
    const dateEnd = params.date_end || this.fmtDate(today);

    const args: unknown[] = [dateStart, dateEnd];
    const conds: string[] = [
      `customername = 'Google_DIR'`,
      `COALESCE(vendorname, '') <> 'Iristel_p2p'`,
      `receiveddate >= $1::date`,
      `receiveddate <= $2::date`,
    ];
    if (params.mccmnc) conds.push(`mccmnc = $${args.push(params.mccmnc)}`);
    if (params.country)
      conds.push(`countryname = $${args.push(params.country)}`);
    if (params.operator)
      conds.push(`operatorname = $${args.push(params.operator)}`);
    const whereClause = `WHERE ${conds.join(" AND ")}`;

    // Fixed 30-day window for trend chart and 30-day operator bar chart
    // Shares optional filters (mccmnc/country/operator) but always uses last 30 days
    const today30 = new Date();
    const thirty = new Date(today30);
    thirty.setDate(today30.getDate() - 29);
    const args30: unknown[] = [this.fmtDate(thirty), this.fmtDate(today30)];
    const conds30: string[] = [
      `customername = 'Google_DIR'`,
      `COALESCE(vendorname, '') <> 'Iristel_p2p'`,
      `receiveddate >= $1::date`,
      `receiveddate <= $2::date`,
    ];
    if (params.mccmnc) conds30.push(`mccmnc = $${args30.push(params.mccmnc)}`);
    if (params.country)
      conds30.push(`countryname = $${args30.push(params.country)}`);
    if (params.operator)
      conds30.push(`operatorname = $${args30.push(params.operator)}`);
    const where30 = `WHERE ${conds30.join(" AND ")}`;

    const [rows, totalsResult, trends30, operatorSummary, operatorSummary30] =
      await Promise.all([
        // All matching rows — no LIMIT so pagination shows complete data
        this.dataSource.query(
          `SELECT
           receiveddate::text AS date,
           mccmnc,
           countryname  AS country_name,
           operatorname AS operator_name,
           customername AS customer_name,
           vendorname   AS vendor_name,
           volume::bigint,
           ROUND(revenue::numeric, 4)    AS revenue,
           ROUND(vendorcost::numeric, 4) AS vendor_cost,
           ROUND(margin::numeric, 4)     AS margin
         FROM ${STAGE}
         ${whereClause}`,
          args,
        ),
        // Accurate totals — single-pass aggregate with no row limit
        this.dataSource.query(
          `SELECT
           SUM(volume)::bigint                AS volume,
           ROUND(SUM(revenue)::numeric, 4)    AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4) AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)     AS margin
         FROM ${STAGE}
         ${whereClause}`,
          args,
        ),
        // Trend always uses last 30 days regardless of selected date range
        this.dataSource.query(
          `SELECT
           receiveddate::text                    AS date,
           SUM(volume)::bigint                   AS volume,
           ROUND(SUM(revenue)::numeric, 4)       AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4)    AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)        AS margin
         FROM ${STAGE}
         ${where30}
         GROUP BY receiveddate
         ORDER BY receiveddate`,
          args30,
        ),
        // Operator summary for selected date range
        this.dataSource.query(
          `SELECT
           operatorname AS operator_name,
           SUM(volume)::bigint                   AS volume,
           ROUND(SUM(revenue)::numeric, 4)       AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4)    AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)        AS margin
         FROM ${STAGE}
         ${whereClause}
         GROUP BY operatorname
         ORDER BY volume DESC`,
          args,
        ),
        // Operator summary always last 30 days — top 12 by volume for bar chart
        this.dataSource.query(
          `SELECT
           operatorname AS operator_name,
           SUM(volume)::bigint                   AS volume,
           ROUND(SUM(revenue)::numeric, 4)       AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4)    AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)        AS margin
         FROM ${STAGE}
         ${where30}
         GROUP BY operatorname
         ORDER BY volume DESC
         LIMIT 12`,
          args30,
        ),
      ]);

    const t = totalsResult[0] ?? {};
    const totals = {
      volume: Number(t.volume ?? 0),
      revenue: Number(t.revenue ?? 0),
      vendor_cost: Number(t.vendor_cost ?? 0),
      margin: Number(t.margin ?? 0),
    };

    return {
      rows,
      totals,
      trends30,
      operatorSummary,
      operatorSummary30,
      date_start: dateStart,
      date_end: dateEnd,
    };
  }

  // ── Comparison ─────────────────────────────────────────────────

  async getComparison(params: {
    date_old?: string;
    date_new?: string;
    customer?: string;
    countries: string[];
    operators: string[];
  }) {
    if (!(await this.stageExists()))
      return { rows: [], trends: [], yesterdayVsDayBefore: [] };

    // Resolve dates — if not provided, use the two most recent distinct dates
    let dateOld = params.date_old;
    let dateNew = params.date_new;

    const GDIR = `customername = 'Google_DIR' AND COALESCE(vendorname, '') <> 'Iristel_p2p'`;

    if (!dateOld || !dateNew) {
      const recentDates = await this.dataSource.query(
        `SELECT DISTINCT receiveddate::text AS d FROM ${STAGE} WHERE ${GDIR} ORDER BY 1 DESC LIMIT 2`,
      );
      dateNew = recentDates[0]?.d ?? null;
      dateOld = recentDates[1]?.d ?? dateNew;
    }

    const args: unknown[] = [dateOld, dateNew];
    const extra: string[] = [];
    if (params.countries?.length)
      extra.push(
        `AND countryname = ANY($${args.push(params.countries)}::text[])`,
      );
    if (params.operators?.length)
      extra.push(
        `AND operatorname = ANY($${args.push(params.operators)}::text[])`,
      );
    const extraStr = extra.join(" ");

    // 7-day window args (no date_old/date_new)
    const trendArgs: unknown[] = [];
    const trendExtra: string[] = [];
    if (params.countries?.length)
      trendExtra.push(
        `AND countryname = ANY($${trendArgs.push(params.countries)}::text[])`,
      );
    if (params.operators?.length)
      trendExtra.push(
        `AND operatorname = ANY($${trendArgs.push(params.operators)}::text[])`,
      );
    const trendExtraStr = trendExtra.join(" ");

    const [rows, trends, yvdb] = await Promise.all([
      // Main comparison table by country
      this.dataSource.query(
        `SELECT
           countryname AS country_name,
           SUM(CASE WHEN receiveddate = $1::date THEN volume     ELSE 0 END)::bigint        AS volume_old,
           SUM(CASE WHEN receiveddate = $2::date THEN volume     ELSE 0 END)::bigint        AS volume_new,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN revenue     ELSE 0 END)::numeric, 4) AS revenue_old,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN revenue     ELSE 0 END)::numeric, 4) AS revenue_new,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN vendorcost  ELSE 0 END)::numeric, 4) AS vendor_cost_old,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN vendorcost  ELSE 0 END)::numeric, 4) AS vendor_cost_new,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN margin      ELSE 0 END)::numeric, 4) AS margin_old,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN margin      ELSE 0 END)::numeric, 4) AS margin_new
         FROM ${STAGE}
         WHERE ${GDIR}
           AND receiveddate IN ($1::date, $2::date)
           ${extraStr}
         GROUP BY countryname
         HAVING SUM(CASE WHEN receiveddate = $1::date THEN volume ELSE 0 END) > 0
             OR SUM(CASE WHEN receiveddate = $2::date THEN volume ELSE 0 END) > 0
         ORDER BY volume_new DESC`,
        args,
      ),
      // Last 7 days trends by country (for line chart)
      this.dataSource.query(
        `SELECT
           receiveddate::text AS date,
           countryname        AS country_name,
           ROUND(SUM(revenue)::numeric, 4) AS revenue,
           SUM(volume)::bigint             AS volume,
           ROUND(SUM(margin)::numeric, 4)  AS margin,
           ROUND(SUM(vendorcost)::numeric, 4) AS vendor_cost
         FROM ${STAGE}
         WHERE ${GDIR}
           AND receiveddate IN (
             SELECT DISTINCT receiveddate FROM ${STAGE}
             WHERE ${GDIR}
             ORDER BY receiveddate DESC LIMIT 7
           )
           ${trendExtraStr}
         GROUP BY receiveddate, countryname
         ORDER BY receiveddate, countryname`,
        trendArgs,
      ),
      // Yesterday vs Day Before Yesterday — mirrors the main comparison: same dates, same HAVING filter
      this.dataSource.query(
        `SELECT
           countryname AS country_name,
           SUM(CASE WHEN receiveddate = $1::date THEN volume     ELSE 0 END)::bigint        AS volume_td1,
           SUM(CASE WHEN receiveddate = $2::date THEN volume     ELSE 0 END)::bigint        AS volume_td2,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN revenue    ELSE 0 END)::numeric, 4) AS revenue_td1,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN revenue    ELSE 0 END)::numeric, 4) AS revenue_td2,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN vendorcost ELSE 0 END)::numeric, 4) AS vendor_cost_td1,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN vendorcost ELSE 0 END)::numeric, 4) AS vendor_cost_td2,
           ROUND(SUM(CASE WHEN receiveddate = $1::date THEN margin     ELSE 0 END)::numeric, 4) AS margin_td1,
           ROUND(SUM(CASE WHEN receiveddate = $2::date THEN margin     ELSE 0 END)::numeric, 4) AS margin_td2
         FROM ${STAGE}
         WHERE ${GDIR}
           AND receiveddate IN ($1::date, $2::date)
           ${extraStr}
         GROUP BY countryname
         HAVING SUM(CASE WHEN receiveddate = $1::date THEN volume ELSE 0 END) > 0
             OR SUM(CASE WHEN receiveddate = $2::date THEN volume ELSE 0 END) > 0
         ORDER BY volume_td2 DESC`,
        args,
      ),
    ]);

    const enrichedRows = rows.map((r: any) => ({
      ...r,
      volume_diff_pct: this.diffPct(r.volume_old, r.volume_new),
      revenue_diff_pct: this.diffPct(r.revenue_old, r.revenue_new),
      vendor_cost_diff_pct: this.diffPct(r.vendor_cost_old, r.vendor_cost_new),
      margin_diff_pct: this.diffPct(r.margin_old, r.margin_new),
    }));

    const enrichedYvdb = yvdb.map((r: any) => ({
      ...r,
      volume_diff_pct: this.diffPct(r.volume_td1, r.volume_td2),
      revenue_diff_pct: this.diffPct(r.revenue_td1, r.revenue_td2),
      margin_diff_pct: this.diffPct(r.margin_td1, r.margin_td2),
    }));

    return {
      rows: enrichedRows,
      totals_old: this.sumTotals(
        rows.map((r: any) => ({
          volume: r.volume_old,
          revenue: r.revenue_old,
          vendor_cost: r.vendor_cost_old,
          margin: r.margin_old,
        })),
      ),
      totals_new: this.sumTotals(
        rows.map((r: any) => ({
          volume: r.volume_new,
          revenue: r.revenue_new,
          vendor_cost: r.vendor_cost_new,
          margin: r.margin_new,
        })),
      ),
      date_old: dateOld,
      date_new: dateNew,
      trends,
      yesterday_vs_day_before: enrichedYvdb,
    };
  }

  // ── Profit and Loss ────────────────────────────────────────────

  async getProfitLoss(params: {
    mccmnc?: string;
    year?: number;
    month?: number;
    countries: string[];
    operators: string[];
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null };

    const args: unknown[] = [];
    const conds: string[] = [];

    if (params.mccmnc) conds.push(`t.mccmnc = $${args.push(params.mccmnc)}`);
    if (params.year)
      conds.push(
        `EXTRACT(YEAR  FROM t.receiveddate) = $${args.push(params.year)}`,
      );
    if (params.month)
      conds.push(
        `EXTRACT(MONTH FROM t.receiveddate) = $${args.push(params.month)}`,
      );
    if (params.countries?.length)
      conds.push(
        `t.countryname = ANY($${args.push(params.countries)}::text[])`,
      );
    if (params.operators?.length)
      conds.push(
        `t.operatorname = ANY($${args.push(params.operators)}::text[])`,
      );

    const GDIR_FILTER = `t.customername = 'Google_DIR' AND COALESCE(t.vendorname, '') <> 'Iristel_p2p'`;
    const whereClause = conds.length
      ? `WHERE ${GDIR_FILTER} AND ${conds.join(" AND ")}`
      : `WHERE ${GDIR_FILTER}`;

    let rows: any[];
    try {
      rows = await this.dataSource.query(
        `SELECT
           TO_CHAR(DATE_TRUNC('month', t.receiveddate), 'Month')             AS month_name,
           EXTRACT(YEAR  FROM DATE_TRUNC('month', t.receiveddate))::int      AS year,
           EXTRACT(MONTH FROM DATE_TRUNC('month', t.receiveddate))::int      AS month_num,
           t.countryname                                                      AS country_name,
           SUM(t.volume)::bigint                                              AS volume,
           ROUND(SUM(t.revenue)::numeric, 4)                                 AS revenue,
           ROUND(SUM(t.vendorcost)::numeric, 4)                              AS vendor_cost,
           ROUND(SUM(t.margin)::numeric, 4)                                  AS stage_margin,
           COALESCE(gmc.monthly_cost, 0)                                     AS monthly_cost,
           COALESCE(gmc.miscellaneous, 0)                                    AS miscellaneous,
           COALESCE(gmc.monthly_cost, 0) + COALESCE(gmc.miscellaneous, 0)   AS monthly_misc_cost,
           ROUND((SUM(t.revenue) - SUM(t.vendorcost)
             - COALESCE(gmc.monthly_cost, 0)
             - COALESCE(gmc.miscellaneous, 0))::numeric, 4)                  AS margin
         FROM ${STAGE} t
         LEFT JOIN ${COST_TABLE} gmc
           ON LOWER(gmc.country) = LOWER(t.countryname)
          AND gmc.year  = EXTRACT(YEAR  FROM t.receiveddate)
          AND gmc.month = EXTRACT(MONTH FROM t.receiveddate)
         ${whereClause}
         GROUP BY
           DATE_TRUNC('month', t.receiveddate),
           t.countryname,
           gmc.monthly_cost,
           gmc.miscellaneous
         ORDER BY year DESC, month_num, country_name`,
        args,
      );
    } catch (err) {
      this.logger.error("getProfitLoss query failed", err);
      throw err;
    }

    return { rows, totals: this.sumTotals(rows) };
  }

  // ── Yesterday ──────────────────────────────────────────────────

  async getYesterday(params: {
    mccmnc?: string;
    countries: string[];
    operators: string[];
  }) {
    if (!(await this.stageExists()))
      return { rows: [], totals: null, chartData: [] };

    const GDIR = `customername = 'Google_DIR' AND COALESCE(vendorname, '') <> 'Iristel_p2p'`;
    const yesterday = `(CURRENT_DATE - INTERVAL '1 day')::date`;

    const args: unknown[] = [];
    const extra: string[] = [];
    if (params.mccmnc) extra.push(`AND mccmnc = $${args.push(params.mccmnc)}`);
    if (params.countries?.length)
      extra.push(`AND countryname = ANY($${args.push(params.countries)}::text[])`);
    if (params.operators?.length)
      extra.push(`AND operatorname = ANY($${args.push(params.operators)}::text[])`);
    const extraStr = extra.join(" ");

    const [rows, chartData] = await Promise.all([
      this.dataSource.query(
        `SELECT
           receiveddate::text AS date,
           countryname        AS country_name,
           operatorname       AS operator_name,
           vendorname         AS vendor_name,
           SUM(volume)::bigint                AS volume,
           ROUND(SUM(revenue)::numeric, 4)    AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4) AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)     AS margin
         FROM ${STAGE}
         WHERE ${GDIR}
           AND receiveddate = ${yesterday}
           ${extraStr}
         GROUP BY receiveddate, countryname, operatorname, vendorname
         ORDER BY countryname, volume DESC`,
        args,
      ),
      this.dataSource.query(
        `SELECT
           countryname AS country_name,
           SUM(volume)::bigint                AS volume,
           ROUND(SUM(revenue)::numeric, 4)    AS revenue,
           ROUND(SUM(vendorcost)::numeric, 4) AS vendor_cost,
           ROUND(SUM(margin)::numeric, 4)     AS margin
         FROM ${STAGE}
         WHERE ${GDIR}
           AND receiveddate = ${yesterday}
           ${extraStr}
         GROUP BY countryname
         ORDER BY volume DESC`,
        args,
      ),
    ]);

    return { rows, totals: this.sumTotals(rows), chartData };
  }

  // ── Yesterday Iristel ──────────────────────────────────────────

  async getYesterdayIristelFilters() {
    if (!(await this.stageExists()))
      return { mccmncs: [], countries: [], operators: [] };

    const GDIR_IRISTEL = `customername = 'Google_DIR' AND vendorname = 'Iristel_p2p'`;
    const [mccmncs, countries, operators] = await Promise.all([
      this.dataSource.query(`SELECT DISTINCT mccmnc AS v FROM ${STAGE} WHERE ${GDIR_IRISTEL} AND mccmnc IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT countryname AS v FROM ${STAGE} WHERE ${GDIR_IRISTEL} AND countryname IS NOT NULL ORDER BY 1`),
      this.dataSource.query(`SELECT DISTINCT operatorname AS v FROM ${STAGE} WHERE ${GDIR_IRISTEL} AND operatorname IS NOT NULL ORDER BY 1`),
    ]);
    return {
      mccmncs:   mccmncs.map((r: any) => r.v),
      countries: countries.map((r: any) => r.v),
      operators: operators.map((r: any) => r.v),
    };
  }

  async getYesterdayIristel(params: {
    mccmnc?: string;
    countries: string[];
    operators: string[];
  }) {
    if (!(await this.stageExists()))
      return { rows: [], totals: null };

    const GDIR_IRISTEL = `customername = 'Google_DIR' AND vendorname = 'Iristel_p2p'`;
    const yesterday = `(CURRENT_DATE - INTERVAL '1 day')::date`;

    const args: unknown[] = [];
    const extra: string[] = [];
    if (params.mccmnc) extra.push(`AND mccmnc = $${args.push(params.mccmnc)}`);
    if (params.countries?.length)
      extra.push(`AND countryname = ANY($${args.push(params.countries)}::text[])`);
    if (params.operators?.length)
      extra.push(`AND operatorname = ANY($${args.push(params.operators)}::text[])`);
    const extraStr = extra.join(" ");

    const rows = await this.dataSource.query(
      `SELECT
         receiveddate::text AS date,
         countryname        AS country_name,
         operatorname       AS operator_name,
         vendorname         AS vendor_name,
         SUM(volume)::bigint                AS volume,
         ROUND(SUM(revenue)::numeric, 4)    AS revenue,
         ROUND(SUM(vendorcost)::numeric, 4) AS vendor_cost,
         ROUND(SUM(margin)::numeric, 4)     AS margin
       FROM ${STAGE}
       WHERE ${GDIR_IRISTEL}
         AND receiveddate = ${yesterday}
         ${extraStr}
       GROUP BY receiveddate, countryname, operatorname, vendorname
       ORDER BY countryname, volume DESC`,
      args,
    );

    return { rows, totals: this.sumTotals(rows) };
  }

  // ── Estimates ──────────────────────────────────────────────────
  // Applies same hardcoded Google_DIR / non-Iristel filters as getData().
  // Date range defaults to last 30 days when not provided.

  async getEstimates(params?: {
    mccmnc?: string;
    country?: string;
    operator?: string;
  }) {
    if (!(await this.stageExists())) return { rows: [], totals: null };

    // Last 30 COMPLETE days ending yesterday (excludes today's partial day) — never follows
    // the date picker. Matches the Google MO alert's estimation window (CURRENT_DATE-30 .. -1).
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const thirtyStart = new Date(today);
    thirtyStart.setDate(today.getDate() - 30);
    const dateStart = this.fmtDate(thirtyStart);
    const dateEnd = this.fmtDate(yesterday);

    // Hard filter used for both queries — same as getData()
    const BASE = `customername = 'Google_DIR' AND COALESCE(vendorname, '') <> 'Iristel_p2p'`;

    // Optional user-selected filters (no date — for the base countries list)
    const optArgs: unknown[] = [];
    const optConds: string[] = [];
    if (params?.mccmnc)
      optConds.push(`mccmnc = $${optArgs.push(params.mccmnc)}`);
    if (params?.country)
      optConds.push(`countryname = $${optArgs.push(params.country)}`);
    if (params?.operator)
      optConds.push(`operatorname = $${optArgs.push(params.operator)}`);
    const optFilter = optConds.length ? ` AND ${optConds.join(" AND ")}` : "";

    // Traffic args: date params first, then optional params re-bound at $3+
    const trafficArgs: unknown[] = [dateStart, dateEnd];
    const trafficOptConds: string[] = [];
    if (params?.mccmnc)
      trafficOptConds.push(`mccmnc = $${trafficArgs.push(params.mccmnc)}`);
    if (params?.country)
      trafficOptConds.push(
        `countryname = $${trafficArgs.push(params.country)}`,
      );
    if (params?.operator)
      trafficOptConds.push(
        `operatorname = $${trafficArgs.push(params.operator)}`,
      );
    const trafficOpt = trafficOptConds.length
      ? ` AND ${trafficOptConds.join(" AND ")}`
      : "";

    const [activeCountries, trafficData, estimates] = await Promise.all([
      // All countries ever active with Google_DIR + non-Iristel traffic (no date cap)
      // This is how Power BI builds the country dimension — Rwanda appears here even
      // when it has no traffic in the rolling 30-day window.
      this.dataSource.query(
        `SELECT DISTINCT countryname AS country
         FROM ${STAGE}
         WHERE ${BASE}${optFilter}
         ORDER BY 1`,
        optArgs,
      ),
      // Rolling 30-day traffic per country — DATESINPERIOD(TODAY(), -30, DAY) equivalent
      this.dataSource.query(
        `SELECT countryname AS country, SUM(volume)::bigint AS traffic_30d
         FROM ${STAGE}
         WHERE ${BASE}
           AND receiveddate >= $1::date
           AND receiveddate <= $2::date${trafficOpt}
         GROUP BY countryname`,
        trafficArgs,
      ),
      this.dataSource.query(
        `SELECT country, estimation FROM ${ESTIMATES_TABLE} ORDER BY country`,
      ),
    ]);

    const estMap: Record<string, number> = {};
    for (const e of estimates)
      estMap[e.country?.toLowerCase()] = Number(e.estimation);

    const trafficMap: Record<string, number> = {};
    for (const t of trafficData)
      trafficMap[t.country?.toLowerCase()] = Number(t.traffic_30d);

    const rows = (activeCountries as Array<{ country: string }>).map((r) => {
      const key = r.country?.toLowerCase();
      const traffic = trafficMap.hasOwnProperty(key) ? trafficMap[key] : null;
      const est = estMap[key] ?? null;
      const pct =
        est != null && est > 0 && traffic != null
          ? (traffic / est) * 100
          : null;
      return {
        country: r.country,
        traffic_30d: traffic,
        estimation: est,
        pct_received: pct,
      };
    });

    // Sort: countries with 30-day traffic descending, then zero/null at bottom
    rows.sort((a, b) => (b.traffic_30d ?? -1) - (a.traffic_30d ?? -1));

    const totalTraffic = rows.reduce((s, r) => s + (r.traffic_30d ?? 0), 0);
    const totalEst = rows.reduce((s, r) => s + (r.estimation ?? 0), 0);

    return {
      rows,
      totals: {
        traffic_30d: totalTraffic,
        estimation: totalEst,
        pct_received: totalEst > 0 ? (totalTraffic / totalEst) * 100 : 0,
      },
    };
  }

  // ── P&L year/month lists (from google_mo_cost) ────────────────
  async getProfitLossYears() {
    const rows = await this.dataSource.query(
      `SELECT DISTINCT year AS y FROM ${COST_TABLE} ORDER BY 1 DESC`,
    );
    return { years: rows.map((r: any) => r.y as number) };
  }

  async getProfitLossMonths(year?: number) {
    let rows: any[];
    if (year) {
      rows = await this.dataSource.query(
        `SELECT DISTINCT month AS m FROM ${COST_TABLE} WHERE year = $1 ORDER BY 1`,
        [year],
      );
    } else {
      rows = await this.dataSource.query(
        `SELECT DISTINCT month AS m FROM ${COST_TABLE} ORDER BY 1`,
      );
    }
    return { months: rows.map((r: any) => r.m as number) };
  }

  // ── File Import ─────────────────────────────────────────────────

  async importCosts(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ): Promise<{ upserted: number; vendor_rows: number; skipped: number }> {
    const raw = await this.parseImportFile(buffer, mimetype, filename);
    const records = raw
      .map((r) => this.normalizeCostRow(r))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (records.length === 0)
      throw new Error(
        "No valid rows found. Expected columns: Date, Country, Monthly Cost, Miscellaneous",
      );

    // Aggregate multiple vendor rows into one record per country+year+month
    const aggMap = new Map<
      string,
      { country: string; year: number; month: number; monthly_cost: number; miscellaneous: number }
    >();
    for (const r of records) {
      const key = `${r.country.toLowerCase()}|${r.year}|${r.month}`;
      const existing = aggMap.get(key);
      if (existing) {
        existing.monthly_cost += r.monthly_cost;
        existing.miscellaneous += r.miscellaneous;
      } else {
        aggMap.set(key, { ...r });
      }
    }
    const aggregated = Array.from(aggMap.values());

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      for (const r of aggregated) {
        await qr.query(
          `INSERT INTO ${COST_TABLE} (country, year, month, monthly_cost, miscellaneous)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ON CONSTRAINT google_mo_cost_ym_country
           DO UPDATE SET monthly_cost   = EXCLUDED.monthly_cost,
                         miscellaneous  = EXCLUDED.miscellaneous,
                         updated_at     = NOW()`,
          [r.country, r.year, r.month, r.monthly_cost, r.miscellaneous],
        );
      }
      await qr.commitTransaction();
      return {
        upserted: aggregated.length,
        vendor_rows: records.length,
        skipped: raw.length - records.length,
      };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  async importEstimates(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ): Promise<{ upserted: number; skipped: number }> {
    const raw = await this.parseImportFile(buffer, mimetype, filename);
    const records = raw
      .map((r) => this.normalizeEstimateRow(r))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (records.length === 0)
      throw new Error(
        "No valid rows found. Expected columns: Country, Estimation",
      );

    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      for (const r of records) {
        await qr.query(
          `INSERT INTO ${ESTIMATES_TABLE} (country, estimation)
           VALUES ($1, $2)
           ON CONFLICT (country)
           DO UPDATE SET estimation = EXCLUDED.estimation, updated_at = NOW()`,
          [r.country, r.estimation],
        );
      }
      await qr.commitTransaction();
      return { upserted: records.length, skipped: raw.length - records.length };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }

  private async parseImportFile(
    buffer: Buffer,
    mimetype: string,
    filename: string,
  ): Promise<Record<string, string>[]> {
    const ext = (filename.split(".").pop() ?? "").toLowerCase();
    if (mimetype.includes("pdf") || ext === "pdf") return this.parsePdf(buffer);
    if (
      mimetype.includes("sheet") ||
      mimetype.includes("excel") ||
      ext === "xlsx" ||
      ext === "xls"
    )
      return this.parseXlsx(buffer);
    return this.parseCsv(buffer);
  }

  private parseCsv(buffer: Buffer): Record<string, string>[] {
    const text = buffer
      .toString("utf-8")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) return [];

    const delim =
      lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";

    const parseRow = (line: string): string[] => {
      const cells: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = !inQ;
          }
        } else if (ch === delim && !inQ) {
          cells.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    };

    const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
    return lines
      .slice(1)
      .map((line) => {
        const vals = parseRow(line);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = (vals[i] ?? "").trim();
        });
        return obj;
      })
      .filter((row) => Object.values(row).some((v) => v !== ""));
  }

  private async parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const ws = workbook.worksheets[0];
    if (!ws) return [];

    const result: Record<string, string>[] = [];
    let headers: string[] = [];

    ws.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        let val: any = cell.value;
        if (val && typeof val === "object" && "text" in val) val = (val as any).text;
        if (val && typeof val === "object" && "richText" in val)
          val = (val as any).richText.map((rt: any) => rt.text).join("");
        if (val instanceof Date) val = val.toISOString().split("T")[0];
        cells.push(String(val ?? "").trim());
      });

      if (rowNumber === 1) {
        headers = cells.map((h) => h.toLowerCase());
        return;
      }
      if (cells.every((c) => c === "")) return;

      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = cells[i] ?? "";
      });
      result.push(obj);
    });

    return result;
  }

  private async parsePdf(buffer: Buffer): Promise<Record<string, string>[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("pdf-parse");
    const pdfParse = (mod.default ?? mod) as (buf: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);

    const lines = data.text
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    if (lines.length < 2) return [];

    const result: Record<string, string>[] = [];

    // pdf-parse concatenates all columns with NO separator.
    // Detect format by checking if any line starts with a 6-digit MCC/MNC followed by a date.
    const isCostsFormat = lines.some((l: string) =>
      /^\d{6}\d{1,2}\/\d{1,2}\/\d{4}/.test(l),
    );

    if (isCostsFormat) {
      // COSTS FORMAT: {6-digit MCC/MNC}{M/D/YYYY}{country}{vendor}{cost}{misc?}
      // Miscellaneous always has exactly 4 decimal places (e.g. 166.6667).
      // Cost has 0-2 decimal places (e.g. 45.55, 79.8, 0).
      // Both appear at the end of the line with no separator between them.
      for (const line of lines) {
        const lineMatch = line.match(/^(\d{6})(\d{1,2}\/\d{1,2}\/\d{4})(.+)$/);
        if (!lineMatch) continue;

        const [, , date, rest] = lineMatch;

        let countryVendor: string, cost: string, misc: string;

        // Try cost (0-2 decimals) + misc (3+ integer digits, 4+ decimal places) adjacent at end.
        // Cost uses (?:0|[1-9]\d*) so a bare "0" doesn't consume leading digits of misc
        // (e.g. "0166.6667" → cost=0, misc=166.6667).
        // Misc requires 3+ integer digits (≥100) to prevent a single 4-decimal cost like
        // "116.6666" being falsely split as cost="11" + misc="6.6666".
        const twoNum = rest.match(/^(.*?)((?:0|[1-9]\d*)(?:\.\d{1,2})?)(\d{3,}\.\d{4,})$/);
        if (twoNum) {
          [, countryVendor, cost, misc] = twoNum;
        } else {
          // Single trailing number
          const oneNum = rest.match(/^(.*?)(\d+\.?\d*)$/);
          if (!oneNum) continue;
          [, countryVendor, cost] = oneNum;
          misc = "0";
        }

        // Country ends at first lowercase→uppercase transition in the concatenated string.
        // e.g. "GhanaGhana Tigo" → 'a' before 'G' at index 4 → "Ghana"
        const boundary = countryVendor.search(/[a-z](?=[A-Z])/);
        const country =
          boundary !== -1
            ? countryVendor.slice(0, boundary + 1).trim()
            : countryVendor.trim();

        if (!country || !cost) continue;

        result.push({
          date,
          country,
          "monthly cost": cost,
          miscellaneous: misc ?? "0",
        });
      }
    } else {
      // ESTIMATES FORMAT: {country}{estimation} — concatenated with no separator.
      // Header line contains both "Country" and "Estimation" — skip it.
      for (const line of lines) {
        if (/country/i.test(line) && /estimation/i.test(line)) continue;

        // Estimation is the trailing decimal number at end of line.
        const match = line.match(/^(.*?)(\d+\.?\d*)$/);
        if (!match) continue;

        const country = match[1].trim();
        if (!country) continue;

        result.push({ country, estimation: match[2] });
      }
    }

    return result;
  }

  // Strip everything except a-z and 0-9 — used for column header matching.
  private normKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  // Exact normalized key lookup.
  private pickField(row: Record<string, string>, ...variants: string[]): string {
    const nmap = new Map(
      Object.entries(row).map(([k, v]) => [this.normKey(k), v.trim()]),
    );
    for (const variant of variants) {
      const v = nmap.get(this.normKey(variant));
      if (v !== undefined && v !== "") return v;
    }
    return "";
  }

  // Prefix-match lookup — for headers like "Estimation (conservative 2%)"
  // where normKey produces "estimationconservative2" but variant is "estimation".
  private pickFieldLoose(
    row: Record<string, string>,
    ...variants: string[]
  ): string {
    const entries = Object.entries(row).map(
      ([k, v]) => [this.normKey(k), v.trim()] as const,
    );
    for (const variant of variants) {
      const nv = this.normKey(variant);
      // Exact first to avoid ambiguity
      const exact = entries.find(([nk, v]) => nk === nv && v !== "");
      if (exact) return exact[1];
      // Then prefix
      const prefix = entries.find(
        ([nk, v]) => nk.startsWith(nv) && nk.length > nv.length && v !== "",
      );
      if (prefix) return prefix[1];
    }
    return "";
  }

  // Parse a date string (or ISO string from ExcelJS) into { year, month }.
  // Handles: "2026-01-15", "01/15/2026", "01/2026", "January 2026", "Jan 2026".
  private parseDateToYearMonth(
    s: string,
  ): { year: number; month: number } | null {
    if (!s) return null;

    // ISO / YYYY-MM: 2026-01-15 or 2026-01
    let m = s.match(/^(\d{4})-(\d{1,2})/);
    if (m) return { year: +m[1], month: +m[2] };

    // MM/DD/YYYY
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return { year: +m[3], month: +m[1] };

    // MM/YYYY
    m = s.match(/^(\d{1,2})\/(\d{4})/);
    if (m) return { year: +m[2], month: +m[1] };

    // "January 2026" or "Jan 2026"
    const MO: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    m = s.match(/([a-zA-Z]{3,})\s+(\d{4})/);
    if (m) {
      const mo = MO[m[1].toLowerCase().slice(0, 3)];
      if (mo) return { year: +m[2], month: mo };
    }
    m = s.match(/(\d{4})\s+([a-zA-Z]{3,})/);
    if (m) {
      const mo = MO[m[2].toLowerCase().slice(0, 3)];
      if (mo) return { year: +m[1], month: mo };
    }

    // Fallback: native Date parse
    const d = new Date(s);
    if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 };

    return null;
  }

  private normalizeCostRow(row: Record<string, string>) {
    const country = this.pickField(row, "country", "countryname", "country name");

    // Date column (e.g. "Date" header with "2026-01-01" values)
    const dateStr = this.pickField(row, "date", "period", "monthyear");
    let year: number, month: number;

    if (dateStr) {
      const parsed = this.parseDateToYearMonth(dateStr);
      if (!parsed) return null;
      ({ year, month } = parsed);
    } else {
      // Fallback: explicit year / month columns
      const yearStr = this.pickField(row, "year");
      const monthStr = this.pickField(row, "month");
      year = parseInt(yearStr, 10);
      month = parseInt(monthStr, 10);
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
    }

    if (!country) return null;

    const costStr = this.pickField(row, "monthly cost", "monthlycost", "cost");
    const miscStr =
      this.pickField(row, "miscellaneous", "misc", "miscellaneouscost") || "0";

    const monthly_cost = parseFloat(costStr.replace(/[,$\s]/g, ""));
    const miscellaneous = parseFloat(miscStr.replace(/[,$\s]/g, ""));

    return {
      country,
      year,
      month,
      monthly_cost: isNaN(monthly_cost) ? 0 : monthly_cost,
      miscellaneous: isNaN(miscellaneous) ? 0 : miscellaneous,
    };
  }

  private normalizeEstimateRow(row: Record<string, string>) {
    const country = this.pickField(row, "country", "countryname", "country name");
    // "Estimation (conservative 2%)" → normKey → "estimationconservative2"
    // pickFieldLoose matches on prefix "estimation"
    const estStr = this.pickFieldLoose(
      row,
      "estimation",
      "estimate",
      "traffic",
    );

    if (!country) return null;
    const estimation = parseFloat(estStr.replace(/[,$\s]/g, ""));
    return { country, estimation: isNaN(estimation) ? 0 : estimation };
  }
}
