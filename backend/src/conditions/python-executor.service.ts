import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { writeFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SettingsService } from '../admin/settings/settings.service';

export interface PythonExecutionResult {
  triggered: boolean;
  message?: string;
  rows?: Record<string, unknown>[];
}

/**
 * Extended result for scripts that build a full email report (HTML + inline chart)
 * rather than returning matched rows. Superset of PythonExecutionResult so the same
 * "last JSON line on stdout" contract is reused.
 */
export interface PythonReportResult {
  triggered: boolean;
  subject?: string;
  html?: string;
  image_base64?: string;
  image_cid?: string;
  images?: Array<{ cid: string; base64: string }>;
  message?: string;
  rows?: Record<string, unknown>[];
}

@Injectable()
export class PythonExecutorService {
  private readonly logger = new Logger(PythonExecutorService.name);
  private readonly TIMEOUT_MS = 300_000; // 5 minutes — MTD loops can be slow

  constructor(private readonly settingsService: SettingsService) {}

  async execute(script: string): Promise<PythonExecutionResult> {
    const tmpPath = join(tmpdir(), `ams_script_${Date.now()}.py`);

    try {
      await writeFile(tmpPath, script, 'utf8');
      const env = await this.buildEnv();
      const output = await this.runScript(tmpPath, env);
      return this.parseOutput(output);
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  /**
   * Run a report-building script and parse the extended JSON contract
   * ({triggered, subject, html, image_base64, image_cid, message}). Same env +
   * temp-file + spawn flow as execute(); only the parsing differs.
   */
  async executeReport(script: string): Promise<PythonReportResult> {
    const tmpPath = join(tmpdir(), `ams_report_${Date.now()}.py`);

    try {
      await writeFile(tmpPath, script, 'utf8');
      const env = await this.buildEnv();
      const output = await this.runScript(tmpPath, env);
      return this.parseReport(output);
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  private async buildEnv(): Promise<Record<string, string>> {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    try {
      const [host, port, db, user, pass] = await Promise.all([
        this.settingsService.get('jerasoft_host'),
        this.settingsService.get('jerasoft_port'),
        this.settingsService.get('jerasoft_db'),
        this.settingsService.get('jerasoft_user'),
        this.settingsService.get('jerasoft_pass'),
      ]);
      if (host) env['JERASOFT_HOST'] = host;
      if (port) env['JERASOFT_PORT'] = port;
      if (db)   env['JERASOFT_DB']   = db;
      if (user) env['JERASOFT_USER'] = user;
      if (pass) env['JERASOFT_PASS'] = pass;
    } catch (err) {
      this.logger.warn('Could not load Jerasoft credentials for script env', err);
    }

    // AMS Postgres creds — so scripts can query the app DB (e.g. google_mo_traffic).
    // These are already present via the process.env spread above; set explicitly to
    // document the contract report scripts rely on.
    for (const key of ['AMS_PG_HOST', 'AMS_PG_PORT', 'AMS_PG_DB', 'AMS_PG_USER', 'AMS_PG_PASS']) {
      const val = process.env[key];
      if (val) env[key] = val;
    }

    return env;
  }

  private async getPythonCmd(): Promise<string> {
    if (process.platform === 'win32') return 'python';
    const venvPython = '/opt/ams-venv/bin/python3';
    try {
      await access(venvPython);
      return venvPython;
    } catch {
      return 'python3';
    }
  }

  private async runScript(scriptPath: string, env: Record<string, string>): Promise<string> {
    const cmd = await this.getPythonCmd();
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [scriptPath], { timeout: this.TIMEOUT_MS, env });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python script exited with code ${code}. stderr: ${stderr.trim()}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });
    });
  }

  private parseOutput(raw: string): PythonExecutionResult {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.logger.warn('Python script produced no output — treating as not triggered');
      return { triggered: false };
    }

    try {
      // Find the last line that is valid JSON (scripts often print debug lines before it)
      const lines = trimmed.split('\n').reverse();
      const jsonLine = lines.find((l) => l.trimStart().startsWith('{'));
      const jsonStr = jsonLine ?? trimmed;
      const parsed = JSON.parse(jsonStr) as PythonExecutionResult;
      return {
        triggered: Boolean(parsed.triggered),
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        rows: Array.isArray(parsed.rows) ? parsed.rows : undefined,
      };
    } catch {
      this.logger.error(`Failed to parse Python script output as JSON: ${trimmed.slice(0, 200)}`);
      throw new Error('Python script must print a JSON object: {"triggered": true/false, "message": "...", "rows": [...]}');
    }
  }

  private parseReport(raw: string): PythonReportResult {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.logger.warn('Python report script produced no output — treating as not triggered');
      return { triggered: false };
    }

    try {
      const lines = trimmed.split('\n').reverse();
      const jsonLine = lines.find((l) => l.trimStart().startsWith('{'));
      const parsed = JSON.parse(jsonLine ?? trimmed) as PythonReportResult;
      return {
        triggered: Boolean(parsed.triggered),
        subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
        html: typeof parsed.html === 'string' ? parsed.html : undefined,
        image_base64: typeof parsed.image_base64 === 'string' ? parsed.image_base64 : undefined,
        image_cid: typeof parsed.image_cid === 'string' ? parsed.image_cid : undefined,
        images: Array.isArray(parsed.images)
          ? parsed.images.filter((i: any) => i && typeof i.cid === 'string' && typeof i.base64 === 'string')
          : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : undefined,
        rows: Array.isArray(parsed.rows) ? parsed.rows : undefined,
      };
    } catch {
      this.logger.error(`Failed to parse Python report output as JSON: ${trimmed.slice(0, 200)}`);
      throw new Error('Python report script must print a JSON object with at least {"triggered": true/false}');
    }
  }
}
