import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { McpKeysService } from './mcp-keys.service';
import { McpKeysController } from './mcp-keys.controller';
import { McpReadonlyDbService } from './mcp-readonly-db.service';
import { McpServerFactory } from './mcp-server.factory';
import { McpHttpService } from './mcp-http.service';

/**
 * MCP server: read-only DB access over Streamable HTTP with per-user API keys.
 * The HTTP transport is mounted at /mcp in main.ts (BEFORE Nest middleware) using
 * McpHttpService.router, which is why it's exported. DataSource + ConfigService are global.
 */
@Module({
  imports: [AuditModule],
  controllers: [McpKeysController],
  providers: [McpKeysService, McpReadonlyDbService, McpServerFactory, McpHttpService],
  exports: [McpHttpService],
})
export class McpModule {}
