import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { PrepaymentClService } from './prepayment-cl.service';
import { PrepaymentClController } from './prepayment-cl.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset])],
  controllers: [PrepaymentClController],
  providers: [PrepaymentClService, ReportAccessGuard],
})
export class PrepaymentClModule {}
