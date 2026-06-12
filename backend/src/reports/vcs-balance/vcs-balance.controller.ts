import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { VcsBalanceService } from './vcs-balance.service';

@Controller('reports/vcs-balance')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('vcs-balance')
export class VcsBalanceController {
  constructor(private readonly service: VcsBalanceService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
