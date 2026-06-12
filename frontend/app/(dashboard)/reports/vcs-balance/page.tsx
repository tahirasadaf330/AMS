'use client';

import * as React from 'react';
import {
  AlertTriangle, CreditCard, Users, TrendingDown,
  RefreshCw, Search, Wifi,
} from 'lucide-react';
import { vcsBalanceApi } from '@/lib/api';

// ── Formatters ─────────────────────────────────────────────────
const fmtRev = (n: any) =>
  n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtPct = (n: any) => (n != null ? `${Number(n).toFixed(1)}%` : '—');

// ── Days cell ──────────────────────────────────────────────────
function DaysCell({ days }: { days: number | null }) {
  if (days == null)
    return <td className="px-4 py-3 text-center text-gray-600 text-sm">—</td>;

  const color =
    days <= 0 ? 'text-red-400 font-black animate-pulse'
    : days <= 2 ? 'text-red-400 font-bold'
    : days <= 7 ? 'text-amber-400 font-semibold'
    : days <= 30 ? 'text-yellow-300 font-medium'
    : 'text-emerald-400';

  const label = days <= 0 ? 'NOW' : `${days}d`;
  return (
    <td className="px-4 py-3 text-center">
      <span className={`text-sm tabular-nums ${color}`}>{label}</span>
    </td>
  );
}

// ── Remaining % badge ──────────────────────────────────────────
function RemainingBadge({ pct }: { pct: number | null }) {
  if (pct == null)
    return <span className="text-gray-600 text-sm">—</span>;

  const color =
    pct < 10 ? 'bg-red-500/20 text-red-400 ring-red-500/40'
    : pct < 20 ? 'bg-amber-500/20 text-amber-400 ring-amber-500/40'
    : pct < 50 ? 'bg-yellow-500/20 text-yellow-400 ring-yellow-500/40'
    : 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/40';

  const bar =
    pct < 10 ? 'bg-red-400'
    : pct < 20 ? 'bg-amber-400'
    : pct < 50 ? 'bg-yellow-400'
    : 'bg-emerald-400';

  return (
    <div className="flex flex-col gap-1 items-end">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${color}`}>
        {fmtPct(pct)}
      </span>
      <div className="w-16 h-1 rounded-full bg-gray-700/60 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ── Row stripe based on risk ───────────────────────────────────
function rowBg(pct: number | null): string {
  if (pct == null) return '';
  if (pct < 10) return 'bg-red-500/5 hover:bg-red-500/10';
  if (pct < 20) return 'bg-amber-500/5 hover:bg-amber-500/10';
  return 'hover:bg-indigo-500/5';
}

// ── KPI card ───────────────────────────────────────────────────
function KpiCard({ title, value, sub, accent = 'indigo', icon: Icon }: {
  title: string; value: string | number; sub?: string;
  accent?: 'indigo' | 'emerald' | 'amber' | 'rose'; icon?: React.ElementType;
}) {
  const a = {
    indigo:  { border: 'border-indigo-500/30', bg: 'from-indigo-500/15 to-indigo-500/5',   icon: 'text-indigo-400',  ring: 'bg-indigo-500/10'  },
    emerald: { border: 'border-emerald-500/30', bg: 'from-emerald-500/15 to-emerald-500/5', icon: 'text-emerald-400', ring: 'bg-emerald-500/10' },
    amber:   { border: 'border-amber-500/30',  bg: 'from-amber-500/15 to-amber-500/5',     icon: 'text-amber-400',   ring: 'bg-amber-500/10'   },
    rose:    { border: 'border-rose-500/30',   bg: 'from-rose-500/15 to-rose-500/5',       icon: 'text-rose-400',    ring: 'bg-rose-500/10'    },
  }[accent];
  return (
    <div className={`relative overflow-hidden rounded-2xl border ${a.border} bg-gradient-to-br ${a.bg} p-5`}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{title}</p>
        {Icon && <span className={`p-1.5 rounded-lg ${a.ring}`}><Icon className={`h-3.5 w-3.5 ${a.icon}`} /></span>}
      </div>
      <p className="text-2xl font-black text-white tracking-tight">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      <div className={`absolute -right-3 -bottom-3 h-14 w-14 rounded-full ${a.ring} blur-xl`} />
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="space-y-3 p-6 animate-pulse">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-gray-800/60" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

// ── Card wrapper ───────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-700/50 bg-gray-900/80 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────
function TH({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={`px-4 py-3 text-${align} text-xs font-semibold text-gray-500 uppercase tracking-widest whitespace-nowrap`}>
      {children}
    </th>
  );
}

// ══════════════════════════════════════════════════════════════
export default function VcsBalancePage() {
  const [data, setData]       = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch]   = React.useState('');
  const [lastLoaded, setLastLoaded] = React.useState<Date | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    vcsBalanceApi
      .getData()
      .then(r => {
        setData(r.data);
        setLastLoaded(new Date());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    if (!search.trim()) return data.rows;
    const q = search.toLowerCase();
    return data.rows.filter((r: any) =>
      (r.company_name ?? '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const s = data?.summary;

  return (
    <div className="min-h-screen bg-[#080d14] text-gray-100 p-4 md:p-6 space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-emerald-500/20 ring-1 ring-emerald-500/30">
            <CreditCard className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Client Balances</h1>
            {lastLoaded && (
              <p className="text-xs text-gray-600 flex items-center gap-1 mt-0.5">
                <Wifi className="h-3 w-3" /> Live from VCS · loaded {lastLoaded.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-800 border border-gray-700/60 text-gray-300 text-sm hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Critical alert banner */}
      {s?.clientsCritical > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-300">
            <span className="font-bold">{s.clientsCritical} client{s.clientsCritical > 1 ? 's' : ''}</span> at critical credit level — less than 10% remaining.
          </p>
        </div>
      )}

      {/* KPI cards */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            title="Total Clients"
            value={s.totalClients}
            sub="active with credit"
            accent="indigo"
            icon={Users}
          />
          <KpiCard
            title="Total Credit Limit"
            value={fmtRev(s.totalCreditLimit)}
            sub={`Used: ${fmtRev(s.totalUsed)}`}
            accent="emerald"
            icon={CreditCard}
          />
          <KpiCard
            title="Clients at Risk"
            value={s.clientsAtRisk}
            sub="< 20% remaining"
            accent={s.clientsAtRisk > 0 ? 'amber' : 'emerald'}
            icon={AlertTriangle}
          />
          <KpiCard
            title="Critical"
            value={s.clientsCritical}
            sub="< 10% remaining"
            accent={s.clientsCritical > 0 ? 'rose' : 'emerald'}
            icon={TrendingDown}
          />
        </div>
      )}

      {/* Search + table */}
      <Card className="overflow-hidden shadow-xl">
        {/* Table header bar */}
        <div className="px-5 py-4 border-b border-gray-700/50 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Credit Monitor</h3>
            <p className="text-xs text-gray-500 mt-0.5">Sorted by remaining balance — lowest first</p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search company..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 pl-9 pr-4 rounded-xl border border-gray-700/60 bg-gray-800/80 text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all w-52"
            />
          </div>
        </div>

        {loading ? (
          <Skeleton />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700/50 bg-gray-800/30">
                  <TH>Company</TH>
                  <TH align="right">Credit Limit</TH>
                  <TH align="right">Used</TH>
                  <TH align="right">Remaining</TH>
                  <TH align="right">Remaining %</TH>
                  <TH align="right">Yesterday</TH>
                  <TH align="right">3-Day Avg</TH>
                  <TH align="center">Days Left</TH>
                  <TH>Currency</TH>
                  <TH>Payment Term</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-gray-600 text-sm">
                      {search ? 'No matching clients' : 'No data'}
                    </td>
                  </tr>
                )}
                {rows.map((r: any) => (
                  <tr
                    key={r.clients_id}
                    className={`transition-colors ${rowBg(r.remaining_balance_pct)}`}
                  >
                    {/* Company */}
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-100">{r.company_name}</p>
                        {r.c_email_billing && (
                          <p className="text-xs text-gray-600 truncate max-w-[200px]">{r.c_email_billing}</p>
                        )}
                      </div>
                    </td>
                    {/* Credit Limit */}
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-300">
                      {fmtRev(r.credit_limit)}
                    </td>
                    {/* Used */}
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-400">
                      {fmtRev(r.used)}
                    </td>
                    {/* Remaining */}
                    <td className={`px-4 py-3 text-right text-sm tabular-nums font-semibold ${
                      r.remaining_balance < 0 ? 'text-red-400' :
                      r.remaining_balance_pct < 20 ? 'text-amber-300' : 'text-emerald-400'
                    }`}>
                      {fmtRev(r.remaining_balance)}
                    </td>
                    {/* Remaining % with inline bar */}
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <RemainingBadge pct={r.remaining_balance_pct} />
                      </div>
                    </td>
                    {/* Yesterday */}
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-300">
                      {r.yesterday_amount != null ? fmtRev(r.yesterday_amount) : <span className="text-gray-600">—</span>}
                    </td>
                    {/* 3-Day Avg */}
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-gray-300">
                      {r.avg_amount_last_3_days != null ? fmtRev(r.avg_amount_last_3_days) : <span className="text-gray-600">—</span>}
                    </td>
                    {/* Days Until Zero */}
                    <DaysCell days={r.days_until_zero} />
                    {/* Currency */}
                    <td className="px-4 py-3 text-sm text-gray-500">{r.currency_name ?? '—'}</td>
                    {/* Payment Term */}
                    <td className="px-4 py-3 text-sm text-gray-500">{r.payment_term ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer with legend */}
        {!loading && rows.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-800/50 flex flex-wrap items-center gap-5">
            <span className="text-xs text-gray-600">Colour key:</span>
            {[
              { color: 'bg-red-500/30', label: '< 10% — Critical' },
              { color: 'bg-amber-500/30', label: '10–20% — At risk' },
              { color: 'bg-yellow-500/30', label: '20–50% — Watch' },
              { color: 'bg-emerald-500/30', label: '> 50% — Healthy' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={`h-2.5 w-2.5 rounded-sm ${item.color}`} />
                {item.label}
              </div>
            ))}
            <span className="ml-auto text-xs text-gray-600">{rows.length} clients shown</span>
          </div>
        )}
      </Card>
    </div>
  );
}
