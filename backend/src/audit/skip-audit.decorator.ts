import { SetMetadata } from '@nestjs/common';

export const SKIP_AUDIT_KEY = 'skip_audit';

/**
 * Exempts a handler (or whole controller) from the global AuditInterceptor's
 * automatic mutation logging. Use only for POST endpoints that are actually
 * read-like (connection tests, previews, SQL validation, token refresh).
 */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT_KEY, true);
