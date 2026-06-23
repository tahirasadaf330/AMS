import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { SmsCreditLimitService } from './sms-credit-limit.service';

@Controller('reports/sms-credit-limit')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('sms-credit-limit')
export class SmsCreditLimitController {
  constructor(private readonly service: SmsCreditLimitService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
