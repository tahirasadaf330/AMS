import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  truncated: boolean;
  elapsed_ms: number;
}

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_ROW_LIMIT = 500;
const MAX_ROW_LIMIT = 2000;

/**
 * Dedicated read-only Postgres access for the MCP server. Connects as `ams_readonly`
 * (AMS_PG_RO_*), a role with SELECT only + sensitive tables revoked + safe views +
 * default_transaction_read_only + an 8s statement_timeout (see migration 010). This is the
 * real security boundary — Postgres, not app code, decides visibility. The query wrap here
 * is defence-in-depth (rejects non-SELECT before it ever reaches the DB).
 *
 * If AMS_PG_RO_* is unset the service reports notConfigured() and the /mcp route returns 503,
 * so the backend runs fine with MCP disabled.
 */
@Injectable()
export class McpReadonlyDbService implements OnModuleDestroy {
  private readonly logger = new Logger(McpReadonlyDbService.name);
  private pool: Pool | null = null;
  private readonly configured: boolean;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('AMS_PG_RO_USER', '');
    const pass = this.config.get<string>('AMS_PG_RO_PASSWORD', '');
    this.configured = !!user && !!pass;
    if (!this.configured) {
      this.logger.warn('AMS_PG_RO_USER/PASSWORD not set — MCP DB access disabled (/mcp → 503).');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: this.config.get<string>('AMS_PG_HOST', 'localhost'),
        port: Number(this.config.get<string>('AMS_PG_PORT', '5432')),
        database: this.config.get<string>('AMS_PG_DB', 'AMS'),
        user: this.config.get<string>('AMS_PG_RO_USER'),
        password: this.config.get<string>('AMS_PG_RO_PASSWORD'),
        max: 5,
        statement_timeout: 8000,
        query_timeout: 10000,
        idleTimeoutMillis: 30000,
        application_name: 'ams-mcp',
      });
      this.pool.on('error', (err) => this.logger.error('MCP RO pool error', err));
    }
    return this.pool;
  }

  async listTables(): Promise<{ table_name: string; table_type: string; approx_rows: number | null }[]> {
    const res = await this.getPool().query(
      `SELECT t.table_name, t.table_type,
              c.reltuples::bigint AS approx_rows
       FROM information_schema.tables t
       LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = 'public'::regnamespace
       WHERE t.table_schema = 'public'
       ORDER BY t.table_name`,
    );
    // information_schema is already privilege-filtered for ams_readonly: revoked tables
    // (users, sessions, settings, …) never appear; the *_safe views do.
    return res.rows.map((r) => ({
      table_name: r.table_name,
      table_type: r.table_type,
      approx_rows: r.approx_rows == null ? null : Number(r.approx_rows),
    }));
  }

  async describeTable(table: string): Promise<{ column_name: string; data_type: string; is_nullable: string }[]> {
    if (!IDENT_RE.test(table)) {
      throw new Error(`Invalid table name "${table}". Expected a lowercase identifier; call list_tables for the readable set.`);
    }
    const res = await this.getPool().query(
      `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table],
    );
    if (res.rows.length === 0) {
      throw new Error(`Table "${table}" not found or not readable by the MCP role. Call list_tables for the readable set (note: users/sessions/credentials are exposed only via the *_safe views).`);
    }
    return res.rows;
  }

  async runQuery(sql: string, rowLimit?: number): Promise<QueryResult> {
    const cap = Math.min(Math.max(Math.floor(rowLimit ?? DEFAULT_ROW_LIMIT), 1), MAX_ROW_LIMIT);

    // Normalize: allow exactly one trailing semicolon; reject any other → single statement only.
    let q = sql.trim();
    if (q.endsWith(';')) q = q.slice(0, -1).trim();
    if (q.includes(';')) {
      throw new Error('Only a single statement is allowed per query call (no ";").');
    }
    if (!/^(select|with)\b/i.test(q)) {
      throw new Error('Only read-only SELECT queries are allowed (the query must start with SELECT or WITH).');
    }

    // Wrap as a derived table: forces the input to be a single SELECT-expression, so any
    // DDL/DML/multi-statement becomes a syntax error (same approach as validateQuery).
    const wrapped = `SELECT * FROM (\n${q}\n) AS _q LIMIT ${cap}`;
    const started = Date.now();
    let res;
    try {
      res = await this.getPool().query(wrapped);
    } catch (err: unknown) {
      throw this.mapPgError(err);
    }
    const elapsed = Date.now() - started;
    const columns = res.fields.map((f) => f.name);
    return {
      columns,
      rows: res.rows,
      row_count: res.rowCount ?? res.rows.length,
      truncated: (res.rowCount ?? res.rows.length) >= cap,
      elapsed_ms: elapsed,
    };
  }

  /** List of business datasets (name → stage table) so agents can map without guessing. */
  async listDatasets(): Promise<Record<string, unknown>[]> {
    const res = await this.getPool().query(
      `SELECT id, name, source_db, stage_table_name, schedule_cron, is_active, updated_at
       FROM datasets ORDER BY name`,
    );
    return res.rows;
  }

  private mapPgError(err: unknown): Error {
    const e = err as { code?: string; message?: string; position?: string };
    if (e.code === '42501') {
      return new Error('Permission denied: that table/column is excluded from MCP access (password hashes, session tokens, and stored credentials are redacted). Use the *_safe views (users_safe, data_sources_safe) or call list_tables for the readable set.');
    }
    if (e.code === '57014') {
      return new Error('Query exceeded the 8-second time limit. Add filters (WHERE/date range) or reduce the scope, then retry.');
    }
    if (e.code === '42P01') {
      return new Error(`${e.message}. Call list_tables for readable tables (sensitive base tables are exposed only via *_safe views).`);
    }
    return new Error(e.message ?? 'Query failed.');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
    }
  }
}
