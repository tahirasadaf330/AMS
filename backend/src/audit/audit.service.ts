import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../common/entities/audit-log.entity';
import { auditContext } from './audit-context';

export interface AuditLogParams {
  userId?: string | null;
  action: string;
  resource?: string | null;
  detail?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * Fire-and-forget audit log write. Never throws.
   */
  log(params: AuditLogParams): void {
    // Tell the request-scoped AuditInterceptor a manual entry was written,
    // so it doesn't add a duplicate generic one.
    const store = auditContext.getStore();
    if (store) store.logged = true;

    this.writeLog(params).catch((err) => {
      this.logger.error('Failed to write audit log', err);
    });
  }

  private async writeLog(params: AuditLogParams): Promise<void> {
    try {
      const entry = this.auditRepo.create({
        userId: params.userId || null,
        action: params.action,
        resource: params.resource || null,
        detail: params.detail || null,
        ipAddress: params.ipAddress || null,
      });
      await this.auditRepo.save(entry);
    } catch (err) {
      this.logger.error('Error saving audit log entry', err);
    }
  }
}
