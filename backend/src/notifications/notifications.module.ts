import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { GraphEmailService } from './graph-email.service';
import { TeamsWebhookService } from './teams-webhook.service';
import { NotificationLog } from '../common/entities/notification-log.entity';
import { Setting } from '../common/entities/setting.entity';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationLog, Setting]),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, GraphEmailService, TeamsWebhookService],
  exports: [NotificationsService, GraphEmailService, TeamsWebhookService],
})
export class NotificationsModule {}
