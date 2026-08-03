import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from 'jose';
import type { DenyReason, MatchedBy } from './mcp-audit';

/**
 * Verifies the RS256 JWT Atlas signs for each MCP call and maps it to an AMS user.
 *
 * Atlas is the identity broker: it authenticated the human (Entra), then mints a short-lived
 * token carrying that user's `oid`/`email`. We fully verify it against Atlas's published JWKS
 * (signature, RS256-only, exact iss/aud, exp/nbf, single-use jti) — trusting the token's key,
 * never its self-declared `alg` — then match oid→email→backfill exactly like SSO does. Any
 * active AMS account is allowed (the read-only PG role, not app logic, bounds what it can read).
 *
 * Failures never throw to the HTTP layer: authenticate() always resolves to an ok/deny result so
 * the tool handler can return the denial as a normal 200 result carrying the audit block.
 */

export interface AtlasSubject {
  oid: string | null;
  email: string | null;
  matchedBy: MatchedBy;
  localUserId: string | null;
}

export type AtlasAuthResult =
  | { ok: true; userId: string; email: string; correlationId: string; subject: AtlasSubject }
  | { ok: false; denyReason: DenyReason; correlationId: string; subject: AtlasSubject };

/** A verified caller, passed to the per-request MCP server so tool handlers can audit. */
export interface AtlasIdentity {
  userId: string;
  email: string;
  correlationId: string;
  subject: AtlasSubject;
}

/** HTTP status for a denial: authentication failures → 401; a valid token whose user has no
 *  usable AMS account → 403 (authenticated but not authorized). */
export function denyHttpStatus(reason: string): number {
  return reason === 'no_account' || reason === 'ambiguous_account' || reason === 'no_permission' ? 403 : 401;
}

const NO_SUBJECT: AtlasSubject = { oid: null, email: null, matchedBy: null, localUserId: null };

@Injectable()
export class AtlasAuthService {
  private readonly logger = new Logger(AtlasAuthService.name);

  private readonly jwksUrl: string;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly leewaySeconds: number;
  private readonly configured: boolean;

  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  // jti → token exp (epoch seconds). Single-use enforcement; entries evict once past exp+leeway.
  private readonly seenJti = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.jwksUrl = this.config.get<string>('ATLAS_JWKS_URL', '').trim();
    this.issuer = this.config.get<string>('ATLAS_ISS', '').trim();
    this.audience = this.config.get<string>('MCP_AUD', '').trim();
    this.leewaySeconds = Number(this.config.get<string>('ATLAS_TOKEN_LEEWAY_S', '60')) || 60;
    this.configured = !!this.jwksUrl && !!this.issuer && !!this.audience;
    if (!this.configured) {
      this.logger.warn('ATLAS_JWKS_URL/ATLAS_ISS/MCP_AUD not all set — Atlas MCP auth disabled (/mcp → 503).');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      // Caches keys, selects by `kid`, and refetches once (cooldown-gated) on an unknown kid.
      this.jwks = createRemoteJWKSet(new URL(this.jwksUrl), {
        timeoutDuration: 5000,
        cooldownDuration: 30000,
        cacheMaxAge: 10 * 60 * 1000,
      });
    }
    return this.jwks;
  }

  /** Bearer token from the Authorization header (Atlas sends `Authorization: Bearer <jwt>`). */
  static extractBearer(headerValue: string | undefined): string | undefined {
    if (!headerValue) return undefined;
    return headerValue.startsWith('Bearer ') ? headerValue.slice(7).trim() : undefined;
  }

  async authenticate(rawToken: string | undefined, ipAddress: string): Promise<AtlasAuthResult> {
    if (!rawToken) {
      return { ok: false, denyReason: 'bad_token', correlationId: 'unknown', subject: NO_SUBJECT };
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(rawToken, this.getJwks(), {
        algorithms: ['RS256'], // rejects `none`/HS*; the JWKS is RSA-public-key only
        issuer: this.issuer,
        audience: this.audience,
        clockTolerance: this.leewaySeconds,
      });
      payload = verified.payload;
    } catch (err) {
      return this.mapVerifyError(err, rawToken, ipAddress);
    }

    const correlationId = typeof payload.correlation_id === 'string' ? payload.correlation_id : 'unknown';
    const oid = typeof payload.oid === 'string' ? payload.oid : '';
    const email = String(payload.email ?? '').trim().toLowerCase();
    const jti = typeof payload.jti === 'string' ? payload.jti : undefined;

    // A signed-but-unusable token (missing subject claims) can't be mapped to a user. Reject it
    // BEFORE touching the replay cache — a malformed token must never consume/poison a jti (else an
    // attacker could pre-send garbage carrying a victim's jti to block the victim's real token).
    if (!oid || !email) {
      this.logger.warn('Atlas token missing oid/email claim');
      return {
        ok: false,
        denyReason: 'bad_token',
        correlationId,
        subject: { oid: oid || null, email: email || null, matchedBy: null, localUserId: null },
      };
    }

    // Single-use: reject a token whose jti we've already accepted within its lifetime.
    if (jti) {
      this.evictExpiredJti();
      if (this.seenJti.has(jti)) {
        this.logger.warn(`Atlas token replay rejected (jti=${jti.slice(0, 12)}…)`);
        return {
          ok: false,
          denyReason: 'token_replayed',
          correlationId,
          subject: { oid, email, matchedBy: null, localUserId: null },
        };
      }
      const exp = typeof payload.exp === 'number' ? payload.exp : Math.floor(Date.now() / 1000) + 300;
      this.seenJti.set(jti, exp);
    }

    return this.matchUser(oid, email, correlationId);
  }

  /** oid → email fallback → backfill-once, mirroring SSO (sso.service.ts). Any active account passes. */
  private async matchUser(oid: string, email: string, correlationId: string): Promise<AtlasAuthResult> {
    const denySubject: AtlasSubject = { oid, email, matchedBy: null, localUserId: null };
    try {
      let matchedBy: MatchedBy = 'oid';
      let rows: Array<{ id: string; email: string; oid: string | null; is_active: boolean }> =
        await this.dataSource.query(`SELECT id, email, oid, is_active FROM users WHERE oid = $1 LIMIT 1`, [oid]);

      if (!rows.length) {
        matchedBy = 'email';
        rows = await this.dataSource.query(
          `SELECT id, email, oid, is_active FROM users WHERE lower(email) = $1 LIMIT 1`,
          [email],
        );
        // An email match already bound to a DIFFERENT Microsoft identity is never a re-bind.
        if (rows.length && rows[0].oid && rows[0].oid !== oid) {
          this.logger.warn(`Atlas: ${email} already bound to another Microsoft identity`);
          return { ok: false, denyReason: 'ambiguous_account', correlationId, subject: denySubject };
        }
      }

      const user = rows[0];
      if (!user) return { ok: false, denyReason: 'no_account', correlationId, subject: denySubject };
      if (!user.is_active) return { ok: false, denyReason: 'no_account', correlationId, subject: denySubject };

      // Backfill oid exactly once — only after the active check, only when the record's email
      // truly equals the authenticated identity. Never overwrite an existing oid.
      if (!user.oid) {
        if (user.email.toLowerCase() !== email) {
          return { ok: false, denyReason: 'ambiguous_account', correlationId, subject: denySubject };
        }
        await this.dataSource.query(`UPDATE users SET oid = $1 WHERE id = $2 AND oid IS NULL`, [oid, user.id]);
        this.logger.log(`Atlas oid backfilled for ${user.email}`);
      }

      return {
        ok: true,
        userId: user.id,
        email: user.email,
        correlationId,
        subject: { oid, email: user.email, matchedBy, localUserId: user.id },
      };
    } catch (err) {
      this.logger.error('Atlas user match query failed', err as Error);
      // Treat an infrastructure failure as a denial (never leak internals to the caller).
      return { ok: false, denyReason: 'no_account', correlationId, subject: denySubject };
    }
  }

  /** Map a jose verification error to a deny reason. exp/nbf keep the (validly-signed) claims for
   *  audit; signature/alg/iss/aud/parse failures are untrusted, so no claims are echoed. */
  private mapVerifyError(err: unknown, rawToken: string, ipAddress: string): AtlasAuthResult {
    const code = (err as { code?: string })?.code ?? '';
    const claim = (err as { claim?: string })?.claim ?? '';
    const expiredLike = code === 'ERR_JWT_EXPIRED' || (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'nbf');

    if (expiredLike) {
      // Signature was valid → the claims are trustworthy for the audit trail.
      let oid: string | null = null;
      let email: string | null = null;
      let correlationId = 'unknown';
      try {
        const c = decodeJwt(rawToken);
        oid = typeof c.oid === 'string' ? c.oid : null;
        email = c.email ? String(c.email).trim().toLowerCase() : null;
        correlationId = typeof c.correlation_id === 'string' ? c.correlation_id : 'unknown';
      } catch {
        /* keep nulls */
      }
      return {
        ok: false,
        denyReason: 'token_expired',
        correlationId,
        subject: { oid, email, matchedBy: null, localUserId: null },
      };
    }

    this.logger.warn(`Atlas token rejected (bad_token; code=${code || 'unknown'}${claim ? `, claim=${claim}` : ''}) from ${ipAddress}`);
    return { ok: false, denyReason: 'bad_token', correlationId: 'unknown', subject: NO_SUBJECT };
  }

  private evictExpiredJti(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.seenJti) {
      if (exp + this.leewaySeconds < now) this.seenJti.delete(jti);
    }
  }
}
