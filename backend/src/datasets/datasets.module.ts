import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatasetsService } from './datasets.service';
import { Dataset } from '../common/entities/dataset.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, DatasetRefreshLog, UserDatasetAccess]),
  ],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
