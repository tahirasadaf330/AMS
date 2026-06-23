import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

type Severity = 'critical' | 'warning' | 'info';

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'attention',
  warning: 'warning',
  info: 'accent',
};

@Injectable()
export class TeamsWebhookService {
  private readonly logger = new Logger(TeamsWebhookService.name);
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
  }): Promise<void> {
    const webhookUrl = params.webhookUrl || this.defaultWebhookUrl;
    if (!webhookUrl) {
      throw new Error('No Teams webhook URL configured');
    }

    const INTERNAL = new Set(['id', 'refreshed_at']);
    const ts = params.timestamp || new Date().toISOString();
    const severity: Severity = params.severity || 'info';
    const colorKey = SEVERITY_COLORS[severity];
    const displayRows = params.matchedRows.slice(0, 10);
    const extraRows = params.matchedCount - 10;
    const allColumns = displayRows.length > 0 ? Object.keys(displayRows[0]) : [];
    const columns = params.selectedColumns?.length
      ? allColumns.filter((c) => (params.selectedColumns as string[]).includes(c))
      : allColumns.filter((c) => !INTERNAL.has(c));

    const bodyItems: unknown[] = [
      {
        type: 'TextBlock',
        text: `AMS Alert: ${params.conditionName}`,
        weight: 'bolder',
        color: colorKey,
        size: 'medium',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `${params.datasetName} · ${new Date(ts).toLocaleString('en-GB')}`,
        isSubtle: true,
        wrap: true,
      },
    ];

    if (displayRows.length > 0 && columns.length > 0) {
      // One FactSet per row — renders cleanly in Teams regardless of column count
      for (let i = 0; i < displayRows.length; i++) {
        const row = displayRows[i];
        bodyItems.push({
          type: 'FactSet',
          separator: i > 0,
          facts: columns.map((col) => ({
            title: col.replace(/_/g, ' '),
            value: this.formatValue(row[col]),
          })),
        });
      }
    }

    if (extraRows > 0) {
      bodyItems.push({
        type: 'TextBlock',
        text: `... and ${extraRows} more rows — full table sent to your email.`,
        isSubtle: true,
        wrap: true,
        size: 'small',
      });
    }

    bodyItems.push({
      type: 'TextBlock',
      text: `AMS · ${new Date(ts).toLocaleString('en-GB')}`,
      isSubtle: true,
      size: 'small',
      wrap: true,
    });

    const card = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.5',
            body: bodyItems,
          },
        },
      ],
    };

    await axios.post(webhookUrl, card, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
  }

  async testWebhook(webhookUrl?: string): Promise<boolean> {
    const url = webhookUrl || this.defaultWebhookUrl;
    if (!url) return false;
    try {
      const testCard = {
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
              $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
              type: 'AdaptiveCard',
              version: '1.5',
              body: [
                {
                  type: 'TextBlock',
                  text: 'AMS Connection Test',
                  weight: 'bolder',
                },
                {
                  type: 'TextBlock',
                  text: `Test sent at ${new Date().toLocaleString('en-GB')}`,
                  isSubtle: true,
                },
              ],
            },
          },
        ],
      };
      await axios.post(url, testCard, { timeout: 10000 });
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

  private getColor(val: unknown): string | undefined {
    const num = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
    if (!isNaN(num) && num < 0) return 'attention';
    return undefined;
  }
}
