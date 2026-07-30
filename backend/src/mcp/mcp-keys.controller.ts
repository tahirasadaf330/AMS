import { Controller, Get, Post, Delete, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { McpKeysService } from './mcp-keys.service';

/**
 * Admin management of per-user MCP API keys. Scoped under admin/users so it sits alongside
 * the existing user-management surface; admin-only, every mutation audited.
 */
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class McpKeysController {
  constructor(
    private readonly keys: McpKeysService,
    private readonly audit: AuditService,
  ) {}

  private ip(req: Request): string {
    return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
  }

  @Get(':id/mcp-key')
  getStatus(@Param('id') id: string) {
    return this.keys.getStatus(id);
  }

  // Returns the plaintext key ONCE (mirrors the temp-password reveal); revokes any prior key.
  @Post(':id/mcp-key')
  async generate(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: Request) {
    const result = await this.keys.generate(id, user.sub);
    this.audit.log({
      userId: user.sub,
      action: 'admin:mcp_key_generate',
      resource: id,
      detail: { prefix: result.prefix },
      ipAddress: this.ip(req),
    });
    return result;
  }

  @Delete(':id/mcp-key')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string, @CurrentUser() user: JwtUser, @Req() req: Request) {
    await this.keys.revoke(id);
    this.audit.log({
      userId: user.sub,
      action: 'admin:mcp_key_revoke',
      resource: id,
      ipAddress: this.ip(req),
    });
    return { message: 'MCP key revoked' };
  }
}
