import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { SsoService } from './sso.service';
import { AuditService } from '../../audit/audit.service';

/**
 * Browser-navigation endpoints for Microsoft Entra SSO. Both are full-page redirects
 * (not XHR): /auth/sso/login sends the browser to Microsoft; Microsoft returns to
 * /auth/sso/callback, which finishes on the frontend /callback page. On success the
 * standard refresh_token cookie is set (same as password login) and the frontend
 * bootstraps its access token from it — the access token never rides in a URL.
 */
@Controller('auth/sso')
export class SsoController {
  constructor(
    private ssoService: SsoService,
    private auditService: AuditService,
  ) {}

  private cookieOpts(maxAgeMs: number) {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: maxAgeMs,
      path: '/',
    };
  }

  @Get('login')
  async login(@Res() res: Response) {
    if (!this.ssoService.isEnabled()) {
      return res.redirect(`${this.ssoService.frontendCallbackUrl()}?sso=denied&reason=unavailable`);
    }
    try {
      const { url, ctxJwt } = await this.ssoService.start();
      // 10-minute signed context (state/nonce/PKCE verifier) for the callback leg.
      res.cookie('sso_ctx', ctxJwt, this.cookieOpts(10 * 60 * 1000));
      return res.redirect(url);
    } catch (err) {
      // e.g. discovery failed (Microsoft unreachable) — playbook: new logins pause.
      return res.redirect(`${this.ssoService.frontendCallbackUrl()}?sso=denied&reason=error`);
    }
  }

  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    const front = this.ssoService.frontendCallbackUrl();
    if (!this.ssoService.isEnabled()) {
      return res.redirect(`${front}?sso=denied&reason=unavailable`);
    }

    const ctxJwt = (req.cookies ?? {})['sso_ctx'] as string | undefined;
    res.clearCookie('sso_ctx', { path: '/' });

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = await this.ssoService.callback(
      req.query as Record<string, string | string[] | undefined>,
      ctxJwt,
      ipAddress,
      userAgent,
    );

    if (!result.ok) {
      return res.redirect(`${front}?sso=denied&reason=${result.reason}`);
    }

    // Same refresh cookie contract as password login (see auth.controller for the
    // path-'/' rationale behind the nginx /api proxy).
    res.cookie('refresh_token', result.refreshToken, this.cookieOpts(7 * 24 * 60 * 60 * 1000));

    this.auditService.log({
      userId: result.userId,
      action: 'auth:sso_login',
      resource: 'auth',
      detail: { email: result.email, provider: 'entra' },
      ipAddress,
    });

    return res.redirect(front);
  }
}
