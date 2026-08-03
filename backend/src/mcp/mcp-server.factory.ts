import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { type AtlasIdentity } from './atlas-auth.service';
import { AuditService } from '../audit/audit.service';
import {
  buildAudit,
  extractRelations,
  toolResult,
  TOOL_OUTPUT_SHAPE,
  type McpToolResult,
} from './mcp-audit';

const INSTRUCTIONS = [
  'Read-only access to the AMS (Alert Management System) Postgres database.',
  'Only SELECT/WITH queries are allowed; results are capped (default 500, max 2000 rows) and each query has an 8s time limit.',
  'Sensitive data is excluded: password hashes, session tokens, and stored credentials are unreadable.',
  'The users, data_sources and notification_log tables are exposed only via the users_safe, data_sources_safe and notification_log_safe views (which omit those sensitive columns).',
  'Start with list_tables and list_datasets to discover what is available; use describe_table before writing a query.',
].join(' ');

/** Per-request context. `identity` is the caller the HTTP layer already verified (present for
 *  `tools/call`; absent for `initialize`/`tools/list` discovery, which never run a tool handler). */
export interface AtlasContext {
  identity?: AtlasIdentity;
  ip: string;
}

/**
 * Builds a stateless McpServer for one request. Authentication happens in the HTTP layer BEFORE
 * this server runs (McpHttpService: a failed `tools/call` is refused with HTTP 401/403 and never
 * reaches here). `initialize`/`tools/list` are unauthenticated discovery. So by the time a tool
 * handler runs, `ctx.identity` is present — handlers execute and return the result + an ok/error
 * audit block in structuredContent.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly db: McpReadonlyDbService,
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
        const id = ctx.identity;
        if (!id) return this.unauthenticated('list_tables', 'metadata', started);
        try {
          const tables = await this.db.listTables();
          return this.ok('list_tables', 'metadata', id, started, ctx, {
            data: tables,
            rowCount: tables.length,
            relations: ['information_schema.tables'],
            text: `Listed ${tables.length} readable tables/views.`,
          });
        } catch (err) {
          return this.error('list_tables', 'metadata', id, started, ctx, err);
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
        const id = ctx.identity;
        if (!id) return this.unauthenticated('describe_table', 'metadata', started);
        try {
          const cols = await this.db.describeTable(table);
          return this.ok('describe_table', 'metadata', id, started, ctx, {
            data: cols,
            rowCount: cols.length,
            relations: [table],
            text: `Described ${table}: ${cols.length} columns.`,
          });
        } catch (err) {
          return this.error('describe_table', 'metadata', id, started, ctx, err);
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
        const id = ctx.identity;
        if (!id) return this.unauthenticated('query', 'read', started);
        try {
          const result = await this.db.runQuery(sql, row_limit);
          return this.ok('query', 'read', id, started, ctx, {
            data: result,
            rowCount: result.row_count,
            relations: extractRelations(sql),
            statement: sql,
            text: `Query returned ${result.row_count} row(s)${result.truncated ? ' (capped)' : ''}.`,
            detail: { truncated: result.truncated, elapsed_ms: result.elapsed_ms },
          });
        } catch (err) {
          return this.error('query', 'read', id, started, ctx, err, sql);
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
        const id = ctx.identity;
        if (!id) return this.unauthenticated('list_datasets', 'metadata', started);
        try {
          const datasets = await this.db.listDatasets();
          return this.ok('list_datasets', 'metadata', id, started, ctx, {
            data: datasets,
            rowCount: datasets.length,
            relations: ['datasets'],
            text: `Listed ${datasets.length} datasets.`,
          });
        } catch (err) {
          return this.error('list_datasets', 'metadata', id, started, ctx, err);
        }
      },
    );

    return server;
  }

  // ── result builders (tool results are HTTP-200; denials are handled at the HTTP layer) ──

  private ok(
    tool: string,
    kind: string,
    id: AtlasIdentity,
    started: number,
    ctx: AtlasContext,
    r: { data: unknown; rowCount: number; relations: string[]; statement?: string; text: string; detail?: Record<string, unknown> },
  ): McpToolResult {
    this.audit.log({
      userId: id.userId,
      action: `mcp:${tool}`,
      detail: { correlation_id: id.correlationId, row_count: r.rowCount, ...(r.statement ? { sql: r.statement.slice(0, 4000) } : {}), ...r.detail },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'ok',
      subject: id.subject,
      correlationId: id.correlationId,
      operationKind: kind,
      statement: r.statement ?? null,
      relationsTouched: r.relations,
      rowCount: r.rowCount,
      startedAtMs: started,
      detail: r.detail,
    });
    return toolResult(r.text, r.data, audit);
  }

  private error(
    tool: string,
    kind: string,
    id: AtlasIdentity,
    started: number,
    ctx: AtlasContext,
    err: unknown,
    statement?: string,
  ): McpToolResult {
    const message = (err as Error)?.message ?? 'Tool execution failed.';
    this.audit.log({
      userId: id.userId,
      action: `mcp:${tool}`,
      detail: { correlation_id: id.correlationId, error: message, ...(statement ? { sql: statement.slice(0, 4000) } : {}) },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'error',
      subject: id.subject,
      correlationId: id.correlationId,
      operationKind: kind,
      statement: statement ?? null,
      relationsTouched: statement ? extractRelations(statement) : [],
      rowCount: null,
      startedAtMs: started,
      detail: { error: message },
    });
    return toolResult(`Error: ${message}`, null, audit);
  }

  /** Defensive only — the HTTP layer authenticates every tools/call before the transport runs,
   *  so a handler should never see a missing identity. Returns a well-formed error result. */
  private unauthenticated(tool: string, kind: string, started: number): McpToolResult {
    const audit = buildAudit({
      tool,
      outcome: 'error',
      subject: { oid: null, email: null, matchedBy: null, localUserId: null },
      correlationId: 'unknown',
      operationKind: kind,
      statement: null,
      relationsTouched: [],
      rowCount: null,
      startedAtMs: started,
      detail: { error: 'unauthenticated' },
    });
    return toolResult('Error: unauthenticated request reached the tool handler.', null, audit);
  }
}
