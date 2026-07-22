import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { DealsAutomationService } from './deals-automation.service';
import { DealsAutomationController } from './deals-automation.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [DealsAutomationController],
  providers: [DealsAutomationService, ReportAccessGuard],
})
export class DealsAutomationModule {}
