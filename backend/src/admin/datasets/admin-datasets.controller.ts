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
import { AdminDatasetsService } from './admin-datasets.service';
import { CreateDatasetDto, UpdateDatasetDto } from '../../datasets/datasets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';

@Controller('admin/datasets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminDatasetsController {
  constructor(
    private adminDatasetsService: AdminDatasetsService,
    private auditService: AuditService,
  ) {}

  @Get()
  findAll() {
    return this.adminDatasetsService.findAll();
  }

  @Post()
  async create(
    @Body() dto: CreateDatasetDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.adminDatasetsService.create(dto, user.sub);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:dataset_create',
      resource: result.id,
      detail: { name: result.name },
      ipAddress,
    });
    return result;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDatasetDto,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const result = await this.adminDatasetsService.update(id, dto);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:dataset_update',
      resource: id,
      detail: dto as Record<string, unknown>,
      ipAddress,
    });
    return result;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    await this.adminDatasetsService.remove(id);
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'admin:dataset_delete',
      resource: id,
      detail: {},
      ipAddress,
    });
  }

  @Post('validate-sql')
  @HttpCode(HttpStatus.OK)
  async validateSql(@Body() body: { query: string; data_source_id?: string }) {
    return this.adminDatasetsService.validateSql(body.query, body.data_source_id);
  }
}
