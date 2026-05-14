import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { JerasoftModule } from '../datasources/jerasoft/jerasoft.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [JerasoftModule, NotificationsModule],
  controllers: [HealthController],
})
export class SystemModule {}
