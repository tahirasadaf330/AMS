import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpServerFactory } from './mcp-server.factory';
import { McpHttpService } from './mcp-http.service';
import { AtlasAuthService } from './atlas-auth.service';
import { McpAuthzService } from './mcp-authz.service';

/**
 * MCP server: read-only DB access over Streamable HTTP for Atlas (Hayo's AI platform).
 * Atlas authenticates each call with an RS256 JWT (AtlasAuthService); there are no per-user
 * API keys. The HTTP transport is mounted at /mcp in main.ts (BEFORE Nest middleware) using
 * McpHttpService.router, which is why it's exported. DataSource + ConfigService are global.
 */
@Module({
  imports: [AuditModule],
  providers: [AtlasAuthService, McpAuthzService, McpReadonlyDbService, McpServerFactory, McpHttpService],
  exports: [McpHttpService],
})
export class McpModule {}
