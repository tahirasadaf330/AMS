import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReportsRegistryService } from '../../admin/reports/reports-registry.service';
import type { Section } from '../decorators/report-access.decorator';

export type Permission = 'viewer' | 'editor' | 'admin';

export interface ResolvedAccess {
  isAdmin: boolean;
  /** Effective permission = max(stored user.role, level of any role the user holds). */
  permission: Permission;
  /** Report slugs the user may open. */
  reportSlugs: Set<string>;
  /** Active dataset UUIDs the user may open. */
  datasetIds: Set<string>;
  /** Sections in which the user holds an Editor-level role (auto-grants all that section). */
  editorSections: Set<Section>;
}

const TTL_MS = 60_000;

/**
 * The single source of truth for "what can this user see": reports + datasets, and their
 * effective permission. Replaces the pre-Phase-2 inconsistency where the login payload +
 * MCP honoured groups but the report guard / dashboard / export / datasets / notifications
 * enforced individual grants only.
 *
 * Access is the UNION of, for a non-admin user:
 *   - individual grants (user_report_access / user_dataset_access),
 *   - explicit grants of every role/group they belong to (group_report_access / group_dataset_access),
 *   - for every Editor-level role they hold, ALL reports + active datasets in that role's section.
 * Admin sees everything active. Permission never regresses below the stored user.role.
 *
 * Resolved per user and cached ≤60s so an admin's grant/role change takes effect promptly
 * (call invalidate() to clear immediately).
 */
@Injectable()
export class AccessResolverService {
  private readonly logger = new Logger(AccessResolverService.name);
  private readonly cache = new Map<string, { value: ResolvedAccess; expiresAt: number }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reports: ReportsRegistryService,
  ) {}

  async resolve(userId: string): Promise<ResolvedAccess> {
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await this.load(userId);
    this.cache.set(userId, { value, expiresAt: now + TTL_MS });
    return value;
  }

  private levelRank(p: Permission): number {
    return p === 'admin' ? 3 : p === 'editor' ? 2 : 1;
  }

  private async load(userId: string): Promise<ResolvedAccess> {
    const [userRow] = await this.dataSource.query<Array<{ role: string | null }>>(
      `SELECT role FROM users WHERE id = $1`,
      [userId],
    );
    const storedRole = (userRow?.role ?? 'viewer') as Permission;

    if (storedRole === 'admin') {
      const [datasets] = await Promise.all([
        this.dataSource.query<Array<{ id: string }>>(
          `SELECT id FROM datasets WHERE is_active = true`,
        ),
      ]);
      return {
        isAdmin: true,
        permission: 'admin',
        reportSlugs: new Set(this.reports.list().map((r) => r.slug)),
        datasetIds: new Set(datasets.map((d) => d.id)),
        editorSections: new Set<Section>(),
      };
    }

    // Membership: the new user_roles join + the legacy single users.group_id, unified.
    const memberships = await this.dataSource.query<Array<{ id: string; section: Section | null; level: string | null }>>(
      `SELECT g.id, g.section, g.level
         FROM user_groups g
        WHERE g.id IN (
          SELECT role_id FROM user_roles WHERE user_id = $1
          UNION
          SELECT group_id FROM users WHERE id = $1 AND group_id IS NOT NULL
        )`,
      [userId],
    );
    const membershipIds = memberships.map((m) => m.id);
    const editorSections = new Set<Section>();
    for (const m of memberships) {
      if (m.level !== 'editor' || !m.section) continue;
      // section is a CSV — a role may span both sections ('sms,voice').
      for (const s of String(m.section).split(',')) {
        if (s === 'sms' || s === 'voice') editorSections.add(s);
      }
    }

    const sectionsArr = [...editorSections];

    const [indivReports, indivDatasets, groupReports, groupDatasets, sectionDatasets] = await Promise.all([
      this.dataSource.query<Array<{ report_slug: string }>>(
        `SELECT report_slug FROM user_report_access WHERE user_id = $1`,
        [userId],
      ),
      this.dataSource.query<Array<{ dataset_id: string }>>(
        `SELECT dataset_id FROM user_dataset_access WHERE user_id = $1`,
        [userId],
      ),
      membershipIds.length
        ? this.dataSource.query<Array<{ report_slug: string }>>(
            `SELECT report_slug FROM group_report_access WHERE group_id = ANY($1::uuid[])`,
            [membershipIds],
          )
        : Promise.resolve([]),
      membershipIds.length
        ? this.dataSource.query<Array<{ dataset_id: string }>>(
            `SELECT dataset_id FROM group_dataset_access WHERE group_id = ANY($1::uuid[])`,
            [membershipIds],
          )
        : Promise.resolve([]),
      sectionsArr.length
        ? this.dataSource.query<Array<{ id: string }>>(
            `SELECT id FROM datasets WHERE is_active = true AND section = ANY($1::text[])`,
            [sectionsArr],
          )
        : Promise.resolve([]),
    ]);

    const reportSlugs = new Set<string>();
    for (const r of indivReports) reportSlugs.add(r.report_slug);
    for (const r of groupReports) reportSlugs.add(r.report_slug);
    if (editorSections.size) {
      for (const r of this.reports.list()) {
        if (r.section && editorSections.has(r.section)) reportSlugs.add(r.slug);
      }
    }

    const datasetIds = new Set<string>();
    for (const d of indivDatasets) datasetIds.add(d.dataset_id);
    for (const d of groupDatasets) datasetIds.add(d.dataset_id);
    for (const d of sectionDatasets) datasetIds.add(d.id);

    // Permission never regresses below the stored role; an Editor-level role lifts it to editor.
    let permission: Permission = storedRole === 'editor' ? 'editor' : 'viewer';
    if (memberships.some((m) => m.level === 'editor')) permission = 'editor';

    return { isAdmin: false, permission, reportSlugs, datasetIds, editorSections };
  }

  /** Drop cached access (e.g. after an admin changes a user's grants/roles). No-arg clears all. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
