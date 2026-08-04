import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { DealsAutomationService } from './deals-automation.service';

@Controller('reports/deals-automation')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('deals-automation', 'Deals Automation', 'voice')
export class DealsAutomationController {
  constructor(private readonly service: DealsAutomationService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
