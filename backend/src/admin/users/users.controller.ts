import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Req,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminUsersService, CreateUserDto, UpdateUserDto } from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(
    private usersService: AdminUsersService,
    private auditService: AuditService,
  ) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.usersService.create(dto, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:user_create',
      resource: result.id,
      detail: { email: result.email, role: result.role },
      ipAddress,
    });
    return result;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    if (id === user.sub && dto.role !== undefined) {
      return { statusCode: 403, message: 'Admins cannot change their own role' };
    }
    const result = await this.usersService.update(id, dto, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:user_update',
      resource: id,
      detail: dto as Record<string, unknown>,
      ipAddress,
    });
    return result;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.usersService.deleteUser(id, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:user_delete',
      resource: id,
      detail: {},
      ipAddress,
    });
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    if (id === user.sub) {
      return { statusCode: 403, message: 'Admins cannot deactivate their own account' };
    }
    await this.usersService.deactivate(id);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:user_deactivate',
      resource: id,
      detail: {},
      ipAddress,
    });
    return { message: 'User deactivated' };
  }

  @Get(':id/sessions')
  getSessions(@Param('id') id: string) {
    return this.usersService.getSessions(id);
  }

  @Delete(':id/sessions/:sid')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Param('id') id: string,
    @Param('sid') sid: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.usersService.revokeSession(id, sid);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:session_revoke',
      resource: sid,
      detail: { targetUserId: id },
      ipAddress,
    });
  }
}
