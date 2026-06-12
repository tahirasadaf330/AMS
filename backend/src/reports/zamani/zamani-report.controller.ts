import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { ZamaniReportService } from './zamani-report.service';

@Controller('reports/zamani')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani')
export class ZamaniReportController {
  constructor(private readonly zamaniService: ZamaniReportService) {}

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
  upsertTarget(@Body() dto: { year: number; month: number; messages_target: number; revenue_target: number }) {
    return this.zamaniService.upsertTarget(dto);
  }
}
