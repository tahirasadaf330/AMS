import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { AppleTrafficService } from './apple-traffic.service';

@Controller('reports/apple-traffic')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('apple-traffic', 'Apple Traffic')
export class AppleTrafficController {
  constructor(private readonly service: AppleTrafficService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
