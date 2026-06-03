'use client';

import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NotificationLogTable } from '@/components/notification-log-table';
import { NotificationDetailDrawer } from '@/components/notification-detail-drawer';
import { useNotificationLog, useRetryNotification } from '@/hooks/useNotifications';
import { useDatasets } from '@/hooks/useDashboard';
import type { NotificationLog, NotificationFilters } from '@/types';

export default function NotificationsPage() {
  const { data: datasets } = useDatasets();

  const [filters, setFilters] = React.useState<NotificationFilters>({
    page: 1,
    limit: 15,
  });

  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');
  const [channel, setChannel] = React.useState('');
  const [datasetId, setDatasetId] = React.useState('');
  const [status, setStatus] = React.useState('');

  const [selectedLog, setSelectedLog] = React.useState<NotificationLog | null>(null);

  const { data, isLoading } = useNotificationLog(filters);
  const retryMutation = useRetryNotification();

  const applyFilters = () => {
    setFilters({
      page: 1,
      limit: 15,
      from: fromDate || undefined,
      to: toDate || undefined,
      channel: channel || undefined,
      dataset: datasetId || undefined,
      status: status || undefined,
    });
  };

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setChannel('');
    setDatasetId('');
    setStatus('');
    setFilters({ page: 1, limit: 50 });
  };

  const handlePageChange = (page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  };

  const summary = data?.summary;
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const page = data?.page ?? 1;
  const limit = data?.limit ?? 50;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notification Log"
        description="History of all alert notifications sent by the system"
      />

      {/* Filters */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Date</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To Date</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Channel</label>
            <Select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="">All channels</option>
              <option value="email">Email</option>
              <option value="teams">Teams</option>
            </Select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Dataset</label>
            <Select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="">All datasets</option>
              {(datasets ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 text-xs"
            >
              <option value="">All statuses</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="retrying">Retrying</option>
              <option value="permanently_failed">Permanently Failed</option>
              <option value="skipped">Skipped</option>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={applyFilters}>Apply Filters</Button>
          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
        </div>
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Total:</span>
            <span className="text-gray-800 dark:text-gray-100 font-medium">{summary.total.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm">
            <span className="text-blue-600 dark:text-blue-400">Email:</span>
            <span className="text-blue-700 dark:text-blue-100 font-medium">{summary.email_count.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 px-3 py-2 text-sm">
            <span className="text-purple-600 dark:text-purple-400">Teams:</span>
            <span className="text-purple-700 dark:text-purple-100 font-medium">{summary.teams_count.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm">
            <span className="text-red-500 dark:text-red-400">Failed:</span>
            <span className="text-red-700 dark:text-red-100 font-medium">{summary.failed_count.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Skipped:</span>
            <span className="text-gray-600 dark:text-gray-300 font-medium">{summary.skipped_count.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <NotificationLogTable
        logs={logs}
        isLoading={isLoading}
        onRetry={(id) => void retryMutation.mutateAsync(id)}
        isRetrying={retryMutation.isPending}
        onRowClick={setSelectedLog}
      />

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <p>
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of{' '}
            {total.toLocaleString()} notifications
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="px-3 py-1 text-gray-500 dark:text-gray-400">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <NotificationDetailDrawer
        log={selectedLog}
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        onRetry={(id) => void retryMutation.mutateAsync(id)}
        isRetrying={retryMutation.isPending}
      />
    </div>
  );
}
