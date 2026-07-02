import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { PrepaymentClService } from './prepayment-cl.service';

@Controller('reports/prepayment-cl')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('prepayment-cl', 'Pre-Payment Limit')
export class PrepaymentClController {
  constructor(private readonly service: PrepaymentClService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
