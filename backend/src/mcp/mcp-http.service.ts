import { Injectable, Logger } from '@nestjs/common';
import { Router, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpServerFactory } from './mcp-server.factory';
import { AtlasAuthService } from './atlas-auth.service';

/**
 * Express router for the MCP endpoint, mounted at /mcp in main.ts BEFORE any Nest
 * middleware — so the incoming body-camelize middleware and the global SnakeCaseInterceptor
 * never touch JSON-RPC traffic. Stateless Streamable HTTP: one McpServer + transport per POST,
 * JSON responses (no SSE).
 *
 * Auth is NOT enforced here. Atlas is the only consumer; it presents an RS256 JWT which is
 * verified *inside each tool handler* so a denial can be returned as a normal 200 result
 * carrying the audit block (Atlas's client raises on JSON-RPC errors before it can read the
 * audit). `initialize` and `tools/list` are unauthenticated discovery.
 */
@Injectable()
export class McpHttpService {
  private readonly logger = new Logger(McpHttpService.name);
  readonly router: Router;

  constructor(
    private readonly db: McpReadonlyDbService,
    private readonly atlas: AtlasAuthService,
    private readonly factory: McpServerFactory,
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
    // Disabled (503) unless BOTH the read-only DB role and Atlas token config are present.
    // The rest of the backend runs regardless.
    if (!this.db.isConfigured() || !this.atlas.isConfigured()) {
      this.jsonRpcError(res, 503, -32001, 'MCP is not configured on this server.');
      return;
    }

    // Carry the raw bearer token + IP into the per-request server; the tool handlers verify it.
    const rawToken = AtlasAuthService.extractBearer(req.headers['authorization'] as string | undefined);
    const server = this.factory.build({ rawToken, ip: this.ip(req) });
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
