'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { RefreshCw, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { ExportButtons } from '@/components/export-buttons';
import { TableView } from '@/components/table-view';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { useQueryClient } from '@tanstack/react-query';
import {
  useDashboardData,
  useRefreshHistory,
  useTriggerRefresh,
  useCancelRefresh,
  useDatasets,
  dashboardKeys,
} from '@/hooks/useDashboard';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useDatasetStore } from '@/store/dataset.store';
import { subscribeToDataset, unsubscribeFromDataset, getCurrentSocket } from '@/lib/socket';
import { formatDatetimeFull, formatNumber } from '@/lib/utils';
import { RefreshHistoryTable } from '@/components/refresh-history-table';
import { useConditions } from '@/hooks/useConditions';

// SRC/DST Number Monitoring keeps an hourly rollup (many hour buckets of rows); its long "Tried DST
// areas" cell renders one-line + click-to-expand in the shared TableView, and the viewer defaults to
// showing SRC rows first. Its window/rows are chosen on the report; the Datasets viewer just shows the
// raw rollup + Refresh Now (which triggers the 5-min gap-fill ingestion).
const SRC_DST_STAGE = 'ds_src_dst_number_monitoring';

// Voice Live Traffic account values are "client / account". Show just the
// account (second) part in the account filter so long combined names don't
// overflow the dropdown — the stored/matched value is unchanged.
const accountShort = (v: string): string => {
  const i = v.indexOf(' / ');
  return i >= 0 ? v.slice(i + 3) : v;
};

export default function DatasetDashboardPage() {
  const params = useParams();
  const datasetId = params.datasetId as string;
  const canRefresh = useAuthStore((s) => s.canAccess('trigger_refresh'));
  const queryClient = useQueryClient();

  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<string | undefined>(undefined);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = React.useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = React.useState(false);
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Subscribe to real-time updates for this dataset
  const token = useAuthStore((s) => s.token);
  React.useEffect(() => {
    if (!token) return;
    subscribeToDataset(datasetId);
    return () => unsubscribeFromDataset(datasetId);
  }, [datasetId, token]);

  // Sync isRefreshing with backend WebSocket events — works for cron, manual, and other sessions
  React.useEffect(() => {
    const socket = getCurrentSocket();
    if (!socket) return;
    const onStarted = (event: { dataset_id: string }) => {
      if (event.dataset_id === datasetId) {
        setIsRefreshing(true);
        // The backend writes the 'running' dataset_refresh_log row before emitting this event, so
        // refetch now — otherwise the stats-bar status and the Refresh History table don't show the
        // running row until the refresh finishes.
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.datasets() });
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.history(datasetId) });
      }
    };
    const onDone = (event: { dataset_id: string }) => {
      if (event.dataset_id === datasetId) {
        setIsRefreshing(false);
        refreshGuard.current = false;
        // Refetch status/history/data now that the refresh has completed, so the
        // status badge and refresh history flip to success without a page reload.
        // (The mutation's fixed 2s-delay refetch fires while the refresh is still
        // running, so we tie the refetch to the completion event instead.)
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.datasets() });
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.history(datasetId) });
        void queryClient.invalidateQueries({ queryKey: [...dashboardKeys.all, 'data', datasetId] });
      }
    };
    socket.on('dataset:refresh_started', onStarted);
    socket.on('dataset:refreshed', onDone);
    socket.on('dataset:refresh_failed', onDone);
    return () => {
      socket.off('dataset:refresh_started', onStarted);
      socket.off('dataset:refreshed', onDone);
      socket.off('dataset:refresh_failed', onDone);
    };
  }, [datasetId, token, queryClient]);

  const tableParams = {
    page,
    limit: 50,
    sort,
    sortDir,
    ...(Object.fromEntries(
      Object.entries(columnFilters).filter(([, v]) => v.trim())
    ) as Record<string, string>),
  };

  const { data: tableData, isLoading: tableLoading } = useDashboardData(datasetId, tableParams);

  // Full-table distinct values for the per-column filter dropdowns, so they list
  // EVERY value (not just the current 50-row page) — same complete set the custom
  // report pages show. Memoised on datasetId; fetched lazily when a filter opens.
  const fetchDistinctValues = React.useCallback(
    (column: string) =>
      dashboardApi.getDistinctValues(datasetId, column).then((r) => r.data.values ?? []),
    [datasetId],
  );

  // Voice Live Traffic totals row — format the backend's call-weighted figures
  // exactly as the custom report footer does (int / 2-dp / percent). The backend
  // only returns `totals` for that dataset, so this is undefined elsewhere and no
  // footer renders.
  const voiceTotals = React.useMemo<Record<string, string> | undefined>(() => {
    const t = tableData?.totals;
    if (!t) return undefined;
    // A formatted number with a minus sign but no non-zero digit is a "-0" — never show the sign.
    const zz = (s: string) => (s.includes('-') && !/[1-9]/.test(s) ? s.replace('-', '') : s);
    const fmtInt = (n: number | null) => (n == null ? '—' : zz(Number(n).toLocaleString('en-US')));
    const fmtDec = (n: number | null) => (n == null ? '—' : zz(Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
    const fmtPct = (n: number | null) => (n == null ? '—' : zz(`${Number(n).toFixed(2)}%`));
    return {
      attempts: fmtInt(t.attempts),
      acd: fmtDec(t.acd),
      asr: fmtPct(t.asr),
      failed_calls: fmtInt(t.failed_calls),
      volume: fmtDec(t.volume),
      answered_calls: fmtInt(t.answered_calls),
    };
  }, [tableData?.totals]);

  const voiceTotalsLabel = tableData?.totals
    ? `Total (${(tableData?.total ?? 0).toLocaleString('en-US')} routes)`
    : undefined;
  const { data: historyData, isLoading: historyLoading } = useRefreshHistory(datasetId);
  const { data: datasetsAll } = useDatasets();
  const { data: conditions } = useConditions();
  const triggerRefresh = useTriggerRefresh();
  const cancelRefresh = useCancelRefresh();
  const refreshGuard = React.useRef(false);

  // Get dataset from store (has real-time refresh info)
  const storeDataset = useDatasetStore((s) => s.getDataset(datasetId));
  const dataset = storeDataset ?? datasetsAll?.find((d) => d.id === datasetId);

  const columns = dataset?.column_metadata ?? tableData?.dataset?.column_metadata ?? [];

  const isSrcDst = dataset?.stage_table_name === SRC_DST_STAGE;

  // Refresh Now — generic dataset refresh (for SRC/DST this triggers the gap-fill ingestion).
  // Reuses the shared isRefreshing/socket wiring (the 'dataset:refreshed' handler clears it + reloads).
  const handleRefreshNow = () => {
    if (!canRefresh || refreshGuard.current || isRefreshing) return;
    refreshGuard.current = true;
    setIsRefreshing(true);
    void triggerRefresh.mutateAsync(datasetId).catch(() => {
      setIsRefreshing(false);
      refreshGuard.current = false;
    });
  };

  // Initialize visible columns from metadata on first load
  React.useEffect(() => {
    if (columns.length > 0 && visibleColumnKeys.length === 0) {
      setVisibleColumnKeys(columns.filter((c) => c.visible !== false).map((c) => c.key));
    }
  }, [columns, visibleColumnKeys.length]);

  // Build export params from current view state
  const exportParams = React.useMemo(() => {
    const p: Record<string, string> = {};
    if (visibleColumnKeys.length > 0) p.columns = visibleColumnKeys.join(',');
    if (sort) { p.sort = sort; p.sortDir = sortDir.toUpperCase(); }
    for (const [k, v] of Object.entries(columnFilters)) { if (v) p[k] = v; }
    return p;
  }, [visibleColumnKeys, sort, sortDir, columnFilters]);

  // Conditions that matched in last refresh
  const matchedConditions = (conditions ?? []).filter(
    (c) => c.dataset_id === datasetId && c.last_triggered_at
  );

  const handleSort = (column: string) => {
    if (sort === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(column);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleFilterChange = (changes: Record<string, string>) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(changes)) {
        if (v === '') {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
      return next;
    });
    setPage(1);
  };

  const lastRefresh = dataset?.last_refresh;

  // SRC/DST: order SRC rows first by default (kind DESC → 'src' before 'dst'); both kinds stay
  // visible. Set once; the user can re-sort. (Not a filter, so nothing is hidden.)
  const sdnSortInit = React.useRef(false);
  React.useEffect(() => {
    if (!isSrcDst || sdnSortInit.current) return;
    sdnSortInit.current = true;
    setSort('kind');
    setSortDir('desc');
    setPage(1);
  }, [isSrcDst]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={dataset?.name ?? 'Dataset'}
        description={dataset?.description}
        actions={
          <>
            {canRefresh && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefreshNow}
                isLoading={triggerRefresh.isPending || isRefreshing}
                disabled={isRefreshing}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh Now
              </Button>
            )}
            {/* Voice Live Traffic refreshes in a few seconds, so its Cancel button is noise — hide it there only. */}
            {canRefresh && isRefreshing && dataset?.stage_table_name !== 'ds_voice_live_traffic' && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  void cancelRefresh.mutateAsync(datasetId).finally(() => {
                    setIsRefreshing(false);
                    refreshGuard.current = false;
                  });
                }}
                isLoading={cancelRefresh.isPending}
              >
                <XCircle className="h-4 w-4" />
                Cancel Refresh
              </Button>
            )}
            <ExportButtons datasetId={datasetId} exportParams={exportParams} />
          </>
        }
      />

      {/* Stats bar */}
      {lastRefresh && (
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
          <div>
            <span className="text-gray-500">Last refreshed:</span>{' '}
            <span className="text-gray-200">{formatDatetimeFull(lastRefresh.refreshed_at)}</span>
          </div>
          <div>
            <span className="text-gray-500">Rows:</span>{' '}
            <span className="text-gray-200 font-medium">{formatNumber(lastRefresh.row_count)}</span>
          </div>
          <div>
            <span className="text-gray-500">Duration:</span>{' '}
            <span className="text-gray-200">{lastRefresh.duration_ms}ms</span>
          </div>
          <StatusBadge status={lastRefresh.status} />
        </div>
      )}

      {/* Matched conditions panel */}
      {matchedConditions.length > 0 && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
          <h3 className="text-sm font-medium text-amber-300 mb-2">
            Conditions Matched in Last Refresh
          </h3>
          <div className="flex flex-wrap gap-2">
            {matchedConditions.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-full border border-amber-700 bg-amber-900/30 px-3 py-1 text-xs text-amber-200">
                <span className="font-medium">{c.name}</span>
                {(c as any).matched_count !== undefined && (
                  <Badge variant="amber">{(c as any).matched_count} rows</Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main content */}
      <TableView
        columns={columns}
        rows={tableData?.rows ?? []}
        total={tableData?.total ?? 0}
        page={page}
        limit={50}
        isLoading={tableLoading}
        sort={sort}
        sortDir={sortDir}
        onSort={handleSort}
        onPageChange={setPage}
        columnFilters={columnFilters}
        onFilterChange={handleFilterChange}
        visibleColumnKeys={visibleColumnKeys}
        onVisibleColumnsChange={setVisibleColumnKeys}
        fetchDistinctValues={fetchDistinctValues}
        expandableColumns={isSrcDst ? ['tried_dst_areas'] : undefined}
        formatFilterLabel={
          dataset?.stage_table_name === 'ds_voice_live_traffic'
            ? (colKey, value) => (colKey === 'account' ? accountShort(value) : value)
            : undefined
        }
        totals={voiceTotals}
        totalsLabel={voiceTotalsLabel}
      />

      {/* Refresh history toggle */}
      <div>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          {showHistory ? 'Hide' : 'Show'} Refresh History
        </button>
        {showHistory && (
          <div className="mt-3">
            <RefreshHistoryTable
              entries={historyData ?? []}
              isLoading={historyLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
