import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { NegativeMarginService } from './negative-margin.service';
import { NegativeMarginController } from './negative-margin.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { CredentialsModule } from '../../credentials/credentials.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource]), CredentialsModule],
  controllers: [NegativeMarginController],
  providers: [NegativeMarginService, ReportAccessGuard],
})
export class NegativeMarginModule {}
