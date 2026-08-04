import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Resolves an AMS user's MCP data scope: their role + the physical stage tables they may read.
 *
 * Mirrors the app's own grant model (auth.service.ts `buildAccessArrays`): `admin` sees every active
 * dataset; everyone else (viewer/editor, and any unrecognised role → lowest tier, never
 * admin) sees only datasets granted to them individually (`user_dataset_access`) or via their group
 * (`group_dataset_access`), filtered to `is_active`. Dataset→table is resolved at runtime from
 * `datasets.stage_table_name` (never inferred from names — some tables lack the `stage_` prefix).
 *
 * Resolved per request and cached ≤60s per user, so a grant/revocation through the admin UI takes
 * effect promptly.
 */

export interface McpScope {
  role: string | null;
  isAdmin: boolean;
  allowedTables: Set<string>; // lowercased stage_table_name values
  datasetCount: number;
}

const TTL_MS = 60_000;

@Injectable()
export class McpAuthzService {
  private readonly logger = new Logger(McpAuthzService.name);
  private readonly cache = new Map<string, { value: McpScope; expiresAt: number }>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolve(userId: string): Promise<McpScope> {
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await this.load(userId);
    this.cache.set(userId, { value, expiresAt: now + TTL_MS });
    return value;
  }

  private async load(userId: string): Promise<McpScope> {
    // One round-trip: the user's role + the stage tables of the datasets they may read.
    // `admin` → all active datasets; otherwise the union of individual + group grants.
    const rows: Array<{ role: string | null; tables: string[] | null; dataset_count: string }> =
      await this.dataSource.query(
        `
        WITH u AS (SELECT id, role, group_id FROM users WHERE id = $1)
        SELECT
          (SELECT role FROM u) AS role,
          array_agg(d.stage_table_name) FILTER (WHERE d.stage_table_name IS NOT NULL) AS tables,
          count(d.id) AS dataset_count
        FROM datasets d
        WHERE d.is_active
          AND (
            (SELECT role FROM u) = 'admin'
            OR d.id IN (SELECT dataset_id FROM user_dataset_access WHERE user_id = $1)
            OR d.id IN (SELECT dataset_id FROM group_dataset_access
                        WHERE group_id = (SELECT group_id FROM u))
          )
        `,
        [userId],
      );

    const row = rows[0] ?? { role: null, tables: [], dataset_count: '0' };
    const role = row.role ?? null;
    const allowedTables = new Set((row.tables ?? []).map((t) => String(t).toLowerCase()));
    const scope: McpScope = {
      role,
      isAdmin: role === 'admin',
      allowedTables,
      datasetCount: Number(row.dataset_count ?? 0),
    };
    this.logger.debug(`MCP scope for ${userId}: role=${role} datasets=${scope.datasetCount} admin=${scope.isAdmin}`);
    return scope;
  }

  /** Drop cached scope (e.g., after an access change). No-arg clears all. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
