import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../common/entities/setting.entity';
import { CredentialsService } from '../credentials/credentials.service';
import axios from 'axios';

interface TokenCache {
  token: string;
  expiresAt: number;
  credFingerprint: string;
}

interface EmailRecipient {
  emailAddress: { address: string; name?: string };
}

interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderEmail: string;
}

@Injectable()
export class GraphEmailService {
  private readonly logger = new Logger(GraphEmailService.name);
  private tokenCache: TokenCache | null = null;

  private readonly envTenantId: string;
  private readonly envClientId: string;
  private readonly envClientSecret: string;
  private readonly envSenderEmail: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Setting) private settingRepo: Repository<Setting>,
    private credentialsService: CredentialsService,
  ) {
    this.envTenantId = this.configService.get<string>('GRAPH_TENANT_ID', '');
    this.envClientId = this.configService.get<string>('GRAPH_CLIENT_ID', '');
    this.envClientSecret = this.configService.get<string>('GRAPH_CLIENT_SECRET', '');
    this.envSenderEmail = this.configService.get<string>('GRAPH_SENDER_EMAIL', '');
  }

  private async loadCredentials(): Promise<GraphCredentials> {
    const rows = await this.settingRepo.find({
      where: [
        { key: 'graph_tenant_id' },
        { key: 'graph_client_id' },
        { key: 'graph_client_secret' },
        { key: 'graph_sender_email' },
      ],
    });
    const flat: Record<string, string> = {};
    for (const r of rows) flat[r.key] = r.value ?? '';

    let dbSecret = flat['graph_client_secret'] ?? '';
    if (dbSecret) {
      try { dbSecret = this.credentialsService.decrypt(dbSecret); } catch { dbSecret = ''; }
    }

    return {
      tenantId: flat['graph_tenant_id'] || this.envTenantId,
      clientId: flat['graph_client_id'] || this.envClientId,
      clientSecret: dbSecret || this.envClientSecret,
      senderEmail: flat['graph_sender_email'] || this.envSenderEmail,
    };
  }

  private async getAccessToken(): Promise<{ token: string; senderEmail: string }> {
    const creds = await this.loadCredentials();
    const fingerprint = `${creds.tenantId}:${creds.clientId}:${creds.clientSecret}`;

    // Use cached token if still valid and credentials unchanged
    if (
      this.tokenCache &&
      this.tokenCache.credFingerprint === fingerprint &&
      (this.tokenCache.expiresAt - 60000) > Date.now()
    ) {
      return { token: this.tokenCache.token, senderEmail: creds.senderEmail };
    }

    const tokenUrl = `https://login.microsoftonline.com/${creds.tenantId}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await axios.post(tokenUrl, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });

    const expiresIn: number = response.data.expires_in || 3600;
    this.tokenCache = {
      token: response.data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
      credFingerprint: fingerprint,
    };

    return { token: this.tokenCache.token, senderEmail: creds.senderEmail };
  }

  isTokenValid(): boolean {
    return !!(this.tokenCache && (this.tokenCache.expiresAt - 60000) > Date.now());
  }

  async testConnection(): Promise<void> {
    await this.getAccessToken();
  }

  async sendAlert(params: {
    recipients: string[];
    subject: string;
    conditionName: string;
    datasetName: string;
    matchedRows: Record<string, unknown>[];
    emailText?: string;
    columnMeta?: Array<{ key: string; label: string; visible: boolean }>;
    selectedColumns?: string[];
  }): Promise<void> {
    const { token, senderEmail } = await this.getAccessToken();
    const html = this.buildHtml({ ...params });

    const toRecipients: EmailRecipient[] = params.recipients.map((addr) => ({
      emailAddress: { address: addr },
    }));

    const payload = {
      message: {
        subject: params.subject,
        body: { contentType: 'HTML', content: html },
        toRecipients,
      },
      saveToSentItems: true,
    };

    const response = await axios.post(
      `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        validateStatus: (status) => status === 202,
      },
    );

    if (response.status !== 202) {
      throw new Error(`Graph API returned status ${response.status}`);
    }
  }

  private buildHtml(params: {
    conditionName: string;
    datasetName: string;
    matchedRows: Record<string, unknown>[];
    emailText?: string;
    columnMeta?: Array<{ key: string; label: string; visible: boolean }>;
    selectedColumns?: string[];
  }): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const EXCLUDED_KEYS = new Set(['refreshed_at', 'refreshedat']);
    const selectedSet = params.selectedColumns && params.selectedColumns.length > 0
      ? new Set(params.selectedColumns)
      : null;
    let colDefs: Array<{ key: string; label: string }> = [];
    if (params.columnMeta && params.columnMeta.length > 0) {
      colDefs = params.columnMeta
        .filter((c) => c.visible !== false && !EXCLUDED_KEYS.has(c.key.toLowerCase()) && (!selectedSet || selectedSet.has(c.key)))
        .map((c) => ({ key: c.key, label: c.label }));
    } else if (params.matchedRows.length > 0) {
      colDefs = Object.keys(params.matchedRows[0])
        .filter((k) => !EXCLUDED_KEYS.has(k.toLowerCase()) && (!selectedSet || selectedSet.has(k)))
        .map((k) => ({ key: k, label: k.replace(/_/g, ' ') }));
    }

    const VISIBLE_ROWS = 5;
    const totalRows = params.matchedRows.length;
    const headerCells = colDefs
      .map((c) => `<th style="padding:8px 12px;text-align:left;font-weight:600;white-space:nowrap;background:#dce6f1;color:#1f3864;font-size:12px;border-bottom:2px solid #b8cce4;">${this.escapeHtml(c.label)}</th>`)
      .join('');

    const allDataRows = params.matchedRows
      .map((row, idx) => {
        const bg = idx % 2 === 0 ? '#ffffff' : '#f5f8fc';
        const cells = colDefs.map((c) => {
          const val = row[c.key];
          const formatted = this.formatCellValue(val);
          const style = this.getCellStyle(val);
          return `<td style="padding:6px 12px;border-bottom:1px solid #e8edf5;white-space:nowrap;font-size:13px;${style}">${formatted}</td>`;
        }).join('');
        return `<tr style="background:${bg};">${cells}</tr>`;
      })
      .join('');

    const textSection = params.emailText
      ? `<tr><td style="padding:14px 24px 4px;font-size:14px;color:#333;white-space:pre-line;line-height:1.6;">${this.escapeHtml(params.emailText)}</td></tr>`
      : '';

    const moreNote = totalRows > VISIBLE_ROWS
      ? `<tr><td style="padding:8px 24px 0;font-size:12px;color:#666;font-style:italic;">Showing ${VISIBLE_ROWS} of ${totalRows} matching rows. Scroll to see more.</td></tr>`
      : '';

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Calibri,'Segoe UI',Arial,sans-serif;background:#f0f2f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;">
    <!-- Header -->
    <tr>
      <td style="background:#1f3864;padding:18px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:bold;">AMS — Alert Management System</div>
        <div style="color:#a8b8d8;font-size:12px;margin-top:4px;">Generated ${dateStr} at ${timeStr}</div>
      </td>
    </tr>
    <!-- Section label: dataset first, then alert name -->
    <tr>
      <td style="background:#dce6f1;padding:10px 24px;">
        <span style="color:#1f3864;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;">
          ${this.escapeHtml(params.datasetName)} &nbsp;&bull;&nbsp; ${this.escapeHtml(params.conditionName)} &nbsp;&bull;&nbsp; ${dateStr} ${timeStr}
        </span>
      </td>
    </tr>
    <!-- Custom text -->
    ${textSection}
    <!-- Row count note if truncated -->
    ${moreNote}
    <!-- Table with horizontal + vertical scroll -->
    <tr>
      <td style="padding:12px 24px 20px;">
        <div style="overflow-x:auto;overflow-y:auto;max-height:${VISIBLE_ROWS * 42}px;border:1px solid #d0d8e8;border-radius:4px;">
          <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;min-width:100%;">
            <thead style="position:sticky;top:0;z-index:1;">
              <tr>${headerCells}</tr>
            </thead>
            <tbody>
              ${allDataRows}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="background:#fafafa;padding:12px 24px;text-align:center;border-top:1px solid #e8e8e8;">
        <span style="font-size:10px;color:#999;">© Hayo &nbsp;&bull;&nbsp; Auto-generated &nbsp;&bull;&nbsp; do not reply</span>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private formatCellValue(val: unknown): string {
    if (val === null || val === undefined || val === '') return '<span style="color:#bbb;">&mdash;</span>';
    if (typeof val === 'number') {
      if (val === 0) return '<span style="color:#bbb;">0.00</span>';
      const formatted = val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (val < 0) return `<span style="color:#c00000;">${formatted}</span>`;
      return formatted;
    }
    const strVal = String(val);
    const numVal = parseFloat(strVal);
    if (!isNaN(numVal) && strVal.trim() !== '' && /^-?\d/.test(strVal.trim())) {
      if (numVal === 0) return '<span style="color:#bbb;">0.00</span>';
      const formatted = numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (numVal < 0) return `<span style="color:#c00000;">${formatted}</span>`;
      return formatted;
    }
    return this.escapeHtml(strVal);
  }

  private getCellStyle(val: unknown): string {
    if (val === null || val === undefined) return '';
    const num = typeof val === 'number' ? val : parseFloat(String(val));
    if (!isNaN(num) && num < 0) return 'color:#c00000;';
    if (!isNaN(num) && num === 0) return 'color:#bbb;';
    return '';
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
