import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { ZamaniFirewallController } from './zamani-firewall.controller';
import { ZamaniFirewallService } from './zamani-firewall.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [ZamaniFirewallController],
  providers: [ZamaniFirewallService, ReportAccessGuard],
})
export class ZamaniFirewallModule {}
