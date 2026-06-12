import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConditionsController } from './conditions.controller';
import { ConditionsService } from './conditions.service';
import { ConditionEvaluatorService } from './condition-evaluator.service';
import { ConditionSchedulerService } from './condition-scheduler.service';
import { PythonExecutorService } from './python-executor.service';
import { Condition } from '../common/entities/condition.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { NotificationLog } from '../common/entities/notification-log.entity';
import { Dataset } from '../common/entities/dataset.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../admin/settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Condition, UserDatasetAccess, NotificationLog, Dataset]),
    forwardRef(() => NotificationsModule),
    SettingsModule,
  ],
  controllers: [ConditionsController],
  providers: [ConditionsService, ConditionEvaluatorService, ConditionSchedulerService, PythonExecutorService],
  exports: [ConditionsService, ConditionEvaluatorService, ConditionSchedulerService, PythonExecutorService],
})
export class ConditionsModule {}
