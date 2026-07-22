import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { ZamaniSenderIdService } from './zamani-senderid.service';
import { ZamaniAlertsService } from './zamani-alerts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition])],
  providers: [ZamaniSenderIdService, ZamaniAlertsService],
  exports: [ZamaniSenderIdService],
})
export class ZamaniSenderIdModule {}
