import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { Dataset } from '../common/entities/dataset.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { UserRole } from '../common/entities/user.entity';

interface ExportQueryParts {
  columnKeys: string[] | null; // null means use t.*
  whereSql: string;
  orderSql: string;
  params: unknown[];
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    @InjectRepository(Dataset)
    private datasetRepo: Repository<Dataset>,
    @InjectRepository(UserDatasetAccess)
    private accessRepo: Repository<UserDatasetAccess>,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  async exportCsv(
    datasetId: string,
    userId: string,
    userRole: UserRole,
    userName: string,
    res: Response,
    query: Record<string, string> = {},
  ): Promise<void> {
    await this.checkAccess(datasetId, userId, userRole);
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${dataset.name.replace(/[^a-z0-9_-]/gi, '_')}_${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    try {
      // UTF-8 BOM
      res.write('﻿');

      const { columnKeys, whereSql, orderSql, params } = this.buildExportQuery(query);
      const metaMap = this.buildMetaMap(dataset.columnMetadata);
      const selectClause = columnKeys
        ? columnKeys.map((k) => `"${k}"`).join(', ')
        : 't.*';

      // Stream data in chunks
      const pageSize = 500;
      let offset = 0;
      let isFirst = true;
      let headers: string[] = [];

      while (true) {
        const paramOffset = params.length + 1;
        const sql = `
          SELECT ${selectClause}
          FROM ${dataset.stageTableName} t
          ${whereSql}
          ${orderSql}
          LIMIT $${paramOffset} OFFSET $${paramOffset + 1}
        `;
        const rows: Record<string, unknown>[] = await this.dataSource.query(
          sql,
          [...params, pageSize, offset],
        );

        if (rows.length === 0) break;

        if (isFirst) {
          headers = Object.keys(rows[0]).filter((k) => k !== 'id' && k !== 'refreshed_at');

          const displayHeaders = headers.map((h) => metaMap[h] || h);
          res.write(displayHeaders.map((h) => this.csvEscape(h)).join(',') + '\r\n');
          isFirst = false;
        }

        for (const row of rows) {
          const line = headers.map((h) => this.csvEscape(String(row[h] ?? ''))).join(',');
          res.write(line + '\r\n');
        }

        if (rows.length < pageSize) break;
        offset += pageSize;
      }

      res.end();
    } catch (err) {
      this.logger.error('CSV export error', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Export failed' });
      }
    }
  }

  async exportExcel(
    datasetId: string,
    userId: string,
    userRole: UserRole,
    userName: string,
    res: Response,
    query: Record<string, string> = {},
  ): Promise<void> {
    await this.checkAccess(datasetId, userId, userRole);
    const dataset = await this.datasetRepo.findOne({ where: { id: datasetId } });
    if (!dataset) throw new NotFoundException('Dataset not found');

    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `${dataset.name.replace(/[^a-z0-9_-]/gi, '_')}_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
      const worksheet = workbook.addWorksheet(dataset.name.slice(0, 31));

      const { columnKeys, whereSql, orderSql, params } = this.buildExportQuery(query);
      const selectClause = columnKeys
        ? columnKeys.map((k) => `"${k}"`).join(', ')
        : 't.*';

      const sql = `
        SELECT ${selectClause}
        FROM ${dataset.stageTableName} t
        ${whereSql}
        ${orderSql}
      `;
      const rows: Record<string, unknown>[] = await this.dataSource.query(sql, params);

      if (rows.length === 0) {
        await workbook.commit();
        return;
      }

      const headers = Object.keys(rows[0]).filter((k) => k !== 'id' && k !== 'refreshed_at');
      const metaMap = this.buildMetaMap(dataset.columnMetadata);

      // Setup columns with header formatting
      worksheet.columns = headers.map((h) => ({
        header: metaMap[h] || h,
        key: h,
        width: 18,
      }));

      // Style header row
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF1F3864' },
        };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FF1F3864' } },
        };
      });

      // Freeze row 1
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];

      // Auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      // Write data rows
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const dataRow = worksheet.addRow(headers.map((h) => row[h] ?? null));

        // Alternating background
        const bg = i % 2 === 0 ? 'FFFFFFFF' : 'FFF9F9F9';
        dataRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bg },
          };

          const val = cell.value;
          const numVal = typeof val === 'number' ? val : (typeof val === 'string' ? parseFloat(val) : NaN);

          if (!isNaN(numVal) && typeof val !== 'boolean') {
            cell.numFmt = '#,##0.00';
            if (numVal < 0) {
              cell.font = { color: { argb: 'FFC00000' } };
            } else if (numVal === 0) {
              cell.font = { color: { argb: 'FFBBBBBB' } };
            }
          }
        });

        dataRow.commit();
      }

      // Footer row
      const footerRowNum = rows.length + 3;
      const footerRow = worksheet.getRow(footerRowNum);
      const isoTs = new Date().toISOString();
      worksheet.mergeCells(footerRowNum, 1, footerRowNum, headers.length);
      const footerCell = footerRow.getCell(1);
      footerCell.value = `Exported by AMS · ${userName} · ${isoTs}`;
      footerCell.font = { italic: true, size: 9, color: { argb: 'FF999999' } };
      footerCell.alignment = { horizontal: 'center' };
      footerRow.commit();

      await workbook.commit();
    } catch (err) {
      this.logger.error('Excel export error', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Export failed' });
      }
    }
  }

  /**
   * Parse query params into SQL fragments and positional params.
   *
   * Supported params:
   *   columns   comma-separated column keys to select
   *   search    full-text ILIKE across all text columns (not applied here — handled per col)
   *   <col>__min  >= filter
   *   <col>__max  <= filter
   *   <col>__in   pipe-separated IN filter
   *   sort        column name to order by
   *   sortDir     ASC | DESC (default DESC)
   */
  private buildExportQuery(query: Record<string, string>): ExportQueryParts {
    // Column selection
    let columnKeys: string[] | null = null;
    if (query.columns) {
      const rawKeys = query.columns.split(',').map((k) => k.trim()).filter(Boolean);
      if (rawKeys.length > 0) {
        // Always exclude system cols; they are re-added if requested
        columnKeys = rawKeys.filter((k) => k !== 'id' && k !== 'refreshed_at');
      }
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // Full-text search across text columns — not feasible without schema; skip or use ts_vector
    // Instead we support individual col__in / col__min / col__max from the dashboard filters
    for (const [rawKey, rawVal] of Object.entries(query)) {
      if (!rawVal) continue;
      if (rawKey === 'columns' || rawKey === 'sort' || rawKey === 'sortDir') continue;

      if (rawKey.endsWith('__min')) {
        const col = rawKey.slice(0, -5);
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
          conditions.push(`t."${col}" >= $${paramIdx++}`);
          params.push(rawVal);
        }
      } else if (rawKey.endsWith('__max')) {
        const col = rawKey.slice(0, -5);
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
          conditions.push(`t."${col}" <= $${paramIdx++}`);
          params.push(rawVal);
        }
      } else if (rawKey.endsWith('__in')) {
        const col = rawKey.slice(0, -4);
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
          const vals = rawVal.split('||').filter(Boolean);
          if (vals.length > 0) {
            const placeholders = vals.map(() => `$${paramIdx++}`).join(', ');
            conditions.push(`t."${col}"::text IN (${placeholders})`);
            params.push(...vals);
          }
        }
      } else if (rawKey === 'search') {
        // search is a global filter — we pass it as a generic text search token
        // The dashboard applies search server-side; we replicate it here if possible
        // Without knowing the column list, we skip it (backend dashboard controller handles it)
      }
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Order
    let orderSql = 'ORDER BY t.id DESC';
    if (query.sort && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(query.sort)) {
      const dir = (query.sortDir ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      orderSql = `ORDER BY t."${query.sort}" ${dir}`;
    }

    return { columnKeys, whereSql, orderSql, params };
  }

  private buildMetaMap(columnMetadata: unknown): Record<string, string> {
    if (!Array.isArray(columnMetadata)) return {};
    const map: Record<string, string> = {};
    for (const col of columnMetadata as Array<{ key: string; label: string }>) {
      if (col.key && col.label) map[col.key] = col.label;
    }
    return map;
  }

  private async checkAccess(datasetId: string, userId: string, userRole: UserRole): Promise<void> {
    if (userRole === 'admin') return; // Admin sees all datasets

    const access = await this.accessRepo.findOne({ where: { userId, datasetId } });
    if (!access) {
      throw new ForbiddenException('You do not have access to this dataset');
    }
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
