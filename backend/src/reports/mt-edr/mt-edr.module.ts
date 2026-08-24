import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { MtEdrController } from './mt-edr.controller';
import { MtEdrService } from './mt-edr.service';
import { MtEdrAlertsService } from './mt-edr-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition])],
  controllers: [MtEdrController],
  providers: [MtEdrService, MtEdrAlertsService, ReportAccessGuard],
})
export class MtEdrModule {}
