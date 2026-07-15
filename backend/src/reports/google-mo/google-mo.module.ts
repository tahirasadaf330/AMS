import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { Condition } from '../../common/entities/condition.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ConditionsModule } from '../../conditions/conditions.module';
import { GoogleMoService } from './google-mo.service';
import { GoogleMoController } from './google-mo.controller';
import { GoogleMoImportController } from './google-mo-import.controller';
import { SharePointSyncService } from './sharepoint-sync.service';
import { GoogleMoAlertService } from './google-mo-alert.service';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource, Condition]),
    CredentialsModule,
    NotificationsModule,
    ConditionsModule,
  ],
  controllers: [GoogleMoController, GoogleMoImportController],
  providers: [GoogleMoService, SharePointSyncService, GoogleMoAlertService, ReportAccessGuard],
  exports: [GoogleMoService, SharePointSyncService, GoogleMoAlertService],
})
export class GoogleMoModule {}
