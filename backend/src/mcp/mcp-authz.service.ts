import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccessResolverService } from '../common/access/access-resolver.service';

/**
 * Resolves an AMS user's MCP data scope: their role + the physical stage tables they may read.
 *
 * Delegates the "which datasets" decision to the central AccessResolverService (the single source of
 * truth also used by auth/login, the report-access guard, dashboard, export, datasets and
 * notifications), then maps the resolved dataset ids to their physical stage tables. So the MCP scope
 * is IDENTICAL to what the user sees in the AMS app: `admin` → every active dataset; otherwise the
 * union of their individual grants (`user_dataset_access`), their roles' grants (`user_roles` →
 * `user_groups` → `group_dataset_access`), and every active dataset in any Editor-level section they
 * hold. Dataset→table is resolved at runtime from `datasets.stage_table_name` (never inferred from
 * names — some tables lack the `stage_` prefix).
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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessResolverService,
  ) {}

  async resolve(userId: string): Promise<McpScope> {
    const now = Date.now();
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    const value = await this.load(userId);
    this.cache.set(userId, { value, expiresAt: now + TTL_MS });
    return value;
  }

  private async load(userId: string): Promise<McpScope> {
    // Delegate the "which datasets" decision to the central resolver (individual + role/group +
    // editor-section), then map the allowed dataset ids to their physical stage tables.
    const acc = await this.access.resolve(userId);

    let tableRows: Array<{ stage_table_name: string | null }>;
    if (acc.isAdmin) {
      tableRows = await this.dataSource.query(
        `SELECT stage_table_name FROM datasets WHERE is_active AND stage_table_name IS NOT NULL`,
      );
    } else {
      const ids = [...acc.datasetIds];
      tableRows = ids.length
        ? await this.dataSource.query(
            `SELECT stage_table_name FROM datasets
              WHERE is_active AND stage_table_name IS NOT NULL AND id = ANY($1::uuid[])`,
            [ids],
          )
        : [];
    }

    const allowedTables = new Set(
      tableRows.map((r) => String(r.stage_table_name).toLowerCase()).filter((t) => t && t !== 'null'),
    );
    const scope: McpScope = {
      role: acc.permission,
      isAdmin: acc.isAdmin,
      allowedTables,
      datasetCount: allowedTables.size,
    };
    this.logger.debug(`MCP scope for ${userId}: role=${scope.role} datasets=${scope.datasetCount} admin=${scope.isAdmin}`);
    return scope;
  }

  /** Drop cached scope (e.g., after an access change). No-arg clears all. */
  invalidate(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
