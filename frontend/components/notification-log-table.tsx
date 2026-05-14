'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { cn, formatDatetimeFull, truncate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './status-badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/store/auth.store';
import type { NotificationLog } from '@/types';

interface NotificationLogTableProps {
  logs: NotificationLog[];
  isLoading: boolean;
  onRetry: (id: string) => void;
  isRetrying?: boolean;
  onRowClick: (log: NotificationLog) => void;
}

export function NotificationLogTable({
  logs,
  isLoading,
  onRetry,
  isRetrying,
  onRowClick,
}: NotificationLogTableProps) {
  const canRetry = useAuthStore((s) => s.canAccess('retry_notification'));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    );
  }

  if (!logs.length) {
    return (
      <div className="text-center py-12 text-gray-500 text-sm">No notifications found</div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700" style={{ maxHeight: '62vh', overflowY: 'auto' }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-800 border-b border-gray-700">
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">Timestamp</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Condition</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Dataset</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Channel</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Recipients</th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Rows</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Error</th>
            {canRetry && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr
              key={log.id}
              className="border-b border-gray-700/50 hover:bg-gray-700/30 cursor-pointer"
              onClick={() => onRowClick(log)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onRowClick(log);
              }}
            >
              <td className="px-4 py-3 text-gray-400 font-mono text-xs whitespace-nowrap">
                {formatDatetimeFull(log.triggered_at)}
              </td>
              <td className="px-4 py-3 text-gray-200 max-w-[160px] truncate">
                {log.condition_name}
              </td>
              <td className="px-4 py-3 text-gray-400 max-w-[120px] truncate">
                {log.dataset_name}
              </td>
              <td className="px-4 py-3">
                <Badge variant={log.channel === 'email' ? 'blue' : 'purple'}>
                  {log.channel}
                </Badge>
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs max-w-[150px] truncate">
                {log.recipients?.join(', ') ?? log.webhook_url ?? '—'}
              </td>
              <td className="px-4 py-3 text-right text-gray-300">
                {log.matched_rows.toLocaleString()}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={log.status} />
              </td>
              <td className="px-4 py-3 text-xs text-red-400 max-w-[180px] truncate" title={log.error}>
                {truncate(log.error ?? '', 60)}
              </td>
              {canRetry && (
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  {log.status === 'failed' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRetry(log.id)}
                      disabled={isRetrying}
                      title="Retry notification"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
