import { Injectable, Logger } from '@nestjs/common';
import { Router, json, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpServerFactory } from './mcp-server.factory';
import { AtlasAuthService, type AtlasIdentity } from './atlas-auth.service';
import { AuditService } from '../audit/audit.service';
import { buildAudit, DENY_MESSAGE } from './mcp-audit';

/**
 * Express router for the MCP endpoint, mounted at /mcp in main.ts BEFORE any Nest
 * middleware — so the incoming body-camelize middleware and the global SnakeCaseInterceptor
 * never touch JSON-RPC traffic. Stateless Streamable HTTP: one McpServer + transport per POST,
 * JSON responses (no SSE).
 *
 * Atlas is the only consumer; it presents an RS256 JWT. A `tools/call` is authenticated HERE,
 * before the MCP transport runs. A denial is returned as a normal JSON-RPC **200 result**
 * (`isError:false`) whose `structuredContent` carries the audit block — NOT an HTTP 401/403.
 * Atlas's langchain-mcp-adapters client raises on transport-level errors before parsing a tool
 * result, so an error body loses the audit (and turns a routine "no access" answer into an
 * outage); a refusal is a successful tool execution with a negative result. It is still never a
 * redirect or HTML. `initialize` and `tools/list` are unauthenticated discovery.
 */
@Injectable()
export class McpHttpService {
  private readonly logger = new Logger(McpHttpService.name);
  readonly router: Router;

  constructor(
    private readonly db: McpReadonlyDbService,
    private readonly atlas: AtlasAuthService,
    private readonly factory: McpServerFactory,
    private readonly audit: AuditService,
  ) {
    this.router = Router();
    // Parse the JSON-RPC body here (this route is mounted before Nest's body parser) so we can
    // read the method for auth. json() does NOT camelize keys, so JSON-RPC payloads stay intact;
    // the parsed body is then handed to the MCP transport (no double-read).
    this.router.post('/', json({ limit: '1mb' }), (req, res) => void this.handlePost(req, res));
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

  /** Find the tools/call request in a single or batched JSON-RPC body (that's the only method we
   *  authenticate; initialize/tools/list/notifications are open discovery). */
  private findToolCall(body: unknown): { id: unknown; name: string } | null {
    const messages = Array.isArray(body) ? body : [body];
    for (const m of messages) {
      if (m && typeof m === 'object' && (m as { method?: string }).method === 'tools/call') {
        const msg = m as { id?: unknown; params?: { name?: string } };
        return { id: msg.id ?? null, name: msg.params?.name ?? 'unknown' };
      }
    }
    return null;
  }

  private async handlePost(req: Request, res: Response): Promise<void> {
    // Disabled (503) unless BOTH the read-only DB role and Atlas token config are present.
    // The rest of the backend runs regardless.
    if (!this.db.isConfigured() || !this.atlas.isConfigured()) {
      this.jsonRpcError(res, 503, -32001, 'MCP is not configured on this server.');
      return;
    }

    const ip = this.ip(req);
    const toolCall = this.findToolCall(req.body);

    // Authenticate a tools/call before the transport runs, so a failure can be a real 401/403.
    let identity: AtlasIdentity | undefined;
    if (toolCall) {
      const started = Date.now();
      const token = AtlasAuthService.extractBearer(req.headers['authorization'] as string | undefined);
      const auth = await this.atlas.authenticate(token, ip);
      if (!auth.ok) {
        this.audit.log({
          userId: null,
          action: 'mcp:denied',
          detail: { tool: toolCall.name, deny_reason: auth.denyReason, correlation_id: auth.correlationId },
          ipAddress: ip,
        });
        const auditBlock = buildAudit({
          tool: toolCall.name,
          outcome: 'denied',
          denyReason: auth.denyReason,
          subject: auth.subject,
          correlationId: auth.correlationId,
          operationKind: toolCall.name === 'query' ? 'read' : 'metadata',
          statement: null,
          relationsTouched: [],
          rowCount: null,
          startedAtMs: started,
        });
        // Deliver the denial as a normal JSON-RPC tool RESULT (HTTP 200, isError:false) with the
        // audit in structuredContent — the only channel Atlas's client reads. Bypasses the MCP
        // transport (no tool runs), but the envelope is shape-identical to a transport result.
        res.status(200).json({
          jsonrpc: '2.0',
          id: toolCall.id,
          result: {
            content: [{ type: 'text', text: DENY_MESSAGE }],
            structuredContent: { data: null, audit: auditBlock },
            isError: false,
          },
        });
        return;
      }
      identity = { userId: auth.userId, email: auth.email, correlationId: auth.correlationId, subject: auth.subject };
    }

    // Fresh stateless server + transport per request. Discovery (initialize/tools/list) runs with
    // no identity; a tools/call always has one by the time a handler executes.
    const server = this.factory.build({ identity, ip });
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
