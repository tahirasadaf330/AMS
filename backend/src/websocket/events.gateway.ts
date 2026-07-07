import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { JerasoftService } from '../datasources/jerasoft/jerasoft.service';

export interface DatasetRefreshStartedEvent {
  dataset_id: string;
  dataset_name: string;
  started_at: string;
}

export interface DatasetRefreshedEvent {
  dataset_id: string;
  dataset_name: string;
  refreshed_at: string;
  row_count: number;
  duration_ms: number;
}

export interface DatasetRefreshFailedEvent {
  dataset_id: string;
  dataset_name: string;
  error: string;
  failed_at: string;
}

export interface ConditionMatchedEvent {
  condition_id: string;
  condition_name: string;
  dataset_id: string;
  matched_count: number;
  channels_dispatched: string[];
  triggered_at: string;
}

export interface NotificationSentEvent {
  notification_log_id: string;
  channel: string;
  status: string;
  triggered_at: string;
}

export interface NotificationFailedEvent {
  notification_log_id: string;
  channel: string;
  error: string;
  triggered_at: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
@Injectable()
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private lastRefreshAt: string | null = null;
  private schedulerRunning = true;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private jerasoftService: JerasoftService,
  ) {}

  afterInit(server: Server): void {
    this.logger.log('WebSocket Gateway initialized');

    // JWT auth middleware
    server.use((socket: Socket, next) => {
      try {
        const token =
          (socket.handshake.auth?.token as string) ||
          (socket.handshake.headers?.authorization as string)?.replace('Bearer ', '');

        if (!token) {
          return next(new Error('Authentication required'));
        }

        const payload = this.jwtService.verify(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        });

        (socket as any).user = payload;
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(client: Socket): void {
    const user = (client as any).user;
    this.logger.log(`Client connected: ${client.id} (user: ${user?.email || 'unknown'})`);

    // Auto-join admin room for admins
    if (user?.role === 'admin') {
      client.join('admin');
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:dataset')
  handleSubscribeDataset(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { dataset_id: string },
  ): void {
    if (data?.dataset_id) {
      client.join(`dataset:${data.dataset_id}`);
      this.logger.debug(`Client ${client.id} subscribed to dataset:${data.dataset_id}`);
    }
  }

  @SubscribeMessage('unsubscribe:dataset')
  handleUnsubscribeDataset(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { dataset_id: string },
  ): void {
    if (data?.dataset_id) {
      client.leave(`dataset:${data.dataset_id}`);
      this.logger.debug(`Client ${client.id} unsubscribed from dataset:${data.dataset_id}`);
    }
  }

  emitDatasetRefreshStarted(event: DatasetRefreshStartedEvent): void {
    this.server.to(`dataset:${event.dataset_id}`).emit('dataset:refresh_started', event);
    this.server.to('admin').emit('dataset:refresh_started', event);
  }

  emitDatasetRefreshed(event: DatasetRefreshedEvent): void {
    this.lastRefreshAt = event.refreshed_at;
    this.server.to(`dataset:${event.dataset_id}`).emit('dataset:refreshed', event);
    this.server.to('admin').emit('dataset:refreshed', event);
  }

  emitDatasetRefreshFailed(event: DatasetRefreshFailedEvent): void {
    this.server.to(`dataset:${event.dataset_id}`).emit('dataset:refresh_failed', event);
    this.server.to('admin').emit('dataset:refresh_failed', event);
  }

  emitConditionMatched(event: ConditionMatchedEvent): void {
    this.server.to(`dataset:${event.dataset_id}`).emit('condition:matched', event);
    this.server.to('admin').emit('condition:matched', event);
  }

  emitNotificationSent(event: NotificationSentEvent): void {
    this.server.to('admin').emit('notification:sent', event);
  }

  emitNotificationFailed(event: NotificationFailedEvent): void {
    this.server.to('admin').emit('notification:failed', event);
  }

  setSchedulerRunning(running: boolean): void {
    this.schedulerRunning = running;
  }

  @Interval(30000)
  async emitSystemHealth(): Promise<void> {
    try {
      const jerasoftConnected = await this.jerasoftService.testConnection().catch(() => false);

      const healthEvent = {
        jerasoft_connected: jerasoftConnected,
        graph_token_valid: true, // GraphEmailService manages this
        teams_default_reachable: true, // Teams webhook not pre-checked
        scheduler_running: this.schedulerRunning,
        last_refresh_at: this.lastRefreshAt,
        timestamp: new Date().toISOString(),
      };

      this.server.to('admin').emit('system:health', healthEvent);
    } catch (err) {
      this.logger.error('Error emitting system health', err);
    }
  }
}
