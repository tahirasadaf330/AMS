import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { Condition } from '../../common/entities/condition.entity';
import { VoiceLiveTrafficService } from './voice-live-traffic.service';
import { VoiceLiveTrafficHistoryService } from './voice-live-traffic-history.service';
import { VoiceLiveTrafficAlertService } from './voice-live-traffic-alert.service';
import { VoiceLiveTrafficAsrAlertService } from './voice-live-traffic-asr-alert.service';
import { VoiceLiveTrafficOutlierAlertService } from './voice-live-traffic-outlier-alert.service';
import { VoiceLiveTrafficController } from './voice-live-traffic.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { ConditionsModule } from '../../conditions/conditions.module';

@Module({
  // ConditionsModule gives us ConditionSchedulerService, so a newly seeded alert starts on
  // this boot instead of the next one. No cycle: nothing in the conditions/notifications
  // chain imports this module (same pattern as SrcDstNumberMonitoringModule + SchedulerModule).
  imports: [TypeOrmModule.forFeature([Dataset, Condition]), ConditionsModule],
  controllers: [VoiceLiveTrafficController],
  providers: [
    VoiceLiveTrafficService,
    VoiceLiveTrafficHistoryService,
    VoiceLiveTrafficAlertService,
    VoiceLiveTrafficAsrAlertService,
    VoiceLiveTrafficOutlierAlertService,
    ReportAccessGuard,
  ],
  exports: [VoiceLiveTrafficHistoryService],
})
export class VoiceLiveTrafficModule {}
