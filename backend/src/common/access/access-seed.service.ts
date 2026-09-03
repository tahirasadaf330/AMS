import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** The four seeded Roles (section × level). Names are user-facing (shown in the admin UI). */
export const SEEDED_ROLES: Array<{ name: string; section: 'sms' | 'voice'; level: 'viewer' | 'editor' }> = [
  { name: 'SMS - Viewer', section: 'sms', level: 'viewer' },
  { name: 'SMS - Editor', section: 'sms', level: 'editor' },
  { name: 'Voice - Viewer', section: 'voice', level: 'viewer' },
  { name: 'Voice - Editor', section: 'voice', level: 'editor' },
];

// Dataset name → section. Kept in sync with migration 011 and the @ReportAccess sections.
const SMS_DATASETS = [
  'SMS Report', 'SMS Credit Limit', 'MT EDR Monitoring', 'Google MO Traffic',
  'Zamani Traffic', 'Zamani Sender ID', 'Apple Traffic History', 'Apple Traffic Live',
  'Innovatio Traffic Report', 'Senegal Report', 'Vendor Bind Status',
];
const VOICE_DATASETS = [
  'Voice Credit Limit', 'Voice Live Traffic - Data', 'Voice Negative Margin', 'Deals Automation',
  'Pre-Payment Limit', 'PrePayment CL', 'SRC/DST Number Monitoring - Data', 'Vendor Credit Limit',
  "Voice AM's Profit",
];

/**
 * Idempotent, runs on every boot AFTER all module seeders (onApplicationBootstrap fires after
 * every onModuleInit). Ensures the Phase-2 access schema exists, seeds the four Roles, and
 * classifies any dataset that a report seeder just (re)created — which is why this must run
 * post-seed: a deploy-time SQL migration classifies only datasets that already existed, so a
 * freshly-seeded dataset would otherwise keep section = NULL until the next deploy.
 */
@Injectable()
export class AccessSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccessSeedService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Roles live in user_groups (section + level make a group a "Role"). Legacy ad-hoc groups
      // keep section/level NULL and are unaffected.
      await this.dataSource.query(
        `ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS section VARCHAR(16)`,
      );
      await this.dataSource.query(
        `ALTER TABLE user_groups ADD COLUMN IF NOT EXISTS level VARCHAR(16)`,
      );
      // Multi-role membership (a user may hold several roles). The legacy users.group_id stays
      // for backward compatibility and is unioned in by AccessResolverService.
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS user_roles (
          user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role_id    UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
          granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (user_id, role_id)
        )
      `);

      // Seed the four Roles (upsert section/level so a rename/relevel converges).
      for (const r of SEEDED_ROLES) {
        await this.dataSource.query(
          `INSERT INTO user_groups (name, section, level, description)
             VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO UPDATE SET section = EXCLUDED.section, level = EXCLUDED.level`,
          [r.name, r.section, r.level, `${r.section.toUpperCase()} ${r.level} role`],
        );
      }

      // Classify datasets by name (idempotent; only fills NULLs so admin overrides are kept).
      await this.dataSource.query(
        `UPDATE datasets SET section = 'sms' WHERE section IS NULL AND btrim(name) = ANY($1::text[])`,
        [SMS_DATASETS],
      );
      await this.dataSource.query(
        `UPDATE datasets SET section = 'voice' WHERE section IS NULL AND btrim(name) = ANY($1::text[])`,
        [VOICE_DATASETS],
      );

      this.logger.log('Access schema ensured: user_roles + 4 seeded roles + dataset sections classified');
    } catch (err) {
      this.logger.error('AccessSeedService failed', err as Error);
    }
  }
}
