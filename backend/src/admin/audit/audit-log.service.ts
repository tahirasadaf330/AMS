import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { AuditLog } from '../../common/entities/audit-log.entity';

export interface AuditLogQuery {
  user?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

// Service for managing audit logs, including fetching and exporting logs.
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLog)
    private auditRepo: Repository<AuditLog>,
  ) {}

  async findAll(query: AuditLogQuery): Promise<{ data: AuditLog[]; total: number }> {
    try {
      const page = query.page || 1;
      const limit = Math.min(query.limit || 50, 200);
      const skip = (page - 1) * limit;

      const qb = this.auditRepo
        .createQueryBuilder('al')
        .leftJoinAndSelect('al.user', 'user')
        .orderBy('al.created_at', 'DESC')
        .skip(skip)
        .take(limit);

      if (query.user) {
        qb.andWhere('al.user_id = :userId', { userId: query.user });
      }
      if (query.action) {
        qb.andWhere('al.action ILIKE :action', { action: `%${query.action}%` });
      }
      if (query.from) {
        qb.andWhere('al.created_at >= :from', { from: query.from });
      }
      if (query.to) {
        qb.andWhere('al.created_at <= :to', { to: query.to });
      }

      const [data, total] = await qb.getManyAndCount();
      return { data, total };
    } catch (err) {
      this.logger.error('Error fetching audit log', err);
      throw err;
    }
  }

  async exportCsv(query: AuditLogQuery, res: Response): Promise<void> {
    try {
      const qb = this.auditRepo
        .createQueryBuilder('al')
        .leftJoinAndSelect('al.user', 'user')
        .orderBy('al.created_at', 'DESC');

      if (query.user) {
        qb.andWhere('al.user_id = :userId', { userId: query.user });
      }
      if (query.action) {
        qb.andWhere('al.action ILIKE :action', { action: `%${query.action}%` });
      }
      if (query.from) {
        qb.andWhere('al.created_at >= :from', { from: query.from });
      }
      if (query.to) {
        qb.andWhere('al.created_at <= :to', { to: query.to });
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit_log_${dateStr}.csv"`);

      // UTF-8 BOM
      res.write('﻿');
      res.write('ID,User Email,Action,Resource,IP Address,Created At,Detail\r\n');

      // Stream in pages
      const pageSize = 500;
      let offset = 0;

      while (true) {
        const rows = await qb.skip(offset).take(pageSize).getMany();
        if (rows.length === 0) break;

        for (const row of rows) {
          const line = [
            row.id,
            this.csvEscape(row.user?.email || ''),
            this.csvEscape(row.action),
            this.csvEscape(row.resource || ''),
            this.csvEscape(row.ipAddress || ''),
            row.createdAt.toISOString(),
            this.csvEscape(JSON.stringify(row.detail || {})),
          ].join(',');
          res.write(line + '\r\n');
        }

        if (rows.length < pageSize) break;
        offset += pageSize;
      }

      res.end();
    } catch (err) {
      this.logger.error('Error exporting audit log', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Export failed' });
      }
    }
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
