import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { VendorBindStatusController } from './vendor-bind-status.controller';
import { VendorBindStatusService } from './vendor-bind-status.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

// No ConditionsModule import: this report seeds no alert. The Vendor Bind Status alert is created
// in the Alerts UI as a dataset condition against stage_vendor_bind_status.
@Module({
  imports: [TypeOrmModule.forFeature([Dataset, ExternalDataSource])],
  controllers: [VendorBindStatusController],
  providers: [VendorBindStatusService, ReportAccessGuard],
})
export class VendorBindStatusModule {}
