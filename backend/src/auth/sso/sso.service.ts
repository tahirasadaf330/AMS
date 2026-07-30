import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Issuer, generators, type Client } from 'openid-client';

import { User } from '../../common/entities/user.entity';
import { AuthService } from '../auth.service';

/**
 * Microsoft Entra ID single sign-on (OIDC authorization-code + PKCE), per the Hayo SSO
 * playbook. Entra proves WHO the user is; AMS keeps deciding WHAT they can do (roles +
 * report/dataset access stay in our DB, enforced per request). Identity key is the
 * permanent Entra Object ID (oid): match by oid, fall back to email once, backfill the
 * oid on that first match, never overwrite. No account / inactive → deny (no JIT).
 *
 * Fails closed: without ENTRA_* config the flow is disabled and every start attempt is
 * bounced to the frontend with reason=unavailable. Phase 1 runs ALONGSIDE password login.
 */

export type SsoDenyReason = 'unavailable' | 'state' | 'no-account' | 'inactive' | 'mismatch' | 'error';

export type SsoCallbackResult =
  | { ok: true; token: string; refreshToken: string; userId: string; email: string }
  | { ok: false; reason: SsoDenyReason };

interface SsoCtx {
  st: string; // state
  nc: string; // nonce
  cv: string; // PKCE code_verifier
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private client: Client | null = null;

  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly ssoSwitch: string;

  constructor(
    private configService: ConfigService,
    private jwtService: JwtService,
    private authService: AuthService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    this.tenantId = this.configService.get<string>('ENTRA_TENANT_ID', '');
    this.clientId = this.configService.get<string>('ENTRA_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>('ENTRA_CLIENT_SECRET', '');
    this.redirectUri = this.configService.get<string>('ENTRA_REDIRECT_URI', '');
    this.ssoSwitch = this.configService.get<string>('SSO_ENABLED', 'true');
  }

  /** SSO is usable only when the master switch is on AND all Entra config is present. */
  isEnabled(): boolean {
    return (
      this.ssoSwitch !== 'false' &&
      !!this.tenantId && !!this.clientId && !!this.clientSecret && !!this.redirectUri
    );
  }

  /** Where to land the browser on the frontend after the flow (success or deny). */
  frontendCallbackUrl(): string {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
    return `${appUrl}/callback`;
  }

  /** Discover the tenant's OIDC metadata once and cache the client (lazy — no outbound
   *  call at boot, so the app runs fine with SSO unconfigured/disabled). */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    const issuer = await Issuer.discover(`https://login.microsoftonline.com/${this.tenantId}/v2.0`);
    this.client = new issuer.Client({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uris: [this.redirectUri],
      response_types: ['code'],
    });
    return this.client;
  }

  /**
   * Begin the flow: build the Microsoft authorize URL (state + nonce + PKCE) and a
   * short-lived signed context the controller stores in an HttpOnly cookie so the
   * callback can verify state/nonce and complete the PKCE exchange.
   */
  async start(): Promise<{ url: string; ctxJwt: string }> {
    const client = await this.getClient();
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();

    const url = client.authorizationUrl({
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: generators.codeChallenge(codeVerifier),
      code_challenge_method: 'S256',
    });

    const ctx: SsoCtx = { st: state, nc: nonce, cv: codeVerifier };
    const ctxJwt = this.jwtService.sign(ctx, { expiresIn: '10m' });
    return { url, ctxJwt };
  }

  /**
   * Complete the flow: verify state, exchange the code (PKCE), fully validate the
   * id_token (openid-client checks signature via the tenant JWKS, issuer, audience =
   * our client id, expiry, and nonce; we add an explicit tenant check), then match the
   * Microsoft identity to an AMS user and mint a normal AMS session.
   */
  async callback(
    query: Record<string, string | string[] | undefined>,
    ctxJwt: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<SsoCallbackResult> {
    // Recover the state/nonce/verifier stashed at /auth/sso/login. Missing or expired
    // (>10m) → restart the flow; this also blocks login-CSRF (attacker-initiated codes).
    let ctx: SsoCtx;
    try {
      ctx = this.jwtService.verify<SsoCtx>(ctxJwt ?? '');
    } catch {
      return { ok: false, reason: 'state' };
    }

    let claims: Record<string, unknown>;
    try {
      const client = await this.getClient();
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(query)) {
        if (typeof v === 'string') params[k] = v;
      }
      const tokenSet = await client.callback(this.redirectUri, params, {
        state: ctx.st,
        nonce: ctx.nc,
        code_verifier: ctx.cv,
      });
      claims = tokenSet.claims() as unknown as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(`SSO token exchange/validation failed: ${err instanceof Error ? err.message : err}`);
      return { ok: false, reason: 'error' };
    }

    // Defense in depth: the discovery issuer already pins the tenant, but verify the
    // token's tid claim explicitly per the playbook.
    if (String(claims.tid ?? '') !== this.tenantId) {
      this.logger.warn(`SSO token from unexpected tenant: ${String(claims.tid)}`);
      return { ok: false, reason: 'error' };
    }

    const oid = String(claims.oid ?? '');
    const email = String(claims.email ?? claims.preferred_username ?? claims.upn ?? '').toLowerCase();
    if (!oid || !email) {
      this.logger.warn('SSO token missing oid or email claim');
      return { ok: false, reason: 'error' };
    }

    // Identity matching (playbook §3.2/3.3): oid first; email fallback only for records
    // not yet bound to a Microsoft identity. An email match against a record that already
    // carries a DIFFERENT oid is a mismatch, never a re-bind.
    let user = await this.userRepo.findOne({ where: { oid } });
    if (!user) {
      const byEmail = await this.userRepo.findOne({ where: { email } });
      if (byEmail && byEmail.oid && byEmail.oid !== oid) {
        this.logger.warn(`SSO mismatch: ${email} already bound to another Microsoft identity`);
        return { ok: false, reason: 'mismatch' };
      }
      user = byEmail;
    }

    if (!user) {
      this.logger.log(`SSO denied (no account): ${email}`);
      return { ok: false, reason: 'no-account' };
    }
    if (!user.isActive) {
      this.logger.log(`SSO denied (inactive): ${email}`);
      return { ok: false, reason: 'inactive' };
    }

    // Backfill the oid exactly once — only after the active check, and only when the
    // record's email genuinely equals the authenticated identity. Never overwrite.
    if (!user.oid) {
      if (user.email.toLowerCase() !== email) {
        return { ok: false, reason: 'mismatch' };
      }
      await this.userRepo.update(user.id, { oid });
      this.logger.log(`SSO oid backfilled for ${user.email}`);
    }

    const session = await this.authService.issueSession(user, ipAddress, userAgent, {
      suppressMustChange: true,
    });
    return {
      ok: true,
      token: session.token,
      refreshToken: session.refreshToken,
      userId: user.id,
      email: user.email,
    };
  }
}
