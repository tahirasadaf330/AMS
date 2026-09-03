import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocketIoAdapter } from './websocket/socket-io.adapter';
import * as cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { SnakeCaseInterceptor } from './common/interceptors/snake-case.interceptor';
import { auditContext } from './audit/audit-context';
import { McpHttpService } from './mcp/mcp-http.service';
import type { Router } from 'express';

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function bodyToCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(bodyToCamel);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[toCamel(k)] = bodyToCamel(v);
    }
    return out;
  }
  return value;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);

  // MCP endpoint — mounted FIRST, before the camelize body middleware and the global
  // SnakeCaseInterceptor, so JSON-RPC payloads (e.g. `row_limit`) are never rewritten and
  // responses aren't snake_cased. The router is resolved from DI after app.init() below;
  // until then the lazy shim answers 503. Nest's built-in body parser (registered at
  // create()) has already populated req.body by the time this handler runs.
  let mcpRouter: Router | null = null;
  app.use('/mcp', (req, res, next) => {
    if (mcpRouter) return mcpRouter(req, res, next);
    res.status(503).json({ jsonrpc: '2.0', error: { code: -32001, message: 'MCP not ready.' }, id: null });
  });

  // CORS
  const allowedOrigins = (
    configService.get<string>('CORS_ORIGINS', 'http://localhost:3000')
  ).split(',').map(o => o.trim());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  });

  // Cookie parser
  app.use(cookieParser());

  // Per-request audit context: the global AuditInterceptor uses it to detect whether
  // the handler already wrote a manual audit entry (prevents double-logging).
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    auditContext.run({ logged: false }, next);
  });

  // Convert incoming snake_case request bodies to camelCase
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      req.body = bodyToCamel(req.body) as Record<string, unknown>;
    }
    next();
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Global snake_case response transform
  app.useGlobalInterceptors(new SnakeCaseInterceptor());

  // WebSocket adapter
  app.useWebSocketAdapter(new SocketIoAdapter(app));

  // DI container is ready — resolve the MCP router so the /mcp shim above starts serving.
  await app.init();
  mcpRouter = app.get(McpHttpService).router;

  await app.listen(port);
  console.log(`AMS Backend running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start AMS backend:', err);
  process.exit(1);
});
