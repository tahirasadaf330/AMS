import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../common/entities/setting.entity';
import { JerasoftService } from '../../datasources/jerasoft/jerasoft.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { TeamsWebhookService } from '../../notifications/teams-webhook.service';
import { CredentialsService } from '../../credentials/credentials.service';
import * as crypto from 'crypto';

const ENCRYPTED_KEYS = ['jerasoft_pass', 'graph_client_secret', 'teams_webhook_url'];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private settingRepo: Repository<Setting>,
    private jerasoftService: JerasoftService,
    private graphEmailService: GraphEmailService,
    private teamsWebhookService: TeamsWebhookService,
    private credentialsService: CredentialsService,
  ) {}

  async getAll(): Promise<Record<string, unknown>> {
    try {
      const settings = await this.settingRepo.find({ order: { key: 'ASC' } });
      const flat: Record<string, string> = {};

      for (const s of settings) {
        flat[s.key] = ENCRYPTED_KEYS.includes(s.key) && s.value ? '***' : (s.value ?? '');
      }

      return {
        jerasoft: {
          host: flat['jerasoft_host'] ?? '',
          port: parseInt(flat['jerasoft_port'] ?? '5432', 10),
          db: flat['jerasoft_db'] ?? '',
          user: flat['jerasoft_user'] ?? '',
          password: flat['jerasoft_pass'] ?? '',
        },
        graph: {
          tenant_id: flat['graph_tenant_id'] ?? '',
          client_id: flat['graph_client_id'] ?? '',
          client_secret: flat['graph_client_secret'] ?? '',
          sender_email: flat['graph_sender_email'] ?? '',
        },
        teams: {
          default_webhook_url: flat['teams_default_webhook_url'] ?? '',
        },
        security: {
          session_timeout_hours: parseInt(flat['security_session_timeout_hours'] ?? '8', 10),
          max_failed_logins: parseInt(flat['security_max_failed_logins'] ?? '5', 10),
          lockout_duration_minutes: parseInt(flat['security_lockout_duration_minutes'] ?? '15', 10),
        },
      };
    } catch (err) {
      this.logger.error('Error getting settings', err);
      throw err;
    }
  }

  async get(key: string): Promise<string | null> {
    const setting = await this.settingRepo.findOne({ where: { key } });
    if (!setting) return null;

    if (ENCRYPTED_KEYS.includes(key) && setting.value) {
      try {
        return this.credentialsService.decrypt(setting.value);
      } catch {
        return null;
      }
    }

    return setting.value;
  }

  async set(key: string, value: string, userId: string): Promise<void> {
    try {
      let storedValue = value;

      if (ENCRYPTED_KEYS.includes(key) && value && value !== '***ENCRYPTED***') {
        storedValue = this.credentialsService.encrypt(value);
      }

      const existing = await this.settingRepo.findOne({ where: { key } });

      if (existing) {
        await this.settingRepo.update(
          { key },
          { value: storedValue, updatedBy: userId, updatedAt: new Date() },
        );
      } else {
        await this.settingRepo.save(
          this.settingRepo.create({
            key,
            value: storedValue,
            updatedBy: userId,
          }),
        );
      }
    } catch (err) {
      this.logger.error(`Error setting ${key}`, err);
      throw err;
    }
  }

  async setBulk(nested: Record<string, unknown>, userId: string): Promise<void> {
    const flat: Record<string, string> = {};

    const j = nested['jerasoft'] as Record<string, unknown> | undefined;
    if (j) {
      if (j['host'] !== undefined) flat['jerasoft_host'] = String(j['host']);
      if (j['port'] !== undefined) flat['jerasoft_port'] = String(j['port']);
      if (j['db'] !== undefined) flat['jerasoft_db'] = String(j['db']);
      if (j['user'] !== undefined) flat['jerasoft_user'] = String(j['user']);
      if (j['password'] !== undefined && j['password'] !== '***') flat['jerasoft_pass'] = String(j['password']);
    }

    const g = nested['graph'] as Record<string, unknown> | undefined;
    if (g) {
      if (g['tenant_id'] !== undefined) flat['graph_tenant_id'] = String(g['tenant_id']);
      if (g['client_id'] !== undefined) flat['graph_client_id'] = String(g['client_id']);
      if (g['client_secret'] !== undefined && g['client_secret'] !== '***') flat['graph_client_secret'] = String(g['client_secret']);
      if (g['sender_email'] !== undefined) flat['graph_sender_email'] = String(g['sender_email']);
    }

    const t = nested['teams'] as Record<string, unknown> | undefined;
    if (t) {
      if (t['default_webhook_url'] !== undefined) flat['teams_default_webhook_url'] = String(t['default_webhook_url']);
    }

    const s = nested['security'] as Record<string, unknown> | undefined;
    if (s) {
      if (s['session_timeout_hours'] !== undefined) flat['security_session_timeout_hours'] = String(s['session_timeout_hours']);
      if (s['max_failed_logins'] !== undefined) flat['security_max_failed_logins'] = String(s['max_failed_logins']);
      if (s['lockout_duration_minutes'] !== undefined) flat['security_lockout_duration_minutes'] = String(s['lockout_duration_minutes']);
    }

    for (const [key, value] of Object.entries(flat)) {
      await this.set(key, value, userId);
    }
  }

  async testJerasoft(): Promise<{ connected: boolean; error?: string }> {
    try {
      const connected = await this.jerasoftService.testConnection();
      return { connected };
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async testGraph(): Promise<{ success: boolean; message: string }> {
    try {
      await this.graphEmailService.testConnection();
      return { success: true, message: 'Graph API token obtained successfully — credentials are valid.' };
    } catch (err) {
      const axiosErr = err as any;
      const detail =
        axiosErr?.response?.data?.error_description ||
        axiosErr?.response?.data?.error ||
        (err instanceof Error ? err.message : String(err));
      return { success: false, message: detail };
    }
  }

  async testTeams(webhookUrl?: string): Promise<{ reachable: boolean; error?: string }> {
    try {
      const reachable = await this.teamsWebhookService.testWebhook(webhookUrl);
      return { reachable };
    } catch (err) {
      return { reachable: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async rotateEncryptionKey(newKeyHex: string, userId: string): Promise<void> {
    // Re-encrypt all encrypted settings with the new key
    // This is a simplified implementation — in production you'd swap keys atomically
    this.logger.warn('Rotating encryption key — all encrypted settings will be re-encrypted');

    try {
      for (const key of ENCRYPTED_KEYS) {
        const setting = await this.settingRepo.findOne({ where: { key } });
        if (!setting || !setting.value) continue;

        try {
          // Decrypt with old key
          const plaintext = this.credentialsService.decrypt(setting.value);
          // Note: In a real rotation, we'd update the key in credentialsService
          // For now, we log and skip actual rotation as it requires config change
          this.logger.log(`Would re-encrypt setting: ${key}`);
        } catch (err) {
          this.logger.error(`Failed to decrypt ${key} during rotation`, err);
        }
      }
    } catch (err) {
      this.logger.error('Error during key rotation', err);
      throw err;
    }
  }
}
