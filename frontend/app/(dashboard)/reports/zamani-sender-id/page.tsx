'use client';

import * as React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { zamaniSenderIdApi } from '@/lib/api';

// ──────────────────────────────────────────────────────────────────────────────
// Styles (matches the MT EDR Monitoring report)
// ──────────────────────────────────────────────────────────────────────────────
const CSS = `
.edr{
  --sf:#ffffff;--sf2:#f5f7f8;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  --delivered:#16a34a;--delivered-bg:rgba(22,163,74,.10);--delivered-bd:rgba(22,163,74,.28);
  --accepted:#2563eb;
  --pending:#d97706;--pending-bg:rgba(217,119,6,.10);--pending-bd:rgba(217,119,6,.28);
  --rejected:#dc2626;--rejected-bg:rgba(220,38,38,.10);--rejected-bd:rgba(220,38,38,.28);
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --warn:#ea580c;--warn-bg:rgba(234,88,12,.07);--warn-bd:rgba(234,88,12,.25);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:var(--ink);
}
.dark .edr{
  --sf:#22303f;--sf2:#1d2a37;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
  --delivered-bg:rgba(22,163,74,.14);--delivered-bd:rgba(22,163,74,.35);
  --pending-bg:rgba(217,119,6,.14);--pending-bd:rgba(217,119,6,.35);
  --rejected-bg:rgba(220,38,38,.14);--rejected-bd:rgba(220,38,38,.35);
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
  --warn-bg:rgba(234,88,12,.12);--warn-bd:rgba(234,88,12,.35);
}
.edr-body{max-width:1600px;margin:0 auto;padding:22px 20px 48px}
.edr-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.edr-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.edr-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.edr-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:edr-blink 2s infinite}
@keyframes edr-blink{0%,100%{opacity:1}50%{opacity:.3}}
.edr-lu{text-align:right}
.edr-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.edr-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.edr-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:640px){.edr-cards{grid-template-columns:repeat(2,1fr)}}
.edr-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.edr-card-danger{border-color:var(--danger-bd);background:var(--danger-bg)}
.edr-card-good{border-color:var(--delivered-bd);background:var(--delivered-bg)}
.edr-card-num{font-size:1.55rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;color:var(--ink);margin-bottom:4px}
.edr-card-danger .edr-card-num{color:var(--danger)}
.edr-card-good .edr-card-num{color:var(--delivered)}
.edr-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.edr-card-sub{font-size:.62rem;color:var(--mu);margin-top:3px}
.edr-alerts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.edr-al-neg{font-size:.74rem;font-weight:600;padding:5px 12px;border-radius:6px;background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger)}
.edr-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.edr-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.edr-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:190px;color-scheme:light}
.dark .edr-inp{color-scheme:dark}
.edr-inp:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.edr-tbtn{height:33px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.78rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:border-color .12s}
.edr-tbtn:hover{border-color:#94a3b8}
.edr-tbtn.an{background:var(--danger-bg);border-color:var(--danger-bd);color:var(--danger);font-weight:700}
.edr-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}
.edr-seg{display:inline-flex;border:1px solid var(--lns);border-radius:7px;overflow:hidden}
.edr-seg button{height:33px;padding:0 14px;border:0;background:var(--sf);color:var(--inks);font-size:.78rem;font-weight:600;cursor:pointer}
.edr-seg button.on{background:#2563eb;color:#fff}
.edr-tbl-wrap{overflow:auto;max-height:calc(100vh - 320px);min-height:260px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.edr-tbl{width:100%;border-collapse:collapse;font-size:.79rem;min-width:900px}
.edr-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.edr-tbl th{padding:9px 10px;text-align:right;font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);white-space:nowrap;user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1}
.edr-tbl th.l{text-align:left}
.edr-tbl th:hover{color:var(--ink)}
.edr-tbl th.active{color:#2563eb}
.edr-tbl td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums}
.edr-tbl td.l{text-align:left}
.edr-tbl td.mono{font-family:'Courier New',monospace;font-size:.75rem}
.edr-tbl tbody tr:hover td{background:rgba(37,99,235,.03)}
.edr-tbl tbody tr.rn td{background:rgba(220,38,38,.05)}
.edr-tbl tbody tr.rn:hover td{background:rgba(220,38,38,.09)}
.edr-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.bdg{display:inline-block;font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase}
.bdg-neg{background:var(--rejected-bg);color:var(--rejected);border:1px solid var(--rejected-bd)}
.bdg-none{background:var(--sf2);color:var(--mu);border:1px solid var(--lns)}
.bdg-spike{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-bd)}
.bdg-new{background:var(--delivered-bg);color:var(--delivered);border:1px solid var(--delivered-bd)}
.age-chip{margin-left:5px;font-size:10px;color:var(--mu);font-variant-numeric:tabular-nums}
.dlr-good{color:var(--delivered);font-weight:700}
.dlr-ok{color:var(--pending);font-weight:700}
.dlr-bad{color:var(--rejected);font-weight:700}
.edr-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.edr-skel{padding:18px;display:flex;flex-direction:column;gap:9px}
.edr-skel-bar{height:38px;border-radius:6px;background:linear-gradient(90deg,var(--sf2) 25%,var(--sf) 50%,var(--sf2) 75%);background-size:200% 100%;animation:edr-sh 1.4s infinite}
@keyframes edr-sh{from{background-position:200% 0}to{background-position:-200% 0}}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

type SortDir = 'asc' | 'desc' | null;
type Totals = { submitted: number; delivered: number; dlr_pct: number; misrouted: number; senders: number; aggregators: number };
type Sender = { sender_id: string; aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; dlr_pct: number; last_seen: string; is_new: boolean; is_spike: boolean; is_stopped: boolean; is_low_delivery: boolean; appeared_min: number | null; idle_min: number | null; out_of_window?: boolean };

// Compact "how long ago" label for the status freshness chip: 8m, 26m, 1h20m, 3h.
function ageLabel(min: number | null): string {
  if (min == null || !isFinite(min)) return '';
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${r}m` : `${h}h`;
}
type Agg = { aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; senders: number; dlr_pct: number };
type Route = { sender_id: string; aggregator: string; vendor: string; vendor_id: number; msgs: number };
type Pair = { sender_id: string; aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; dlr_pct: number; last_seen: string };
type Data = { totals: Totals; senders: Sender[]; aggregators: Agg[]; senderCustomer: Pair[]; routing: Route[]; trend: any[] };

// Distinct line colors for the trend chart (categorical; assigned in fixed order, never cycled
// per-render). Vibrant mid-tones ordered for adjacent-pair separation — legible on both themes.
const SERIES_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#eab308'];
// Shared axis / tooltip styling, matching the Zamani Traffic report's charts.
const TIP = { contentStyle: { background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--mu)' } };
const AX = { tick: { fontSize: 10, fill: 'var(--mu)' }, axisLine: false, tickLine: false } as const;

const fmtN = (n: number | null) => (n != null ? Number(n).toLocaleString() : '—');
const dlrCls = (p: number) => (p >= 80 ? 'dlr-good' : p >= 50 ? 'dlr-ok' : 'dlr-bad');

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
type Preset = '1h' | '6h' | '24h' | '48h' | 'custom';
const PRESET_MS: Record<'1h' | '6h' | '24h' | '48h', number> = { '1h': 3_600_000, '6h': 6 * 3_600_000, '24h': 24 * 3_600_000, '48h': 48 * 3_600_000 };
const PRESET_LABEL: Record<Exclude<Preset, 'custom'>, string> = { '1h': '1h', '6h': '6h', '24h': '24h', '48h': '48h' };
function presetWindow(p: Exclude<Preset, 'custom'>) {
  const end = new Date();
  const start = new Date(end.getTime() - PRESET_MS[p]);
  return { start, end };
}

function Skel() {
  return <div className="edr-skel">{Array.from({ length: 8 }, (_, i) => <div key={i} className="edr-skel-bar" style={{ opacity: 1 - i * 0.09 }} />)}</div>;
}

function TH({ children, left, w, colKey, sort, onSort }: { children: React.ReactNode; left?: boolean; w?: number; colKey: string; sort: { key: string | null; dir: SortDir }; onSort: (k: string) => void }) {
  const active = sort.key === colKey;
  const cls = [left ? 'l' : '', active ? 'active' : ''].filter(Boolean).join(' ');
  return (
    <th className={cls || undefined} style={{ width: w, minWidth: w ?? 60 }} onClick={() => onSort(colKey)}>
      {children}<span className="sa">{active ? (sort.dir === 'asc' ? '▲' : sort.dir === 'desc' ? '▼' : '⇅') : '⇅'}</span>
    </th>
  );
}
function TD({ children, left, mono }: { children: React.ReactNode; left?: boolean; mono?: boolean }) {
  const cls = [left ? 'l' : '', mono ? 'mono' : ''].filter(Boolean).join(' ');
  return <td className={cls || undefined}>{children}</td>;
}

function computeWindowISO(preset: Preset, customFrom: string, customTo: string): { fromISO?: string; toISO?: string } {
  if (preset === 'custom') return { fromISO: customFrom ? new Date(customFrom).toISOString() : undefined, toISO: customTo ? new Date(customTo).toISOString() : undefined };
  const { start, end } = presetWindow(preset);
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
}

// Compact searchable multi-select dropdown (used to pick which customers / sender IDs to plot).
function MultiSelect({ options, selected, onChange, placeholder }: { options: string[]; selected: string[]; onChange: (s: string[]) => void; placeholder: string }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="edr-tbtn" onClick={() => setOpen((v) => !v)} title="Pick which series to plot (max 12)">
        {selected.length ? `${selected.length} selected` : placeholder} ▾
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, marginTop: 4, width: 270, maxHeight: 320, overflow: 'auto', background: 'var(--sf)', border: '1px solid var(--lns)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.18)', padding: 8 }}>
          <input className="edr-inp" style={{ width: '100%', marginBottom: 6 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: '.68rem', color: 'var(--mu)' }}>{selected.length ? `${selected.length} selected` : 'None → top 12 by volume'}</span>
            {selected.length > 0 && <button className="edr-clr" style={{ height: 24, padding: '0 8px' }} onClick={() => onChange([])}>Clear</button>}
          </div>
          {filtered.map((o) => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 4px', fontSize: '.78rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o}</span>
            </label>
          ))}
          {filtered.length === 0 && <div style={{ fontSize: '.75rem', color: 'var(--mu)', padding: 6 }}>No matches</div>}
        </div>
      )}
    </div>
  );
}

// Line chart: Messages or DLR % over time, split by customer or sender ID, at hour/day/week/month
// granularity, for a selectable set of series. Fetches its own time-series independent of the table.
function TrendChart({ senders, aggregators, preset, customFrom, customTo, reloadKey }: {
  senders: Sender[]; aggregators: Agg[]; preset: Preset; customFrom: string; customTo: string; reloadKey?: number;
}) {
  const [metric, setMetric] = React.useState<'messages' | 'dlr'>('messages');
  const [dim, setDim] = React.useState<'customer' | 'sender'>('customer');
  const [gran, setGran] = React.useState<'hour' | 'day' | 'week' | 'month'>('day');
  const [keys, setKeys] = React.useState<string[]>([]);
  const [chartSearch, setChartSearch] = React.useState('');
  const [ts, setTs] = React.useState<{ buckets: string[]; keys: string[]; points: any[] } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const options = React.useMemo(
    () => (dim === 'customer'
      ? Array.from(new Set(aggregators.map((a) => a.aggregator).filter(Boolean)))
      : Array.from(new Set(senders.map((s) => s.sender_id).filter(Boolean)))).sort((a, b) => a.localeCompare(b)),
    [dim, aggregators, senders],
  );
  // Switching dimension: drop any picked keys that don't exist in the new option set.
  React.useEffect(() => { setKeys((k) => k.filter((x) => options.includes(x))); }, [dim]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const { fromISO, toISO } = computeWindowISO(preset, customFrom, customTo);
    setLoading(true); setErr(null);
    zamaniSenderIdApi.getTimeseries({ from: fromISO, to: toISO, dimension: dim, granularity: gran, keys })
      .then((r) => setTs(r.data as any))
      .catch((e: any) => setErr(e?.response?.data?.message ?? e?.message ?? 'Failed to load chart'))
      .finally(() => setLoading(false));
  }, [dim, gran, keys, preset, customFrom, customTo, reloadKey]);

  const seriesKeys = ts?.keys ?? [];
  // Live text filter on the plotted series — mirrors the table's "Search sender / customer" box.
  const visibleKeys = React.useMemo(
    () => chartSearch.trim()
      ? seriesKeys.filter((k) => k.toLowerCase().includes(chartSearch.trim().toLowerCase()))
      : seriesKeys,
    [seriesKeys, chartSearch],
  );
  const chartData = React.useMemo(() => {
    if (!ts) return [];
    const byBucket = new Map<string, any>();
    for (const b of ts.buckets) byBucket.set(b, { bucket: b });
    for (const p of ts.points) { const o = byBucket.get(p.bucket); if (o) o[p.key] = metric === 'messages' ? p.messages : p.dlr; }
    return ts.buckets.map((b) => byBucket.get(b));
  }, [ts, metric]);

  const seg = (val: string, cur: string, set: (v: any) => void, label: string) => (
    <button className={cur === val ? 'on' : ''} onClick={() => set(val)}>{label}</button>
  );

  return (
    <div style={{ marginTop: 20, border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--sf)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--ink)', marginRight: 4 }}>Trend</span>
        <span className="edr-seg">{seg('messages', metric, setMetric, 'Messages')}{seg('dlr', metric, setMetric, 'DLR %')}</span>
        <span className="edr-seg">{seg('customer', dim, setDim, 'By Customer')}{seg('sender', dim, setDim, 'By Sender ID')}</span>
        <span className="edr-seg">{seg('hour', gran, setGran, 'Hour')}{seg('day', gran, setGran, 'Day')}{seg('week', gran, setGran, 'Week')}{seg('month', gran, setGran, 'Month')}</span>
        <MultiSelect options={options} selected={keys} onChange={setKeys} placeholder={dim === 'customer' ? 'All customers' : 'All sender IDs'} />
        {loading && <span style={{ fontSize: '.72rem', color: 'var(--mu)' }}>Loading…</span>}
        <input className="edr-inp" type="text" style={{ width: 200, marginLeft: 'auto' }}
          placeholder="Search sender / customer…"
          value={chartSearch} onChange={(e) => setChartSearch(e.target.value)} />
      </div>
      {err ? <div className="edr-err">{err}</div> : (
        <div style={{ height: 340 }}>
          {chartData.length === 0 || visibleKeys.length === 0 ? (
            <div className="edr-empty">
              {chartData.length > 0 && chartSearch.trim()
                ? `No sender / customer matches “${chartSearch.trim()}”`
                : 'No data to plot for this selection'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
                <defs>
                  {visibleKeys.map((k) => {
                    const i = seriesKeys.indexOf(k);
                    const c = SERIES_COLORS[i % SERIES_COLORS.length];
                    return (
                      <linearGradient key={k} id={`zsg_${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={visibleKeys.length > 1 ? 0.18 : 0.45} />
                        <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                <XAxis dataKey="bucket" {...AX} minTickGap={24} />
                <YAxis {...AX} width={54}
                  domain={metric === 'dlr' ? [0, 100] : undefined}
                  tickFormatter={(v: number) => metric === 'dlr' ? `${v}%` : (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))} />
                <Tooltip {...TIP} formatter={(v: any, name: string) => [metric === 'dlr' ? `${v}%` : Number(v).toLocaleString(), name]} />
                <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                {visibleKeys.map((k) => {
                  const i = seriesKeys.indexOf(k);
                  const c = SERIES_COLORS[i % SERIES_COLORS.length];
                  return (
                    <Area key={k} type="monotone" dataKey={k} name={k} stroke={c} strokeWidth={2.5}
                      fill={`url(#zsg_${i})`} dot={false} connectNulls isAnimationActive={false}
                      activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: c }} />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
}

export default function ZamaniSenderIdPage() {
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = React.useState<Date | null>(null);

  const [view, setView] = React.useState<'senders' | 'aggregators' | 'routing'>('senders');
  const [search, setSearch] = React.useState('');
  const [amFilter, setAmFilter] = React.useState('all');
  const [misOnly, setMisOnly] = React.useState(false);
  const [statusFilters, setStatusFilters] = React.useState<Set<string>>(new Set());
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: 'submitted', dir: 'desc' });

  const [preset, setPreset] = React.useState<Preset>('24h');
  const [customFrom, setCustomFrom] = React.useState('');
  const [customTo, setCustomTo] = React.useState('');
  const dispFrom = preset === 'custom' ? customFrom : toLocalInput(presetWindow(preset).start);
  const dispTo = preset === 'custom' ? customTo : toLocalInput(presetWindow(preset).end);
  const editFrom = (v: string) => { setCustomFrom(v); setCustomTo((t) => t || dispTo); setPreset('custom'); };
  const editTo = (v: string) => { setCustomTo(v); setCustomFrom((f) => f || dispFrom); setPreset('custom'); };

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    let fromISO: string | undefined, toISO: string | undefined;
    if (preset === 'custom') {
      fromISO = customFrom ? new Date(customFrom).toISOString() : undefined;
      toISO = customTo ? new Date(customTo).toISOString() : undefined;
    } else {
      const { start, end } = presetWindow(preset);
      fromISO = start.toISOString(); toISO = end.toISOString();
    }
    zamaniSenderIdApi.getData({ from: fromISO, to: toISO })
      .then((r) => { setData(r.data as Data); setLastLoaded(new Date()); })
      .catch((e: any) => setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [preset, customFrom, customTo]);

  React.useEffect(() => { load(); }, [load]);

  const t = data?.totals;
  const baseRows: any[] = view === 'senders' ? (data?.senders ?? []) : view === 'aggregators' ? (data?.aggregators ?? []) : (data?.routing ?? []);
  const accountManagers = React.useMemo(
    () => Array.from(new Set(baseRows.map((r) => r.account_manager).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [baseRows],
  );

  const filtered = React.useMemo(() => {
    let r = baseRows;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((row) => (row.sender_id ?? '').toLowerCase().includes(q) || (row.aggregator ?? '').toLowerCase().includes(q) || (row.vendor ?? '').toLowerCase().includes(q));
    }
    if (view !== 'routing' && amFilter !== 'all') r = r.filter((row) => row.account_manager === amFilter);
    if (view !== 'routing' && misOnly) r = r.filter((row) => row.misrouted > 0);
    if (view === 'senders' && statusFilters.size) {
      r = r.filter((row) =>
        (statusFilters.has('new') && row.is_new) ||
        (statusFilters.has('spike') && row.is_spike) ||
        (statusFilters.has('stopped') && row.is_stopped) ||
        (statusFilters.has('lowdlr') && row.dlr_pct <= 50));
    }
    return r;
  }, [baseRows, search, amFilter, misOnly, view, statusFilters]);

  const sorted = React.useMemo(() => {
    if (!sort.key || !sort.dir) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : Number(av) - Number(bv);
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort]);

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : s.dir === 'desc' ? null : 'asc') : 'desc' }));
  }, []);

  const hasFilter = !!(search || misOnly || amFilter !== 'all' || statusFilters.size);
  const sharedTH = { sort, onSort };
  const cols = view === 'senders' ? 11 : view === 'aggregators' ? 7 : 4;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="edr">
        <div className="edr-body">

          <div className="edr-hdr">
            <div>
              <div className="edr-title">Zamani Sender ID</div>
              <div className="edr-sub">
                <span className="edr-dot" />
                Zamani-destination traffic by sender ID (all vendors) · since 1 Mar 2026 · refreshes ~5 min
              </div>
            </div>
            <div className="edr-lu">
              <span className="edr-lu-lbl">Last Loaded</span>
              <span className="edr-lu-val">{lastLoaded ? lastLoaded.toLocaleString('en-GB') : '—'}</span>
            </div>
          </div>

          <div className="edr-cards">
            <div className="edr-card">
              <div className="edr-card-num">{fmtN(t?.submitted ?? 0)}</div>
              <div className="edr-card-lbl">Messages</div>
              <div className="edr-card-sub">{fmtN(t?.senders ?? 0)} sender IDs · {fmtN(t?.aggregators ?? 0)} customers</div>
            </div>
            <div className="edr-card">
              <div className="edr-card-num">{fmtN(t?.delivered ?? 0)}</div>
              <div className="edr-card-lbl">Delivered</div>
            </div>
            <div className={`edr-card${(t?.dlr_pct ?? 0) >= 80 ? ' edr-card-good' : (t?.dlr_pct ?? 0) < 50 ? ' edr-card-danger' : ''}`}>
              <div className="edr-card-num">{(t?.dlr_pct ?? 0)}%</div>
              <div className="edr-card-lbl">DLR %</div>
            </div>
            <div className={`edr-card${(t?.misrouted ?? 0) > 0 ? ' edr-card-danger' : ''}`}>
              <div className="edr-card-num">{fmtN(t?.misrouted ?? 0)}</div>
              <div className="edr-card-lbl">Mis-routed</div>
            </div>
          </div>

          {error && <div className="edr-err">{error}</div>}

          {!loading && (t?.misrouted ?? 0) > 0 && (
            <div className="edr-alerts">
              <span className="edr-al-neg">{fmtN(t!.misrouted)} mis-routed message(s) — Zamani traffic sent to a vendor other than 564</span>
            </div>
          )}

          <div className="edr-filt">
            {(['1h', '6h', '24h', '48h'] as const).map((p) => (
              <button key={p} className="edr-tbtn" onClick={() => setPreset(p)}
                style={preset === p ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}>
                {PRESET_LABEL[p]}
              </button>
            ))}
            <span style={{ fontSize: '.72rem', color: 'var(--mu)', fontWeight: 600 }}>From</span>
            <input className="edr-inp" style={{ width: 195 }} type="datetime-local" value={dispFrom} onChange={(e) => editFrom(e.target.value)} />
            <span style={{ fontSize: '.72rem', color: 'var(--mu)', fontWeight: 600 }}>To</span>
            <input className="edr-inp" style={{ width: 195 }} type="datetime-local" value={dispTo} onChange={(e) => editTo(e.target.value)} />
            <span className="edr-seg">
              <button className={view === 'senders' ? 'on' : ''} onClick={() => setView('senders')}>By Sender ID</button>
              <button className={view === 'aggregators' ? 'on' : ''} onClick={() => setView('aggregators')}>By Customer</button>
              <button className={view === 'routing' ? 'on' : ''} onClick={() => setView('routing')}>Routing Errors{(t?.misrouted ?? 0) > 0 ? ` (${data?.routing.length ?? 0})` : ''}</button>
            </span>
            <input className="edr-inp" type="text" placeholder="Search sender / customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="edr-inp" style={{ width: 190 }} value={amFilter} onChange={(e) => setAmFilter(e.target.value)} title="Filter by account manager">
              <option value="all">All Account Managers</option>
              {accountManagers.map((am) => <option key={am} value={am}>{am}</option>)}
            </select>
            <button className={`edr-tbtn${misOnly ? ' an' : ''}`} onClick={() => setMisOnly((v) => !v)}>Mis-routed only</button>
            {view === 'senders' && (
              <span className="edr-seg" title="Show only senders currently flagged with this status (last 6h)">
                {([['new', 'New'], ['spike', 'Spike'], ['stopped', 'Stopped'], ['lowdlr', 'Delivery ≤ 50%']] as [string, string][]).map(([k, label]) => (
                  <button key={k} className={statusFilters.has(k) ? 'on' : ''}
                    onClick={() => setStatusFilters((s) => { const nx = new Set(s); nx.has(k) ? nx.delete(k) : nx.add(k); return nx; })}>{label}</button>
                ))}
              </span>
            )}
            <button className="edr-tbtn" onClick={load}>Refresh</button>
            {hasFilter && (
              <button className="edr-clr" onClick={() => { setSearch(''); setAmFilter('all'); setMisOnly(false); setStatusFilters(new Set()); }}>Clear filters</button>
            )}
          </div>

          <div className="edr-tbl-wrap">
            {loading ? <Skel /> : (
              <table className="edr-tbl">
                <thead>
                  <tr>
                    {view === 'senders' ? (
                      <>
                        <TH left w={200} colKey="sender_id" {...sharedTH}>Sender ID</TH>
                        <TH left w={160} colKey="aggregator" {...sharedTH}>Customer</TH>
                        <TH left w={150} colKey="account_manager" {...sharedTH}>Account Manager</TH>
                        <TH w={95} colKey="submitted" {...sharedTH}>Messages</TH>
                        <TH w={95} colKey="delivered" {...sharedTH}>Delivered</TH>
                        <TH w={80} colKey="dlr_pct" {...sharedTH}>DLR %</TH>
                        <TH w={90} colKey="misrouted" {...sharedTH}>Mis-routed</TH>
                        <TH w={70} colKey="is_new" {...sharedTH}>New</TH>
                        <TH w={70} colKey="is_spike" {...sharedTH}>Spike</TH>
                        <TH w={80} colKey="is_stopped" {...sharedTH}>Stopped</TH>
                        <TH w={140} colKey="last_seen" {...sharedTH}>Last Seen (UTC)</TH>
                      </>
                    ) : view === 'aggregators' ? (
                      <>
                        <TH left w={200} colKey="aggregator" {...sharedTH}>Customer</TH>
                        <TH left w={160} colKey="account_manager" {...sharedTH}>Account Manager</TH>
                        <TH w={90} colKey="senders" {...sharedTH}>Sender IDs</TH>
                        <TH w={95} colKey="submitted" {...sharedTH}>Messages</TH>
                        <TH w={95} colKey="delivered" {...sharedTH}>Delivered</TH>
                        <TH w={80} colKey="dlr_pct" {...sharedTH}>DLR %</TH>
                        <TH w={90} colKey="misrouted" {...sharedTH}>Mis-routed</TH>
                      </>
                    ) : (
                      <>
                        <TH left w={200} colKey="sender_id" {...sharedTH}>Sender ID</TH>
                        <TH left w={180} colKey="aggregator" {...sharedTH}>Customer</TH>
                        <TH left w={220} colKey="vendor" {...sharedTH}>Sent To (wrong vendor)</TH>
                        <TH w={110} colKey="msgs" {...sharedTH}>Messages</TH>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr><td colSpan={cols} className="edr-empty">{baseRows.length === 0 ? (view === 'routing' ? 'No mis-routed records in this window — all Zamani traffic went to the correct vendor (564)' : 'No traffic in the selected time window') : 'No rows match the current filters'}</td></tr>
                  )}
                  {sorted.map((row: any, i: number) => (
                    <tr key={i} className={(view === 'routing' || row.misrouted > 0) ? 'rn' : undefined}>
                      {view === 'senders' ? (
                        <>
                          <TD left><span style={{ fontWeight: 600 }}>{row.sender_id || '—'}</span>{row.out_of_window ? <span className="age-chip" title="No traffic in the selected range — status &amp; counts shown are from the last 6h">· 6h</span> : null}</TD>
                          <TD left>{row.aggregator || '—'}</TD>
                          <TD left><span style={{ color: row.account_manager ? 'var(--inks)' : 'var(--mu)' }}>{row.account_manager || '—'}</span></TD>
                          <TD><span style={{ fontWeight: 700 }}>{fmtN(row.submitted)}</span></TD>
                          <TD>{fmtN(row.delivered)}</TD>
                          <TD><span className={dlrCls(row.dlr_pct)}>{row.dlr_pct}%</span></TD>
                          <TD>{row.misrouted > 0 ? <span className="bdg bdg-neg">{fmtN(row.misrouted)}</span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                          <TD>{row.is_new ? <span style={{ whiteSpace: 'nowrap' }}><span className="bdg bdg-new">NEW</span><span className="age-chip" title="Appeared this long ago">{ageLabel(row.appeared_min)}</span></span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                          <TD>{row.is_spike ? <span style={{ whiteSpace: 'nowrap' }}><span className="bdg bdg-spike">SPIKE</span><span className="age-chip" title="Last message this long ago">{ageLabel(row.idle_min)}</span></span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                          <TD>{row.is_stopped ? <span style={{ whiteSpace: 'nowrap' }}><span className="bdg bdg-neg">STOPPED</span><span className="age-chip" title="Silent for this long">{ageLabel(row.idle_min)}</span></span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                          <TD mono>{row.last_seen || '—'}</TD>
                        </>
                      ) : view === 'aggregators' ? (
                        <>
                          <TD left><span style={{ fontWeight: 600 }}>{row.aggregator || '—'}</span></TD>
                          <TD left><span style={{ color: row.account_manager ? 'var(--inks)' : 'var(--mu)' }}>{row.account_manager || '—'}</span></TD>
                          <TD>{fmtN(row.senders)}</TD>
                          <TD><span style={{ fontWeight: 700 }}>{fmtN(row.submitted)}</span></TD>
                          <TD>{fmtN(row.delivered)}</TD>
                          <TD><span className={dlrCls(row.dlr_pct)}>{row.dlr_pct}%</span></TD>
                          <TD>{row.misrouted > 0 ? <span className="bdg bdg-neg">{fmtN(row.misrouted)}</span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                        </>
                      ) : (
                        <>
                          <TD left><span style={{ fontWeight: 600 }}>{row.sender_id || '—'}</span></TD>
                          <TD left>{row.aggregator || '—'}</TD>
                          <TD left><span style={{ color: 'var(--rejected)', fontWeight: 600 }}>{row.vendor || `vendor ${row.vendor_id}`}</span></TD>
                          <TD><span style={{ fontWeight: 700 }}>{fmtN(row.msgs)}</span></TD>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && sorted.length > 0 && (
            <div className="edr-footer">{sorted.length.toLocaleString()} of {baseRows.length.toLocaleString()} {view === 'senders' ? 'sender IDs' : view === 'aggregators' ? 'customers' : 'routing errors'}</div>
          )}

          <TrendChart senders={data?.senders ?? []} aggregators={data?.aggregators ?? []} preset={preset} customFrom={customFrom} customTo={customTo} reloadKey={lastLoaded?.getTime()} />

        </div>
      </div>
    </>
  );
}
