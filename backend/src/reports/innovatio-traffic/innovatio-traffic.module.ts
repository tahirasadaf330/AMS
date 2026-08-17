import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { InnovatioTrafficService } from './innovatio-traffic.service';
import { InnovatioTrafficController } from './innovatio-traffic.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [InnovatioTrafficController],
  providers: [InnovatioTrafficService, ReportAccessGuard],
})
export class InnovatioTrafficModule {}
