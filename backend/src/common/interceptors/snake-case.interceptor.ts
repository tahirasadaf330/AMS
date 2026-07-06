import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function toSnake(key: string): string {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

const UPPER = /[A-Z]/;

function isPlainPrimitive(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean';
}

function transform(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(transform);
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Buffer)) {
    const entries = Object.entries(value as Record<string, unknown>);
    // Fast-path: all keys already snake_case and all values are primitives — return as-is
    if (entries.every(([k, v]) => !UPPER.test(k) && isPlainPrimitive(v))) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[toSnake(k)] = transform(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class SnakeCaseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map(transform));
  }
}
