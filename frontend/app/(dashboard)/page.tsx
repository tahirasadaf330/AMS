'use client';

import * as React from 'react';
import {
  Database,
  RefreshCw,
  GitBranch,
  Bell,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { useDatasets } from '@/hooks/useDashboard';
import { useConditions } from '@/hooks/useConditions';
import { useNotificationLog } from '@/hooks/useNotifications';
import { useDatasetStore } from '@/store/dataset.store';
import { formatDatetime, formatNumber } from '@/lib/utils';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { Dataset } from '@/types';

function datasetStatus(d: Dataset): 'ok' | 'failed' | 'stale' | 'pending' {
  if (!d.last_refresh) return 'pending';
  if (d.last_refresh.status === 'failed') return 'failed';
  if (d.last_refresh.status === 'running') return 'ok';
  const hoursSince = (Date.now() - new Date(d.last_refresh.refreshed_at).getTime()) / 36e5;
  return hoursSince > 24 ? 'stale' : 'ok';
}

const TH_CLASS =
  'sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/80 backdrop-blur px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap';
const TD_CLASS = 'px-4 py-2.5 text-sm whitespace-nowrap';

export default function OverviewPage() {
  const router = useRouter();
  const { data: datasets, isLoading: datasetsLoading } = useDatasets();
  const { data: conditions, isLoading: conditionsLoading } = useConditions();

  const today = new Date().toISOString().slice(0, 10);
  const { data: notifData, isLoading: notifLoading } = useNotificationLog({
    from: today,
    limit: 10,
  });

  const datasetStore = useDatasetStore();

  // KPIs
  const kpiLoading = datasetsLoading || conditionsLoading || notifLoading;
  const activeDatasets = datasets?.filter((d) => d.is_active).length ?? 0;
  const activeConditions = conditions?.filter((c) => c.is_active).length ?? 0;
  const notifSentToday = notifData?.summary?.total ?? 0;
  const notifFailedToday = notifData?.summary?.failed_count ?? 0;

  const lastRefreshedAt = datasets?.reduce((latest, d) => {
    const t = d.last_refresh?.refreshed_at;
    if (!t) return latest;
    if (!latest) return t;
    return t > latest ? t : latest;
  }, null as string | null);

  const recentNotifs = notifData?.logs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Real-time monitoring dashboard" />

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard
          label="Datasets Available"
          value={activeDatasets}
          icon={Database}
          iconColor="text-blue-400"
          isLoading={kpiLoading}
        />
        <KpiCard
          label="Last Refresh"
          value={lastRefreshedAt ? formatDatetime(lastRefreshedAt) : '—'}
          icon={RefreshCw}
          iconColor="text-green-400"
          isLoading={kpiLoading}
        />
        <KpiCard
          label="Active Alerts"
          value={activeConditions}
          icon={GitBranch}
          iconColor="text-purple-400"
          isLoading={kpiLoading}
        />
        <KpiCard
          label="Notifications Today"
          value={notifSentToday}
          icon={Bell}
          iconColor="text-amber-400"
          isLoading={kpiLoading}
        />
        <KpiCard
          label="Failed Today"
          value={notifFailedToday}
          icon={XCircle}
          iconColor="text-red-400"
          isLoading={kpiLoading}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent notifications table */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Recent Notifications</h2>
            <Badge variant="default">{recentNotifs.length}</Badge>
          </div>
          <div className="overflow-auto max-h-[420px]">
            {notifLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonCard key={i} className="h-10 bg-gray-200 dark:bg-gray-700/30" />
                ))}
              </div>
            ) : recentNotifs.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                No notifications today
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH_CLASS}>Condition</th>
                    <th className={TH_CLASS}>Dataset</th>
                    <th className={TH_CLASS}>Channel</th>
                    <th className={`${TH_CLASS} text-right`}>Rows</th>
                    <th className={TH_CLASS}>Time</th>
                    <th className={TH_CLASS}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {recentNotifs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className={`${TD_CLASS} font-medium text-gray-800 dark:text-gray-200 max-w-[220px] truncate`} title={log.condition_name}>
                        {log.condition_name}
                      </td>
                      <td className={`${TD_CLASS} text-gray-500 dark:text-gray-400 max-w-[180px] truncate`} title={log.dataset_name}>
                        {log.dataset_name}
                      </td>
                      <td className={TD_CLASS}>
                        <Badge variant={log.channel === 'email' ? 'blue' : 'purple'} className="text-xs">
                          {log.channel}
                        </Badge>
                      </td>
                      <td className={`${TD_CLASS} text-right tabular-nums text-gray-600 dark:text-gray-300`}>
                        {log.matched_rows}
                      </td>
                      <td className={`${TD_CLASS} text-gray-500 dark:text-gray-400 tabular-nums`}>
                        {formatDatetime(log.triggered_at)}
                      </td>
                      <td className={TD_CLASS}>
                        <StatusBadge status={log.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Dataset health table */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Dataset Health</h2>
            <Badge variant="default">{(datasets ?? []).length}</Badge>
          </div>
          <div className="overflow-auto max-h-[420px]">
            {datasetsLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={i} className="h-10" />
                ))}
              </div>
            ) : (datasets ?? []).length === 0 ? (
              <p className="text-center py-8 text-gray-500 text-sm">No datasets available</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH_CLASS}>Dataset</th>
                    <th className={TH_CLASS}>Status</th>
                    <th className={`${TH_CLASS} text-right`}>Rows</th>
                    <th className={TH_CLASS}>Last Refresh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                  {(datasets ?? []).map((dataset) => {
                    const storeRefresh = datasetStore.lastRefreshes[dataset.id];
                    const enriched = storeRefresh
                      ? {
                          ...dataset,
                          last_refresh: {
                            status: storeRefresh.status ?? dataset.last_refresh?.status ?? 'success',
                            row_count: storeRefresh.row_count,
                            refreshed_at: storeRefresh.refreshed_at,
                            duration_ms: storeRefresh.duration_ms ?? 0,
                          },
                        }
                      : dataset;
                    return (
                      <tr
                        key={dataset.id}
                        onClick={() => router.push(`/dashboard/${dataset.id}`)}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/20"
                      >
                        <td className={`${TD_CLASS} font-medium text-gray-800 dark:text-gray-200 max-w-[220px] truncate`} title={enriched.name}>
                          {enriched.name}
                        </td>
                        <td className={TD_CLASS}>
                          <StatusBadge status={datasetStatus(enriched)} />
                        </td>
                        <td className={`${TD_CLASS} text-right tabular-nums text-gray-600 dark:text-gray-300`}>
                          {enriched.last_refresh ? formatNumber(enriched.last_refresh.row_count) : '—'}
                        </td>
                        <td className={`${TD_CLASS} text-gray-500 dark:text-gray-400 tabular-nums`}>
                          {enriched.last_refresh ? formatDatetime(enriched.last_refresh.refreshed_at) : 'Awaiting first run'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
