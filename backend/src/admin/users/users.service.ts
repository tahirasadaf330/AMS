import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../../common/entities/user.entity';
import { Session } from '../../common/entities/session.entity';
import { PasswordHistory } from '../../common/entities/password-history.entity';
import { UserDatasetAccess } from '../../common/entities/user-dataset-access.entity';
import { UserReportAccess } from '../../common/entities/user-report-access.entity';
import { GraphEmailService } from '../../notifications/graph-email.service';

const BCRYPT_ROUNDS = 12;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/;

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
  role: UserRole;
  datasetAccess?: string[];
  reportAccess?: string[];
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
  mustChangePassword?: boolean;
  datasetAccess?: string[];
  reportAccess?: string[];
}

@Injectable()
export class AdminUsersService implements OnModuleInit {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Session)
    private sessionRepo: Repository<Session>,
    @InjectRepository(PasswordHistory)
    private passwordHistoryRepo: Repository<PasswordHistory>,
    @InjectRepository(UserDatasetAccess)
    private accessRepo: Repository<UserDatasetAccess>,
    @InjectRepository(UserReportAccess)
    private reportAccessRepo: Repository<UserReportAccess>,
    @InjectDataSource()
    private dataSource: DataSource,
    private graphEmailService: GraphEmailService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS user_report_access (
          id          BIGSERIAL PRIMARY KEY,
          user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          report_slug VARCHAR(100) NOT NULL,
          granted_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
          granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT uq_user_report UNIQUE (user_id, report_slug)
        )
      `);
    } catch (err) {
      this.logger.error('Failed to ensure user_report_access table', err);
    }
  }

  async findAll(): Promise<(Omit<User, 'passwordHash'> & { dataset_access: string[]; report_access: string[] })[]> {
    try {
      const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
      const [accesses, reportAccesses] = await Promise.all([
        this.accessRepo.find(),
        this.reportAccessRepo.find(),
      ]);

      const accessMap = new Map<string, string[]>();
      for (const a of accesses) {
        const list = accessMap.get(a.userId) ?? [];
        list.push(a.datasetId);
        accessMap.set(a.userId, list);
      }

      const reportMap = new Map<string, string[]>();
      for (const r of reportAccesses) {
        const list = reportMap.get(r.userId) ?? [];
        list.push(r.reportSlug);
        reportMap.set(r.userId, list);
      }

      return users.map(({ passwordHash, ...u }) => ({
        ...(u as Omit<User, 'passwordHash'>),
        dataset_access: accessMap.get(u.id) ?? [],
        report_access:  reportMap.get(u.id)  ?? [],
      }));
    } catch (err) {
      this.logger.error('Error finding users', err);
      throw err;
    }
  }

  async findOne(id: string): Promise<Omit<User, 'passwordHash'> & { dataset_access: string[]; report_access: string[] }> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    const [accesses, reportAccesses] = await Promise.all([
      this.accessRepo.find({ where: { userId: id } }),
      this.reportAccessRepo.find({ where: { userId: id } }),
    ]);
    const { passwordHash, ...u } = user;
    return {
      ...(u as Omit<User, 'passwordHash'>),
      dataset_access: accesses.map((a) => a.datasetId),
      report_access:  reportAccesses.map((r) => r.reportSlug),
    };
  }

  async create(dto: CreateUserDto, createdBy: string): Promise<Omit<User, 'passwordHash'>> {
    if (!PASSWORD_REGEX.test(dto.password)) {
      throw new BadRequestException(
        'Password must be at least 10 characters with uppercase, lowercase, digit, and special character',
      );
    }

    const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    try {
      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
      const user = this.userRepo.create({
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: dto.role,
        isActive: true,
        mustChangePassword: true,
        failedLoginCount: 0,
        createdBy,
      });

      const saved = await this.userRepo.save(user);

      // Save initial password to history
      await this.passwordHistoryRepo.save(
        this.passwordHistoryRepo.create({ userId: saved.id, passwordHash }),
      );

      // Grant dataset access
      if (dto.datasetAccess?.length) {
        for (const datasetId of dto.datasetAccess) {
          await this.accessRepo.save(
            this.accessRepo.create({ userId: saved.id, datasetId, grantedBy: createdBy }),
          );
        }
      }

      // Grant report access
      if (dto.reportAccess?.length) {
        for (const reportSlug of dto.reportAccess) {
          await this.reportAccessRepo.save(
            this.reportAccessRepo.create({ userId: saved.id, reportSlug, grantedBy: createdBy }),
          );
        }
      }

      // Send welcome email (fire and forget)
      this.sendWelcomeEmail(saved, dto.password).catch((err) => {
        this.logger.error('Failed to send welcome email', err);
      });

      const { passwordHash: _, ...result } = saved;
      return result as Omit<User, 'passwordHash'>;
    } catch (err) {
      if ((err as any).code === '23505') {
        throw new ConflictException('Email already in use');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateUserDto, updatedBy: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
      if (existing) throw new ConflictException('Email already in use');
    }

    try {
      await this.userRepo.update(id, {
        name: dto.name ?? user.name,
        email: dto.email ? dto.email.toLowerCase() : user.email,
        role: dto.role ?? user.role,
        isActive: dto.isActive ?? user.isActive,
        mustChangePassword: dto.mustChangePassword ?? user.mustChangePassword,
      });

      // Sync dataset access only when the field is explicitly provided
      if (dto.datasetAccess !== undefined) {
        await this.accessRepo.delete({ userId: id });
        for (const datasetId of dto.datasetAccess) {
          await this.accessRepo.save(
            this.accessRepo.create({ userId: id, datasetId, grantedBy: updatedBy }),
          );
        }
      }

      // Sync report access only when the field is explicitly provided
      if (dto.reportAccess !== undefined) {
        await this.reportAccessRepo.delete({ userId: id });
        for (const reportSlug of dto.reportAccess) {
          await this.reportAccessRepo.save(
            this.reportAccessRepo.create({ userId: id, reportSlug, grantedBy: updatedBy }),
          );
        }
      }

      return this.findOne(id);
    } catch (err) {
      this.logger.error('Error updating user', err);
      throw err;
    }
  }

  async deactivate(id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    try {
      await this.userRepo.update(id, { isActive: false });
      // Revoke all sessions
      await this.sessionRepo.update({ userId: id }, { revokedAt: new Date() });
      this.logger.log(`User ${id} deactivated`);
    } catch (err) {
      this.logger.error('Error deactivating user', err);
      throw err;
    }
  }

  async getSessions(userId: string): Promise<Session[]> {
    try {
      return this.sessionRepo.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    } catch (err) {
      this.logger.error('Error getting sessions', err);
      throw err;
    }
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');

    try {
      await this.sessionRepo.update(sessionId, { revokedAt: new Date() });
    } catch (err) {
      this.logger.error('Error revoking session', err);
      throw err;
    }
  }

  private async sendWelcomeEmail(user: User, temporaryPassword: string): Promise<void> {
    try {
      await this.graphEmailService.sendWelcome({
        recipientEmail: user.email,
        recipientName: user.name,
        temporaryPassword,
        role: user.role,
      });
    } catch (err) {
      this.logger.error('Failed to send welcome email', err);
    }
  }
}
