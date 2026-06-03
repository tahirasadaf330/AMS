import { cn, formatDatetimeFull } from '@/lib/utils';
import { StatusBadge } from './status-badge';
import { Spinner } from '@/components/ui/spinner';
import type { RefreshHistoryEntry } from '@/types';

interface RefreshHistoryTableProps {
  entries: RefreshHistoryEntry[];
  isLoading: boolean;
}

export function RefreshHistoryTable({ entries, isLoading }: RefreshHistoryTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Spinner />
      </div>
    );
  }

  if (!entries.length) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">No refresh history available</div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Started At
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Rows
            </th>
            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Duration
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Error
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
              <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap font-mono text-xs">
                {formatDatetimeFull(entry.started_at)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={entry.status} />
              </td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                {entry.row_count != null ? entry.row_count.toLocaleString() : '—'}
              </td>
              <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                {entry.duration_ms != null ? `${entry.duration_ms}ms` : '—'}
              </td>
              <td className="px-4 py-3 text-xs text-red-400 max-w-[200px] truncate">
                {entry.error ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
