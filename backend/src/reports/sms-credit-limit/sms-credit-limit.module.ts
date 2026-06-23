import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { SmsCreditLimitService } from './sms-credit-limit.service';
import { SmsCreditLimitController } from './sms-credit-limit.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [SmsCreditLimitController],
  providers: [SmsCreditLimitService, ReportAccessGuard],
})
export class SmsCreditLimitModule {}
