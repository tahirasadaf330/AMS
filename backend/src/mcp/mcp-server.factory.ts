import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpIdentity } from './mcp-keys.service';
import { AuditService } from '../audit/audit.service';

const INSTRUCTIONS = [
  'Read-only access to the AMS (Alert Management System) Postgres database.',
  'Only SELECT/WITH queries are allowed; results are capped (default 500, max 2000 rows) and each query has an 8s time limit.',
  'Sensitive data is excluded: password hashes, session tokens, and stored credentials are unreadable.',
  'The users, data_sources and notification_log tables are exposed only via the users_safe, data_sources_safe and notification_log_safe views (which omit those sensitive columns).',
  'Start with list_tables and list_datasets to discover what is available; use describe_table before writing a query.',
].join(' ');

/** Builds a stateless McpServer bound to one authenticated identity. A fresh instance is
 *  created per request so tool handlers can close over `identity` for auditing. */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly db: McpReadonlyDbService,
    private readonly audit: AuditService,
  ) {}

  build(identity: McpIdentity, ipAddress: string): McpServer {
    const server = new McpServer(
      { name: 'ams-postgres-readonly', version: '1.0.0' },
      { instructions: INSTRUCTIONS },
    );

    const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
    const fail = (message: string) => ({ content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true });

    server.registerTool(
      'list_tables',
      {
        title: 'List tables',
        description: 'List all tables and views readable via MCP (sensitive tables are hidden; safe views appear instead).',
        inputSchema: {},
      },
      async () => {
        try {
          const tables = await this.db.listTables();
          this.audit.log({ userId: identity.userId, action: 'mcp:list_tables', detail: { count: tables.length }, ipAddress });
          return ok(tables);
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    );

    server.registerTool(
      'describe_table',
      {
        title: 'Describe table',
        description: 'Show columns (name, type, nullability) of a readable table or *_safe view.',
        inputSchema: { table: z.string().describe('Table or view name, e.g. datasets or users_safe') },
      },
      async ({ table }) => {
        try {
          const cols = await this.db.describeTable(table);
          this.audit.log({ userId: identity.userId, action: 'mcp:describe_table', resource: table, detail: { columns: cols.length }, ipAddress });
          return ok(cols);
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    );

    server.registerTool(
      'query',
      {
        title: 'Run read-only SQL',
        description: 'Run a single read-only SELECT (or WITH…SELECT) against the AMS database. Non-SELECT statements are rejected. Results are row-capped and time-limited.',
        inputSchema: {
          sql: z.string().describe('A single SELECT or WITH…SELECT statement. No DDL/DML, no multiple statements.'),
          row_limit: z.number().int().positive().optional().describe('Rows requested; silently capped at 2000 (default 500). A capped result sets truncated:true.'),
        },
      },
      async ({ sql, row_limit }) => {
        const started = Date.now();
        try {
          const result = await this.db.runQuery(sql, row_limit);
          this.audit.log({
            userId: identity.userId,
            action: 'mcp:query',
            detail: { sql: sql.slice(0, 4000), row_count: result.row_count, truncated: result.truncated, elapsed_ms: result.elapsed_ms },
            ipAddress,
          });
          return ok(result);
        } catch (err) {
          this.audit.log({
            userId: identity.userId,
            action: 'mcp:query',
            detail: { sql: sql.slice(0, 4000), error: (err as Error).message, elapsed_ms: Date.now() - started },
            ipAddress,
          });
          return fail((err as Error).message);
        }
      },
    );

    server.registerTool(
      'list_datasets',
      {
        title: 'List datasets',
        description: 'List AMS datasets with their backing stage table names, to map business datasets to queryable tables.',
        inputSchema: {},
      },
      async () => {
        try {
          const datasets = await this.db.listDatasets();
          this.audit.log({ userId: identity.userId, action: 'mcp:list_datasets', detail: { count: datasets.length }, ipAddress });
          return ok(datasets);
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    );

    return server;
  }
}
