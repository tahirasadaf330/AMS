import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '../common/entities/session.entity';
import { User } from '../common/entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
  mustChangePassword?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(Session)
    private sessionRepo: Repository<Session>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'fallback_secret_change_this'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Check if jti is revoked
    const session = await this.sessionRepo.findOne({ where: { jti: payload.jti } });
    if (!session || session.revokedAt !== null) {
      throw new UnauthorizedException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session has expired');
    }
    // Re-check the account is still active on EVERY request (not only at login), so
    // deactivating a user takes effect on their next request — the offboarding
    // kill-switch required by the SSO playbook (§3.4/§7.3).
    const user = await this.userRepo.findOne({ where: { id: payload.sub }, select: ['id', 'isActive'] });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }
    return payload;
  }
}
