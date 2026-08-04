import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { MtEdrService } from './mt-edr.service';

@Controller('reports/mt-edr')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('mt-edr', 'MT EDR Monitoring', 'sms')
export class MtEdrController {
  constructor(private readonly service: MtEdrService) {}

  // from/to are ISO-8601 UTC instants (the frontend converts its datetime-local inputs);
  // both optional — omitted returns the whole retained window (today+yesterday).
  @Get('data')
  getData(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getData(from, to);
  }
}
