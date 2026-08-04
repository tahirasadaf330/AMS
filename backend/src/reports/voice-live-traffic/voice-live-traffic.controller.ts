import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { VoiceLiveTrafficService } from './voice-live-traffic.service';

@Controller('reports/voice-live-traffic')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('voice-live-traffic', 'Voice Live Traffic', 'voice')
export class VoiceLiveTrafficController {
  constructor(private readonly service: VoiceLiveTrafficService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }
}
