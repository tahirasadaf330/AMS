import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { VendorBindStatusService } from './vendor-bind-status.service';

@Controller('reports/vendor-bind-status')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('vendor-bind-status', 'Vendor Bind Status', 'sms')
export class VendorBindStatusController {
  constructor(private readonly service: VendorBindStatusService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
