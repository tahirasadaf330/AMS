import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { ZamaniSenderIdService } from './zamani-senderid.service';
import { ZamaniAlertsService } from './zamani-alerts.service';
import { ZamaniSenderIdController } from './zamani-senderid.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition])],
  controllers: [ZamaniSenderIdController],
  providers: [ZamaniSenderIdService, ZamaniAlertsService, ReportAccessGuard],
  exports: [ZamaniSenderIdService],
})
export class ZamaniSenderIdModule {}
