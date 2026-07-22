import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { SmsReportService } from './sms-report.service';

@Controller('reports/sms-report')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('sms-report', 'SMS Report')
export class SmsReportController {
  constructor(private readonly service: SmsReportService) {}

  @Get('data')
  getData(
    @Query('startDate')     startDate?: string,
    @Query('endDate')       endDate?: string,
    @Query('accountManager') accountManager?: string,
    @Query('company')       company?: string,
  ) {
    return this.service.getData(startDate, endDate, accountManager, company);
  }
}
