import { Module } from '@nestjs/common';
import { VcsBalanceService } from './vcs-balance.service';
import { VcsBalanceController } from './vcs-balance.controller';

@Module({
  controllers: [VcsBalanceController],
  providers: [VcsBalanceService],
})
export class VcsBalanceModule {}
