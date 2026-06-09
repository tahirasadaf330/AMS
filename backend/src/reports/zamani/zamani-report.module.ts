import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { ZamaniReportService } from './zamani-report.service';
import { ZamaniReportController } from './zamani-report.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource]),
    CredentialsModule,
  ],
  controllers: [ZamaniReportController],
  providers: [ZamaniReportService, ReportAccessGuard],
})
export class ZamaniReportModule {}
