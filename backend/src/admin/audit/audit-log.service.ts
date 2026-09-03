import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Response } from 'express';
import { AuditLog } from '../../common/entities/audit-log.entity';

// Interface for query parameters when fetching audit logs.
export interface AuditLogQuery {
  user?: string;
  action?: string;
  /** Free-text: matches action, resource, and the acting user's name/email. */
  search?: string;
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

      // leftJoin + addSelect (NOT leftJoinAndSelect) so only safe user fields are serialized —
      // joining the full entity would leak password_hash into the API response.
      const qb = this.auditRepo
        .createQueryBuilder('al')
        .leftJoin('al.user', 'user')
        .addSelect(['user.id', 'user.email', 'user.name'])
        .orderBy('al.created_at', 'DESC')
        .skip(skip)
        .take(limit);

      this.applyFilters(qb, query);

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
        .leftJoin('al.user', 'user')
        .addSelect(['user.id', 'user.email', 'user.name'])
        .orderBy('al.created_at', 'DESC');

      this.applyFilters(qb, query);

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

  // Shared WHERE clauses so the list and the CSV export can never drift apart.
  private applyFilters(
    qb: SelectQueryBuilder<AuditLog>,
    query: AuditLogQuery,
  ): void {
    if (query.user) {
      qb.andWhere('al.user_id = :userId', { userId: query.user });
    }
    if (query.action) {
      qb.andWhere('al.action ILIKE :action', { action: `%${query.action}%` });
    }
    if (query.search) {
      // Also match a punctuation-stripped form on both sides, so "bilalwaris"
      // finds "bilal.waris@hayo.net" and "usercreate" finds "admin:user_create".
      const collapsed = query.search.toLowerCase().replace(/[^a-z0-9]/g, '');
      qb.andWhere(
        `(al.action ILIKE :q OR al.resource ILIKE :q
          OR user.email ILIKE :q OR user.name ILIKE :q
          OR (:collapsed <> '' AND (
            regexp_replace(lower(al.action), '[^a-z0-9]', '', 'g') LIKE :collapsedLike
            OR regexp_replace(lower(user.email), '[^a-z0-9]', '', 'g') LIKE :collapsedLike
            OR regexp_replace(lower(user.name), '[^a-z0-9]', '', 'g') LIKE :collapsedLike
          )))`,
        {
          q: `%${query.search}%`,
          collapsed,
          collapsedLike: `%${collapsed}%`,
        },
      );
    }
    if (query.from) {
      qb.andWhere('al.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('al.created_at <= :to', { to: query.to });
    }
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
