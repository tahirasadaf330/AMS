import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { SchedulerService } from './scheduler.service';
import { DatasetsService } from '../datasets/datasets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@Controller('schedules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('full_rights')
export class SchedulesController {
  constructor(
    private schedulerService: SchedulerService,
    private datasetsService: DatasetsService,
    private auditService: AuditService,
  ) {}

  @Get()
  async getAll(@CurrentUser() user: JwtUser) {
    const [datasets, lastRefreshMap] = await Promise.all([
      this.datasetsService.findAllForUser(user.sub, user.role),
      this.datasetsService.getLastRefreshMap(),
    ]);
    return datasets.map((d) => {
      const status = this.schedulerService.getJobStatus(d.id);
      const last = lastRefreshMap.get(d.id);
      return {
        datasetId: d.id,
        datasetName: d.name,
        cron: d.scheduleCron,
        scheduleStartDate: d.scheduleStartDate ? d.scheduleStartDate.toISOString() : null,
        scheduleEndDate: d.scheduleEndDate ? d.scheduleEndDate.toISOString() : null,
        isActive: d.isActive,
        lastRun: last?.startedAt?.toISOString() ?? null,
        lastStatus: last?.status ?? null,
        rowCount: last?.rowCount ?? null,
        ...status,
      };
    });
  }

  @Put(':datasetId')
  async updateSchedule(
    @Param('datasetId') datasetId: string,
    @Body() body: { cron: string; startDate?: string | null; endDate?: string | null },
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const updated = await this.datasetsService.update(datasetId, {
      schedule_cron: body.cron,
      schedule_start_date: body.startDate ?? undefined,
      schedule_end_date: body.endDate ?? undefined,
    });
    await this.schedulerService.reloadDataset(datasetId);

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'schedule:update',
      resource: datasetId,
      detail: { scheduleCron: body.cron },
      ipAddress,
    });

    return updated;
  }

  @Post(':datasetId/trigger')
  @HttpCode(HttpStatus.OK)
  async trigger(
    @Param('datasetId') datasetId: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'schedule:trigger',
      resource: datasetId,
      detail: {},
      ipAddress,
    });

    this.schedulerService.triggerNow(datasetId).catch(() => {});
    return { message: 'Refresh triggered', datasetId };
  }
}
