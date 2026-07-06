import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { MtEdrController } from './mt-edr.controller';
import { MtEdrService } from './mt-edr.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [MtEdrController],
  providers: [MtEdrService, ReportAccessGuard],
})
export class MtEdrModule {}
