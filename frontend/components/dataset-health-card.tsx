'use client';

import { useRouter } from 'next/navigation';
import { cn, formatDatetime, getCronHumanReadable, getNextCronRun, formatNumber } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import type { Dataset } from '@/types';

interface DatasetHealthCardProps {
  dataset: Dataset;
  className?: string;
}

function getDatasetStatus(dataset: Dataset): 'ok' | 'failed' | 'stale' {
  if (!dataset.last_refresh) return 'stale';
  if (dataset.last_refresh.status === 'failed') return 'failed';
  // Consider stale if not refreshed in 2x the schedule interval (approximate)
  const lastRefreshed = new Date(dataset.last_refresh.refreshed_at).getTime();
  const hoursSince = (Date.now() - lastRefreshed) / (1000 * 60 * 60);
  if (hoursSince > 24) return 'stale';
  return 'ok';
}

export function DatasetHealthCard({ dataset, className }: DatasetHealthCardProps) {
  const router = useRouter();
  const status = getDatasetStatus(dataset);

  const borderColors = {
    ok: 'border-green-300 dark:border-green-700/50 hover:border-green-500 dark:hover:border-green-600',
    failed: 'border-red-300 dark:border-red-700/50 hover:border-red-500 dark:hover:border-red-600',
    stale: 'border-amber-300 dark:border-amber-700/50 hover:border-amber-500 dark:hover:border-amber-600',
  };

  return (
    <button
      onClick={() => router.push(`/dashboard/${dataset.id}`)}
      className={cn(
        'w-full text-left rounded-lg border bg-white dark:bg-gray-800 p-4 transition-all',
        'hover:bg-gray-50 dark:hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        borderColors[status],
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{dataset.name}</h3>
        <StatusBadge status={status} />
      </div>

      <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        {dataset.last_refresh ? (
          <>
            <p>
              <span className="text-gray-400 dark:text-gray-500">Refreshed:</span>{' '}
              <span className="text-gray-600 dark:text-gray-300">
                {formatDatetime(dataset.last_refresh.refreshed_at)}
              </span>
            </p>
            <p>
              <span className="text-gray-400 dark:text-gray-500">Rows:</span>{' '}
              <span className="text-gray-600 dark:text-gray-300">{formatNumber(dataset.last_refresh.row_count)}</span>
            </p>
          </>
        ) : (
          <p className="text-gray-400 dark:text-gray-500">Never refreshed</p>
        )}
        <p>
          <span className="text-gray-400 dark:text-gray-500">Schedule:</span>{' '}
          <span className="text-gray-600 dark:text-gray-300">{getCronHumanReadable(dataset.schedule_cron)}</span>
        </p>
        <p>
          <span className="text-gray-400 dark:text-gray-500">Next run:</span>{' '}
          <span className="text-gray-600 dark:text-gray-300">{getNextCronRun(dataset.schedule_cron)}</span>
        </p>
      </div>
    </button>
  );
}
