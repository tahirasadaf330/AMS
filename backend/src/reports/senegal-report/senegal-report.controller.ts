import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { SenegalReportService } from './senegal-report.service';

@Controller('reports/senegal-report')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('senegal-report', 'Senegal Report', 'sms')
export class SenegalReportController {
  constructor(private readonly service: SenegalReportService) {}

  @Get('data')
  getData(@Query('day') day?: string) {
    return this.service.getData(day);
  }
}
