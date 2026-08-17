import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CostChangesController } from './cost-changes.controller';
import { CostChangesService } from './cost-changes.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [CostChangesController],
  providers: [CostChangesService, ReportAccessGuard],
})
export class CostChangesModule {}
