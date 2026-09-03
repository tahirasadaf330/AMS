import { AsyncLocalStorage } from 'async_hooks';

// Per-request context, entered by a middleware in main.ts. AuditService.log() flips
// `logged` so the global AuditInterceptor knows a handler already wrote its own
// (richer) audit entry and the generic safety-net entry must not be written too.
export interface AuditRequestContext {
  logged: boolean;
}

export const auditContext = new AsyncLocalStorage<AuditRequestContext>();
