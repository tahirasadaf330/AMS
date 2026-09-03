import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { SkipAudit } from '../../audit/skip-audit.decorator';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class SettingsController {
  constructor(
    private settingsService: SettingsService,
    private auditService: AuditService,
  ) {}

  @Get()
  getAll() {
    return this.settingsService.getAll();
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  async updateBulk(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.settingsService.setBulk(body, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:settings_update',
      resource: 'settings',
      detail: { keys: Object.keys(body) },
      ipAddress,
    });
    return { message: 'Settings updated' };
  }

  @Post('test-jerasoft')
  @SkipAudit() // read-like: connectivity test
  @HttpCode(HttpStatus.OK)
  testJerasoft() {
    return this.settingsService.testJerasoft();
  }

  @Post('test-graph')
  @SkipAudit() // read-like: connectivity test
  @HttpCode(HttpStatus.OK)
  testGraph() {
    return this.settingsService.testGraph();
  }

  @Post('test-teams')
  @SkipAudit() // read-like: connectivity test (sends only a test webhook ping)
  @HttpCode(HttpStatus.OK)
  testTeams(@Body() body: { webhookUrl?: string }) {
    return this.settingsService.testTeams(body.webhookUrl);
  }

  @Get('python-packages')
  listPythonPackages() {
    return this.settingsService.listPythonPackages();
  }

  @Post('python-packages/install')
  @HttpCode(HttpStatus.OK)
  async installPythonPackage(
    @Body('packageSpec') packageSpec: string,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.settingsService.installPythonPackage(packageSpec ?? '');
    this.auditService.log({
      userId: user.sub,
      action: 'admin:python_package_install',
      resource: packageSpec ?? '',
      detail: {},
    });
    return result;
  }

  @Post('python-packages/uninstall')
  @HttpCode(HttpStatus.OK)
  async uninstallPythonPackage(
    @Body('name') name: string,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.settingsService.uninstallPythonPackage(name ?? '');
    this.auditService.log({
      userId: user.sub,
      action: 'admin:python_package_uninstall',
      resource: name ?? '',
      detail: {},
    });
    return result;
  }

  @Post('rotate-key')
  @HttpCode(HttpStatus.OK)
  async rotateKey(
    @Body() body: { newKeyHex: string },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.settingsService.rotateEncryptionKey(body.newKeyHex, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:rotate_key',
      resource: 'credentials',
      detail: {},
      ipAddress,
    });
    return { message: 'Key rotation initiated' };
  }
}
