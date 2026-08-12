import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportAccess } from '../../common/decorators/report-access.decorator';
import { VoiceOutliersService } from './voice-outliers.service';

@Controller('reports/voice-outliers')
@UseGuards(JwtAuthGuard, ReportAccessGuard)
@ReportAccess('voice-outliers', 'Voice Outliers', 'voice')
export class VoiceOutliersController {
  constructor(private readonly service: VoiceOutliersService) {}

  @Get('data')
  getData() {
    return this.service.getData();
  }

  // Admin-only: force a full baseline rebuild (clears samples, re-pulls 15 days, re-detects).
  @Post('rebuild')
  @UseGuards(RolesGuard)
  @Roles('admin')
  rebuild() {
    return this.service.rebuild();
  }
}
