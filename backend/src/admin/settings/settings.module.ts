import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { Setting } from '../../common/entities/setting.entity';
import { JerasoftModule } from '../../datasources/jerasoft/jerasoft.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { CredentialsModule } from '../../credentials/credentials.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Setting]),
    JerasoftModule,
    NotificationsModule,
    CredentialsModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
