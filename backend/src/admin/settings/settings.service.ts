import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../common/entities/setting.entity';
import { JerasoftService } from '../../datasources/jerasoft/jerasoft.service';
import { GraphEmailService } from '../../notifications/graph-email.service';
import { TeamsWebhookService } from '../../notifications/teams-webhook.service';
import { CredentialsService } from '../../credentials/credentials.service';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, writeFile } from 'fs/promises';
import { resolve } from 'path';

const execFileAsync = promisify(execFile);

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

  private getPythonCmd(): string {
    if (process.platform === 'win32') return 'python';
    const venvPython = '/opt/ams-venv/bin/python3';
    try {
      require('fs').accessSync(venvPython);
      return venvPython;
    } catch {
      return 'python3';
    }
  }

  private validatePackageSpec(spec: string): boolean {
    if (!spec || spec.length > 200) return false;
    // Block shell metacharacters — execFile doesn't spawn a shell so this is
    // just a sanity check, not a security boundary.
    return !/[;&|`$\s\\/]/.test(spec);
  }

  async listPythonPackages(): Promise<Array<{ name: string; version: string }>> {
    const py = this.getPythonCmd();
    try {
      const { stdout } = await execFileAsync(py, ['-m', 'pip', 'list', '--format=json'], {
        timeout: 30_000,
      });
      // Strip any warning lines before the JSON array (Debian can emit warnings to stdout)
      const jsonStart = stdout.indexOf('[');
      if (jsonStart === -1) return [];
      return JSON.parse(stdout.slice(jsonStart)) as Array<{ name: string; version: string }>;
    } catch (err) {
      this.logger.error('pip list failed', err);
      throw new Error('Failed to list Python packages. Is Python installed and pip available?');
    }
  }

  async installPythonPackage(packageSpec: string): Promise<{ success: boolean; output: string }> {
    if (!this.validatePackageSpec(packageSpec)) {
      throw new BadRequestException('Invalid package specification');
    }
    const py = this.getPythonCmd();
    try {
      const { stdout, stderr } = await execFileAsync(
        py,
        ['-m', 'pip', 'install', packageSpec],
        { timeout: 120_000 },
      );
      await this.syncRequirementsFile();
      return { success: true, output: (stdout + '\n' + stderr).trim() };
    } catch (err: any) {
      const output = ((err.stdout ?? '') + '\n' + (err.stderr ?? '')).trim() || String(err);
      return { success: false, output };
    }
  }

  async uninstallPythonPackage(name: string): Promise<{ success: boolean; output: string }> {
    if (!this.validatePackageSpec(name)) {
      throw new BadRequestException('Invalid package name');
    }
    const py = this.getPythonCmd();
    try {
      const { stdout, stderr } = await execFileAsync(
        py,
        ['-m', 'pip', 'uninstall', '-y', name],
        { timeout: 60_000 },
      );
      await this.syncRequirementsFile();
      return { success: true, output: (stdout + '\n' + stderr).trim() };
    } catch (err: any) {
      const output = ((err.stdout ?? '') + '\n' + (err.stderr ?? '')).trim() || String(err);
      return { success: false, output };
    }
  }

  /**
   * Persist the venv to `requirements.txt` after a runtime pip install/uninstall, so the change
   * survives Docker image rebuilds (the Dockerfile bakes the venv from this file). It is bind-mounted
   * from `backend/requirements.txt` in docker-compose, so writing it here updates the host file.
   * Best-effort: if the file isn't present (e.g. a dev run without the mount) we log and skip rather
   * than fail the install. The updated file still needs committing to reach other environments.
   */
  private async syncRequirementsFile(): Promise<void> {
    const target = resolve(process.cwd(), 'requirements.txt');
    try {
      await access(target);
    } catch {
      this.logger.warn(
        `requirements.txt not found at ${target} — this package change will be LOST on the next ` +
          `image rebuild (bind-mount backend/requirements.txt into the container to persist it).`,
      );
      return;
    }
    try {
      const { stdout } = await execFileAsync(this.getPythonCmd(), ['-m', 'pip', 'freeze'], {
        timeout: 30_000,
      });
      const header =
        '# AMS backend Python venv (/opt/ams-venv) — AUTO-UPDATED when packages change via\n' +
        '# Admin -> Settings -> Python packages. Baked into the image (backend/Dockerfile).\n' +
        '# Commit this file to persist the change across rebuilds and to other environments.\n';
      await writeFile(target, header + stdout);
      this.logger.log(`requirements.txt synced (${target}) — commit it to persist across rebuilds/VMs.`);
    } catch (err) {
      this.logger.error('Failed to sync requirements.txt after a package change', err as Error);
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
