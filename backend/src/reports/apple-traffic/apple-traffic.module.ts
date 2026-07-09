import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { AppleTrafficController } from './apple-traffic.controller';
import { AppleTrafficService } from './apple-traffic.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [AppleTrafficController],
  providers: [AppleTrafficService, ReportAccessGuard],
})
export class AppleTrafficModule {}
