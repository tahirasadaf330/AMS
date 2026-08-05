import {
  Injectable,
  Logger,
  OnModuleInit,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccessResolverService } from '../../common/access/access-resolver.service';

const VALID_SECTIONS = ['sms', 'voice'] as const;
const VALID_LEVELS = ['viewer', 'editor'] as const;

/** Normalize a section input (CSV string or array) to a canonical sorted CSV ('sms', 'voice',
 *  'sms,voice') or null. Throws on unknown sections. A role may span BOTH sections. */
function normalizeSections(input?: string | string[] | null): string | null {
  if (input === undefined || input === null || input === '') return null;
  const parts = Array.isArray(input) ? input : String(input).split(',');
  const clean = [...new Set(parts.map((s) => s.trim().toLowerCase()).filter(Boolean))];
  for (const s of clean) {
    if (!VALID_SECTIONS.includes(s as any)) {
      throw new BadRequestException(`section must be one or more of: ${VALID_SECTIONS.join(', ')}`);
    }
  }
  return clean.length ? clean.sort().join(',') : null;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  section: string | null;
  level: string | null;
  created_at: Date;
  user_count: number;
  dataset_access: string[];
  report_access: string[];
}

@Injectable()
export class AdminGroupsService implements OnModuleInit {
  private readonly logger = new Logger(AdminGroupsService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private access: AccessResolverService,
  ) {}

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
      // section/level normally arrive via migration 011_sections.sql, but guard here too so this
      // service is self-sufficient on a fresh DB (matches the group_id guard above).
      await this.dataSource.query(`
        ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS section VARCHAR(16)
      `);
      await this.dataSource.query(`
        ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS level VARCHAR(16)
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
      section: string | null;
      level: string | null;
      created_at: Date;
      user_count: string;
    }>>(
      `SELECT g.id, g.name, g.description, g.section, g.level, g.created_at,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = g.id)
              + COUNT(u.id)::int AS user_count
       FROM user_groups g
       LEFT JOIN users u ON u.group_id = g.id
       GROUP BY g.id
       ORDER BY g.section NULLS LAST, g.level, g.name ASC`,
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
      section: g.section,
      level: g.level,
      created_at: g.created_at,
      user_count: Number(g.user_count),
      dataset_access: datasetMap.get(g.id) ?? [],
      report_access: reportMap.get(g.id) ?? [],
    }));
  }

  async create(
    name: string,
    description: string | undefined,
    createdBy: string,
    section?: string | string[] | null,
    level?: string | null,
  ): Promise<AdminGroup> {
    const normSection = normalizeSections(section);
    if (level && !VALID_LEVELS.includes(level as any)) {
      throw new BadRequestException(`level must be one of: ${VALID_LEVELS.join(', ')}`);
    }
    if (level && !normSection) {
      throw new BadRequestException('level requires a section — an Editor/Viewer role must belong to sms and/or voice');
    }
    try {
      const [row] = await this.dataSource.query<[{ id: string }]>(
        `INSERT INTO user_groups (name, description, created_by, section, level)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name.trim(), description?.trim() ?? null, createdBy, normSection, level || null],
      );
      this.access.invalidate();
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
    section?: string | string[] | null,
    level?: string | null,
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

    // section/level decide whether this role's members are treated as a section-wide Editor
    // (auto-grants everything in that section — see AccessResolverService) or a scoped Viewer
    // (only the individually-checked datasets/reports below). Both null = a plain custom role
    // with no section-wide privilege, same as a freshly created role today.
    if (section !== undefined || level !== undefined) {
      const normSection = normalizeSections(section);
      if (level && !VALID_LEVELS.includes(level as any)) {
        throw new BadRequestException(`level must be one of: ${VALID_LEVELS.join(', ')}`);
      }
      if (level && !normSection) {
        throw new BadRequestException('level requires a section — an Editor/Viewer role must belong to sms and/or voice');
      }
      await this.dataSource.query(
        `UPDATE user_groups SET section = $1, level = $2 WHERE id = $3`,
        [normSection, level || null, id],
      );

      // A role's level can flip AFTER members already joined it — recompute their stored
      // permission immediately (same rule as setMembers()) rather than leaving it stale
      // until the next membership change or login.
      const members = await this.dataSource.query<{ id: string }[]>(
        `SELECT user_id AS id FROM user_roles WHERE role_id = $1
         UNION SELECT id FROM users WHERE group_id = $1`,
        [id],
      );
      if (members.length > 0) {
        await this.dataSource.query(
          `UPDATE users u SET role = CASE
              WHEN EXISTS (
                SELECT 1 FROM user_roles ur JOIN user_groups g ON g.id = ur.role_id
                 WHERE ur.user_id = u.id AND g.level = 'editor'
              ) THEN 'editor'
              ELSE 'viewer'
            END
           WHERE u.id = ANY($1::uuid[]) AND u.role <> 'admin' AND u.is_protected IS NOT TRUE`,
          [members.map((m) => m.id)],
        );
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

    this.access.invalidate(); // group grants changed — clear all cached scopes
    const all = await this.findAll();
    const updated = all.find((g) => g.id === id);
    if (!updated) throw new NotFoundException(`Group ${id} not found`);
    return updated;
  }

  async setMembers(groupId: string, userIds: string[]): Promise<void> {
    const [existing] = await this.dataSource.query(`SELECT id FROM user_groups WHERE id = $1`, [groupId]);
    if (!existing) throw new NotFoundException(`Group ${groupId} not found`);

    // Membership for a Role lives in the user_roles join (multi-role). Gather everyone whose
    // membership in THIS role is about to change so we can recompute their permission afterwards.
    const before = await this.dataSource.query<{ id: string }[]>(
      `SELECT user_id AS id FROM user_roles WHERE role_id = $1
       UNION SELECT id FROM users WHERE group_id = $1`,
      [groupId],
    );
    const affected = new Set<string>([...before.map((r) => r.id), ...userIds]);

    // Replace this role's membership set, and clear any legacy single-group pointer to it.
    await this.dataSource.query(`DELETE FROM user_roles WHERE role_id = $1`, [groupId]);
    await this.dataSource.query(`UPDATE users SET group_id = NULL WHERE group_id = $1`, [groupId]);
    for (const uid of userIds) {
      await this.dataSource.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [uid, groupId],
      );
    }

    // Permission is derived from roles: editor if the user holds any Editor-level role, else viewer.
    // Admins and the protected system account are never changed.
    if (affected.size > 0) {
      await this.dataSource.query(
        `UPDATE users u SET role = CASE
            WHEN EXISTS (
              SELECT 1 FROM user_roles ur JOIN user_groups g ON g.id = ur.role_id
               WHERE ur.user_id = u.id AND g.level = 'editor'
            ) THEN 'editor'
            ELSE 'viewer'
          END
         WHERE u.id = ANY($1::uuid[]) AND u.role <> 'admin' AND u.is_protected IS NOT TRUE`,
        [[...affected]],
      );
    }

    this.access.invalidate();
  }

  async delete(id: string): Promise<void> {
    const [existing] = await this.dataSource.query(`SELECT id FROM user_groups WHERE id = $1`, [id]);
    if (!existing) throw new NotFoundException(`Group ${id} not found`);
    await this.dataSource.query(`DELETE FROM user_groups WHERE id = $1`, [id]);
    this.access.invalidate();
  }
}
