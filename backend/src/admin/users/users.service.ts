import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
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
  groupId?: string | null;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
  role?: UserRole;
  isActive?: boolean;
  mustChangePassword?: boolean;
  datasetAccess?: string[];
  reportAccess?: string[];
  groupId?: string | null;
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

    try {
      await this.dataSource.query(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_protected BOOLEAN DEFAULT FALSE`,
      );
      // Mark the original system admin (oldest admin with no creator) as protected
      await this.dataSource.query(`
        UPDATE users SET is_protected = TRUE
        WHERE id = (
          SELECT id FROM users
          WHERE role = 'admin' AND created_by IS NULL
          ORDER BY created_at ASC
          LIMIT 1
        )
      `);
    } catch (err) {
      this.logger.error('Failed to initialise is_protected column', err);
    }
  }

  async findAll(): Promise<(Omit<User, 'passwordHash'> & { dataset_access: string[]; report_access: string[]; group_name: string | null })[]> {
    try {
      const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
      const [accesses, reportAccesses, groups] = await Promise.all([
        this.dataSource.query<{ user_id: string; dataset_id: string }[]>(
          `SELECT user_id, dataset_id FROM user_dataset_access`,
        ),
        this.dataSource.query<{ user_id: string; report_slug: string }[]>(
          `SELECT user_id, report_slug FROM user_report_access`,
        ),
        this.dataSource.query<{ id: string; name: string }[]>(
          `SELECT id, name FROM user_groups`,
        ),
      ]);

      const accessMap = new Map<string, string[]>();
      for (const a of accesses) {
        const list = accessMap.get(a.user_id) ?? [];
        list.push(a.dataset_id);
        accessMap.set(a.user_id, list);
      }

      const reportMap = new Map<string, string[]>();
      for (const r of reportAccesses) {
        const list = reportMap.get(r.user_id) ?? [];
        list.push(r.report_slug);
        reportMap.set(r.user_id, list);
      }

      const groupNameMap = new Map<string, string>();
      for (const g of groups) groupNameMap.set(g.id, g.name);

      return users.map(({ passwordHash, ...u }) => ({
        ...(u as Omit<User, 'passwordHash'>),
        dataset_access: accessMap.get(u.id) ?? [],
        report_access:  reportMap.get(u.id)  ?? [],
        group_name:     u.groupId ? (groupNameMap.get(u.groupId) ?? null) : null,
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
      this.dataSource.query<{ dataset_id: string }[]>(
        `SELECT dataset_id FROM user_dataset_access WHERE user_id = $1`, [id],
      ),
      this.dataSource.query<{ report_slug: string }[]>(
        `SELECT report_slug FROM user_report_access WHERE user_id = $1`, [id],
      ),
    ]);
    const { passwordHash, ...u } = user;
    return {
      ...(u as Omit<User, 'passwordHash'>),
      dataset_access: accesses.map((a) => a.dataset_id),
      report_access:  reportAccesses.map((r) => r.report_slug),
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
        groupId: dto.groupId ?? null,
      });

      const saved = await this.userRepo.save(user);

      // Save initial password to history
      await this.passwordHistoryRepo.save(
        this.passwordHistoryRepo.create({ userId: saved.id, passwordHash }),
      );

      // Grant dataset access
      if (dto.datasetAccess?.length) {
        for (const datasetId of dto.datasetAccess) {
          await this.dataSource.query(
            `INSERT INTO user_dataset_access (user_id, dataset_id, granted_by) VALUES ($1, $2, $3)`,
            [saved.id, datasetId, createdBy],
          );
        }
      }

      // Grant report access
      if (dto.reportAccess?.length) {
        for (const reportSlug of dto.reportAccess) {
          await this.dataSource.query(
            `INSERT INTO user_report_access (user_id, report_slug, granted_by) VALUES ($1, $2, $3)`,
            [saved.id, reportSlug, createdBy],
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

    if (user.isProtected && dto.role !== undefined && dto.role !== user.role) {
      throw new ForbiddenException('Cannot change the role of the system admin account');
    }

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
      if (existing) throw new ConflictException('Email already in use');
    }

    try {
      const patch: Partial<User> = {
        name: dto.name ?? user.name,
        email: dto.email ? dto.email.toLowerCase() : user.email,
        role: dto.role ?? user.role,
        isActive: dto.isActive ?? user.isActive,
        mustChangePassword: dto.mustChangePassword ?? user.mustChangePassword,
      };
      // Allow explicit null to clear group assignment
      if ('groupId' in dto) {
        patch.groupId = (dto.groupId as string | null | undefined) ?? null;
      }
      await this.userRepo.update(id, patch);

      // Accept both camelCase (bodyToCamel converted) and snake_case (raw body)
      const raw = dto as Record<string, unknown>;
      const datasetAccess = (dto.datasetAccess ?? raw['dataset_access']) as string[] | undefined;
      const reportAccess  = (dto.reportAccess  ?? raw['report_access'])  as string[] | undefined;

      // Sync dataset access only when the field is explicitly provided
      if (datasetAccess !== undefined) {
        await this.dataSource.query(
          `DELETE FROM user_dataset_access WHERE user_id = $1`, [id],
        );
        for (const datasetId of datasetAccess) {
          await this.dataSource.query(
            `INSERT INTO user_dataset_access (user_id, dataset_id, granted_by) VALUES ($1, $2, $3)`,
            [id, datasetId, updatedBy],
          );
        }
      }

      // Sync report access only when the field is explicitly provided
      if (reportAccess !== undefined) {
        await this.dataSource.query(
          `DELETE FROM user_report_access WHERE user_id = $1`, [id],
        );
        for (const reportSlug of reportAccess) {
          await this.dataSource.query(
            `INSERT INTO user_report_access (user_id, report_slug, granted_by) VALUES ($1, $2, $3)`,
            [id, reportSlug, updatedBy],
          );
        }
      }

      return this.findOne(id);
    } catch (err) {
      this.logger.error('Error updating user', err);
      throw err;
    }
  }

  async deleteUser(id: string, requestingUserId: string): Promise<void> {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    if (user.isProtected) {
      throw new ForbiddenException('Cannot delete the system admin account');
    }

    // Null out FK columns that have no ON DELETE CASCADE/SET NULL
    await Promise.all([
      this.dataSource.query(`UPDATE audit_log          SET user_id    = NULL WHERE user_id    = $1`, [id]),
      this.dataSource.query(`UPDATE settings           SET updated_by = NULL WHERE updated_by = $1`, [id]),
      this.dataSource.query(`UPDATE datasets           SET created_by = NULL WHERE created_by = $1`, [id]),
      this.dataSource.query(`UPDATE conditions         SET created_by = NULL WHERE created_by = $1`, [id]),
      this.dataSource.query(`UPDATE users              SET created_by = NULL WHERE created_by = $1`, [id]),
      this.dataSource.query(`UPDATE user_dataset_access SET granted_by = NULL WHERE granted_by = $1`, [id]),
      this.dataSource.query(`UPDATE user_report_access  SET granted_by = NULL WHERE granted_by = $1`, [id]),
    ]);

    await this.userRepo.delete(id);
    this.logger.log(`User ${id} (${user.email}) permanently deleted`);
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
