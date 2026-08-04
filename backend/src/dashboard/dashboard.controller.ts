import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../common/entities/user.entity';
import { SchedulerService } from '../scheduler/scheduler.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private schedulerService: SchedulerService,
    private auditService: AuditService,
  ) {}

  @Get('datasets')
  async getDatasets(@CurrentUser() user: JwtUser) {
    return this.dashboardService.getDatasets(user.sub, user.role as UserRole);
  }

  @Get(':datasetId/data')
  async getData(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
    @Query() allQuery: Record<string, string>,
  ) {
    const { page, limit, sort, sortDir, search, ...rest } = allQuery;
    // Remaining params are per-column filters
    const columnFilters = Object.fromEntries(
      Object.entries(rest).filter(([k]) => /^[a-z_][a-z0-9_]*$/i.test(k))
    );
    return this.dashboardService.getData(datasetId, user.sub, user.role as UserRole, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      sort,
      sortDir: (sortDir?.toUpperCase() as 'ASC' | 'DESC') || 'DESC',
      search,
      columnFilters,
    });
  }

  @Get(':datasetId/distinct-values')
  async getDistinctValues(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
    @Query('column') column: string,
  ) {
    return this.dashboardService.getDistinctValues(
      datasetId,
      user.sub,
      user.role as UserRole,
      column ?? '',
    );
  }

  @Get(':datasetId/matrix')
  async getMatrix(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.dashboardService.getMatrix(datasetId, user.sub, user.role as UserRole);
  }

  @Post(':datasetId/refresh')
  @Roles('editor')
  async triggerRefresh(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'dataset:manual_refresh',
      resource: datasetId,
      detail: {},
      ipAddress,
    });
    // Trigger async, return immediately
    this.schedulerService.triggerNow(datasetId).catch((err) => {
      // Error is logged inside scheduler service
    });
    return { message: 'Refresh triggered', datasetId };
  }

  @Get(':datasetId/history')
  async getHistory(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.dashboardService.getHistory(datasetId, user.sub, user.role as UserRole);
  }
}
