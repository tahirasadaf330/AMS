import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { CostChangesService } from './cost-changes.service';

@Controller('reports/cost-changes')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('cost-changes', 'Cost Changes Report', 'sms')
export class CostChangesController {
  constructor(private readonly service: CostChangesService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
