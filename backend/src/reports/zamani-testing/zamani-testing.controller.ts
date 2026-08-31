import { Controller, Get, Post, Body, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { CurrentUser, JwtUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../audit/audit.service';
import { ZamaniTestingService } from './zamani-testing.service';

@Controller('reports/zamani-testing')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani-testing', 'Zamani Traffic include Testing', 'sms')
export class ZamaniTestingController {
  constructor(
    private readonly zamaniTestingService: ZamaniTestingService,
    private readonly auditService: AuditService,
  ) {}

  @Get('filters')
  getFilters() {
    return this.zamaniTestingService.getFilters();
  }

  @Get('yesterday')
  getYesterday(
    @Query('date') date: string,
    @Query('customer') customer?: string,
    @Query('senderId') senderId?: string,
    @Query('operator') operator?: string,
    @Query('accountManager') accountManager?: string,
    @Query('supplier') supplier?: string,
  ) {
    return this.zamaniTestingService.getYesterday({ date, customer, senderId, operator, accountManager, supplier });
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
    @Query('supplier')  supplier?:  string,
  ) {
    if (old_start && old_end && new_start && new_end) {
      return this.zamaniTestingService.getComparisonRange({ old_start, old_end, new_start, new_end, customer, supplier });
    }
    return this.zamaniTestingService.getComparison({ old_date: old_date!, new_date: new_date!, customer, supplier });
  }

  @Get('mtd')
  getMtd(
    @Query('start_date') start_date: string,
    @Query('end_date') end_date: string,
    @Query('customer') customer?: string,
    @Query('senderId') senderId?: string,
    @Query('accountManager') accountManager?: string,
    @Query('supplier') supplier?: string,
  ) {
    return this.zamaniTestingService.getMtd({ start_date, end_date, customer, senderId, accountManager, supplier });
  }

  @Get('projections')
  getProjections(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('supplier') supplier?: string,
  ) {
    return this.zamaniTestingService.getProjections({ year: Number(year), month: Number(month), supplier });
  }

  @Get('cost-vs-revenue')
  getCostVsRevenue(@Query('supplier') supplier?: string) {
    return this.zamaniTestingService.getCostVsRevenue(supplier);
  }

  @Get('targets')
  getTargets() {
    return this.zamaniTestingService.getTargets();
  }

  @Post('targets')
  async upsertTarget(
    @Body() dto: { year: number; month: number; messages_target: number; revenue_target: number },
    @CurrentUser() user: JwtUser,
  ) {
    const result = await this.zamaniTestingService.upsertTarget(dto);
    this.auditService.log({
      userId: user.sub,
      action: 'zamani-testing:target_upsert',
      resource: `${dto.year}-${dto.month}`,
      detail: dto as unknown as Record<string, unknown>,
    });
    return result;
  }

  // Combined-supplier recovery (Zamani_Niger + Innovatio revenue vs the €546k investment).
  @Get('investment-recovery')
  getInvestmentRecovery(
    @Query('trailingDays', new DefaultValuePipe(7), ParseIntPipe) trailingDays: number,
  ) {
    return this.zamaniTestingService.getInvestmentRecovery(trailingDays);
  }
}
