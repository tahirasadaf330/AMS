import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { ZamaniReportModule } from '../zamani/zamani-report.module';
import { ZamaniTestingService } from './zamani-testing.service';
import { ZamaniTestingController } from './zamani-testing.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource]),
    CredentialsModule,
    // Provides ZamaniReportService for the delegated Investment Recovery endpoint
    ZamaniReportModule,
  ],
  controllers: [ZamaniTestingController],
  providers: [ZamaniTestingService, ReportAccessGuard],
})
export class ZamaniTestingModule {}
