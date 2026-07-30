import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { BootstrapService } from './bootstrap.service';
import { SsoController } from './sso/sso.controller';
import { SsoService } from './sso/sso.service';

import { User } from '../common/entities/user.entity';
import { Session } from '../common/entities/session.entity';
import { PasswordHistory } from '../common/entities/password-history.entity';
import { UserDatasetAccess } from '../common/entities/user-dataset-access.entity';
import { UserReportAccess } from '../common/entities/user-report-access.entity';
import { Dataset } from '../common/entities/dataset.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session, PasswordHistory, UserDatasetAccess, UserReportAccess, Dataset]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'fallback_secret_change_this'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '8h'),
        },
      }),
    }),
    AuditModule,
  ],
  controllers: [AuthController, SsoController],
  providers: [AuthService, JwtStrategy, BootstrapService, SsoService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
