import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { SenegalReportService } from './senegal-report.service';
import { SenegalReportController } from './senegal-report.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [SenegalReportController],
  providers: [SenegalReportService, ReportAccessGuard],
})
export class SenegalReportModule {}
