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
import * as crypto from 'crypto';
import { User, UserRole } from '../../common/entities/user.entity';
import { Session } from '../../common/entities/session.entity';
import { PasswordHistory } from '../../common/entities/password-history.entity';
import { UserDatasetAccess } from '../../common/entities/user-dataset-access.entity';
import { UserReportAccess } from '../../common/entities/user-report-access.entity';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { AccessResolverService } from '../../common/access/access-resolver.service';

const BCRYPT_ROUNDS = 12;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{10,}$/;

// Temp passwords are generated server-side (admin no longer types one).
// 14 chars, at least one of each required class, unambiguous alphabet.
function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = upper + lower + digits + special;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < 14) chars.push(pick(all));
  // Fisher–Yates so the guaranteed classes aren't always at the front
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface CreateUserDto {
  email: string;
  name: string;
  /** Optional — when omitted the server generates a temp password and returns it once. */
  password?: string;
  role: UserRole;
  datasetAccess?: string[];
  reportAccess?: string[];
  groupId?: string | null;
  /** Role ids (user_groups with section+level) the user holds. Permission is derived from these. */
  roleIds?: string[];
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
  roleIds?: string[];
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
    private access: AccessResolverService,
  ) {}

  /** Effective permission from the selected roles: 'editor' if any Editor-level role, else 'viewer'.
   *  Admin is set explicitly (never derived). Used so the stored user.role matches the resolver. */
  private async deriveRole(roleIds: string[]): Promise<UserRole> {
    if (!roleIds.length) return 'viewer';
    const rows = await this.dataSource.query<Array<{ level: string | null }>>(
      `SELECT level FROM user_groups WHERE id = ANY($1::uuid[])`,
      [roleIds],
    );
    return rows.some((r) => r.level === 'editor') ? 'editor' : 'viewer';
  }

  /** Replace a user's role memberships (user_roles join). */
  private async syncUserRoles(userId: string, roleIds: string[], grantedBy: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
    for (const roleId of roleIds) {
      await this.dataSource.query(
        `INSERT INTO user_roles (user_id, role_id, granted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, roleId, grantedBy],
      );
    }
  }

  /**
   * Phase 3 delegation: an Editor (non-admin) may create/manage only Viewer-level users, and only
   * assign roles / individual reports+datasets that fall inside a section where THEY hold an Editor
   * role. Admins are unrestricted. Everything the editor may grant is, by construction, a subset of
   * their own resolved access — so we validate against that. Throws ForbiddenException on any breach.
   */
  private async assertRequesterScope(
    requesterId: string,
    grants: { role?: UserRole; roleIds?: string[]; datasetAccess?: string[]; reportAccess?: string[] },
  ): Promise<void> {
    const requester = await this.access.resolve(requesterId);
    if (requester.isAdmin) return; // admins: no scoping

    if (grants.role === 'admin' || grants.role === 'editor') {
      throw new ForbiddenException('Editors can only create or manage Viewer-level users');
    }
    if (grants.roleIds?.length) {
      const rows = await this.dataSource.query<Array<{ id: string; section: string | null; level: string | null }>>(
        `SELECT id, section, level FROM user_groups WHERE id = ANY($1::uuid[])`,
        [grants.roleIds],
      );
      if (rows.length !== new Set(grants.roleIds).size) throw new ForbiddenException('Unknown role');
      for (const r of rows) {
        if (r.level !== 'viewer' || !r.section || !requester.editorSections.has(r.section as 'sms' | 'voice')) {
          throw new ForbiddenException('Editors can only assign Viewer roles within their own section');
        }
      }
    }
    for (const id of grants.datasetAccess ?? []) {
      if (!requester.datasetIds.has(id)) throw new ForbiddenException('Dataset is outside your section');
    }
    for (const slug of grants.reportAccess ?? []) {
      if (!requester.reportSlugs.has(slug)) throw new ForbiddenException('Report is outside your section');
    }
  }

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

  async findAll(): Promise<(Omit<User, 'passwordHash'> & { dataset_access: string[]; report_access: string[]; role_ids: string[]; group_name: string | null; effective_dataset_count: number; effective_report_count: number })[]> {
    try {
      const users = await this.userRepo.find({ order: { createdAt: 'DESC' } });
      const [accesses, reportAccesses, groups, roleLinks] = await Promise.all([
        this.dataSource.query<{ user_id: string; dataset_id: string }[]>(
          `SELECT user_id, dataset_id FROM user_dataset_access`,
        ),
        this.dataSource.query<{ user_id: string; report_slug: string }[]>(
          `SELECT user_id, report_slug FROM user_report_access`,
        ),
        this.dataSource.query<{ id: string; name: string }[]>(
          `SELECT id, name FROM user_groups`,
        ),
        this.dataSource.query<{ user_id: string; role_id: string }[]>(
          `SELECT user_id, role_id FROM user_roles`,
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

      const roleMap = new Map<string, string[]>();
      for (const r of roleLinks) {
        const list = roleMap.get(r.user_id) ?? [];
        list.push(r.role_id);
        roleMap.set(r.user_id, list);
      }

      // Effective (resolved) access counts — role-derived ∪ individual — so the admin UI
      // shows what each user can actually reach, not just their individual grants.
      const resolved = await Promise.all(
        users.map(async (u) => {
          try {
            const acc = await this.access.resolve(u.id);
            return { id: u.id, datasets: acc.datasetIds.size, reports: acc.reportSlugs.size };
          } catch {
            return { id: u.id, datasets: 0, reports: 0 };
          }
        }),
      );
      const resolvedMap = new Map(resolved.map((r) => [r.id, r]));

      return users.map(({ passwordHash, ...u }) => ({
        ...(u as Omit<User, 'passwordHash'>),
        dataset_access: accessMap.get(u.id) ?? [],
        report_access:  reportMap.get(u.id)  ?? [],
        role_ids:       roleMap.get(u.id)    ?? [],
        group_name:     u.groupId ? (groupNameMap.get(u.groupId) ?? null) : null,
        effective_dataset_count: resolvedMap.get(u.id)?.datasets ?? 0,
        effective_report_count:  resolvedMap.get(u.id)?.reports  ?? 0,
      }));
    } catch (err) {
      this.logger.error('Error finding users', err);
      throw err;
    }
  }

  async findOne(id: string): Promise<Omit<User, 'passwordHash'> & { dataset_access: string[]; report_access: string[]; role_ids: string[] }> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    const [accesses, reportAccesses, roleLinks] = await Promise.all([
      this.dataSource.query<{ dataset_id: string }[]>(
        `SELECT dataset_id FROM user_dataset_access WHERE user_id = $1`, [id],
      ),
      this.dataSource.query<{ report_slug: string }[]>(
        `SELECT report_slug FROM user_report_access WHERE user_id = $1`, [id],
      ),
      this.dataSource.query<{ role_id: string }[]>(
        `SELECT role_id FROM user_roles WHERE user_id = $1`, [id],
      ),
    ]);
    const { passwordHash, ...u } = user;
    return {
      ...(u as Omit<User, 'passwordHash'>),
      dataset_access: accesses.map((a) => a.dataset_id),
      report_access:  reportAccesses.map((r) => r.report_slug),
      role_ids:       roleLinks.map((r) => r.role_id),
    };
  }

  async create(
    dto: CreateUserDto,
    createdBy: string,
  ): Promise<Omit<User, 'passwordHash'> & { tempPassword: string }> {
    const tempPassword = dto.password?.trim() ? dto.password : generateTempPassword();
    if (!PASSWORD_REGEX.test(tempPassword)) {
      throw new BadRequestException(
        'Password must be at least 10 characters with uppercase, lowercase, digit, and special character',
      );
    }

    const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    try {
      // Accept both camelCase and snake_case (the inbound camelCase middleware is a no-op).
      const raw0 = dto as unknown as Record<string, unknown>;
      const roleIds       = (dto.roleIds       ?? raw0['role_ids'])       as string[] | undefined;
      const datasetAccess = (dto.datasetAccess ?? raw0['dataset_access']) as string[] | undefined;
      const reportAccess  = (dto.reportAccess  ?? raw0['report_access'])  as string[] | undefined;

      // Phase 3: a non-admin (Editor) creator may only assign within their own section, Viewer-level.
      await this.assertRequesterScope(createdBy, { role: dto.role, roleIds, datasetAccess, reportAccess });

      // Permission is derived from the assigned roles (unless Admin is set explicitly).
      const effectiveRole: UserRole =
        dto.role === 'admin' ? 'admin' : roleIds !== undefined ? await this.deriveRole(roleIds) : dto.role;

      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
      const user = this.userRepo.create({
        email: dto.email.toLowerCase(),
        name: dto.name,
        passwordHash,
        role: effectiveRole,
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
      if (datasetAccess?.length) {
        for (const datasetId of datasetAccess) {
          await this.dataSource.query(
            `INSERT INTO user_dataset_access (user_id, dataset_id, granted_by) VALUES ($1, $2, $3)`,
            [saved.id, datasetId, createdBy],
          );
        }
      }

      // Grant report access
      if (reportAccess?.length) {
        for (const reportSlug of reportAccess) {
          await this.dataSource.query(
            `INSERT INTO user_report_access (user_id, report_slug, granted_by) VALUES ($1, $2, $3)`,
            [saved.id, reportSlug, createdBy],
          );
        }
      }

      // Assign roles (user_roles join)
      if (roleIds?.length) {
        await this.syncUserRoles(saved.id, roleIds, createdBy);
      }
      this.access.invalidate(saved.id);

      // Send welcome email (fire and forget)
      this.sendWelcomeEmail(saved, tempPassword).catch((err) => {
        this.logger.error('Failed to send welcome email', err);
      });

      const { passwordHash: _, ...result } = saved;
      // Returned exactly once so the admin can hand it to the user;
      // never stored or logged in plaintext.
      return { ...(result as Omit<User, 'passwordHash'>), tempPassword };
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

    // Phase 3: a non-admin (Editor) may not manage admins or other editors.
    const requesterScope = await this.access.resolve(updatedBy);
    if (!requesterScope.isAdmin && (user.role === 'admin' || user.role === 'editor')) {
      throw new ForbiddenException('Editors can only manage Viewer-level users');
    }

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
      if (existing) throw new ConflictException('Email already in use');
    }

    try {
      // Accept both camelCase (bodyToCamel converted) and snake_case (raw body)
      const raw = dto as Record<string, unknown>;
      const datasetAccess = (dto.datasetAccess ?? raw['dataset_access']) as string[] | undefined;
      const reportAccess  = (dto.reportAccess  ?? raw['report_access'])  as string[] | undefined;
      const roleIds       = (dto.roleIds       ?? raw['role_ids'])       as string[] | undefined;

      // A non-admin editor may only grant within their section, Viewer-level.
      await this.assertRequesterScope(updatedBy, { role: dto.role, roleIds, datasetAccess, reportAccess });

      // Permission is derived from the roles when they are provided (unless Admin is set
      // explicitly, which is protected above for the system admin).
      let effectiveRole: UserRole | undefined = dto.role;
      if (roleIds !== undefined && dto.role !== 'admin' && !(user.isProtected && user.role === 'admin')) {
        effectiveRole = await this.deriveRole(roleIds);
      }

      const patch: Partial<User> = {
        name: dto.name ?? user.name,
        email: dto.email ? dto.email.toLowerCase() : user.email,
        role: effectiveRole ?? user.role,
        isActive: dto.isActive ?? user.isActive,
        mustChangePassword: dto.mustChangePassword ?? user.mustChangePassword,
      };
      // Allow explicit null to clear group assignment
      if ('groupId' in dto) {
        patch.groupId = (dto.groupId as string | null | undefined) ?? null;
      }
      await this.userRepo.update(id, patch);

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

      // Sync roles only when explicitly provided
      if (roleIds !== undefined) {
        await this.syncUserRoles(id, roleIds, updatedBy);
      }

      // Access changed — drop the resolver's cached scope so it takes effect immediately.
      this.access.invalidate(id);

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
