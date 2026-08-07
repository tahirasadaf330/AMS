import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { SpecialRoutesMonitoringService } from './special-routes-monitoring.service';

@Controller('reports/special-routes-monitoring')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('special-routes-monitoring', 'Special Routes Monitoring', 'voice')
export class SpecialRoutesMonitoringController {
  constructor(private readonly service: SpecialRoutesMonitoringService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
