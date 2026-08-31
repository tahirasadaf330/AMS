import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ConditionsModule } from '../../conditions/conditions.module';
import { ZamaniReportService } from './zamani-report.service';
import { ZamaniReportController } from './zamani-report.controller';
import { ZamaniDailyAlertService } from './zamani-daily-alert.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition]),
    CredentialsModule,
    NotificationsModule,
    ConditionsModule,
  ],
  controllers: [ZamaniReportController],
  providers: [ZamaniReportService, ZamaniDailyAlertService, ReportAccessGuard],
  // ZamaniReportService is exported for the Zamani Testing clone, which delegates its
  // Investment Recovery endpoint here (Zamani-route-only figures, single tracking cron).
  exports: [ZamaniDailyAlertService, ZamaniReportService],
})
export class ZamaniReportModule {}
