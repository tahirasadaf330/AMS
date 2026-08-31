import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { ConditionsModule } from '../../conditions/conditions.module';
import { SenegalReportService } from './senegal-report.service';
import { SenegalDailyAlertService } from './senegal-daily-alert.service';
import { SenegalReportController } from './senegal-report.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  // ConditionsModule gives us ConditionSchedulerService, so the newly seeded daily alert starts
  // on this boot instead of the next one (same pattern as SpecialRoutesMonitoringModule).
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition]),
    ConditionsModule,
  ],
  controllers: [SenegalReportController],
  providers: [SenegalReportService, SenegalDailyAlertService, ReportAccessGuard],
})
export class SenegalReportModule {}
