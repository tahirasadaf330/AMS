'use client';

import * as React from 'react';
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
type Sender = { sender_id: string; aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; dlr_pct: number; last_seen: string };
type Agg = { aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; senders: number; dlr_pct: number };
type Route = { sender_id: string; aggregator: string; vendor: string; vendor_id: number; msgs: number };
type Data = { totals: Totals; senders: Sender[]; aggregators: Agg[]; routing: Route[]; trend: any[] };

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

export default function ZamaniSenderIdPage() {
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = React.useState<Date | null>(null);

  const [view, setView] = React.useState<'senders' | 'aggregators'>('senders');
  const [search, setSearch] = React.useState('');
  const [amFilter, setAmFilter] = React.useState('all');
  const [misOnly, setMisOnly] = React.useState(false);
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
  const baseRows: any[] = view === 'senders' ? (data?.senders ?? []) : (data?.aggregators ?? []);
  const accountManagers = React.useMemo(
    () => Array.from(new Set(baseRows.map((r) => r.account_manager).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [baseRows],
  );

  const filtered = React.useMemo(() => {
    let r = baseRows;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((row) => (row.sender_id ?? '').toLowerCase().includes(q) || (row.aggregator ?? '').toLowerCase().includes(q));
    }
    if (amFilter !== 'all') r = r.filter((row) => row.account_manager === amFilter);
    if (misOnly) r = r.filter((row) => row.misrouted > 0);
    return r;
  }, [baseRows, search, amFilter, misOnly]);

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

  const hasFilter = !!(search || misOnly || amFilter !== 'all');
  const sharedTH = { sort, onSort };
  const cols = view === 'senders' ? 8 : 7;

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
                Zamani-destination traffic by sender ID (all vendors) · rolling ~48h · refreshes ~5 min
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
              <div className="edr-card-sub">{fmtN(t?.senders ?? 0)} sender IDs · {fmtN(t?.aggregators ?? 0)} aggregators</div>
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
              <button className={view === 'aggregators' ? 'on' : ''} onClick={() => setView('aggregators')}>By Aggregator</button>
            </span>
            <input className="edr-inp" type="text" placeholder="Search sender / aggregator…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="edr-inp" style={{ width: 190 }} value={amFilter} onChange={(e) => setAmFilter(e.target.value)} title="Filter by account manager">
              <option value="all">All Account Managers</option>
              {accountManagers.map((am) => <option key={am} value={am}>{am}</option>)}
            </select>
            <button className={`edr-tbtn${misOnly ? ' an' : ''}`} onClick={() => setMisOnly((v) => !v)}>Mis-routed only</button>
            <button className="edr-tbtn" onClick={load}>Refresh</button>
            {hasFilter && (
              <button className="edr-clr" onClick={() => { setSearch(''); setAmFilter('all'); setMisOnly(false); }}>Clear filters</button>
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
                        <TH left w={160} colKey="aggregator" {...sharedTH}>Aggregator</TH>
                        <TH left w={150} colKey="account_manager" {...sharedTH}>Account Manager</TH>
                        <TH w={95} colKey="submitted" {...sharedTH}>Messages</TH>
                        <TH w={95} colKey="delivered" {...sharedTH}>Delivered</TH>
                        <TH w={80} colKey="dlr_pct" {...sharedTH}>DLR %</TH>
                        <TH w={90} colKey="misrouted" {...sharedTH}>Mis-routed</TH>
                        <TH w={140} colKey="last_seen" {...sharedTH}>Last Seen (UTC)</TH>
                      </>
                    ) : (
                      <>
                        <TH left w={200} colKey="aggregator" {...sharedTH}>Aggregator</TH>
                        <TH left w={160} colKey="account_manager" {...sharedTH}>Account Manager</TH>
                        <TH w={90} colKey="senders" {...sharedTH}>Sender IDs</TH>
                        <TH w={95} colKey="submitted" {...sharedTH}>Messages</TH>
                        <TH w={95} colKey="delivered" {...sharedTH}>Delivered</TH>
                        <TH w={80} colKey="dlr_pct" {...sharedTH}>DLR %</TH>
                        <TH w={90} colKey="misrouted" {...sharedTH}>Mis-routed</TH>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr><td colSpan={cols} className="edr-empty">{baseRows.length === 0 ? 'No traffic in the selected time window' : 'No rows match the current filters'}</td></tr>
                  )}
                  {sorted.map((row: any, i: number) => (
                    <tr key={i} className={row.misrouted > 0 ? 'rn' : undefined}>
                      {view === 'senders' ? (
                        <>
                          <TD left><span style={{ fontWeight: 600 }}>{row.sender_id || '—'}</span></TD>
                          <TD left>{row.aggregator || '—'}</TD>
                          <TD left><span style={{ color: row.account_manager ? 'var(--inks)' : 'var(--mu)' }}>{row.account_manager || '—'}</span></TD>
                          <TD><span style={{ fontWeight: 700 }}>{fmtN(row.submitted)}</span></TD>
                          <TD>{fmtN(row.delivered)}</TD>
                          <TD><span className={dlrCls(row.dlr_pct)}>{row.dlr_pct}%</span></TD>
                          <TD>{row.misrouted > 0 ? <span className="bdg bdg-neg">{fmtN(row.misrouted)}</span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                          <TD mono>{row.last_seen || '—'}</TD>
                        </>
                      ) : (
                        <>
                          <TD left><span style={{ fontWeight: 600 }}>{row.aggregator || '—'}</span></TD>
                          <TD left><span style={{ color: row.account_manager ? 'var(--inks)' : 'var(--mu)' }}>{row.account_manager || '—'}</span></TD>
                          <TD>{fmtN(row.senders)}</TD>
                          <TD><span style={{ fontWeight: 700 }}>{fmtN(row.submitted)}</span></TD>
                          <TD>{fmtN(row.delivered)}</TD>
                          <TD><span className={dlrCls(row.dlr_pct)}>{row.dlr_pct}%</span></TD>
                          <TD>{row.misrouted > 0 ? <span className="bdg bdg-neg">{fmtN(row.misrouted)}</span> : <span style={{ color: 'var(--mu)' }}>—</span>}</TD>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && sorted.length > 0 && (
            <div className="edr-footer">{sorted.length.toLocaleString()} of {baseRows.length.toLocaleString()} {view === 'senders' ? 'sender IDs' : 'aggregators'}</div>
          )}

        </div>
      </div>
    </>
  );
}
