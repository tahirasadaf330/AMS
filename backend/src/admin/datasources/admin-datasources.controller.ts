import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminDatasourcesService, CreateDataSourceDto, UpdateDataSourceDto, TestDataSourceDto } from './admin-datasources.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';

@Controller('admin/datasources')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminDatasourcesController {
  constructor(
    private svc: AdminDatasourcesService,
    private auditService: AuditService,
  ) {}

  @Get()
  async findAll() {
    const list = await this.svc.findAll();
    return list.map((ds) => this.svc.maskPassword(ds));
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.svc.maskPassword(await this.svc.findOne(id));
  }

  @Post()
  async create(
    @Body() dto: CreateDataSourceDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.svc.create(dto, user.sub);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({ userId: user.sub, action: 'admin:datasource_create', resource: result.id, detail: { name: result.name }, ipAddress: ip });
    return this.svc.maskPassword(result);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDataSourceDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.svc.update(id, dto);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({ userId: user.sub, action: 'admin:datasource_update', resource: id, detail: { name: result.name }, ipAddress: ip });
    return this.svc.maskPassword(result);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.svc.remove(id);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({ userId: user.sub, action: 'admin:datasource_delete', resource: id, detail: {}, ipAddress: ip });
  }

  @Post('test-connection')
  @HttpCode(HttpStatus.OK)
  testConnection(@Body() dto: TestDataSourceDto) {
    return this.svc.testConnection(dto);
  }
}
