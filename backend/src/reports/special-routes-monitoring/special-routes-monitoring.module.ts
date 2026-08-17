import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { ConditionsModule } from '../../conditions/conditions.module';
import { SpecialRoutesMonitoringController } from './special-routes-monitoring.controller';
import { SpecialRoutesMonitoringService } from './special-routes-monitoring.service';
import { SpecialRoutesZeroAsrAlertService } from './special-routes-zero-asr-alert.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  // ConditionsModule gives us ConditionSchedulerService, so the newly seeded zero-success alert
  // starts on this boot instead of the next one. No cycle: nothing in the conditions/notifications
  // chain imports this module (same pattern as VoiceLiveTrafficModule).
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition]),
    CredentialsModule,
    ConditionsModule,
  ],
  controllers: [SpecialRoutesMonitoringController],
  providers: [SpecialRoutesMonitoringService, SpecialRoutesZeroAsrAlertService, ReportAccessGuard],
})
export class SpecialRoutesMonitoringModule {}
