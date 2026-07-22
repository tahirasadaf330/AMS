import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildAccountDestinationTotals } from './alert-totals.util';
import axios from 'axios';

type Severity = 'critical' | 'warning' | 'info';

const THEME_COLORS: Record<Severity, string> = {
  critical: 'FF0000',
  warning:  'FFA500',
  info:     '0078D4',
};

@Injectable()
export class TeamsWebhookService {
  private readonly defaultWebhookUrl: string;

  constructor(private configService: ConfigService) {
    this.defaultWebhookUrl = this.configService.get<string>('TEAMS_DEFAULT_WEBHOOK_URL', '');
  }

  async sendAlert(params: {
    webhookUrl?: string;
    conditionName: string;
    datasetName: string;
    matchedRows: Record<string, unknown>[];
    matchedCount: number;
    severity?: Severity;
    timestamp?: string;
    selectedColumns?: string[];
    columnMeta?: Array<{ key: string; label: string; visible: boolean }>;
  }): Promise<void> {
    const webhookUrl = params.webhookUrl || this.defaultWebhookUrl;
    if (!webhookUrl) {
      throw new Error('No Teams webhook URL configured');
    }

    const INTERNAL = new Set(['id', 'refreshed_at']);
    // Columns the dataset marks visible:false (e.g. Voice Live Traffic's *_change
    // helper columns) are dropped from the card — mirroring the email renderer and
    // the dashboard viewer. Column order and fact labels are unchanged.
    const hiddenKeys = new Set(
      (params.columnMeta ?? []).filter((c) => c.visible === false).map((c) => c.key),
    );
    const ts = params.timestamp || new Date().toISOString();
    const severity: Severity = params.severity || 'info';
    const themeColor = THEME_COLORS[severity];
    const timeLabel = new Date(ts).toLocaleString('en-GB');

    const allColumns = params.matchedRows.length > 0 ? Object.keys(params.matchedRows[0]) : [];
    const columns = (params.selectedColumns?.length
      ? allColumns.filter((c) => (params.selectedColumns as string[]).includes(c))
      : allColumns.filter((c) => !INTERNAL.has(c))
    ).filter((c) => !hiddenKeys.has(c));

    // One MessageCard per row — same proven format as the Python webhook script
    for (let i = 0; i < params.matchedRows.length; i++) {
      const row = params.matchedRows[i];

      const card = {
        '@type':    'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor,
        summary: `AMS Alert: ${params.conditionName}`,
        sections: [
          {
            activityTitle:    `**AMS Alert:** ${params.conditionName}`,
            activitySubtitle: `${params.datasetName} · ${timeLabel} · Row ${i + 1} of ${params.matchedCount}`,
            facts: columns.map((col) => ({
              name:  col.replace(/_/g, ' '),
              value: this.formatValue(row[col]),
            })),
            markdown: true,
          },
        ],
      };

      await axios.post(webhookUrl, card, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });

      // Avoid Teams 403 rate limiting between cards
      if (i < params.matchedRows.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Totals card(s) — one per Account + Destination group (sum counts,
    // weighted ASR/ACD). No-op for datasets without those columns.
    const totals = buildAccountDestinationTotals(params.matchedRows);
    for (const t of totals) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // pace vs Teams rate limit
      const card = {
        '@type':    'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor,
        summary: `AMS Alert Totals: ${params.conditionName}`,
        sections: [
          {
            activityTitle:    `**AMS Alert — Total:** ${params.conditionName}`,
            activitySubtitle: `${params.datasetName} · ${timeLabel} · Total for ${t.account || '—'} / ${t.destination || '—'}`,
            facts: [
              { name: 'Account',        value: t.account || '—' },
              { name: 'Destination',    value: t.destination || '—' },
              { name: 'Attempts',       value: String(t.attempts) },
              { name: 'ACD',            value: t.acd == null ? '—' : t.acd.toFixed(2) },
              { name: 'ASR',            value: t.asr == null ? '—' : `${t.asr.toFixed(2)}%` },
              { name: 'Failed Calls',   value: String(t.failed_calls) },
              { name: 'Volume',         value: t.volume.toFixed(2) },
              { name: 'Answered Calls', value: String(t.answered_calls) },
            ],
            markdown: true,
          },
        ],
      };
      await axios.post(webhookUrl, card, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      });
    }
  }

  async testWebhook(webhookUrl?: string): Promise<boolean> {
    const url = webhookUrl || this.defaultWebhookUrl;
    if (!url) return false;
    try {
      const card = {
        '@type':    'MessageCard',
        '@context': 'https://schema.org/extensions',
        themeColor: '0078D4',
        summary: 'AMS Connection Test',
        sections: [
          {
            activityTitle:    '**AMS Connection Test**',
            activitySubtitle: `Test sent at ${new Date().toLocaleString('en-GB')}`,
            markdown: true,
          },
        ],
      };
      await axios.post(url, card, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  private formatValue(val: unknown): string {
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val === 'number') {
      if (val < 0) return `(${Math.abs(val).toFixed(2)})`;
      return String(val);
    }
    return String(val);
  }

}
