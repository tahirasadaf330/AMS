import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from '../common/entities/user.entity';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const count = await this.userRepo.count();
      if (count === 0) {
        await this.createAdminUser();
      }
    } catch (err) {
      this.logger.error('Bootstrap error checking users table', err);
    }
  }

  private async createAdminUser(): Promise<void> {
    const email = this.configService.get<string>('ADMIN_EMAIL', 'admin@hayo.com');
    const password = this.configService.get<string>('ADMIN_PASSWORD', 'Admin@ChangeMe123');
    const name = this.configService.get<string>('ADMIN_NAME', 'System Administrator');

    try {
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const admin = this.userRepo.create({
        email: email.toLowerCase(),
        name,
        passwordHash,
        role: 'admin',
        isActive: true,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLogin: null,
        createdBy: null,
      });

      await this.userRepo.save(admin);
      this.logger.log(`Admin user created: ${email}`);
    } catch (err) {
      this.logger.error('Failed to create admin user', err);
    }
  }
}
