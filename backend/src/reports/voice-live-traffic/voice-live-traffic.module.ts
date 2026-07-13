import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { VoiceLiveTrafficService } from './voice-live-traffic.service';
import { VoiceLiveTrafficController } from './voice-live-traffic.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset])],
  controllers: [VoiceLiveTrafficController],
  providers: [VoiceLiveTrafficService, ReportAccessGuard],
})
export class VoiceLiveTrafficModule {}
