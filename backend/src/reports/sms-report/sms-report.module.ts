import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ConditionsModule } from '../../conditions/conditions.module';
import { SmsReportService } from './sms-report.service';
import { SmsReportController } from './sms-report.controller';
import { AmWeeklyVolumeAlertService } from './am-weekly-alert.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition]),
    NotificationsModule,
    ConditionsModule,
  ],
  controllers: [SmsReportController],
  providers: [SmsReportService, AmWeeklyVolumeAlertService, ReportAccessGuard],
  exports: [AmWeeklyVolumeAlertService],
})
export class SmsReportModule {}
