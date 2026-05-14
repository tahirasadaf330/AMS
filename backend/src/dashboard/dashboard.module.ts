import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { Dataset } from '../common/entities/dataset.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { DatasetRefreshLog } from '../common/entities/dataset-refresh-log.entity';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, UserDatasetAccess, DatasetRefreshLog]),
    SchedulerModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
