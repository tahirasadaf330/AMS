import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { ZamaniSenderIdService } from './zamani-senderid.service';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  providers: [ZamaniSenderIdService],
  exports: [ZamaniSenderIdService],
})
export class ZamaniSenderIdModule {}
