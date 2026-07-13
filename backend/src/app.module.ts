import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";

import { User } from "./common/entities/user.entity";
import { PasswordHistory } from "./common/entities/password-history.entity";
import { Session } from "./common/entities/session.entity";
import { Dataset } from "./common/entities/dataset.entity";
import { UserDatasetAccess } from "./common/entities/user-dataset-access.entity";
import { UserReportAccess } from "./common/entities/user-report-access.entity";
import { DatasetRefreshLog } from "./common/entities/dataset-refresh-log.entity";
import { Condition } from "./common/entities/condition.entity";
import { NotificationLog } from "./common/entities/notification-log.entity";
import { Setting } from "./common/entities/setting.entity";
import { AuditLog } from "./common/entities/audit-log.entity";
import { ExternalDataSource } from "./common/entities/data-source.entity";
import { UserGroup } from "./common/entities/user-group.entity";

import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { JerasoftModule } from "./datasources/jerasoft/jerasoft.module";
import { ExternalDatasourcesModule } from "./datasources/external-datasources.module";
import { AdminDatasourcesModule } from "./admin/datasources/admin-datasources.module";
import { CredentialsModule } from "./credentials/credentials.module";
import { DatasetsModule } from "./datasets/datasets.module";
import { SchedulerModule } from "./scheduler/scheduler.module";
import { StageModule } from "./stage/stage.module";
import { ConditionsModule } from "./conditions/conditions.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { ExportModule } from "./export/export.module";
import { AdminUsersModule } from "./admin/users/users.module";
import { AdminDatasetsModule } from "./admin/datasets/admin-datasets.module";
import { SettingsModule } from "./admin/settings/settings.module";
import { AuditLogModule } from "./admin/audit/audit-log.module";
import { WebsocketModule } from "./websocket/websocket.module";
import { SystemModule } from "./system/system.module";
import { ZamaniReportModule } from "./reports/zamani/zamani-report.module";
import { VcsBalanceModule } from "./reports/vcs-balance/vcs-balance.module";
import { SmsCreditLimitModule } from "./reports/sms-credit-limit/sms-credit-limit.module";
import { GoogleMoModule } from "./reports/google-mo/google-mo.module";
import { PrepaymentClModule } from "./reports/prepayment-cl/prepayment-cl.module";
import { ReportsRegistryModule } from "./admin/reports/reports-registry.module";
import { MtEdrModule } from "./reports/mt-edr/mt-edr.module";
import { SmsReportModule } from "./reports/sms-report/sms-report.module";
import { AdminGroupsModule } from "./admin/groups/groups.module";
import { DealsAutomationModule } from "./reports/deals-automation/deals-automation.module";
import { VoiceLiveTrafficModule } from "./reports/voice-live-traffic/voice-live-traffic.module";
import { AppleTrafficModule } from "./reports/apple-traffic/apple-traffic.module";
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get<string>("AMS_PG_HOST", "localhost"),
        port: config.get<number>("AMS_PG_PORT", 5432),
        database: config.get<string>("AMS_PG_DB", "AMS"),
        username: config.get<string>("AMS_PG_USER", "postgres"),
        password: config.get<string>("AMS_PG_PASS"),
        entities: [
          User,
          PasswordHistory,
          Session,
          Dataset,
          UserDatasetAccess,
          UserReportAccess,
          DatasetRefreshLog,
          Condition,
          NotificationLog,
          Setting,
          AuditLog,
          ExternalDataSource,
          UserGroup,
        ],
        synchronize: false,
        autoLoadEntities: true,
        logging: ["error", "warn"],
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
          options: "-c timezone=UTC",
        },
      }),
    }),
    ScheduleModule.forRoot(),
    AuditModule,
    JerasoftModule,
    ExternalDatasourcesModule,
    CredentialsModule,
    AuthModule,
    DatasetsModule,
    SchedulerModule,
    StageModule,
    ConditionsModule,
    NotificationsModule,
    DashboardModule,
    ExportModule,
    AdminUsersModule,
    AdminDatasetsModule,
    AdminDatasourcesModule,
    SettingsModule,
    AuditLogModule,
    WebsocketModule,
    SystemModule,
    ZamaniReportModule,
    VcsBalanceModule,
    SmsCreditLimitModule,
    GoogleMoModule,
    PrepaymentClModule,
    MtEdrModule,
    SmsReportModule,
    DealsAutomationModule,
    VoiceLiveTrafficModule,
    AppleTrafficModule,
    ReportsRegistryModule,
    AdminGroupsModule,
  ],
})
export class AppModule {}
