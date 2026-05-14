'use client';

import * as React from 'react';
import {
  Database,
  RefreshCw,
  GitBranch,
  Bell,
  XCircle,
} from 'lucide-react';
import { KpiCard } from '@/components/kpi-card';
import { DatasetHealthCard } from '@/components/dataset-health-card';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/status-badge';
import { useDatasets } from '@/hooks/useDashboard';
import { useConditions } from '@/hooks/useConditions';
import { useNotificationLog } from '@/hooks/useNotifications';
import { useDatasetStore } from '@/store/dataset.store';
import { formatDatetime } from '@/lib/utils';
import { SkeletonCard } from '@/components/ui/skeleton';

export default function OverviewPage() {
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

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent activity feed */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-700 bg-gray-800">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-200">Recent Notifications</h2>
              <Badge variant="default">{recentNotifs.length}</Badge>
            </div>
            <div className="divide-y divide-gray-700/50">
              {notifLoading && (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <SkeletonCard key={i} className="h-12 bg-gray-700/30" />
                  ))}
                </div>
              )}
              {!notifLoading && recentNotifs.length === 0 && (
                <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                  No notifications today
                </div>
              )}
              {recentNotifs.map((log) => (
                <div key={log.id} className="flex items-start justify-between px-5 py-3 hover:bg-gray-700/20">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-200 truncate">
                        {log.condition_name}
                      </p>
                      <Badge variant={log.channel === 'email' ? 'blue' : 'purple'} className="text-xs">
                        {log.channel}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{log.dataset_name}</span>
                      <span>·</span>
                      <span>{log.matched_rows} rows</span>
                      <span>·</span>
                      <span>{formatDatetime(log.triggered_at)}</span>
                    </div>
                  </div>
                  <StatusBadge status={log.status} className="flex-shrink-0 ml-3" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Dataset health strip */}
        <div>
          <div className="rounded-lg border border-gray-700 bg-gray-800">
            <div className="px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-200">Dataset Health</h2>
            </div>
            <div className="p-3 space-y-2">
              {datasetsLoading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonCard key={i} className="h-24" />
                ))}
              {!datasetsLoading && (datasets ?? []).length === 0 && (
                <p className="text-center py-8 text-gray-500 text-sm">No datasets available</p>
              )}
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
                return <DatasetHealthCard key={dataset.id} dataset={enriched} />;
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
