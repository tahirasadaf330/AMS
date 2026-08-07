import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { SpecialRoutesMonitoringController } from './special-routes-monitoring.controller';
import { SpecialRoutesMonitoringService } from './special-routes-monitoring.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource]), CredentialsModule],
  controllers: [SpecialRoutesMonitoringController],
  providers: [SpecialRoutesMonitoringService, ReportAccessGuard],
})
export class SpecialRoutesMonitoringModule {}
