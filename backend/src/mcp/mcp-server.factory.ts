import { Injectable } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpReadonlyDbService, ForbiddenRelationsError } from './mcp-readonly-db.service';
import { McpAuthzService, type McpScope } from './mcp-authz.service';
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
  'Read-only access to the AMS (Alert Management System) Postgres database, scoped to the datasets',
  'you have been granted in AMS (admins see all). Tools only reveal your accessible datasets.',
  'Only SELECT/WITH queries are allowed; results are capped (default 500, max 2000 rows) and each query has an 8s time limit.',
  'Sensitive data is excluded: password hashes, session tokens, and stored credentials are unreadable.',
  'Start with list_datasets and list_tables to discover what you can access; use describe_table before writing a query.',
].join(' ');

const SCOPE_DENY_MESSAGE = 'Access denied: you do not have access to one or more of the requested datasets in AMS. Contact your administrator to request access.';

/** Per-request context: the caller the HTTP layer already verified + the source IP. */
export interface AtlasContext {
  identity?: AtlasIdentity;
  ip: string;
}

/**
 * Builds a stateless McpServer for one request. Authentication happens in the HTTP layer (a failed
 * tools/call is answered there as a 200 result with the audit). Here, every tool additionally
 * enforces PER-USER dataset scope (McpAuthzService): a caller sees/queries only the datasets granted
 * to them in AMS (admins: all). Query relations are checked against the caller's stage tables via the
 * DB planner (EXPLAIN); metadata tools are filtered; describe_table is gated. Deny-by-default.
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly db: McpReadonlyDbService,
    private readonly authz: McpAuthzService,
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
        description: 'List the tables/views you can access via MCP (only your granted datasets’ tables; admins see all).',
        inputSchema: {},
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async () => {
        const started = Date.now();
        const id = ctx.identity;
        if (!id) return this.unauthenticated('list_tables', 'metadata', started);
        try {
          const scope = await this.authz.resolve(id.userId);
          const all = await this.db.listTables();
          const tables = scope.isAdmin ? all : all.filter((t) => scope.allowedTables.has(t.table_name.toLowerCase()));
          return this.ok('list_tables', 'metadata', id, started, ctx, scope, {
            data: tables,
            rowCount: tables.length,
            relations: ['information_schema.tables'],
            text: `Listed ${tables.length} accessible tables/views.`,
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
        description: 'Show columns (name, type, nullability) of a table you can access.',
        inputSchema: { table: z.string().describe('Table or view name from list_tables (must be one you have access to)') },
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async ({ table }) => {
        const started = Date.now();
        const id = ctx.identity;
        if (!id) return this.unauthenticated('describe_table', 'metadata', started);
        try {
          const scope = await this.authz.resolve(id.userId);
          if (!scope.isAdmin && !scope.allowedTables.has(table.toLowerCase())) {
            return this.denyScope('describe_table', 'metadata', id, started, ctx, null, [table], scope);
          }
          const cols = await this.db.describeTable(table);
          return this.ok('describe_table', 'metadata', id, started, ctx, scope, {
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
        description: 'Run a single read-only SELECT (or WITH…SELECT). You may only reference tables of datasets you have access to. Non-SELECT statements are rejected; results are row-capped and time-limited.',
        inputSchema: {
          sql: z.string().describe('A single SELECT or WITH…SELECT statement referencing only your accessible tables. No DDL/DML, no multiple statements.'),
          row_limit: z.number().int().positive().optional().describe('Rows requested; silently capped at 2000 (default 500). A capped result sets truncated:true.'),
        },
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async ({ sql, row_limit }) => {
        const started = Date.now();
        const id = ctx.identity;
        if (!id) return this.unauthenticated('query', 'read', started);
        let scope: McpScope;
        try {
          scope = await this.authz.resolve(id.userId);
        } catch (err) {
          return this.error('query', 'read', id, started, ctx, err, sql);
        }
        try {
          let relations: string[] | undefined;
          if (!scope.isAdmin) {
            // Authoritative relation list from the planner (EXPLAIN, no execution).
            relations = await this.db.explainRelations(sql, row_limit);
            const forbidden = relations.filter((r) => !scope.allowedTables.has(r));
            if (forbidden.length) {
              return this.denyScope('query', 'read', id, started, ctx, sql, forbidden, scope);
            }
          }
          const result = await this.db.runQuery(sql, row_limit);
          return this.ok('query', 'read', id, started, ctx, scope, {
            data: result,
            rowCount: result.row_count,
            relations: relations ?? extractRelations(sql),
            statement: sql,
            text: `Query returned ${result.row_count} row(s)${result.truncated ? ' (capped)' : ''}.`,
            detail: { truncated: result.truncated, elapsed_ms: result.elapsed_ms },
          });
        } catch (err) {
          if (err instanceof ForbiddenRelationsError) {
            return this.denyScope('query', 'read', id, started, ctx, sql, err.relations, scope);
          }
          return this.error('query', 'read', id, started, ctx, err, sql);
        }
      },
    );

    server.registerTool(
      'list_datasets',
      {
        title: 'List datasets',
        description: 'List the AMS datasets you can access with their backing stage table names (admins see all).',
        inputSchema: {},
        outputSchema: TOOL_OUTPUT_SHAPE,
      },
      async () => {
        const started = Date.now();
        const id = ctx.identity;
        if (!id) return this.unauthenticated('list_datasets', 'metadata', started);
        try {
          const scope = await this.authz.resolve(id.userId);
          const all = await this.db.listDatasets();
          const datasets = scope.isAdmin
            ? all
            : all.filter((d) => scope.allowedTables.has(String(d.stage_table_name ?? '').toLowerCase()));
          return this.ok('list_datasets', 'metadata', id, started, ctx, scope, {
            data: datasets,
            rowCount: datasets.length,
            relations: ['datasets'],
            text: `Listed ${datasets.length} accessible datasets.`,
          });
        } catch (err) {
          return this.error('list_datasets', 'metadata', id, started, ctx, err);
        }
      },
    );

    return server;
  }

  // ── result builders (tool results are HTTP-200; auth denials are handled at the HTTP layer) ──

  private ok(
    tool: string,
    kind: string,
    id: AtlasIdentity,
    started: number,
    ctx: AtlasContext,
    scope: McpScope,
    r: { data: unknown; rowCount: number; relations: string[]; statement?: string; text: string; detail?: Record<string, unknown> },
  ): McpToolResult {
    this.audit.log({
      userId: id.userId,
      action: `mcp:${tool}`,
      detail: { correlation_id: id.correlationId, row_count: r.rowCount, grant_count: scope.datasetCount, ...(r.statement ? { sql: r.statement.slice(0, 4000) } : {}), ...r.detail },
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
      detail: { grant_count: scope.datasetCount, ...r.detail },
    });
    return toolResult(r.text, r.data, audit);
  }

  /** Per-user scope denial (authenticated, but not granted the dataset). 200 + audit, not an error. */
  private denyScope(
    tool: string,
    kind: string,
    id: AtlasIdentity,
    started: number,
    ctx: AtlasContext,
    statement: string | null,
    forbidden: string[],
    scope: McpScope,
  ): McpToolResult {
    this.audit.log({
      userId: id.userId,
      action: 'mcp:denied',
      detail: { tool, deny_reason: 'no_permission', correlation_id: id.correlationId, forbidden_relations: forbidden, grant_count: scope.datasetCount },
      ipAddress: ctx.ip,
    });
    const audit = buildAudit({
      tool,
      outcome: 'denied',
      denyReason: 'no_permission',
      subject: id.subject,
      correlationId: id.correlationId,
      operationKind: kind,
      statement: statement ?? null,
      relationsTouched: forbidden,
      rowCount: null,
      startedAtMs: started,
      detail: { forbidden_relations: forbidden, grant_count: scope.datasetCount },
    });
    return toolResult(SCOPE_DENY_MESSAGE, null, audit);
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

  /** Defensive only — the HTTP layer authenticates every tools/call before the transport runs. */
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
