'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './status-badge';
import { Button } from '@/components/ui/button';
import { formatDatetimeFull } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import type { NotificationLog } from '@/types';

interface NotificationDetailDrawerProps {
  log: NotificationLog | null;
  open: boolean;
  onClose: () => void;
  onRetry: (id: string) => void;
  isRetrying?: boolean;
}

export function NotificationDetailDrawer({
  log,
  open,
  onClose,
  onRetry,
  isRetrying,
}: NotificationDetailDrawerProps) {
  const canRetry = useAuthStore((s) => s.canAccess('retry_notification'));

  if (!log) return null;

  const snapshotColumns =
    log.matched_rows_snapshot?.[0] ? Object.keys(log.matched_rows_snapshot[0]) : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Notification Detail"
      description={log.condition_name}
      width="w-[600px]"
    >
      <div className="p-6 space-y-6">
        {/* Meta info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Triggered At</p>
            <p className="text-gray-800 dark:text-gray-200">{formatDatetimeFull(log.triggered_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Status</p>
            <StatusBadge status={log.status} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Channel</p>
            <Badge variant={log.channel === 'email' ? 'blue' : 'purple'}>{log.channel}</Badge>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Matched Rows</p>
            <p className="text-gray-800 dark:text-gray-200 font-medium">{log.matched_rows.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Dataset</p>
            <p className="text-gray-800 dark:text-gray-200">{log.dataset_name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-0.5">Retries</p>
            <p className="text-gray-800 dark:text-gray-200">{log.retry_count}</p>
          </div>
        </div>

        {/* Recipients */}
        {log.recipients && log.recipients.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Recipients</p>
            <div className="flex flex-wrap gap-1.5">
              {log.recipients.map((r) => (
                <span
                  key={r}
                  className="rounded-full bg-blue-50 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-700 px-2.5 py-0.5 text-xs text-blue-600 dark:text-blue-300"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Webhook URL */}
        {log.webhook_url && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Webhook URL</p>
            <code className="text-xs text-gray-500 dark:text-gray-400 break-all">{log.webhook_url}</code>
          </div>
        )}

        {/* Error */}
        {log.error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-800 p-3">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium mb-1">Error</p>
            <p className="text-sm text-red-600 dark:text-red-300">{log.error}</p>
          </div>
        )}

        {/* Message preview */}
        {log.message_preview && (
          <div>
            <p className="text-xs text-gray-500 mb-1">Message Preview</p>
            <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap">
              {log.message_preview}
            </pre>
          </div>
        )}

        {/* Matched rows snapshot */}
        {log.matched_rows_snapshot && log.matched_rows_snapshot.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-2">
              Matched Rows Snapshot ({log.matched_rows_snapshot.length} rows)
            </p>
            <div className="overflow-auto max-h-64 rounded border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    {snapshotColumns.slice(0, 5).map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2 text-left text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.matched_rows_snapshot.map((row, idx) => (
                    <tr key={idx} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      {snapshotColumns.slice(0, 5).map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {String(row[col] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Retry button */}
        {canRetry && log.status === 'failed' && (
          <Button
            variant="secondary"
            onClick={() => {
              onRetry(log.id);
              onClose();
            }}
            isLoading={isRetrying}
          >
            <RefreshCw className="h-4 w-4" />
            Retry Notification
          </Button>
        )}
      </div>
    </Drawer>
  );
}
