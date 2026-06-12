import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { writeFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface PythonExecutionResult {
  triggered: boolean;
  message?: string;
  rows?: Record<string, unknown>[];
}

@Injectable()
export class PythonExecutorService {
  private readonly logger = new Logger(PythonExecutorService.name);
  private readonly TIMEOUT_MS = 30_000;

  async execute(script: string): Promise<PythonExecutionResult> {
    const tmpPath = join(tmpdir(), `ams_script_${Date.now()}.py`);

    try {
      await writeFile(tmpPath, script, 'utf8');
      const output = await this.runScript(tmpPath);
      return this.parseOutput(output);
    } finally {
      await unlink(tmpPath).catch(() => undefined);
    }
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

  private async runScript(scriptPath: string): Promise<string> {
    const cmd = await this.getPythonCmd();
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, [scriptPath], { timeout: this.TIMEOUT_MS });

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
}
