import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { SmsReportService } from './sms-report.service';
import { SmsReportController } from './sms-report.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [SmsReportController],
  providers: [SmsReportService, ReportAccessGuard],
})
export class SmsReportModule {}
