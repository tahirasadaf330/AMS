import { z } from 'zod';

/**
 * Atlas MCP audit block (v1) — the contract in the Atlas integration spec, Appendix A.
 * Atlas parses every MCP's audit into one shared table, so field names/types/enums are fixed.
 * It is returned inside `structuredContent` (NOT _meta, not a second content block, not a
 * top-level field) alongside the tool's `data`, and it must be present on EVERY tools/call —
 * including denials, which is why denials are normal HTTP-200 results, never JSON-RPC errors.
 */

export type Outcome = 'ok' | 'denied' | 'error';
export type MatchedBy = 'oid' | 'email' | null;
// Fixed vocabulary; fall back to a short snake_case code + `detail` if none fit.
export type DenyReason =
  | 'bad_token' | 'token_expired' | 'token_replayed'
  | 'no_account' | 'ambiguous_account' | 'no_permission'
  | 'not_allowed_operation' | 'rate_limited';

export interface AuditBlock {
  schema_version: 1;
  system: 'ams';
  tool: string;
  outcome: Outcome;
  deny_reason: string | null;
  subject: { oid: string | null; email: string | null; matched_by: MatchedBy; local_user_id: string | null };
  correlation_id: string;
  operation: { kind: string; statement: string | null };
  relations_touched: string[];
  row_count: number | null;
  columns_masked: string[];
  duration_ms: number;
  server_time: string;
  detail?: Record<string, unknown>;
}

// ── zod schema (mirrors Appendix A, incl. the deny_reason conditional) ──
const subjectSchema = z.object({
  oid: z.string().nullable(),
  email: z.string().nullable(),
  matched_by: z.enum(['oid', 'email']).nullable(),
  local_user_id: z.string().nullable().optional(),
});

export const auditSchema = z
  .object({
    schema_version: z.literal(1),
    system: z.string().regex(/^[a-z0-9_-]{2,32}$/),
    tool: z.string().min(1).max(128),
    outcome: z.enum(['ok', 'denied', 'error']),
    deny_reason: z.string().max(64).nullable().optional(),
    subject: subjectSchema,
    correlation_id: z.string().min(1),
    operation: z.object({ kind: z.string().min(1), statement: z.string().max(4000).nullable() }),
    relations_touched: z.array(z.string()).max(50),
    row_count: z.number().int().min(0).nullable(),
    columns_masked: z.array(z.string()).optional(),
    duration_ms: z.number().int().min(0),
    server_time: z.string(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === 'denied' && !v.deny_reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'deny_reason required when outcome=denied' });
    }
    if (v.outcome === 'ok' && v.deny_reason != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'deny_reason must be null when outcome=ok' });
    }
  });

/** Declared as each tool's `outputSchema` so the audit reaches Atlas via structuredContent. */
export const TOOL_OUTPUT_SHAPE = {
  data: z.unknown().nullable(),
  audit: auditSchema,
};

export interface AuditInput {
  tool: string;
  outcome: Outcome;
  denyReason?: DenyReason | string | null;
  subject: { oid: string | null; email: string | null; matchedBy: MatchedBy; localUserId?: string | null };
  correlationId: string;
  operationKind: string;
  statement?: string | null;
  relationsTouched?: string[];
  rowCount?: number | null;
  columnsMasked?: string[];
  startedAtMs: number;
  detail?: Record<string, unknown>;
}

/** SQL is read-only against non-secret tables (secrets are excluded at the PG role), so this is
 *  a light pass: bound length; redact any accidental inline password=/secret= literal. */
function scrubStatement(sql: string): string {
  const redacted = sql.replace(/\b(password|secret|token)\s*=\s*'[^']*'/gi, "$1='***'");
  return redacted.length > 4000 ? redacted.slice(0, 4000) : redacted;
}

/** Best-effort table extraction for relations_touched (FROM/JOIN identifiers). Approximate. */
export function extractRelations(sql: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:from|join)\s+("?[a-z_][a-z0-9_.$"]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const t = m[1].replace(/"/g, '').replace(/^public\./i, '');
    if (t && t !== '_q') out.add(t);
  }
  return [...out].slice(0, 50);
}

export function buildAudit(a: AuditInput): AuditBlock {
  return {
    schema_version: 1,
    system: 'ams',
    tool: a.tool,
    outcome: a.outcome,
    deny_reason: a.outcome === 'denied' ? (a.denyReason ?? 'no_account') : null,
    subject: {
      oid: a.subject.oid,
      email: a.subject.email,
      matched_by: a.subject.matchedBy,
      local_user_id: a.subject.localUserId ?? null,
    },
    correlation_id: a.correlationId,
    operation: { kind: a.operationKind, statement: a.statement != null ? scrubStatement(a.statement) : null },
    relations_touched: a.relationsTouched ?? [],
    row_count: a.rowCount ?? null,
    columns_masked: a.columnsMasked ?? [],
    duration_ms: Math.max(0, Date.now() - a.startedAtMs),
    server_time: new Date().toISOString(),
    ...(a.detail ? { detail: a.detail } : {}),
  };
}

export interface McpToolResult {
  // Index signature required by the MCP SDK's CallToolResult type.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: { data: unknown; audit: AuditBlock };
  isError: false;
}

/** Every tool response — data + audit in structuredContent, always isError:false (denials too). */
export function toolResult(text: string, data: unknown, audit: AuditBlock): McpToolResult {
  return { content: [{ type: 'text', text }], structuredContent: { data, audit }, isError: false };
}

export const DENY_MESSAGE = 'Access denied: no account provisioned, or it is inactive.';

// Distinct, non-enumerating caller messages per deny reason. Account-existence reasons
// (no_account / ambiguous_account / inactive) deliberately share ONE identical message (spec §3.6:
// never reveal which account check failed). Token-level reasons are safe to distinguish, and doing
// so avoids mis-diagnosis — e.g. a replayed jti previously read as "no account provisioned".
const DENY_MESSAGES: Record<string, string> = {
  bad_token: 'Access denied: the request token is missing or could not be verified.',
  token_expired: 'Access denied: the request token has expired.',
  token_replayed: 'Access denied: this request token has already been used — Atlas tokens are single-use.',
  no_account: DENY_MESSAGE,
  ambiguous_account: DENY_MESSAGE,
  no_permission: 'Access denied: you do not have access to that data.',
  not_allowed_operation: 'Access denied: that operation is not permitted.',
  rate_limited: 'Rate limit exceeded — please retry shortly.',
};

/** Caller-facing message for a deny reason (falls back to the generic account message). */
export function denyMessage(reason?: string | null): string {
  return (reason != null && DENY_MESSAGES[reason]) || DENY_MESSAGE;
}
