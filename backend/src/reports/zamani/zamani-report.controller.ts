import { Controller, Get, Post, Body, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { ZamaniReportService } from './zamani-report.service';

@Controller('reports/zamani')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani', 'Zamani Traffic', 'sms')
export class ZamaniReportController {
  constructor(
    private readonly zamaniService: ZamaniReportService,
    private readonly auditService: AuditService,
  ) {}

  @Get('filters')
  getFilters() {
    return this.zamaniService.getFilters();
  }

  @Get('yesterday')
  getYesterday(
    @Query('date') date: string,
    @Query('customer') customer?: string,
    @Query('senderId') senderId?: string,
    @Query('operator') operator?: string,
    @Query('accountManager') accountManager?: string,
    @Query('vendorConnection') vendorConnection?: string,
  ) {
    return this.zamaniService.getYesterday({ date, customer, senderId, operator, accountManager, vendorConnection });
  }

  @Get('comparison')
  getComparison(
    @Query('old_date')  old_date?:  string,
    @Query('new_date')  new_date?:  string,
    @Query('old_start') old_start?: string,
    @Query('old_end')   old_end?:   string,
    @Query('new_start') new_start?: string,
    @Query('new_end')   new_end?:   string,
    @Query('customer')  customer?:  string,
  ) {
    if (old_start && old_end && new_start && new_end) {
      return this.zamaniService.getComparisonRange({ old_start, old_end, new_start, new_end, customer });
    }
    return this.zamaniService.getComparison({ old_date: old_date!, new_date: new_date!, customer });
  }

  @Get('mtd')
  getMtd(
    @Query('start_date') start_date: string,
    @Query('end_date') end_date: string,
    @Query('customer') customer?: string,
    @Query('senderId') senderId?: string,
    @Query('accountManager') accountManager?: string,
    @Query('vendorConnection') vendorConnection?: string,
  ) {
    return this.zamaniService.getMtd({ start_date, end_date, customer, senderId, accountManager, vendorConnection });
  }

  @Get('projections')
  getProjections(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.zamaniService.getProjections({ year: Number(year), month: Number(month) });
  }

  @Get('cost-vs-revenue')
  getCostVsRevenue() {
    return this.zamaniService.getCostVsRevenue();
  }

  @Get('targets')
  getTargets() {
    return this.zamaniService.getTargets();
  }

  @Post('targets')
  async upsertTarget(
    @Body() dto: { year: number; month: number; messages_target: number; revenue_target: number },
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.zamaniService.upsertTarget(dto);
    this.auditService.log({
      userId: user.sub,
      action: 'zamani:target_upsert',
      resource: `${dto.year}-${dto.month}`,
      detail: dto as unknown as Record<string, unknown>,
    });
    return result;
  }

  @Get('investment-recovery')
  getInvestmentRecovery(
    @Query('trailingDays', new DefaultValuePipe(7), ParseIntPipe) trailingDays: number,
  ) {
    return this.zamaniService.getInvestmentRecovery(trailingDays);
  }

  @Post('investment-recovery/run')
  async runWeeklyTracking(
    @Query('trailingDays', new DefaultValuePipe(7), ParseIntPipe) trailingDays: number,
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.zamaniService.runWeeklyTracking(trailingDays);
    this.auditService.log({
      userId: user.sub,
      action: 'zamani:investment_recovery_run',
      resource: null,
      detail: { trailingDays },
    });
    return result;
  }
}
