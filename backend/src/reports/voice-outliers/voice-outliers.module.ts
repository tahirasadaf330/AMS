import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { Condition } from '../../common/entities/condition.entity';
import { VoiceOutliersService } from './voice-outliers.service';
import { VoiceOutliersAlertService } from './voice-outliers-alert.service';
import { VoiceOutliersController } from './voice-outliers.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { WebsocketModule } from '../../websocket/websocket.module';
import { StageModule } from '../../stage/stage.module';
import { ConditionsModule } from '../../conditions/conditions.module';

// JerasoftService (@Global) and SchedulerRegistry (ScheduleModule.forRoot, root) are ambient.
// StageModule provides StageService (the generic 10-min window engine); ConditionsModule provides
// ConditionSchedulerService so the seeded python alert is registered immediately on boot.
@Module({
  imports: [TypeOrmModule.forFeature([Dataset, Condition]), WebsocketModule, StageModule, ConditionsModule],
  controllers: [VoiceOutliersController],
  providers: [VoiceOutliersService, VoiceOutliersAlertService, ReportAccessGuard],
})
export class VoiceOutliersModule {}
