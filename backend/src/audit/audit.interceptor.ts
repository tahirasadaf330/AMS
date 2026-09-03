import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Request } from 'express';
import { AuditService } from './audit.service';
import { auditContext } from './audit-context';
import { SKIP_AUDIT_KEY } from './skip-audit.decorator';

const METHOD_VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

const SENSITIVE_KEY = /password|secret|token|key|credential|authorization/i;

// Redacts secret-looking fields and bounds depth/size so the jsonb detail column
// never stores credentials or multi-megabyte payloads.
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  // Buffers/streams (multipart uploads) would otherwise enumerate byte-by-byte.
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

// Builds a `family:verb` action matching the manual-logging convention, from the
// express route pattern (":id" segments excluded), e.g.
//   POST   /reports/voice-outliers/rebuild -> voice_outliers:rebuild
//   DELETE /conditions/:id                 -> conditions:delete
function deriveAction(method: string, routePath: string): string {
  const segments = routePath.split('/').filter((s) => s && !s.startsWith(':'));
  let family = segments[0] ?? 'http';
  if ((family === 'admin' || family === 'reports') && segments.length > 1) {
    family = segments[1];
  }
  const tail = segments[segments.length - 1];
  const verb = tail && tail !== family ? tail : METHOD_VERB[method];
  return `${family.replace(/-/g, '_')}:${verb.replace(/-/g, '_')}`;
}

type AuditableRequest = Request & { user?: { sub?: string } };

/**
 * Safety net guaranteeing every successful create/edit/delete is audited.
 * Handlers with hand-written AuditService.log() calls keep their richer entries
 * (detected via auditContext); anything else that mutates gets a generic entry
 * automatically — including endpoints added in the future.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<AuditableRequest>();
    if (!METHOD_VERB[req.method]) return next.handle();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return next.handle();

    return next.handle().pipe(
      tap(() => {
        // Auditing must never break the request it is observing: anything thrown
        // in here would surface to the client as a failed mutation.
        try {
          if (auditContext.getStore()?.logged) return;

          const routePath = (req.route?.path as string) || req.path || '';
          const params = req.params ?? {};
          const paramValues = Object.values(params);
          const body = req.body as Record<string, unknown> | undefined;

          this.auditService.log({
            userId: req.user?.sub ?? null,
            action: deriveAction(req.method, routePath),
            resource: paramValues.length ? String(paramValues[0]) : routePath,
            detail: {
              method: req.method,
              path: req.originalUrl?.split('?')[0] || routePath,
              ...(paramValues.length ? { params } : {}),
              ...(body && Object.keys(body).length ? { body: redact(body) } : {}),
            },
            ipAddress:
              (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
              req.socket?.remoteAddress ||
              null,
          });
        } catch (err) {
          this.logger.error('Audit interceptor failed', err as Error);
        }
      }),
    );
  }
}
