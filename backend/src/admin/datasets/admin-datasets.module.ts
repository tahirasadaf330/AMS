import { Module } from '@nestjs/common';
import { AdminDatasetsController } from './admin-datasets.controller';
import { AdminDatasetsService } from './admin-datasets.service';
import { DatasetsModule } from '../../datasets/datasets.module';
import { SchedulerModule } from '../../scheduler/scheduler.module';
import { JerasoftModule } from '../../datasources/jerasoft/jerasoft.module';
import { StageModule } from '../../stage/stage.module';

@Module({
  imports: [DatasetsModule, SchedulerModule, JerasoftModule, StageModule],
  controllers: [AdminDatasetsController],
  providers: [AdminDatasetsService],
  exports: [AdminDatasetsService],
})
export class AdminDatasetsModule {}
