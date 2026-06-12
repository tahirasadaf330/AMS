import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { NotificationLog } from '../common/entities/notification-log.entity';
import { Condition, ConditionChannels } from '../common/entities/condition.entity';
import { GraphEmailService } from './graph-email.service';
import { TeamsWebhookService } from './teams-webhook.service';
import { EventsGateway } from '../websocket/events.gateway';

export interface ColumnMeta {
  key: string;
  label: string;
  visible: boolean;
}

export interface DispatchParams {
  condition: Condition;
  datasetName: string;
  matchedRows: Record<string, unknown>[];
  columnMeta?: ColumnMeta[];
}

export interface NotificationQuery {
  from?: string;
  to?: string;
  channel?: string;
  dataset?: string;
  condition?: string;
  status?: string;
  page?: number;
  limit?: number;
  userId?: string;
  userRole?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationLog)
    private notifLogRepo: Repository<NotificationLog>,
    private graphEmailService: GraphEmailService,
    private teamsWebhookService: TeamsWebhookService,
    @Optional() private eventsGateway: EventsGateway,
  ) {}

  /**
   * Dispatches notifications to all enabled channels independently.
   * Failure in one channel never blocks the other.
   */
  async dispatch(params: DispatchParams): Promise<void> {
    const { condition, datasetName, matchedRows, columnMeta } = params;
    const channels: ConditionChannels = condition.channels || {};
    const channelsDispatched: string[] = [];

    const subject = `[AMS Alert] ${condition.name} — ${matchedRows.length} rows matched`;

    // Dispatch email independently
    if (channels.email?.enabled && channels.email.recipients?.length > 0) {
      channelsDispatched.push('email');
      this.dispatchEmail({
        condition,
        datasetName,
        matchedRows,
        columnMeta,
        subject,
        recipients: channels.email.recipients,
      }).catch((err) => this.logger.error('Email dispatch unhandled error', err));
    }

    // Dispatch Teams independently
    if (channels.teams?.enabled) {
      channelsDispatched.push('teams');
      this.dispatchTeams({
        condition,
        datasetName,
        matchedRows,
        webhookUrl: channels.teams.webhook_url,
        severity: channels.teams.severity || 'info',
      }).catch((err) => this.logger.error('Teams dispatch unhandled error', err));
    }

    // Emit WebSocket event
    if (channelsDispatched.length > 0 && this.eventsGateway) {
      try {
        this.eventsGateway.emitConditionMatched({
          condition_id: condition.id,
          condition_name: condition.name,
          dataset_id: condition.datasetId,
          matched_count: matchedRows.length,
          channels_dispatched: channelsDispatched,
          triggered_at: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.error('Error emitting condition matched event', err);
      }
    }
  }

  private async dispatchEmail(params: {
    condition: Condition;
    datasetName: string;
    matchedRows: Record<string, unknown>[];
    columnMeta?: ColumnMeta[];
    subject: string;
    recipients: string[];
  }): Promise<void> {
    const logEntry = this.notifLogRepo.create({
      conditionId: params.condition.id,
      datasetId: params.condition.datasetId,
      channel: 'email',
      recipients: params.recipients,
      matchedRows: params.matchedRows,
      matchedCount: params.matchedRows.length,
      status: 'pending',
    });
    const saved = await this.notifLogRepo.save(logEntry);

    try {
      await this.graphEmailService.sendAlert({
        recipients: params.recipients,
        subject: params.subject,
        conditionName: params.condition.name,
        datasetName: params.datasetName,
        matchedRows: params.matchedRows,
        emailText: params.condition.channels?.email?.text,
        columnMeta: params.columnMeta,
        selectedColumns: params.condition.channels?.email?.columns,
      });

      await this.notifLogRepo.update(saved.id, { status: 'sent' });

      if (this.eventsGateway) {
        this.eventsGateway.emitNotificationSent({
          notification_log_id: saved.id,
          channel: 'email',
          status: 'sent',
          triggered_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Email notification failed: ${errorMsg}`);
      await this.notifLogRepo.update(saved.id, {
        status: 'failed',
        errorMessage: errorMsg,
      });
      if (this.eventsGateway) {
        this.eventsGateway.emitNotificationFailed({
          notification_log_id: saved.id,
          channel: 'email',
          error: errorMsg,
          triggered_at: new Date().toISOString(),
        });
      }
    }
  }

  private async dispatchTeams(params: {
    condition: Condition;
    datasetName: string;
    matchedRows: Record<string, unknown>[];
    webhookUrl?: string;
    severity: 'critical' | 'warning' | 'info';
  }): Promise<void> {
    const logEntry = this.notifLogRepo.create({
      conditionId: params.condition.id,
      datasetId: params.condition.datasetId,
      channel: 'teams',
      recipients: null,
      webhookUrl: params.webhookUrl ?? null,
      matchedRows: params.matchedRows,
      matchedCount: params.matchedRows.length,
      status: 'pending',
    });
    const saved = await this.notifLogRepo.save(logEntry);

    try {
      await this.teamsWebhookService.sendAlert({
        webhookUrl: params.webhookUrl,
        conditionName: params.condition.name,
        datasetName: params.datasetName,
        matchedRows: params.matchedRows,
        matchedCount: params.matchedRows.length,
        severity: params.severity,
        timestamp: new Date().toISOString(),
      });

      await this.notifLogRepo.update(saved.id, { status: 'sent' });

      if (this.eventsGateway) {
        this.eventsGateway.emitNotificationSent({
          notification_log_id: saved.id,
          channel: 'teams',
          status: 'sent',
          triggered_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Teams notification failed: ${errorMsg}`);
      await this.notifLogRepo.update(saved.id, {
        status: 'failed',
        errorMessage: errorMsg,
      });
      if (this.eventsGateway) {
        this.eventsGateway.emitNotificationFailed({
          notification_log_id: saved.id,
          channel: 'teams',
          error: errorMsg,
          triggered_at: new Date().toISOString(),
        });
      }
    }
  }

  private applyFilters(qb: SelectQueryBuilder<NotificationLog>, query: NotificationQuery): void {
    if (query.from) qb.andWhere('nl.triggeredAt >= :from', { from: query.from });
    if (query.to) {
      const toValue = /^\d{4}-\d{2}-\d{2}$/.test(query.to)
        ? `${query.to}T23:59:59.999Z`
        : query.to;
      qb.andWhere('nl.triggeredAt <= :to', { to: toValue });
    }
    if (query.channel) qb.andWhere('nl.channel = :channel', { channel: query.channel });
    if (query.status) qb.andWhere('nl.status = :status', { status: query.status });
    if (query.dataset) qb.andWhere('nl.datasetId = :dataset', { dataset: query.dataset });
    if (query.condition) qb.andWhere('nl.conditionId = :condition', { condition: query.condition });
    if (query.userId && query.userRole !== 'admin') {
      qb.andWhere(
        `nl.datasetId IN (SELECT dataset_id FROM user_dataset_access WHERE user_id = :userId)`,
        { userId: query.userId },
      );
    }
  }

  private mapLog(log: NotificationLog) {
    return {
      id: log.id,
      condition_id: log.conditionId,
      condition_name: log.condition?.name ?? 'Unknown',
      dataset_id: log.datasetId,
      dataset_name: log.dataset?.name ?? 'Unknown',
      channel: log.channel,
      recipients: log.recipients ?? undefined,
      webhook_url: log.webhookUrl ?? undefined,
      matched_rows: log.matchedCount ?? (log.matchedRows?.length ?? 0),
      status: log.status,
      error: log.errorMessage ?? undefined,
      retry_count: log.retryCount ?? 0,
      triggered_at: log.triggeredAt instanceof Date
        ? log.triggeredAt.toISOString()
        : String(log.triggeredAt),
      matched_rows_snapshot: log.matchedRows?.slice(0, 20) ?? undefined,
    };
  }

  async findAll(query: NotificationQuery) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 200);
    const skip = (page - 1) * limit;

    const mainQb = this.notifLogRepo
      .createQueryBuilder('nl')
      .leftJoinAndSelect('nl.condition', 'condition')
      .leftJoinAndSelect('nl.dataset', 'dataset')
      .orderBy('nl.triggeredAt', 'DESC')
      .skip(skip)
      .take(limit);
    this.applyFilters(mainQb, query);

    const summaryQb = this.notifLogRepo
      .createQueryBuilder('nl')
      .select('nl.channel', 'channel')
      .addSelect('nl.status', 'status')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('nl.channel')
      .addGroupBy('nl.status');
    this.applyFilters(summaryQb, query);

    const [rawLogs, total] = await mainQb.getManyAndCount();
    const summaryRows: Array<{ channel: string; status: string; cnt: string }> =
      await summaryQb.getRawMany();

    let emailCount = 0, teamsCount = 0, failedCount = 0, skippedCount = 0;
    for (const r of summaryRows) {
      const cnt = parseInt(r.cnt, 10) || 0;
      if (r.channel === 'email') emailCount += cnt;
      if (r.channel === 'teams') teamsCount += cnt;
      if (r.status === 'failed' || r.status === 'permanently_failed') failedCount += cnt;
      if (r.status === 'skipped') skippedCount += cnt;
    }

    return {
      logs: rawLogs.map((l) => this.mapLog(l)),
      total,
      page,
      limit,
      summary: {
        total,
        email_count: emailCount,
        teams_count: teamsCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
      },
    };
  }

  async retry(id: string): Promise<NotificationLog> {
    const log = await this.notifLogRepo.findOne({
      where: { id },
      relations: ['condition', 'dataset'],
    });

    if (!log) {
      throw new NotFoundException(`Notification log ${id} not found`);
    }

    if (log.status !== 'failed') {
      throw new Error('Can only retry failed notifications');
    }

    const condition = log.condition;
    if (!condition) {
      throw new Error('Condition no longer exists');
    }

    const matchedRows = (log.matchedRows as Record<string, unknown>[]) || [];
    const datasetName = log.dataset?.name || 'Unknown Dataset';

    await this.notifLogRepo.update(id, {
      retryCount: (log.retryCount || 0) + 1,
      lastRetryAt: new Date(),
      status: 'retrying',
    });

    if (log.channel === 'email') {
      const emailChannels = condition.channels?.email;
      const recipients = emailChannels?.recipients || (log.recipients as string[]) || [];
      const subject = `[AMS Alert] ${condition.name} — ${matchedRows.length} rows matched`;

      try {
        await this.graphEmailService.sendAlert({
          recipients,
          subject,
          conditionName: condition.name,
          datasetName,
          matchedRows,
        });
        await this.notifLogRepo.update(id, { status: 'sent' });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.notifLogRepo.update(id, { status: 'failed', errorMessage: errorMsg });
      }
    } else if (log.channel === 'teams') {
      const teamsChannels = condition.channels?.teams;
      try {
        await this.teamsWebhookService.sendAlert({
          webhookUrl: teamsChannels?.webhook_url,
          conditionName: condition.name,
          datasetName,
          matchedRows,
          matchedCount: matchedRows.length,
          severity: teamsChannels?.severity || 'info',
        });
        await this.notifLogRepo.update(id, { status: 'sent' });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.notifLogRepo.update(id, { status: 'failed', errorMessage: errorMsg });
      }
    }

    const updated = await this.notifLogRepo.findOne({ where: { id } });
    return updated!;
  }

  /**
   * Auto-retry failed notifications every 5 minutes.
   * Max 3 attempts. Backoff: retry_count × 5 minutes between attempts.
   * After 3 failures sets status to 'permanently_failed'.
   */
  @Cron('*/5 * * * *')
  async autoRetryFailed(): Promise<void> {
    const MAX_RETRIES = 3;
    const BACKOFF_MINUTES = 5;

    const failed = await this.notifLogRepo.find({
      where: { status: 'failed' },
      relations: ['condition', 'dataset'],
    });

    for (const log of failed) {
      if ((log.retryCount ?? 0) >= MAX_RETRIES) {
        await this.notifLogRepo.update(log.id, { status: 'permanently_failed' });
        continue;
      }

      // Respect backoff: wait retry_count × BACKOFF_MINUTES since last attempt
      const backoffMs = (log.retryCount ?? 0) * BACKOFF_MINUTES * 60 * 1000;
      const referenceTime = log.lastRetryAt ?? log.triggeredAt;
      if (referenceTime && Date.now() - new Date(referenceTime).getTime() < backoffMs) {
        continue;
      }

      const condition = log.condition;
      if (!condition) {
        await this.notifLogRepo.update(log.id, { status: 'permanently_failed' });
        continue;
      }

      const matchedRows = (log.matchedRows as Record<string, unknown>[]) || [];
      const datasetName = log.dataset?.name || 'Unknown Dataset';

      await this.notifLogRepo.update(log.id, {
        retryCount: (log.retryCount ?? 0) + 1,
        lastRetryAt: new Date(),
        status: 'retrying',
      });

      try {
        if (log.channel === 'email') {
          const recipients = condition.channels?.email?.recipients ?? (log.recipients as string[]) ?? [];
          const subject = `[AMS Alert] ${condition.name} — ${matchedRows.length} rows matched`;
          await this.graphEmailService.sendAlert({ recipients, subject, conditionName: condition.name, datasetName, matchedRows });
        } else if (log.channel === 'teams') {
          await this.teamsWebhookService.sendAlert({
            webhookUrl: condition.channels?.teams?.webhook_url,
            conditionName: condition.name,
            datasetName,
            matchedRows,
            matchedCount: matchedRows.length,
            severity: condition.channels?.teams?.severity || 'info',
          });
        }
        await this.notifLogRepo.update(log.id, { status: 'sent' });
        this.logger.log(`Auto-retry succeeded for notification ${log.id}`);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const newCount = (log.retryCount ?? 0) + 1;
        await this.notifLogRepo.update(log.id, {
          status: newCount >= MAX_RETRIES ? 'permanently_failed' : 'failed',
          errorMessage: errorMsg,
        });
        this.logger.warn(`Auto-retry failed for notification ${log.id} (attempt ${newCount}): ${errorMsg}`);
      }
    }
  }
}
