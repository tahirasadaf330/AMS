import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { GoogleMoService } from './google-mo.service';
import { GoogleMoController } from './google-mo.controller';
import { GoogleMoImportController } from './google-mo-import.controller';
import { SharePointSyncService } from './sharepoint-sync.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource]),
    CredentialsModule,
    NotificationsModule,
  ],
  controllers: [GoogleMoController, GoogleMoImportController],
  providers: [GoogleMoService, SharePointSyncService, ReportAccessGuard],
  exports: [GoogleMoService, SharePointSyncService],
})
export class GoogleMoModule {}
