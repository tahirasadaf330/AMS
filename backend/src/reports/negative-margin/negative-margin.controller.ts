import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { NegativeMarginService } from './negative-margin.service';

@Controller('reports/negative-margin')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('negative-margin', 'Voice Negative Margin')
export class NegativeMarginController {
  constructor(private readonly service: NegativeMarginService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
