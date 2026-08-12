import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { VoiceOutliersService } from './voice-outliers.service';
import { VoiceOutliersController } from './voice-outliers.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { WebsocketModule } from '../../websocket/websocket.module';
import { StageModule } from '../../stage/stage.module';

// JerasoftService (@Global) and SchedulerRegistry (ScheduleModule.forRoot, root) are ambient.
// StageModule provides StageService (the generic engine that runs the 10-min window SQL).
@Module({
  imports: [TypeOrmModule.forFeature([Dataset]), WebsocketModule, StageModule],
  controllers: [VoiceOutliersController],
  providers: [VoiceOutliersService, ReportAccessGuard],
})
export class VoiceOutliersModule {}
