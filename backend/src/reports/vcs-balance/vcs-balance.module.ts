import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { VcsBalanceService } from './vcs-balance.service';
import { VcsBalanceController } from './vcs-balance.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset])],
  controllers: [VcsBalanceController],
  providers: [VcsBalanceService, ReportAccessGuard],
})
export class VcsBalanceModule {}
