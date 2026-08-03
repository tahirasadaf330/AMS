import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { AtlasAuthService, type AtlasAuthResult } from './atlas-auth.service';
import { AuditService } from '../audit/audit.service';
import {
  buildAudit,
  extractRelations,
  toolResult,
  TOOL_OUTPUT_SHAPE,
  DENY_MESSAGE,
  type McpToolResult,
} from './mcp-audit';

const INSTRUCTIONS = [
  'Read-only access to the AMS (Alert Management System) Postgres database.',
  'Only SELECT/WITH queries are allowed; results are capped (default 500, max 2000 rows) and each query has an 8s time limit.',
  'Sensitive data is excluded: password hashes, session tokens, and stored credentials are unreadable.',
  'The users, data_sources and notification_log tables are exposed only via the users_safe, data_sources_safe and notification_log_safe views (which omit those sensitive columns).',
  'Start with list_tables and list_datasets to discover what is available; use describe_table before writing a query.',
].join(' ');

/** Per-request context: the raw bearer token Atlas signed + the source IP, for auth + audit. */
export interface AtlasContext {
  rawToken?: string;
  ip: string;
}

/**
 * Builds a stateless McpServer for one request. `initialize` and `tools/list` are unauthenticated
 * discovery (handled by the SDK). Every `tools/call` authenticates the Atlas JWT *inside the tool
 * handler* and returns an audit block in structuredContent — including denials, which come back as
 * normal HTTP-200 results (never JSON-RPC errors) so Atlas's client can read the audit.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly db: McpReadonlyDbService,
    private readonly atlas: AtlasAuthService,
    private readonly audit: AuditService,
  ) {}

  build(ctx: AtlasContext): McpServer {
    const server = new McpServer(
      { name: 'ams-postgres-readonly', version: '1.0.0' },
      { instructions: INSTRUCTIONS },
    );

    server.registerTool(
      'list_tables',
      {
        title: 'List tables',
        description: 'List all tables and views readable via MCP (sensitive tables are hidden; safe views appear instead).',
        inputSchema: {},
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async () => {
        const started = Date.now();
        const auth = await this.atlas.authenticate(ctx.rawToken, ctx.ip);
        if (!auth.ok) return this.deny('list_tables', 'metadata', auth, started, ctx);
        try {
          const tables = await this.db.listTables();
          return this.ok('list_tables', 'metadata', auth, started, ctx, {
            data: tables,
            rowCount: tables.length,
            relations: ['information_schema.tables'],
            text: `Listed ${tables.length} readable tables/views.`,
          });
        } catch (err) {
          return this.error('list_tables', 'metadata', auth, started, ctx, err);
        }
      },
    );

    server.registerTool(
      'describe_table',
      {
        title: 'Describe table',
        description: 'Show columns (name, type, nullability) of a readable table or *_safe view.',
        inputSchema: { table: z.string().describe('Table or view name, e.g. datasets or users_safe') },
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async ({ table }) => {
        const started = Date.now();
        const auth = await this.atlas.authenticate(ctx.rawToken, ctx.ip);
        if (!auth.ok) return this.deny('describe_table', 'metadata', auth, started, ctx);
        try {
          const cols = await this.db.describeTable(table);
          return this.ok('describe_table', 'metadata', auth, started, ctx, {
            data: cols,
            rowCount: cols.length,
            relations: [table],
            text: `Described ${table}: ${cols.length} columns.`,
          });
        } catch (err) {
          return this.error('describe_table', 'metadata', auth, started, ctx, err);
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
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async ({ sql, row_limit }) => {
        const started = Date.now();
        const auth = await this.atlas.authenticate(ctx.rawToken, ctx.ip);
        if (!auth.ok) return this.deny('query', 'read', auth, started, ctx, sql);
        try {
          const result = await this.db.runQuery(sql, row_limit);
          return this.ok('query', 'read', auth, started, ctx, {
            data: result,
            rowCount: result.row_count,
            relations: extractRelations(sql),
            statement: sql,
            text: `Query returned ${result.row_count} row(s)${result.truncated ? ' (capped)' : ''}.`,
            detail: { truncated: result.truncated, elapsed_ms: result.elapsed_ms },
          });
        } catch (err) {
          return this.error('query', 'read', auth, started, ctx, err, sql);
        }
      },
    );

    server.registerTool(
      'list_datasets',
      {
        title: 'List datasets',
        description: 'List AMS datasets with their backing stage table names, to map business datasets to queryable tables.',
        inputSchema: {},
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async () => {
        const started = Date.now();
        const auth = await this.atlas.authenticate(ctx.rawToken, ctx.ip);
        if (!auth.ok) return this.deny('list_datasets', 'metadata', auth, started, ctx);
        try {
          const datasets = await this.db.listDatasets();
          return this.ok('list_datasets', 'metadata', auth, started, ctx, {
            data: datasets,
            rowCount: datasets.length,
            relations: ['datasets'],
            text: `Listed ${datasets.length} datasets.`,
          });
        } catch (err) {
          return this.error('list_datasets', 'metadata', auth, started, ctx, err);
        }
      },
    );

    return server;
  }

  // ── result builders (all return normal 200 results carrying the audit block) ──

  private ok(
    tool: string,
    kind: string,
    auth: Extract<AtlasAuthResult, { ok: true }>,
    started: number,
    ctx: AtlasContext,
    r: { data: unknown; rowCount: number; relations: string[]; statement?: string; text: string; detail?: Record<string, unknown> },
  ): McpToolResult {
    this.audit.log({
      userId: auth.userId,
      action: `mcp:${tool}`,
      detail: { correlation_id: auth.correlationId, row_count: r.rowCount, ...(r.statement ? { sql: r.statement.slice(0, 4000) } : {}), ...r.detail },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'ok',
      subject: auth.subject,
      correlationId: auth.correlationId,
      operationKind: kind,
      statement: r.statement ?? null,
      relationsTouched: r.relations,
      rowCount: r.rowCount,
      startedAtMs: started,
      detail: r.detail,
    });
    return toolResult(r.text, r.data, audit);
  }

  private deny(
    tool: string,
    kind: string,
    auth: Extract<AtlasAuthResult, { ok: false }>,
    started: number,
    ctx: AtlasContext,
    statement?: string,
  ): McpToolResult {
    this.audit.log({
      userId: null,
      action: 'mcp:denied',
      detail: { tool, deny_reason: auth.denyReason, correlation_id: auth.correlationId },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'denied',
      denyReason: auth.denyReason,
      subject: auth.subject,
      correlationId: auth.correlationId,
      operationKind: kind,
      statement: statement ?? null,
      relationsTouched: [],
      rowCount: null,
      startedAtMs: started,
    });
    return toolResult(DENY_MESSAGE, null, audit);
  }

  private error(
    tool: string,
    kind: string,
    auth: Extract<AtlasAuthResult, { ok: true }>,
    started: number,
    ctx: AtlasContext,
    err: unknown,
    statement?: string,
  ): McpToolResult {
    const message = (err as Error)?.message ?? 'Tool execution failed.';
    this.audit.log({
      userId: auth.userId,
      action: `mcp:${tool}`,
      detail: { correlation_id: auth.correlationId, error: message, ...(statement ? { sql: statement.slice(0, 4000) } : {}) },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'error',
      subject: auth.subject,
      correlationId: auth.correlationId,
      operationKind: kind,
      statement: statement ?? null,
      relationsTouched: statement ? extractRelations(statement) : [],
      rowCount: null,
      startedAtMs: started,
      detail: { error: message },
    });
    return toolResult(`Error: ${message}`, null, audit);
  }
}
