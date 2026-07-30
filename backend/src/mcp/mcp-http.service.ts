import { Injectable, Logger } from '@nestjs/common';
import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpKeysService } from './mcp-keys.service';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpServerFactory } from './mcp-server.factory';
import { AuditService } from '../audit/audit.service';

/**
 * Express router for the MCP endpoint, mounted at /mcp in main.ts BEFORE any Nest
 * middleware — so the incoming body-camelize middleware and the global SnakeCaseInterceptor
 * never touch JSON-RPC traffic. Stateless Streamable HTTP: one McpServer + transport per
 * POST, JSON responses (no SSE), bearer-key auth per request.
 */
@Injectable()
export class McpHttpService {
  private readonly logger = new Logger(McpHttpService.name);
  readonly router: Router;

  constructor(
    private readonly keys: McpKeysService,
    private readonly db: McpReadonlyDbService,
    private readonly factory: McpServerFactory,
    private readonly audit: AuditService,
  ) {
    this.router = Router();
    this.router.post('/', (req, res) => void this.handlePost(req, res));
    // Stateless server: SSE stream / session teardown not supported.
    this.router.get('/', (_req, res) => this.methodNotAllowed(res));
    this.router.delete('/', (_req, res) => this.methodNotAllowed(res));
  }

  private ip(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
  }

  private jsonRpcError(res: Response, status: number, code: number, message: string): void {
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
  }

  private methodNotAllowed(res: Response): void {
    this.jsonRpcError(res, 405, -32000, 'Method not allowed. This MCP endpoint is stateless; use POST.');
  }

  private async handlePost(req: Request, res: Response): Promise<void> {
    // Disabled if the read-only DB role isn't configured — backend still runs.
    if (!this.db.isConfigured()) {
      this.jsonRpcError(res, 503, -32001, 'MCP is not configured on this server.');
      return;
    }

    // Bearer key (fallback X-API-Key), verified every request (revocation + active-user kill-switch).
    const auth = req.headers['authorization'];
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const rawKey = bearer || (req.headers['x-api-key'] as string | undefined);
    const identity = await this.keys.verify(rawKey);
    if (!identity) {
      const prefix = rawKey ? rawKey.slice(0, 16) : null;
      this.audit.log({ userId: null, action: 'mcp:auth_failed', detail: { prefix }, ipAddress: this.ip(req) });
      res.setHeader('WWW-Authenticate', 'Bearer');
      this.jsonRpcError(res, 401, -32001, 'Invalid or missing API key.');
      return;
    }

    // Fresh stateless server + transport per request, bound to this identity.
    const server = this.factory.build(identity, this.ip(req));
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.logger.error('MCP request handling failed', err as Error);
      if (!res.headersSent) {
        this.jsonRpcError(res, 500, -32603, 'Internal error handling MCP request.');
      }
    }
  }
}
