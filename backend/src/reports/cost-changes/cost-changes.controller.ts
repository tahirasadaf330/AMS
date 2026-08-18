import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { CostChangesService } from './cost-changes.service';

@Controller('reports/cost-changes')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('cost-changes', 'Cost Changes Report', 'sms')
export class CostChangesController {
  constructor(private readonly service: CostChangesService) {}

  /** month = 'YYYY-MM' (omitted → current UTC month); days = last-N-days quick range, wins over month. */
  @Get('data')
  getData(@Query('month') month?: string, @Query('days') days?: string) {
    return this.service.getData(month, days);
  }
}
