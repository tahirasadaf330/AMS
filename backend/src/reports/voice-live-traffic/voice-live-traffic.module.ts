import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { VoiceLiveTrafficService } from './voice-live-traffic.service';
import { VoiceLiveTrafficHistoryService } from './voice-live-traffic-history.service';
import { VoiceLiveTrafficController } from './voice-live-traffic.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset])],
  controllers: [VoiceLiveTrafficController],
  providers: [VoiceLiveTrafficService, VoiceLiveTrafficHistoryService, ReportAccessGuard],
  exports: [VoiceLiveTrafficHistoryService],
})
export class VoiceLiveTrafficModule {}
