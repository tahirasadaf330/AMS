import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult } from 'pg';

/**
 * JerasoftService provides READ-ONLY access to the Jerasoft VCS database.
 * IMPORTANT: Only SELECT queries must be passed to query(). This service
 * does NOT enforce DDL/DML prevention at runtime — caller responsibility.
 * Never pass INSERT, UPDATE, DELETE, DROP, CREATE, or any DDL/DML to this service.
 */
@Injectable()
export class JerasoftService implements OnModuleDestroy, OnModuleInit {
  private readonly logger = new Logger(JerasoftService.name);
  private pool: Pool;
  private connected = false;

  constructor(private configService: ConfigService) {
    const sslMode = this.configService.get<string>('JERASOFT_SSL', 'prefer');

    this.pool = new Pool({
      host: this.configService.get<string>('JERASOFT_HOST', '10.10.8.70'),
      port: this.configService.get<number>('JERASOFT_PORT', 5432),
      database: this.configService.get<string>('JERASOFT_DB', 'vcs'),
      user: this.configService.get<string>('JERASOFT_USER', 'tahira'),
      password: this.configService.get<string>('JERASOFT_PASS'),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      this.logger.error('Jerasoft pool error:', err);
      this.connected = false;
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const client = await this.pool.connect();
      client.release();
      this.connected = true;
      this.logger.log('Jerasoft database connection established');
    } catch (err) {
      this.logger.error('Failed to connect to Jerasoft database:', err);
      this.connected = false;
    }
  }

  /**
   * Execute a SELECT query against the Jerasoft read-only database.
   * Only SELECT statements should be passed — NEVER INSERT/UPDATE/DELETE/DDL.
   */
  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    try {
      const result = await this.pool.query(sql, params);
      this.connected = true;
      return result;
    } catch (err) {
      this.logger.error('Jerasoft query error:', err);
      this.connected = false;
      throw err;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.pool.end();
      this.logger.log('Jerasoft pool closed');
    } catch (err) {
      this.logger.error('Error closing Jerasoft pool', err);
    }
  }
}
