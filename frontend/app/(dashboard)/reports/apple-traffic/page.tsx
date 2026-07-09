'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
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

interface ApiData {
  live: LiveRow[];
  hist: HistRow[];
  liveRefreshedAt: string | null;
  histRefreshedAt: string | null;
}

// ── Helpers ────────────────────────────────────────────────────

function fmtTs(ts: string | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
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

// ── Component ─────────────────────────────────────────────────

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

  // All unique 5-min buckets aggregated across all MccMnc/SenderID combos
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
    const sum = bucketTotals.reduce((s, r) => s + r.msg_count, 0);
    return sum / bucketTotals.length;
  }, [bucketTotals]);

  const ratio = avgPerBucket && avgPerBucket > 0
    ? Math.round((liveCount / avgPerBucket) * 100)
    : null;

  // By MccMnc breakdown
  const byMccMnc = useMemo(() => {
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

    const keys = new Set([...liveMap.keys(), ...histBuckets.keys()]);
    const rows = Array.from(keys).map((k) => {
      const buckets = histBuckets.get(k);
      const histAvg = buckets && buckets.size
        ? Array.from(buckets.values()).reduce((s, v) => s + v, 0) / buckets.size
        : 0;
      const curr = liveMap.get(k) ?? 0;
      const r = histAvg > 0 ? Math.round((curr / histAvg) * 100) : null;
      return { key: k, current: curr, histAvg: Math.round(histAvg), ratio: r };
    });

    return rows.sort((a, b) => b.histAvg - a.histAvg).slice(0, 20);
  }, [data]);

  // By SenderID breakdown
  const bySender = useMemo(() => {
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

    const keys = new Set([...liveMap.keys(), ...histBuckets.keys()]);
    const rows = Array.from(keys).map((k) => {
      const buckets = histBuckets.get(k);
      const histAvg = buckets && buckets.size
        ? Array.from(buckets.values()).reduce((s, v) => s + v, 0) / buckets.size
        : 0;
      const curr = liveMap.get(k) ?? 0;
      const r = histAvg > 0 ? Math.round((curr / histAvg) * 100) : null;
      return { key: k, current: curr, histAvg: Math.round(histAvg), ratio: r };
    });

    return rows.sort((a, b) => b.histAvg - a.histAvg).slice(0, 20);
  }, [data]);

  // Trend chart data with reference line for live count
  const chartData = useMemo(() => bucketTotals.map((r) => ({
    label: fmtBucket(r.bucket),
    hist: r.msg_count,
  })), [bucketTotals]);

  // ── Render ───────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        Loading Apple Traffic…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Apple Traffic</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Live 5-min window vs 5-day historical average
          </p>
        </div>
        <div className="text-right text-xs text-gray-400 dark:text-gray-500 space-y-0.5">
          <div>Live refreshed: {fmtTs(data?.liveRefreshedAt ?? null)}</div>
          <div>Hist refreshed: {fmtTs(data?.histRefreshedAt ?? null)}</div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Current (last 5 min)</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{liveCount.toLocaleString()}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">messages</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">5-Day Avg per 5-min</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {avgPerBucket !== null ? Math.round(avgPerBucket).toLocaleString() : '—'}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">messages</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
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
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          5-Day Historical Volume (5-min buckets)
        </h2>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-500 text-sm">
            No historical data yet — stage table refreshes every 2 hours
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="histGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                interval={Math.floor(chartData.length / 10)}
              />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={48} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: number) => [v.toLocaleString(), 'Messages']}
              />
              {liveCount > 0 && (
                <ReferenceLine
                  y={liveCount}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  label={{ value: `Now: ${liveCount}`, fill: '#f59e0b', fontSize: 11, position: 'right' }}
                />
              )}
              <Area
                type="monotone"
                dataKey="hist"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#histGrad)"
                dot={false}
                name="Historical"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Breakdown Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By MCC-MNC */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">By MCC-MNC</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-1.5 pr-3 font-semibold">MCC-MNC</th>
                  <th className="text-right py-1.5 pr-3 font-semibold tabular-nums">Current</th>
                  <th className="text-right py-1.5 pr-3 font-semibold tabular-nums">5d Avg</th>
                  <th className="text-right py-1.5 font-semibold">vs Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {byMccMnc.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-xs">No data</td></tr>
                ) : byMccMnc.map((r) => (
                  <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-200 font-mono text-xs">{r.key}</td>
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
        </div>

        {/* By Sender ID */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">By Sender ID</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left py-1.5 pr-3 font-semibold">Sender ID</th>
                  <th className="text-right py-1.5 pr-3 font-semibold tabular-nums">Current</th>
                  <th className="text-right py-1.5 pr-3 font-semibold tabular-nums">5d Avg</th>
                  <th className="text-right py-1.5 font-semibold">vs Avg</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {bySender.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-gray-400 text-xs">No data</td></tr>
                ) : bySender.map((r) => (
                  <tr key={r.key} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-200 font-mono text-xs truncate max-w-[140px]">{r.key}</td>
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
        </div>
      </div>
    </div>
  );
}
