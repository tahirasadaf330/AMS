import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildAccountDestinationTotals } from './alert-totals.util';
import axios from 'axios';

type Severity = 'critical' | 'warning' | 'info';

// Adaptive Card TextBlock accent per severity (Adaptive Cards have no themeColor).
const TITLE_COLORS: Record<Severity, string> = {
  critical: 'Attention',
  warning:  'Warning',
  info:     'Accent',
};

/**
 * Teams delivery via a Power Automate "Workflows" webhook (the replacement for the retired O365
 * Incoming Webhook connectors).
 *
 * FORMAT MATTERS: workflow webhooks accept ANY POST with HTTP 202 — including the legacy
 * `MessageCard` schema this service used to send — but the flow then fails internally and the
 * message is silently dropped. AMS logged every card as "sent" while nothing reached the channel.
 * Workflow webhooks only deliver **Adaptive Cards** wrapped in the message/attachments envelope
 * below, so everything this service posts is an Adaptive Card (v1.4).
 */
@Injectable()
export class TeamsWebhookService {
  private readonly logger = new Logger(TeamsWebhookService.name);
  private readonly defaultWebhookUrl: string;

  constructor(private configService: ConfigService) {
    this.defaultWebhookUrl = this.configService.get<string>('TEAMS_DEFAULT_WEBHOOK_URL', '');
  }

  /** Master kill-switch for outbound Teams messages (see GraphEmailService.outboundSuppressed).
   *  ALERTS_ENABLED=false on local/dev so a running local backend never posts real alerts. */
  private outboundSuppressed(): boolean {
    if (this.configService.get<string>('ALERTS_ENABLED', 'true') === 'false') {
      this.logger.warn('ALERTS_ENABLED=false — outbound Teams suppressed (local/dev)');
      return true;
    }
    return false;
  }

  /** Wrap an Adaptive Card body in the workflow-webhook envelope and post it. */
  private async postCard(webhookUrl: string, body: Array<Record<string, unknown>>): Promise<void> {
    const envelope = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            msteams: { width: 'Full' },
            body,
          },
        },
      ],
    };
    await axios.post(webhookUrl, envelope, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
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
    vendorScoped?: boolean;
  }): Promise<void> {
    if (this.outboundSuppressed()) return;
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
    const timeLabel = new Date(ts).toLocaleString('en-GB');

    const allColumns = params.matchedRows.length > 0 ? Object.keys(params.matchedRows[0]) : [];
    const columns = (params.selectedColumns?.length
      ? allColumns.filter((c) => (params.selectedColumns as string[]).includes(c))
      : allColumns.filter((c) => !INTERNAL.has(c))
    ).filter((c) => !hiddenKeys.has(c));

    // Totals card(s) — one per Account + Destination group (sum counts, weighted
    // ASR/ACD). Non-empty only for the Voice-shaped datasets.
    const totals = buildAccountDestinationTotals(params.matchedRows, params.vendorScoped);

    // Voice group alerts show ONLY the Account + Destination totals — skip the
    // per-row (per-vendor) cards. Datasets without totals keep one FactSet per row.
    // ONE consolidated card (capped) — high-volume alerts previously fired hundreds of
    // sequential posts and never completed; a single card delivers instantly.
    const MAX_ITEMS = 20;

    const body: Array<Record<string, unknown>> = [
      { type: 'TextBlock', text: `AMS Alert: ${params.conditionName}`, weight: 'Bolder', size: 'Large', color: TITLE_COLORS[severity], wrap: true },
      { type: 'TextBlock', text: `${params.datasetName} · ${timeLabel} · ${params.matchedCount} row(s) matched`, isSubtle: true, spacing: 'None', wrap: true },
    ];

    if (totals.length === 0) {
      // One FactSet per row (capped) — same facts as the old per-row sections.
      params.matchedRows.slice(0, MAX_ITEMS).forEach((row, i) => {
        body.push({ type: 'TextBlock', text: `Row ${i + 1} of ${params.matchedCount}`, weight: 'Bolder', spacing: 'Medium', wrap: true });
        body.push({
          type: 'FactSet',
          facts: columns.map((col) => ({ title: col.replace(/_/g, ' '), value: this.formatValue(row[col]) })),
        });
      });
      const extra = params.matchedRows.length - Math.min(params.matchedRows.length, MAX_ITEMS);
      if (extra > 0) {
        body.push({ type: 'TextBlock', text: `…and ${extra} more row(s). See the full report or the alert email for the complete list.`, isSubtle: true, wrap: true });
      }
    } else {
      // One FactSet per Account + Destination total (capped).
      totals.slice(0, MAX_ITEMS).forEach((t) => {
        body.push({ type: 'TextBlock', text: `Total for ${t.account || '—'} / ${t.destination || '—'}`, weight: 'Bolder', spacing: 'Medium', wrap: true });
        body.push({
          type: 'FactSet',
          facts: [
            { title: 'Account',        value: t.account || '—' },
            { title: 'Destination',    value: t.destination || '—' },
            { title: 'Vendor',         value: t.vendor || '—' },
            { title: 'Attempts',       value: String(t.attempts) },
            { title: 'ACD',            value: t.acd == null ? '—' : t.acd.toFixed(2) },
            { title: 'ASR',            value: t.asr == null ? '—' : `${t.asr.toFixed(2)}%` },
            { title: 'Failed Calls',   value: String(t.failed_calls) },
            { title: 'Volume',         value: t.volume.toFixed(2) },
            { title: 'Answered Calls', value: String(t.answered_calls) },
          ],
        });
      });
      const extra = totals.length - Math.min(totals.length, MAX_ITEMS);
      if (extra > 0) {
        body.push({ type: 'TextBlock', text: `…and ${extra} more group(s).`, isSubtle: true, wrap: true });
      }
    }

    await this.postCard(webhookUrl, body);
  }

  async testWebhook(webhookUrl?: string): Promise<boolean> {
    if (this.outboundSuppressed()) return false;
    const url = webhookUrl || this.defaultWebhookUrl;
    if (!url) return false;
    try {
      await this.postCard(url, [
        { type: 'TextBlock', text: 'AMS Connection Test', weight: 'Bolder', size: 'Large', color: 'Accent', wrap: true },
        { type: 'TextBlock', text: `Test sent at ${new Date().toLocaleString('en-GB')}`, isSubtle: true, spacing: 'None', wrap: true },
      ]);
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
