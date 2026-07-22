import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  user_count: number;
  dataset_access: string[];
  report_access: string[];
}

@Injectable()
export class AdminGroupsService implements OnModuleInit {
  private readonly logger = new Logger(AdminGroupsService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS user_groups (
          id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
          name        VARCHAR(100) UNIQUE NOT NULL,
          description TEXT,
          created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
          created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES user_groups(id) ON DELETE SET NULL
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS group_dataset_access (
          id         BIGSERIAL PRIMARY KEY,
          group_id   UUID        NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
          dataset_id UUID        NOT NULL,
          granted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_group_dataset UNIQUE (group_id, dataset_id)
        )
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS group_report_access (
          id          BIGSERIAL    PRIMARY KEY,
          group_id    UUID         NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
          report_slug VARCHAR(100) NOT NULL,
          granted_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
          granted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_group_report UNIQUE (group_id, report_slug)
        )
      `);
    } catch (err) {
      this.logger.error('Failed to ensure user_groups tables', err);
    }
  }

  async findAll(): Promise<AdminGroup[]> {
    const groups = await this.dataSource.query<Array<{
      id: string;
      name: string;
      description: string | null;
      created_at: Date;
      user_count: string;
    }>>(
      `SELECT g.id, g.name, g.description, g.created_at,
              COUNT(u.id)::text AS user_count
       FROM user_groups g
       LEFT JOIN users u ON u.group_id = g.id
       GROUP BY g.id
       ORDER BY g.name ASC`,
    );

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);
    const [datasetRows, reportRows] = await Promise.all([
      this.dataSource.query<{ group_id: string; dataset_id: string }[]>(
        `SELECT group_id, dataset_id FROM group_dataset_access WHERE group_id = ANY($1)`,
        [groupIds],
      ),
      this.dataSource.query<{ group_id: string; report_slug: string }[]>(
        `SELECT group_id, report_slug FROM group_report_access WHERE group_id = ANY($1)`,
        [groupIds],
      ),
    ]);

    const datasetMap = new Map<string, string[]>();
    for (const r of datasetRows) {
      const list = datasetMap.get(r.group_id) ?? [];
      list.push(r.dataset_id);
      datasetMap.set(r.group_id, list);
    }
    const reportMap = new Map<string, string[]>();
    for (const r of reportRows) {
      const list = reportMap.get(r.group_id) ?? [];
      list.push(r.report_slug);
      reportMap.set(r.group_id, list);
    }

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      created_at: g.created_at,
      user_count: Number(g.user_count),
      dataset_access: datasetMap.get(g.id) ?? [],
      report_access: reportMap.get(g.id) ?? [],
    }));
  }

  async create(name: string, description: string | undefined, createdBy: string): Promise<AdminGroup> {
    try {
      const [row] = await this.dataSource.query<[{ id: string }]>(
        `INSERT INTO user_groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [name.trim(), description?.trim() ?? null, createdBy],
      );
      const all = await this.findAll();
      return all.find((g) => g.id === row.id) as AdminGroup;
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('A group with this name already exists');
      throw err;
    }
  }

  async update(
    id: string,
    name: string | undefined,
    description: string | undefined,
    datasetAccess: string[] | undefined,
    reportAccess: string[] | undefined,
    updatedBy: string,
  ): Promise<AdminGroup> {
    const [existing] = await this.dataSource.query(`SELECT id FROM user_groups WHERE id = $1`, [id]);
    if (!existing) throw new NotFoundException(`Group ${id} not found`);

    if (name !== undefined) {
      try {
        await this.dataSource.query(
          `UPDATE user_groups SET name = $1, description = $2 WHERE id = $3`,
          [name.trim(), description?.trim() ?? null, id],
        );
      } catch (err: any) {
        if (err?.code === '23505') throw new ConflictException('A group with this name already exists');
        throw err;
      }
    }

    if (datasetAccess !== undefined) {
      await this.dataSource.query(`DELETE FROM group_dataset_access WHERE group_id = $1`, [id]);
      for (const datasetId of datasetAccess) {
        await this.dataSource.query(
          `INSERT INTO group_dataset_access (group_id, dataset_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, datasetId, updatedBy],
        );
      }
    }

    if (reportAccess !== undefined) {
      await this.dataSource.query(`DELETE FROM group_report_access WHERE group_id = $1`, [id]);
      for (const slug of reportAccess) {
        await this.dataSource.query(
          `INSERT INTO group_report_access (group_id, report_slug, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, slug, updatedBy],
        );
      }
    }

    const all = await this.findAll();
    const updated = all.find((g) => g.id === id);
    if (!updated) throw new NotFoundException(`Group ${id} not found`);
    return updated;
  }

  async setMembers(groupId: string, userIds: string[]): Promise<void> {
    const [existing] = await this.dataSource.query(`SELECT id FROM user_groups WHERE id = $1`, [groupId]);
    if (!existing) throw new NotFoundException(`Group ${groupId} not found`);
    await this.dataSource.query(`UPDATE users SET group_id = NULL WHERE group_id = $1`, [groupId]);
    if (userIds.length > 0) {
      await this.dataSource.query(
        `UPDATE users SET group_id = $1 WHERE id = ANY($2::uuid[])`,
        [groupId, userIds],
      );
    }
  }

  async delete(id: string): Promise<void> {
    const [existing] = await this.dataSource.query(`SELECT id FROM user_groups WHERE id = $1`, [id]);
    if (!existing) throw new NotFoundException(`Group ${id} not found`);
    await this.dataSource.query(`DELETE FROM user_groups WHERE id = $1`, [id]);
  }
}
