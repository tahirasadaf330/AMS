import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';

export interface McpIdentity {
  keyId: string;
  userId: string;
  email: string;
}

export interface McpKeyStatus {
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}

const KEY_PREFIX = 'ams_mcp_';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/**
 * Per-user MCP API keys. A key authenticates its owning AMS user to the MCP server; the
 * user's normal AMS role/report/dataset permissions are irrelevant to the MCP surface
 * (the read-only Postgres role decides what's visible), but the account must be active.
 *
 * Keys are stored as a one-way SHA-256 hash (deterministic → indexed WHERE key_hash=$1
 * lookup; 256 bits of entropy makes offline brute-force irrelevant — the standard API-key
 * pattern, not bcrypt whose per-row salt would force a full-table scan). The plaintext is
 * shown to the admin exactly once at generation.
 */
@Injectable()
export class McpKeysService implements OnModuleInit {
  private readonly logger = new Logger(McpKeysService.name);
  // Throttle last_used_at writes so a chatty agent doesn't hammer the table.
  private lastUsedWriteAt = new Map<string, number>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    // Idempotent schema, same convention as admin/users user_report_access (users.service.ts).
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS user_mcp_keys (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          key_hash      CHAR(64) NOT NULL UNIQUE,
          prefix        VARCHAR(20) NOT NULL,
          created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at  TIMESTAMPTZ,
          revoked_at    TIMESTAMPTZ
        )`);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_user_mcp_keys_user ON user_mcp_keys (user_id)`,
      );
    } catch (err) {
      this.logger.error('Failed ensuring user_mcp_keys table', err);
    }
  }

  /** Generate a new key for a user, revoking any prior active key. Returns plaintext ONCE. */
  async generate(userId: string, adminId: string): Promise<{ key: string; prefix: string; created_at: Date }> {
    const secret = crypto.randomBytes(32).toString('base64url');
    const key = `${KEY_PREFIX}${secret}`;
    const keyHash = sha256Hex(key);
    const prefix = key.slice(0, 16); // e.g. ams_mcp_3f9a2c1d

    const row = await this.dataSource.transaction(async (tx) => {
      await tx.query(
        `UPDATE user_mcp_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      const inserted = await tx.query(
        `INSERT INTO user_mcp_keys (user_id, key_hash, prefix, created_by)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [userId, keyHash, prefix, adminId],
      );
      return inserted[0] as { created_at: Date };
    });

    return { key, prefix, created_at: row.created_at };
  }

  /** Revoke the user's active key (no-op if none). */
  async revoke(userId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE user_mcp_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  /** Current active-key status for the Admin UI (null if none). */
  async getStatus(userId: string): Promise<McpKeyStatus | null> {
    const rows = await this.dataSource.query(
      `SELECT prefix, created_at, last_used_at FROM user_mcp_keys
       WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /**
   * Verify a presented key. Single indexed lookup that also enforces the kill-switch:
   * the key must be un-revoked AND the owning user still active (parity with jwt.strategy).
   * Returns null on any failure. Updates last_used_at fire-and-forget, throttled to ≥60s.
   */
  async verify(rawKey: string | undefined): Promise<McpIdentity | null> {
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) return null;
    const keyHash = sha256Hex(rawKey);
    let rows: Array<{ id: string; user_id: string; email: string }>;
    try {
      rows = await this.dataSource.query(
        `SELECT k.id, k.user_id, u.email
         FROM user_mcp_keys k JOIN users u ON u.id = k.user_id
         WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND u.is_active = TRUE
         LIMIT 1`,
        [keyHash],
      );
    } catch (err) {
      this.logger.error('MCP key verify query failed', err);
      return null;
    }
    if (!rows.length) return null;
    const r = rows[0];
    this.touchLastUsed(r.id);
    return { keyId: r.id, userId: r.user_id, email: r.email };
  }

  private touchLastUsed(keyId: string): void {
    const now = Date.now();
    const prev = this.lastUsedWriteAt.get(keyId) ?? 0;
    if (now - prev < 60_000) return;
    this.lastUsedWriteAt.set(keyId, now);
    this.dataSource
      .query(`UPDATE user_mcp_keys SET last_used_at = NOW() WHERE id = $1`, [keyId])
      .catch((err) => this.logger.warn(`last_used_at update failed: ${err?.message ?? err}`));
  }
}
