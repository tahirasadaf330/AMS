import { Module } from '@nestjs/common';
import { VcsBalanceService } from './vcs-balance.service';
import { VcsBalanceController } from './vcs-balance.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  controllers: [VcsBalanceController],
  providers: [VcsBalanceService, ReportAccessGuard],
})
export class VcsBalanceModule {}
