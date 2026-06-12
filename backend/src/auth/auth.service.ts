import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

import { User } from '../common/entities/user.entity';
import { Session } from '../common/entities/session.entity';
import { PasswordHistory } from '../common/entities/password-history.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { UserReportAccess } from '../common/entities/user-report-access.entity';
import { Dataset } from '../common/entities/dataset.entity';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 12;
const PASSWORD_HISTORY_COUNT = 5;

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/;

// uuid v4 without 'uuid' package - we'll use crypto
function generateJti(): string {
  return uuidv4();
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Session)
    private sessionRepo: Repository<Session>,
    @InjectRepository(PasswordHistory)
    private passwordHistoryRepo: Repository<PasswordHistory>,
    @InjectRepository(UserDatasetAccess)
    private datasetAccessRepo: Repository<UserDatasetAccess>,
    @InjectRepository(Dataset)
    private datasetRepo: Repository<Dataset>,
    @InjectRepository(UserReportAccess)
    private reportAccessRepo: Repository<UserReportAccess>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string; refreshToken: string; must_change_password: boolean; user: Partial<User> & { dataset_access: string[] } }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.userRepo.update(user.id, { lastLogin: new Date() });

    const jti = generateJti();
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '8h');
    const refreshExpiresIn = this.configService.get<string>('REFRESH_TOKEN_EXPIRES_IN', '7d');

    const expiresAt = this.parseExpiryToDate(expiresIn);
    const refreshExpiresAt = this.parseExpiryToDate(refreshExpiresIn);

    // Create session record
    await this.sessionRepo.save(
      this.sessionRepo.create({
        userId: user.id,
        jti,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt,
        revokedAt: null,
      }),
    );

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
      mustChangePassword: user.mustChangePassword,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn });

    const refreshJti = generateJti();
    const refreshPayload = { sub: user.id, jti: refreshJti, type: 'refresh' };
    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
      expiresIn: refreshExpiresIn,
    });

    // Store refresh session
    await this.sessionRepo.save(
      this.sessionRepo.create({
        userId: user.id,
        jti: refreshJti,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt: refreshExpiresAt,
        revokedAt: null,
      }),
    );

    // Admin users have access to all active datasets/reports; others use their explicit grants
    let datasetAccessIds: string[];
    let reportAccessSlugs: string[];
    if (user.role === 'admin') {
      const allDatasets = await this.datasetRepo.find({ select: ['id'], where: { isActive: true } });
      datasetAccessIds = allDatasets.map((d) => d.id);
      reportAccessSlugs = ['zamani', 'vcs-balance'];
    } else {
      const [datasetAccess, reportAccess] = await Promise.all([
        this.datasetAccessRepo.find({ where: { userId: user.id } }),
        this.reportAccessRepo.find({ where: { userId: user.id } }),
      ]);
      datasetAccessIds = datasetAccess.map((a) => a.datasetId);
      reportAccessSlugs = reportAccess.map((r) => r.reportSlug);
    }

    return {
      token: accessToken,
      refreshToken,
      must_change_password: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        dataset_access: datasetAccessIds,
        report_access: reportAccessSlugs,
      },
    };
  }

  async refresh(
    refreshToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ token: string }> {
    let payload: { sub: string; jti: string; type: string };

    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    const session = await this.sessionRepo.findOne({ where: { jti: payload.jti } });
    if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub, isActive: true } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const newJti = generateJti();
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN', '8h');
    const expiresAt = this.parseExpiryToDate(expiresIn);

    await this.sessionRepo.save(
      this.sessionRepo.create({
        userId: user.id,
        jti: newJti,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        expiresAt,
        revokedAt: null,
      }),
    );

    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: newJti,
      mustChangePassword: user.mustChangePassword,
    };

    const accessToken = this.jwtService.sign(tokenPayload, { expiresIn });
    return { token: accessToken };
  }

  async logout(jti: string): Promise<void> {
    try {
      await this.sessionRepo.update({ jti }, { revokedAt: new Date() });
    } catch (err) {
      this.logger.error('Error revoking session', err);
    }
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const oldPasswordValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!oldPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (!PASSWORD_REGEX.test(dto.newPassword)) {
      throw new BadRequestException(
        'Password must be at least 10 characters and include uppercase, lowercase, digit, and special character',
      );
    }

    // Check password history (last 5)
    const history = await this.passwordHistoryRepo.find({
      where: { userId },
      order: { changedAt: 'DESC' },
      take: PASSWORD_HISTORY_COUNT,
    });

    for (const h of history) {
      const reused = await bcrypt.compare(dto.newPassword, h.passwordHash);
      if (reused) {
        throw new BadRequestException('Cannot reuse one of your last 5 passwords');
      }
    }

    const newHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    // Save to history
    await this.passwordHistoryRepo.save(
      this.passwordHistoryRepo.create({
        userId,
        passwordHash: newHash,
      }),
    );

    await this.userRepo.update(userId, {
      passwordHash: newHash,
      mustChangePassword: false,
    });
  }

  async validatePasswordStrength(password: string): Promise<boolean> {
    return PASSWORD_REGEX.test(password);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  private parseExpiryToDate(expiry: string): Date {
    const now = Date.now();
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return new Date(now + 8 * 60 * 60 * 1000);

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return new Date(now + value * (multipliers[unit] || 3600000));
  }
}
