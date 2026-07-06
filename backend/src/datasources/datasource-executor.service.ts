import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Pool as PgPool } from 'pg';
import * as mssql from 'mssql';
import { ExternalDataSource } from '../common/entities/data-source.entity';
import { CredentialsService } from '../credentials/credentials.service';

export interface SourceField {
  name: string;
  type: 'numeric' | 'text';
}

export interface SourceQueryResult {
  rows: Record<string, unknown>[];
  fields: SourceField[];
}

interface PoolEntry {
  pool: PgPool | mssql.ConnectionPool;
  type: 'postgresql' | 'mssql';
  fingerprint: string;
}

// pg numeric OIDs
const PG_NUMERIC_OIDS = new Set([20, 21, 23, 700, 701, 1700]);

// mssql constructor names that indicate numeric types
const MSSQL_NUMERIC_TYPES = new Set([
  'Int', 'BigInt', 'Float', 'Decimal', 'Numeric',
  'Money', 'SmallMoney', 'SmallInt', 'TinyInt', 'Bit', 'Real',
]);

@Injectable()
export class DatasourceExecutorService implements OnModuleDestroy {
  private readonly logger = new Logger(DatasourceExecutorService.name);
  private readonly pools = new Map<string, PoolEntry>();

  constructor(
    @InjectRepository(ExternalDataSource)
    private dsRepo: Repository<ExternalDataSource>,
    private credentialsService: CredentialsService,
    private config: ConfigService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const [id, entry] of this.pools) {
      try {
        if (entry.type === 'postgresql') {
          await (entry.pool as PgPool).end();
        } else {
          await (entry.pool as mssql.ConnectionPool).close();
        }
      } catch (err) {
        this.logger.error(`Error closing pool for data source ${id}`, err);
      }
    }
    this.pools.clear();
  }

  async query(dataSourceId: string, sql: string, signal?: AbortSignal): Promise<SourceQueryResult> {
    const pool = await this.getPool(dataSourceId);

    if (pool.type === 'postgresql') {
      if (signal?.aborted) throw new Error('Refresh cancelled');
      const result = await (pool.pool as PgPool).query(sql);
      return {
        rows: result.rows as Record<string, unknown>[],
        fields: result.fields.map((f) => ({
          name: f.name,
          type: PG_NUMERIC_OIDS.has(f.dataTypeID) ? 'numeric' : 'text',
        })),
      };
    } else {
      if (signal?.aborted) throw new Error('Refresh cancelled');
      const request = (pool.pool as mssql.ConnectionPool).request();
      if (signal) {
        signal.addEventListener('abort', () => { request.cancel(); }, { once: true });
      }
      const result = await request.query(sql);
      const cols = result.recordset.columns ?? {};
      return {
        rows: result.recordset as unknown as Record<string, unknown>[],
        fields: Object.values(cols).map((col: any) => ({
          name: col.name as string,
          type: MSSQL_NUMERIC_TYPES.has(col.type?.name ?? '') ? 'numeric' : 'text',
        })),
      };
    }
  }

  async testConnectionConfig(config: {
    type: 'postgresql' | 'mssql';
    host: string;
    port: number;
    db: string;
    username: string;
    password: string;
    sslMode: string;
  }): Promise<void> {
    if (config.type === 'postgresql') {
      const pool = new PgPool({
        host: config.host,
        port: config.port,
        database: config.db,
        user: config.username,
        password: config.password,
        max: 1,
        connectionTimeoutMillis: 8000,
        ssl: config.sslMode === 'disable' ? false : { rejectUnauthorized: false },
      });
      try {
        const client = await pool.connect();
        client.release();
      } finally {
        await pool.end().catch(() => {});
      }
    } else {
      const poolCfg: mssql.config = {
        user: config.username,
        password: config.password,
        server: config.host,
        port: config.port,
        database: config.db,
        options: {
          encrypt: config.sslMode !== 'disable',
          trustServerCertificate: config.sslMode !== 'require',
          connectTimeout: 8000,
        },
        pool: { max: 1, min: 0, idleTimeoutMillis: 1000 },
      };
      const pool = new mssql.ConnectionPool(poolCfg);
      try {
        await pool.connect();
      } finally {
        await pool.close().catch(() => {});
      }
    }
  }

  async validateQuery(dataSourceId: string, sql: string): Promise<SourceQueryResult> {
    const pool = await this.getPool(dataSourceId);

    if (pool.type === 'postgresql') {
      return this.query(dataSourceId, `SELECT * FROM (${sql}) AS _q LIMIT 0`);
    } else {
      return this.query(dataSourceId, this.buildMssqlValidationSql(sql));
    }
  }

  private buildMssqlValidationSql(sql: string): string {
    const trimmed = sql.trim();

    // Non-CTE: simple subquery wrap
    if (!/^WITH\s+/i.test(trimmed)) {
      return `SELECT TOP 0 * FROM (${trimmed}) AS _q`;
    }

    // CTE query: MSSQL forbids WITH inside a derived table.
    // Fix: (1) strip outermost ORDER BY, (2) inject TOP 0 into the final SELECT.

    // Step 1 — find and remove the last ORDER BY at paren depth 0.
    // We scan char-by-char tracking depth; string literals are already inside
    // CTE bodies (depth > 0) so unbalanced-quote edge cases don't affect us here.
    let depth = 0;
    let lastOrderByIdx = -1;
    const upper = trimmed.toUpperCase();

    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '(') { depth++; continue; }
      if (trimmed[i] === ')') { depth--; continue; }
      if (depth !== 0) continue;

      // Match ORDER<space>BY at a word boundary
      if (
        upper[i] === 'O' &&
        upper.slice(i, i + 5) === 'ORDER' &&
        /\s/.test(upper[i + 5] ?? '\n') &&
        (i === 0 || /[\s\n\r,]/.test(trimmed[i - 1]))
      ) {
        // Confirm it's ORDER BY (not just ORDER)
        const chunk = upper.slice(i, i + 12).replace(/\s+/, ' ');
        if (/^ORDER BY\b/i.test(chunk)) {
          lastOrderByIdx = i;
        }
      }
    }

    const noOrderBy = lastOrderByIdx >= 0
      ? trimmed.slice(0, lastOrderByIdx).trimEnd()
      : trimmed;

    // Step 2 — inject TOP 0 after the last CTE closing paren, before the outer SELECT.
    // Pattern: ")\n...SELECT " → ")\n...SELECT TOP 0 "
    const withTop0 = noOrderBy.replace(
      /(\)\s*[\r\n]+\s*)(SELECT\s)/i,
      '$1SELECT TOP 0 ',
    );

    return withTop0;
  }

  invalidatePool(dataSourceId: string): void {
    const entry = this.pools.get(dataSourceId);
    if (entry) {
      if (entry.type === 'postgresql') {
        (entry.pool as PgPool).end().catch(() => {});
      } else {
        (entry.pool as mssql.ConnectionPool).close().catch(() => {});
      }
      this.pools.delete(dataSourceId);
    }
  }

  private async getPool(dataSourceId: string): Promise<PoolEntry> {
    if (dataSourceId === 'jerasoft') {
      return this.getJerasoftPool();
    }

    const ds = await this.dsRepo.findOne({ where: { id: dataSourceId } });
    if (!ds) throw new Error(`Data source ${dataSourceId} not found`);

    const password = ds.password
      ? this.credentialsService.decrypt(ds.password)
      : '';
    const fingerprint = `${ds.type}:${ds.host}:${ds.port}:${ds.db}:${ds.username}:${password}`;

    const existing = this.pools.get(dataSourceId);
    if (existing && existing.fingerprint === fingerprint) {
      return existing;
    }

    if (existing) {
      if (existing.type === 'postgresql') {
        await (existing.pool as PgPool).end().catch(() => {});
      } else {
        await (existing.pool as mssql.ConnectionPool).close().catch(() => {});
      }
    }

    const entry = await this.createPool(ds, password, fingerprint);
    this.pools.set(dataSourceId, entry);
    return entry;
  }

  private getJerasoftPool(): PoolEntry {
    const host = this.config.get<string>('JERASOFT_HOST', '10.10.8.70');
    const port = this.config.get<number>('JERASOFT_PORT', 5432);
    const database = this.config.get<string>('JERASOFT_DB', 'vcs');
    const user = this.config.get<string>('JERASOFT_USER', 'tahira');
    const password = this.config.get<string>('JERASOFT_PASS', '');
    const sslMode = this.config.get<string>('JERASOFT_SSL', 'prefer');
    const fingerprint = `jerasoft:${host}:${port}:${database}:${user}:${password}`;

    const existing = this.pools.get('jerasoft');
    if (existing && existing.fingerprint === fingerprint) return existing;

    if (existing) {
      (existing.pool as PgPool).end().catch(() => {});
    }

    const pool = new PgPool({
      host,
      port,
      database,
      user,
      password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
    });
    pool.on('error', (err) => {
      this.logger.error('Jerasoft pool error', err);
    });

    const entry: PoolEntry = { pool, type: 'postgresql', fingerprint };
    this.pools.set('jerasoft', entry);
    return entry;
  }

  private async createPool(
    ds: ExternalDataSource,
    password: string,
    fingerprint: string,
  ): Promise<PoolEntry> {
    if (ds.type === 'postgresql') {
      const pool = new PgPool({
        host: ds.host,
        port: ds.port,
        database: ds.db,
        user: ds.username,
        password,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        ssl: ds.sslMode === 'disable' ? false : { rejectUnauthorized: false },
      });
      pool.on('error', (err) => {
        this.logger.error(`Pool error for data source ${ds.id}`, err);
      });
      return { pool, type: 'postgresql', fingerprint };
    } else {
      const poolCfg: mssql.config = {
        user: ds.username,
        password,
        server: ds.host,
        port: ds.port,
        database: ds.db,
        options: {
          encrypt: ds.sslMode !== 'disable',
          trustServerCertificate: ds.sslMode !== 'require',
          connectTimeout: 5000,
          requestTimeout: 600000,
        },
        pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      };
      const pool = new mssql.ConnectionPool(poolCfg);
      await pool.connect();
      return { pool, type: 'mssql', fingerprint };
    }
  }
}
