import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { InnovatioTrafficService } from './innovatio-traffic.service';
import { InnovatioAlertsService } from './innovatio-alerts.service';
import { InnovatioTrafficController } from './innovatio-traffic.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition])],
  controllers: [InnovatioTrafficController],
  providers: [InnovatioTrafficService, InnovatioAlertsService, ReportAccessGuard],
})
export class InnovatioTrafficModule {}
