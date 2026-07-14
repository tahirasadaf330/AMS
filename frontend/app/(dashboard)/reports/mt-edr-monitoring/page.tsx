'use client';

import * as React from 'react';
import { mtEdrApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────
const CSS = `
.edr{
  --sf:#ffffff;--sf2:#f5f7f8;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  --delivered:#16a34a;--delivered-bg:rgba(22,163,74,.10);--delivered-bd:rgba(22,163,74,.28);
  --accepted:#2563eb;--accepted-bg:rgba(37,99,235,.10);--accepted-bd:rgba(37,99,235,.28);
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
  --accepted-bg:rgba(37,99,235,.14);--accepted-bd:rgba(37,99,235,.35);
  --pending-bg:rgba(217,119,6,.14);--pending-bd:rgba(217,119,6,.35);
  --rejected-bg:rgba(220,38,38,.14);--rejected-bd:rgba(220,38,38,.35);
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
  --warn-bg:rgba(234,88,12,.12);--warn-bd:rgba(234,88,12,.35);
}
.edr-body{max-width:1600px;margin:0 auto;padding:22px 20px 48px}

/* Header */
.edr-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.edr-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.edr-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.edr-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:edr-blink 2s infinite}
@keyframes edr-blink{0%,100%{opacity:1}50%{opacity:.3}}
.edr-lu{text-align:right}
.edr-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.edr-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}

/* Summary cards */
.edr-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:640px){.edr-cards{grid-template-columns:repeat(2,1fr)}}
.edr-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.edr-card-danger{border-color:var(--danger-bd);background:var(--danger-bg)}
.edr-card-warn{border-color:var(--warn-bd);background:var(--warn-bg)}
.edr-card-num{font-size:1.55rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;color:var(--ink);margin-bottom:4px}
.edr-card-danger .edr-card-num{color:var(--danger)}
.edr-card-warn .edr-card-num{color:var(--warn)}
.edr-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}

/* Alert strip */
.edr-alerts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.edr-al-neg{font-size:.74rem;font-weight:600;padding:5px 12px;border-radius:6px;background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger)}
.edr-al-spike{font-size:.74rem;font-weight:600;padding:5px 12px;border-radius:6px;background:var(--warn-bg);border:1px solid var(--warn-bd);color:var(--warn)}

/* Error */
.edr-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}

/* Filters */
.edr-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.edr-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:190px;color-scheme:light}
.dark .edr-inp{color-scheme:dark}
.edr-inp:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.edr-tbtn{height:33px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.78rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:border-color .12s}
.edr-tbtn:hover{border-color:#94a3b8}
.edr-tbtn.an{background:var(--danger-bg);border-color:var(--danger-bd);color:var(--danger);font-weight:700}
.edr-tbtn.as{background:var(--warn-bg);border-color:var(--warn-bd);color:var(--warn);font-weight:700}
.edr-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}

/* Table */
.edr-tbl-wrap{overflow-x:auto;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.edr-tbl{width:100%;border-collapse:collapse;font-size:.79rem;min-width:1100px}
.edr-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}

/* Status column group headers */
.edr-tbl th.grp-delivered{background:var(--delivered-bg);color:var(--delivered);border-bottom:2px solid var(--delivered)}
.edr-tbl th.grp-accepted {background:var(--accepted-bg) ;color:var(--accepted) ;border-bottom:2px solid var(--accepted)}
.edr-tbl th.grp-pending  {background:var(--pending-bg)  ;color:var(--pending)  ;border-bottom:2px solid var(--pending)}
.edr-tbl th.grp-rejected {background:var(--rejected-bg) ;color:var(--rejected) ;border-bottom:2px solid var(--rejected)}

.edr-tbl th{
  padding:9px 10px;text-align:right;font-size:.67rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.05em;color:var(--mu);
  white-space:nowrap;user-select:none;cursor:pointer;
  position:sticky;top:0;background:var(--sf2);z-index:1;
}
.edr-tbl th.l{text-align:left}
.edr-tbl th:hover{color:var(--ink)}
.edr-tbl th.active{color:#2563eb}
.edr-tbl td{
  padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);
  color:var(--ink);white-space:nowrap;font-variant-numeric:tabular-nums;
}
.edr-tbl td.l{text-align:left}
.edr-tbl td.mono{font-family:'Courier New',monospace;font-size:.75rem}
.edr-tbl tbody tr:hover td{background:rgba(37,99,235,.03)}
.edr-tbl tbody tr.rn td{background:rgba(220,38,38,.05)}
.edr-tbl tbody tr.rs td{background:rgba(234,88,12,.05)}
.edr-tbl tbody tr.rb td{background:rgba(220,38,38,.09)}
.edr-tbl tbody tr.rn:hover td{background:rgba(220,38,38,.09)}
.edr-tbl tbody tr.rs:hover td{background:rgba(234,88,12,.09)}
.edr-tbl tbody tr.rb:hover td{background:rgba(220,38,38,.13)}
.edr-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}

/* Status count cell */
.sc{display:inline-flex;flex-direction:column;align-items:flex-end;gap:1px}
.sc-num{font-weight:700;font-size:.85rem}
.sc-pct{font-size:.64rem;color:var(--mu);font-weight:500}
.sc-delivered .sc-num{color:var(--delivered)}
.sc-accepted  .sc-num{color:var(--accepted)}
.sc-pending   .sc-num{color:var(--pending)}
.sc-rejected  .sc-num{color:var(--rejected)}

/* Spike/margin badges */
.bdg{display:inline-block;font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:4px;letter-spacing:.04em;text-transform:uppercase}
.bdg-neg  {background:var(--rejected-bg);color:var(--rejected);border:1px solid var(--rejected-bd)}
.bdg-spike{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-bd)}
.bdg-ok   {background:rgba(22,163,74,.09);color:var(--delivered);border:1px solid var(--delivered-bd)}
.bdg-none {background:var(--sf2);color:var(--mu);border:1px solid var(--lns)}

/* Avg delivery time coloring */
.del-fast{color:var(--delivered);font-weight:600}
.del-ok  {color:var(--accepted);font-weight:600}
.del-slow{color:var(--pending);font-weight:600}
.del-bad {color:var(--rejected);font-weight:600}

/* Footer */
.edr-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}

/* Skeleton */
.edr-skel{padding:18px;display:flex;flex-direction:column;gap:9px}
.edr-skel-bar{height:38px;border-radius:6px;background:linear-gradient(90deg,var(--sf2) 25%,var(--sf) 50%,var(--sf2) 75%);background-size:200% 100%;animation:edr-sh 1.4s infinite}
@keyframes edr-sh{from{background-position:200% 0}to{background-position:-200% 0}}

.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

// ──────────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────────
type SortDir = 'asc' | 'desc' | null;

function Skel() {
  return (
    <div className="edr-skel">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="edr-skel-bar" style={{ opacity: 1 - i * 0.09 }} />
      ))}
    </div>
  );
}

function TH({
  children, left, w, colKey, thClass, sort, onSort,
}: {
  children: React.ReactNode;
  left?: boolean;
  w?: number;
  colKey: string;
  thClass?: string;
  sort: { key: string | null; dir: SortDir };
  onSort: (k: string) => void;
}) {
  const active = sort.key === colKey;
  const cls = [left ? 'l' : '', active ? 'active' : '', thClass ?? ''].filter(Boolean).join(' ');
  return (
    <th
      className={cls || undefined}
      style={{ width: w, minWidth: w ?? 60 }}
      onClick={() => onSort(colKey)}
    >
      {children}
      <span className="sa">{active ? (sort.dir === 'asc' ? '▲' : sort.dir === 'desc' ? '▼' : '⇅') : '⇅'}</span>
    </th>
  );
}

function TD({ children, left, mono }: { children: React.ReactNode; left?: boolean; mono?: boolean }) {
  const cls = [left ? 'l' : '', mono ? 'mono' : ''].filter(Boolean).join(' ');
  return <td className={cls || undefined}>{children}</td>;
}

// Status count cell: shows the absolute count + % of total
function StatusCell({ count, total, cls }: { count: number; total: number; cls: string }) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
  return (
    <div className={`sc ${cls}`}>
      <span className="sc-num">{count.toLocaleString()}</span>
      <span className="sc-pct">{pct}%</span>
    </div>
  );
}

function DelCell({ secs }: { secs: number | null }) {
  if (secs == null) return <span style={{ color: '#94a3b8' }}>—</span>;
  const cls = secs < 10 ? 'del-fast' : secs < 60 ? 'del-ok' : secs < 300 ? 'del-slow' : 'del-bad';
  return <span className={cls}>{secs.toFixed(1)}s</span>;
}

const fmtTime = (dt: string | null) =>
  dt ? new Date(dt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

const fmtDT   = (dt: string | null) => dt ? new Date(dt).toLocaleString('en-GB') : '—';
const fmtN    = (n: number | null)  => n  != null ? Number(n).toLocaleString() : '—';
const fmtRate = (n: number | null)  => n  != null ? Number(n).toFixed(6) : '—';

// datetime-local input value (browser local tz) for the From/To time-window filters.
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Quick-range presets. Relative presets are recomputed from "now" on every load so they roll
// live with each refresh; 'custom' uses the From/To inputs verbatim.
type EdrPreset = '2m' | '1h' | '6h' | '12h' | 'day' | 'custom';
const PRESET_MS: Record<'2m' | '1h' | '6h' | '12h', number> = {
  '2m': 2 * 60_000, '1h': 3_600_000, '6h': 6 * 3_600_000, '12h': 12 * 3_600_000,
};
const PRESET_LABEL: Record<Exclude<EdrPreset, 'custom'>, string> = {
  '2m': 'Last 2 min', '1h': '1h', '6h': '6h', '12h': '12h', 'day': 'Full Day',
};
function presetWindow(p: Exclude<EdrPreset, 'custom'>): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  if (p === 'day') start.setHours(0, 0, 0, 0);
  else start.setTime(end.getTime() - PRESET_MS[p]);
  return { start, end };
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────
export default function MtEdrMonitoringPage() {
  const [data,      setData]      = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading,   setLoading]   = React.useState(true);
  const [error,     setError]     = React.useState<string | null>(null);

  const [search,     setSearch]     = React.useState('');
  const [filterNeg,  setFilterNeg]  = React.useState(false);
  const [filterSpike,setFilterSpike]= React.useState(false);
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({
    key: 'total_msgs', dir: 'desc',
  });

  // Time window — defaults to the live "Last 2 min" view (rolls with each refresh). Editing a
  // From/To input switches to a fixed 'custom' window.
  const [preset, setPreset]         = React.useState<EdrPreset>('2m');
  const [customFrom, setCustomFrom] = React.useState('');
  const [customTo,   setCustomTo]   = React.useState('');

  // Displayed input values: a relative preset shows its (live) window; custom shows the edits.
  const dispFrom = preset === 'custom' ? customFrom : toLocalInput(presetWindow(preset).start);
  const dispTo   = preset === 'custom' ? customTo   : toLocalInput(presetWindow(preset).end);

  const editFrom = (v: string) => { setCustomFrom(v); setCustomTo((t) => t || dispTo); setPreset('custom'); };
  const editTo   = (v: string) => { setCustomTo(v);   setCustomFrom((f) => f || dispFrom); setPreset('custom'); };

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    let fromISO: string | undefined;
    let toISO: string | undefined;
    if (preset === 'custom') {
      fromISO = customFrom ? new Date(customFrom).toISOString() : undefined;
      toISO   = customTo   ? new Date(customTo).toISOString()   : undefined;
    } else {
      const { start, end } = presetWindow(preset);   // recomputed from "now" → rolls live
      fromISO = start.toISOString();
      toISO   = end.toISOString();
    }
    mtEdrApi
      .getData({ from: fromISO, to: toISO })
      .then((r) => {
        setData(r.data);
        setDatasetId(r.data?.dataset_id ?? null);
      })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [preset, customFrom, customTo]);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  const allRows: any[] = data?.rows        ?? [];
  const summary        = data?.summary     ?? {};
  const lastRefreshed  = data?.last_refreshed ?? null;

  const filtered = React.useMemo(() => {
    let r = allRows;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((row) => (row.customer_company ?? '').toLowerCase().includes(q));
    }
    if (filterNeg)   r = r.filter((row) => row.negative_margin_count > 0);
    if (filterSpike) r = r.filter((row) => row.traffic_spike === 1);
    return r;
  }, [allRows, search, filterNeg, filterSpike]);

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
    setSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : s.dir === 'desc' ? null : 'asc') : 'desc',
    }));
  }, []);

  const totalCompanies  = summary.total_companies         ?? 0;
  const totalMsgs       = summary.total_messages          ?? 0;
  const negCount        = summary.companies_with_neg_margin ?? 0;
  const spikeCount      = summary.companies_with_spike    ?? 0;
  const hasFilter       = search || filterNeg || filterSpike;

  const sharedTH = { sort, onSort };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="edr">
        <div className="edr-body">

          {/* Header */}
          <div className="edr-hdr">
            <div>
              <div className="edr-title">MT EDR Monitoring</div>
              <div className="edr-sub">
                <span className="edr-dot" />
                Per company · rolling incremental · today + yesterday retained
              </div>
            </div>
            <div className="edr-lu">
              <span className="edr-lu-lbl">Last Updated</span>
              <span className="edr-lu-val">{fmtDT(lastRefreshed)}</span>
            </div>
          </div>

          {/* Summary cards */}
          <div className="edr-cards">
            <div className="edr-card">
              <div className="edr-card-num">{fmtN(totalCompanies)}</div>
              <div className="edr-card-lbl">Active Companies</div>
            </div>
            <div className="edr-card">
              <div className="edr-card-num">{fmtN(totalMsgs)}</div>
              <div className="edr-card-lbl">Total Messages</div>
            </div>
            <div className={`edr-card${negCount > 0 ? ' edr-card-danger' : ''}`}>
              <div className="edr-card-num">{fmtN(negCount)}</div>
              <div className="edr-card-lbl">Negative Margin</div>
            </div>
            <div className={`edr-card${spikeCount > 0 ? ' edr-card-warn' : ''}`}>
              <div className="edr-card-num">{fmtN(spikeCount)}</div>
              <div className="edr-card-lbl">Traffic Spikes</div>
            </div>
          </div>

          {/* Error */}
          {error && <div className="edr-err">{error}</div>}

          {/* Alert strip */}
          {!loading && (negCount > 0 || spikeCount > 0) && (
            <div className="edr-alerts">
              {negCount > 0 && (
                <span className="edr-al-neg">
                  {negCount} {negCount === 1 ? 'company' : 'companies'} with negative margin
                </span>
              )}
              {spikeCount > 0 && (
                <span className="edr-al-spike">
                  {spikeCount} traffic spike{spikeCount !== 1 ? 's' : ''} detected
                </span>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="edr-filt">
            {(['2m', '1h', '6h', '12h', 'day'] as const).map((p) => (
              <button
                key={p}
                className="edr-tbtn"
                onClick={() => setPreset(p)}
                style={preset === p ? { borderColor: '#2563eb', color: '#2563eb', fontWeight: 700 } : undefined}
              >
                {PRESET_LABEL[p]}
              </button>
            ))}
            <span style={{ fontSize: '.72rem', color: 'var(--mu)', fontWeight: 600 }}>From</span>
            <input className="edr-inp" style={{ width: 195 }} type="datetime-local" value={dispFrom} onChange={(e) => editFrom(e.target.value)} />
            <span style={{ fontSize: '.72rem', color: 'var(--mu)', fontWeight: 600 }}>To</span>
            <input className="edr-inp" style={{ width: 195 }} type="datetime-local" value={dispTo} onChange={(e) => editTo(e.target.value)} />
            <input
              className="edr-inp"
              type="text"
              placeholder="Search company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              className={`edr-tbtn${filterNeg ? ' an' : ''}`}
              onClick={() => setFilterNeg((v) => !v)}
            >
              Negative Margin
            </button>
            <button
              className={`edr-tbtn${filterSpike ? ' as' : ''}`}
              onClick={() => setFilterSpike((v) => !v)}
            >
              Traffic Spikes
            </button>
            {hasFilter && (
              <button
                className="edr-clr"
                onClick={() => { setSearch(''); setFilterNeg(false); setFilterSpike(false); }}
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="edr-tbl-wrap">
            {loading ? (
              <Skel />
            ) : (
              <table className="edr-tbl">
                <thead>
                  <tr>
                    <TH left w={200} colKey="customer_company"      {...sharedTH}>Company</TH>
                    <TH      w={80}  colKey="total_msgs"             {...sharedTH}>Total</TH>
                    <TH      w={95}  colKey="delivered"   thClass="grp-delivered" {...sharedTH}>Delivered</TH>
                    <TH      w={95}  colKey="accepted"    thClass="grp-accepted"  {...sharedTH}>Accepted</TH>
                    <TH      w={95}  colKey="pending"     thClass="grp-pending"   {...sharedTH}>Pending</TH>
                    <TH      w={95}  colKey="rejected"    thClass="grp-rejected"  {...sharedTH}>Rejected</TH>
                    <TH      w={90}  colKey="negative_margin_count"  {...sharedTH}>Neg. Margin</TH>
                    <TH      w={95}  colKey="avg_neg_vendor_rate"    {...sharedTH}>Vendor Rate</TH>
                    <TH      w={95}  colKey="avg_neg_customer_rate"  {...sharedTH}>Cust. Rate</TH>
                    <TH      w={75}  colKey="traffic_spike"          {...sharedTH}>Spike</TH>
                    <TH      w={82}  colKey="msg_count_1min"         {...sharedTH}>Msg/1min</TH>
                    <TH      w={88}  colKey="avg_delivery_time"      {...sharedTH}>Avg Del.</TH>
                    <TH      w={88}  colKey="first_received_time"    {...sharedTH}>First Recv.</TH>
                    <TH      w={88}  colKey="last_received_time"     {...sharedTH}>Last Recv.</TH>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={14} className="edr-empty">
                        {allRows.length === 0
                          ? 'No messages in the selected time window'
                          : 'No companies match the current filters'}
                      </td>
                    </tr>
                  )}
                  {sorted.map((row: any, i: number) => {
                    const isNeg   = row.negative_margin_count > 0;
                    const isSpike = row.traffic_spike === 1;
                    const cls     = isNeg && isSpike ? 'rb' : isNeg ? 'rn' : isSpike ? 'rs' : '';
                    const total   = row.total_msgs as number;
                    return (
                      <tr key={i} className={cls || undefined}>
                        <TD left>
                          <span style={{ fontWeight: 600 }}>{row.customer_company ?? '—'}</span>
                        </TD>
                        <TD>
                          <span style={{ fontWeight: 700 }}>{total.toLocaleString()}</span>
                        </TD>
                        <TD>
                          <StatusCell count={row.delivered} total={total} cls="sc-delivered" />
                        </TD>
                        <TD>
                          <StatusCell count={row.accepted} total={total} cls="sc-accepted" />
                        </TD>
                        <TD>
                          <StatusCell count={row.pending} total={total} cls="sc-pending" />
                        </TD>
                        <TD>
                          <StatusCell count={row.rejected} total={total} cls="sc-rejected" />
                        </TD>
                        <TD>
                          {row.negative_margin_count > 0 ? (
                            <span className="bdg bdg-neg">{row.negative_margin_count}</span>
                          ) : (
                            <span style={{ color: 'var(--mu)' }}>—</span>
                          )}
                        </TD>
                        <TD mono>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            {row.negative_margin_count > 0
                              ? <span style={{ color: 'var(--rejected)', fontWeight: 600 }}>{fmtRate(row.avg_neg_vendor_rate)}</span>
                              : <span style={{ color: 'var(--mu)' }}>—</span>}
                            <span style={{ fontSize: '.62rem', color: 'var(--mu)' }}>{row.vendor_currency ?? '—'}</span>
                          </div>
                        </TD>
                        <TD mono>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                            {row.negative_margin_count > 0
                              ? <span style={{ color: 'var(--accepted)', fontWeight: 600 }}>{fmtRate(row.avg_neg_customer_rate)}</span>
                              : <span style={{ color: 'var(--mu)' }}>—</span>}
                            <span style={{ fontSize: '.62rem', color: 'var(--mu)' }}>{row.customer_currency ?? '—'}</span>
                          </div>
                        </TD>
                        <TD>
                          {isSpike
                            ? <span className="bdg bdg-spike">SPIKE</span>
                            : <span className="bdg bdg-none">—</span>}
                        </TD>
                        <TD>{row.msg_count_1min.toLocaleString()}</TD>
                        <TD>
                          <DelCell secs={row.avg_delivery_time} />
                        </TD>
                        <TD mono>{fmtTime(row.first_received_time)}</TD>
                        <TD mono>{fmtTime(row.last_received_time)}</TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {!loading && sorted.length > 0 && (
            <div className="edr-footer">
              {sorted.length.toLocaleString()} of {allRows.length.toLocaleString()} companies
            </div>
          )}

        </div>
      </div>
    </>
  );
}
