import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AdminGroupsService } from './groups.service';
import { AuditService } from '../../audit/audit.service';

function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
}

@Controller('admin/groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminGroupsController {
  constructor(
    private readonly groupsService: AdminGroupsService,
    private readonly auditService: AuditService,
  ) {}

  // Editors need the role list for the user dialog's Roles multi-select. Mutations stay admin-only.
  @Get()
  @Roles('editor')
  findAll() {
    return this.groupsService.findAll();
  }

  @Post()
  async create(
    @Body() body: { name: string; description?: string; section?: string | string[] | null; level?: string | null },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.groupsService.create(body.name, body.description, user.sub, body.section, body.level);
    this.auditService.log({
      userId: user.sub,
      action: 'admin:role_create',
      resource: result.id,
      detail: { name: result.name, section: body.section, level: body.level },
      ipAddress: clientIp(req),
    });
    return result;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string;
      // The frontend sends snake_case; the app's inbound camelCase middleware is a
      // no-op (it runs before the body is parsed), so read snake_case here with a
      // camelCase fallback to stay robust regardless of that middleware.
      dataset_access?: string[];
      report_access?: string[];
      datasetAccess?: string[];
      reportAccess?: string[];
      // section = one or more of 'sms'/'voice' (CSV or array — a role may span both);
      // level = 'viewer'|'editor'; either may be null to clear. Only admins can reach
      // this endpoint (class-level @Roles('admin')), so this is not reachable by a
      // delegated Editor.
      section?: string | string[] | null;
      level?: string | null;
    },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.groupsService.update(
      id,
      body.name,
      body.description,
      body.dataset_access ?? body.datasetAccess,
      body.report_access ?? body.reportAccess,
      user.sub,
      body.section,
      body.level,
    );
    this.auditService.log({
      userId: user.sub,
      action: 'admin:role_update',
      resource: id,
      detail: {
        name: body.name,
        dataset_access: body.dataset_access ?? body.datasetAccess,
        report_access: body.report_access ?? body.reportAccess,
        section: body.section,
        level: body.level,
      },
      ipAddress: clientIp(req),
    });
    return result;
  }

  @Put(':id/members')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setMembers(
    @Param('id') id: string,
    @Body() body: { userIds?: string[] },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.groupsService.setMembers(id, body.userIds ?? []);
    this.auditService.log({
      userId: user.sub,
      action: 'admin:role_members_set',
      resource: id,
      detail: { userIds: body.userIds ?? [], count: (body.userIds ?? []).length },
      ipAddress: clientIp(req),
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.groupsService.delete(id);
    this.auditService.log({
      userId: user.sub,
      action: 'admin:role_delete',
      resource: id,
      detail: {},
      ipAddress: clientIp(req),
    });
  }
}
