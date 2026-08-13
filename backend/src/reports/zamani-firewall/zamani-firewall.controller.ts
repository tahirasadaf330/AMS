import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { ZamaniFirewallService } from './zamani-firewall.service';

@Controller('reports/zamani-firewall')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('zamani-firewall', 'Zamani SMS Firewall', 'sms')
export class ZamaniFirewallController {
  constructor(private readonly service: ZamaniFirewallService) {}

  @Get('data')
  getData(@Query('hours') hours?: string) {
    const parsed = hours ? Number(hours) : 24;
    return this.service.getData(Number.isFinite(parsed) ? parsed : 24);
  }
}
