import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { MtEdrService } from './mt-edr.service';

@Controller('reports/mt-edr')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('mt-edr', 'MT EDR Monitoring')
export class MtEdrController {
  constructor(private readonly service: MtEdrService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
