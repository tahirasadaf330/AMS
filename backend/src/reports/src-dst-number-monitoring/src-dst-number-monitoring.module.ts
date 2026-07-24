import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { SrcDstNumberMonitoringService } from './src-dst-number-monitoring.service';
import { SrcDstNumberMonitoringController } from './src-dst-number-monitoring.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';
import { SchedulerModule } from '../../scheduler/scheduler.module';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset]), SchedulerModule],
  controllers: [SrcDstNumberMonitoringController],
  providers: [SrcDstNumberMonitoringService, ReportAccessGuard],
})
export class SrcDstNumberMonitoringModule {}
