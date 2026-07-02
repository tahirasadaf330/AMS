import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { SchedulesController } from './schedules.controller';
import { DatasetsModule } from '../datasets/datasets.module';
import { StageModule } from '../stage/stage.module';
import { GoogleMoModule } from '../reports/google-mo/google-mo.module';

@Module({
  imports: [DatasetsModule, StageModule, GoogleMoModule],
  controllers: [SchedulesController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
