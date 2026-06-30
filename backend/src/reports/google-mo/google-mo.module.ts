import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dataset } from '../../common/entities/dataset.entity';
import { ExternalDataSource } from '../../common/entities/data-source.entity';
import { CredentialsModule } from '../../credentials/credentials.module';
import { GoogleMoService } from './google-mo.service';
import { GoogleMoController } from './google-mo.controller';
import { GoogleMoImportController } from './google-mo-import.controller';
import { ReportAccessGuard } from '../../common/guards/report-access.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dataset, ExternalDataSource]),
    CredentialsModule,
  ],
  controllers: [GoogleMoController, GoogleMoImportController],
  providers: [GoogleMoService, ReportAccessGuard],
})
export class GoogleMoModule {}
