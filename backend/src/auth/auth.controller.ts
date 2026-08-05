import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

// SSO-only by default: password login stays fully implemented but is rejected unless
// PASSWORD_LOGIN_ENABLED=true (break-glass for an Entra/SSO outage — flip the env and
// restart the backend; deploy/toggle-password-login.sh does both in one command).
function passwordLoginEnabled(): boolean {
  return process.env.PASSWORD_LOGIN_ENABLED === 'true';
}
function ssoEnabled(): boolean {
  return process.env.SSO_ENABLED !== 'false'; // same default-on convention as graph-email.service
}

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private auditService: AuditService,
  ) {}

  /** Public runtime config for the login page: which sign-in methods to offer. The page reads
   *  this on load, so toggling PASSWORD_LOGIN_ENABLED needs only a backend restart — no rebuild. */
  @Get('login-methods')
  loginMethods() {
    return { password: passwordLoginEnabled(), sso: ssoEnabled() };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    if (!passwordLoginEnabled()) {
      this.auditService.log({
        userId: null,
        action: 'auth:login_blocked',
        resource: 'auth',
        detail: { email: dto.email, reason: 'password_login_disabled' },
        ipAddress,
      });
      throw new ForbiddenException('Password login is disabled — sign in with Microsoft.');
    }

    const result = await this.authService.login(dto, ipAddress, userAgent);

    // Set refresh token as HttpOnly cookie.
    // Path must be '/' (not '/auth/refresh'): behind the nginx reverse proxy the browser
    // calls '/api/auth/refresh', which would not match a '/auth/refresh' cookie path, so
    // the cookie would never be sent and refresh would always 401 (silent logout on token
    // expiry). '/' is sent on every request and works in all environments.
    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    this.auditService.log({
      userId: result.user.id as string,
      action: 'auth:login',
      resource: 'auth',
      detail: { email: dto.email },
      ipAddress,
    });

    return {
      token: result.token,
      must_change_password: result.must_change_password,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.['refresh_token'];
    if (!refreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'No refresh token' });
      return;
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = await this.authService.refresh(refreshToken, ipAddress, userAgent);
    return result;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.jti);

    res.clearCookie('refresh_token', { path: '/' });

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'auth:logout',
      resource: 'auth',
      detail: { jti: user.jti },
      ipAddress,
    });

    return { message: 'Logged out successfully' };
  }

  // Current user + access arrays (same shape as login's `user`). Used by the SSO
  // callback page to hydrate the frontend auth store after cookie-bootstrapping a token.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtUser) {
    return this.authService.me(user.sub);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: JwtUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    await this.authService.changePassword(user.sub, dto);

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';
    this.auditService.log({
      userId: user.sub,
      action: 'auth:change_password',
      resource: 'auth',
      detail: {},
      ipAddress,
    });

    return { message: 'Password changed successfully' };
  }
}
