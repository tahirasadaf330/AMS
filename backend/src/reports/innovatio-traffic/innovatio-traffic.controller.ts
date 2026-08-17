import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { InnovatioTrafficService } from './innovatio-traffic.service';

@Controller('reports/innovatio-traffic')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('innovatio-traffic', 'Innovatio Traffic Report', 'sms')
export class InnovatioTrafficController {
  constructor(private readonly service: InnovatioTrafficService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
