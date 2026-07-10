'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { appleTrafficApi } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────

interface LiveRow {
  terminated_msisdn: string | null;
  terminated_sender_id: string | null;
  mcc_mnc: string | null;
  submit_datetime: string | null;
}

interface HistRow {
  bucket: string | null;
  mcc_mnc: string | null;
  terminated_sender_id: string | null;
  msg_count: number;
  unique_msisdn: number;
}

// Keys arrive snake_cased by the backend's global SnakeCaseInterceptor.
interface ApiData {
  live: LiveRow[];
  hist: HistRow[];
  live_refreshed_at: string | null;
  hist_refreshed_at: string | null;
}

type SortDir = 'asc' | 'desc';
type TableCol = 'key' | 'current' | 'histAvg' | 'ratio';

interface BreakdownRow { key: string; current: number; histAvg: number; ratio: number | null; }

const PAGE_SIZE = 10;

// ── Helpers ────────────────────────────────────────────────────

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtBucket(bucket: string | null) {
  if (!bucket) return '';
  const d = new Date(bucket);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function ratioColor(ratio: number | null): string {
  if (ratio === null) return 'text-gray-400';
  if (ratio >= 90) return 'text-green-500';
  if (ratio >= 60) return 'text-amber-500';
  return 'text-red-500';
}

function ratioBg(ratio: number | null): string {
  if (ratio === null) return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
  if (ratio >= 90) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  if (ratio >= 60) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

function sortRows(rows: BreakdownRow[], col: TableCol, dir: SortDir): BreakdownRow[] {
  return [...rows].sort((a, b) => {
    let av: number | string = col === 'key' ? a.key : col === 'current' ? a.current : col === 'histAvg' ? a.histAvg : (a.ratio ?? -1);
    let bv: number | string = col === 'key' ? b.key : col === 'current' ? b.current : col === 'histAvg' ? b.histAvg : (b.ratio ?? -1);
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
}

// ── Sub-components ─────────────────────────────────────────────

function SortIcon({ col, active, dir }: { col: TableCol; active: TableCol; dir: SortDir }) {
  if (col !== active) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-30" />;
  return dir === 'asc'
    ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-blue-500" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5 text-blue-500" />;
}

function BreakdownTable({
  title, rows, labelHeader,
}: {
  title: string;
  rows: BreakdownRow[];
  labelHeader: string;
}) {
  const [sortCol, setSortCol] = useState<TableCol>('histAvg');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => sortRows(rows, sortCol, sortDir), [rows, sortCol, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(col: TableCol) {
    if (col === sortCol) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(0);
  }

  const thClass = 'py-2 pr-3 font-semibold cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap';

  return (
    <div className="bg-white dark:bg-[#22303f] rounded-xl border border-[#e4e9ec] dark:border-[#2f4151] p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{rows.length} entries</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
              <th className={`${thClass} text-left`} onClick={() => handleSort('key')}>
                {labelHeader}<SortIcon col="key" active={sortCol} dir={sortDir} />
              </th>
              <th className={`${thClass} text-right`} onClick={() => handleSort('current')}>
                Current<SortIcon col="current" active={sortCol} dir={sortDir} />
              </th>
              <th className={`${thClass} text-right`} onClick={() => handleSort('histAvg')}>
                5d Avg<SortIcon col="histAvg" active={sortCol} dir={sortDir} />
              </th>
              <th className={`${thClass} text-right pr-0`} onClick={() => handleSort('ratio')}>
                vs Avg<SortIcon col="ratio" active={sortCol} dir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {pageRows.length === 0 ? (
              <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-xs">No data</td></tr>
            ) : pageRows.map((r) => (
              <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-200 font-mono text-xs truncate max-w-[160px]">{r.key}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{r.current.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{r.histAvg.toLocaleString()}</td>
                <td className="py-1.5 text-right">
                  {r.ratio !== null ? (
                    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${ratioBg(r.ratio)}`}>
                      {r.ratio}%
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 px-1">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-500 dark:text-gray-400"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function AppleTrafficPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      appleTrafficApi.getData()
        .then((r) => { if (!cancelled) { setData(r.data); setLoading(false); } })
        .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Derived ─────────────────────────────────────────────────

  const liveCount = data?.live.length ?? 0;

  const bucketTotals = useMemo(() => {
    if (!data?.hist.length) return [];
    const map = new Map<string, number>();
    for (const row of data.hist) {
      if (!row.bucket) continue;
      map.set(row.bucket, (map.get(row.bucket) ?? 0) + row.msg_count);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, msg_count]) => ({ bucket, msg_count }));
  }, [data]);

  const avgPerBucket = useMemo(() => {
    if (!bucketTotals.length) return null;
    return bucketTotals.reduce((s, r) => s + r.msg_count, 0) / bucketTotals.length;
  }, [bucketTotals]);

  const ratio = avgPerBucket && avgPerBucket > 0
    ? Math.round((liveCount / avgPerBucket) * 100) : null;

  const byMccMnc = useMemo((): BreakdownRow[] => {
    if (!data) return [];
    const liveMap = new Map<string, number>();
    for (const r of data.live) {
      const k = r.mcc_mnc ?? '(unknown)';
      liveMap.set(k, (liveMap.get(k) ?? 0) + 1);
    }
    const histBuckets = new Map<string, Map<string, number>>();
    for (const r of data.hist) {
      if (!r.bucket) continue;
      const k = r.mcc_mnc ?? '(unknown)';
      if (!histBuckets.has(k)) histBuckets.set(k, new Map());
      const bmap = histBuckets.get(k)!;
      bmap.set(r.bucket, (bmap.get(r.bucket) ?? 0) + r.msg_count);
    }
    const keys = new Set([...Array.from(liveMap.keys()), ...Array.from(histBuckets.keys())]);
    return Array.from(keys).map((k) => {
      const buckets = histBuckets.get(k);
      const histAvg = buckets && buckets.size
        ? Array.from(buckets.values()).reduce((s, v) => s + v, 0) / buckets.size : 0;
      const curr = liveMap.get(k) ?? 0;
      return { key: k, current: curr, histAvg: Math.round(histAvg), ratio: histAvg > 0 ? Math.round((curr / histAvg) * 100) : null };
    });
  }, [data]);

  const bySender = useMemo((): BreakdownRow[] => {
    if (!data) return [];
    const liveMap = new Map<string, number>();
    for (const r of data.live) {
      const k = r.terminated_sender_id ?? '(unknown)';
      liveMap.set(k, (liveMap.get(k) ?? 0) + 1);
    }
    const histBuckets = new Map<string, Map<string, number>>();
    for (const r of data.hist) {
      if (!r.bucket) continue;
      const k = r.terminated_sender_id ?? '(unknown)';
      if (!histBuckets.has(k)) histBuckets.set(k, new Map());
      const bmap = histBuckets.get(k)!;
      bmap.set(r.bucket, (bmap.get(r.bucket) ?? 0) + r.msg_count);
    }
    const keys = new Set([...Array.from(liveMap.keys()), ...Array.from(histBuckets.keys())]);
    return Array.from(keys).map((k) => {
      const buckets = histBuckets.get(k);
      const histAvg = buckets && buckets.size
        ? Array.from(buckets.values()).reduce((s, v) => s + v, 0) / buckets.size : 0;
      const curr = liveMap.get(k) ?? 0;
      return { key: k, current: curr, histAvg: Math.round(histAvg), ratio: histAvg > 0 ? Math.round((curr / histAvg) * 100) : null };
    });
  }, [data]);

  const chartData = useMemo(() => bucketTotals.map((r) => ({
    label: fmtBucket(r.bucket),
    hist: r.msg_count,
  })), [bucketTotals]);

  // ── Render ───────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">Loading Apple Traffic…</div>;
  }
  if (error) {
    return <div className="flex items-center justify-center h-64 text-red-500">Error: {error}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Apple Traffic</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Live 5-min window vs 5-day historical average
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-400">Live</span>
            <span className="text-xs text-green-700 dark:text-green-300 tabular-nums font-medium">
              {fmtTs(data?.live_refreshed_at)}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Historical</span>
            <span className="text-xs text-blue-700 dark:text-blue-300 tabular-nums font-medium">
              {fmtTs(data?.hist_refreshed_at)}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#22303f] rounded-xl border border-[#e4e9ec] dark:border-[#2f4151] p-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Current (last 5 min)</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{liveCount.toLocaleString()}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">messages</p>
        </div>
        <div className="bg-white dark:bg-[#22303f] rounded-xl border border-[#e4e9ec] dark:border-[#2f4151] p-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">5-Day Avg per 5-min</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {avgPerBucket !== null ? Math.round(avgPerBucket).toLocaleString() : '—'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">messages</p>
        </div>
        <div className="bg-white dark:bg-[#22303f] rounded-xl border border-[#e4e9ec] dark:border-[#2f4151] p-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">vs Historical Avg</p>
          <p className={`text-3xl font-bold ${ratioColor(ratio)}`}>
            {ratio !== null ? `${ratio}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {ratio === null ? 'no historical data' : ratio >= 90 ? 'on track' : ratio >= 60 ? 'below average' : 'significantly below'}
          </p>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="bg-white dark:bg-[#22303f] rounded-xl border border-[#e4e9ec] dark:border-[#2f4151] p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          5-Day Historical Volume (5-min buckets)
        </h2>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
            No historical data yet — stage table refreshes every 2 hours
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 4, right: 48, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={Math.floor(chartData.length / 10)} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={48} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: '#1f2937', border: '1px solid #374151', color: '#f9fafb' }}
                labelStyle={{ color: '#d1d5db' }}
                itemStyle={{ color: '#93c5fd' }}
                formatter={(v: number) => [v.toLocaleString(), 'Messages']}
              />
              {liveCount > 0 && (
                <ReferenceLine
                  y={liveCount}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: `Now: ${liveCount}`, fill: '#f59e0b', fontSize: 11, position: 'insideTopRight' }}
                />
              )}
              <Area type="monotone" dataKey="hist" stroke="#3b82f6" strokeWidth={1.5} fill="url(#histGrad)" dot={false} name="Historical" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BreakdownTable title="By MCC-MNC" rows={byMccMnc} labelHeader="MCC-MNC" />
        <BreakdownTable title="By Sender ID" rows={bySender} labelHeader="Sender ID" />
      </div>
    </div>
  );
}
