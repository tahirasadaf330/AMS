'use client';

import * as React from 'react';
import { dealsAutomationApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.zr{
  --turquoise:#1abc9c;--green-sea:#16a085;--emerald:#2ecc71;--nephritis:#27ae60;
  --river:#3498db;--belize:#2980b9;--amethyst:#9b59b6;
  --asphalt:#34495e;--midnight:#2c3e50;
  --carrot:#e67e22;--alizarin:#e74c3c;
  --pos:#27ae60;--neg:#e74c3c;
  --bg:#ecf0f1;--sf:#ffffff;--sf2:#f5f7f8;--stripe:#f9fafb;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  font-family:'Hanken Grotesk',-apple-system,sans-serif;
  color:var(--ink);background:var(--bg);
}
.dark .zr{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}

.zk{border-radius:10px;padding:16px 16px 14px;color:#fff;box-shadow:0 4px 0 rgba(0,0,0,.15)}
.zk.kt{background:var(--turquoise)} .zk.kb{background:var(--river)} .zk.kg{background:var(--emerald)}
.zk.kc{background:var(--carrot)} .zk.kr{background:var(--alizarin)} .zk.kp{background:var(--amethyst)}
.zk.kd{background:var(--asphalt)}
.zk-top{display:flex;align-items:center;justify-content:space-between;opacity:.92}
.zk-lbl{font-size:12px;font-weight:700;letter-spacing:.01em}
.zk-ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.22)}
.zk-ic svg{width:16px;height:16px}
.zk-val{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;margin-top:10px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.zk-sub{font-size:11.5px;margin-top:4px;opacity:.88}

.zpnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.zph{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 12px;border-bottom:1px solid var(--ln)}
.zph h2{font-family:'Montserrat',sans-serif;font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-.2px}
.zph .ztag{font-size:11px;color:var(--mu);font-weight:600}

.zdi{
  appearance:none;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:var(--ink);
  background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:9px 12px;width:100%;
  color-scheme:light;transition:border-color .15s,box-shadow .15s;
}
.dark .zdi{color-scheme:dark}
.zdi:focus{outline:none;border-color:var(--turquoise);box-shadow:0 0 0 3px rgba(26,188,156,.18)}

/* segmented direction toggle */
.zseg{display:inline-flex;background:var(--sf2);border:1px solid var(--lns);border-radius:8px;padding:2px;gap:2px}
.zseg button{border:0;background:transparent;font-family:'Hanken Grotesk',sans-serif;font-weight:700;font-size:12.5px;
  color:var(--inks);padding:6px 14px;border-radius:6px;cursor:pointer;transition:.12s;white-space:nowrap}
.zseg button:hover{color:var(--ink)}
.zseg button.on{color:#fff}
.zseg button.on.in{background:var(--river)}
.zseg button.on.out{background:var(--amethyst)}
.zseg button.on.all{background:var(--asphalt)}

.zt{width:100%;border-collapse:collapse;font-size:13.5px}
.zt tbody tr:nth-child(even){background:var(--stripe)}
.zt tbody tr:hover{background:var(--sf2)}

.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;
  box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}

.zpos{color:var(--pos);font-weight:600}
.zneg{color:var(--neg);font-weight:600}

@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}

.zalert{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:8px;
  background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);margin-bottom:16px}
.zalert svg{flex-shrink:0;width:18px;height:18px}
.zalert p{font-size:13.5px;color:var(--alizarin);font-weight:600}

.zleg-row{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--inks)}
.zleg-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}

.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb:hover{background:var(--mu)}

.row-critical{background:rgba(231,76,60,.06)!important}
.row-risk{background:rgba(230,126,34,.05)!important}
.row-critical:hover{background:rgba(231,76,60,.11)!important}
.row-risk:hover{background:rgba(230,126,34,.1)!important}

.pct-wrap{display:inline-flex;flex-direction:column;align-items:flex-end;gap:3px}
.pct-pill{display:inline-flex;align-items:center;border-radius:20px;padding:1px 8px;font-size:11.5px;font-weight:700;font-family:'JetBrains Mono',monospace}
.pct-bar{width:52px;height:3px;border-radius:2px;background:var(--lns);overflow:hidden}
.pct-bar-fill{height:100%;border-radius:2px}

.dir-badge{display:inline-block;border-radius:4px;padding:1px 8px;font-size:10.5px;font-weight:700;letter-spacing:.03em}
.dir-in{background:rgba(52,152,219,.15);color:var(--river)}
.dir-out{background:rgba(155,89,182,.15);color:var(--amethyst)}
`;

const IC = {
  deal:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>,
  gauge:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 12l4-4"/></svg>,
  clock:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  alert:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  scale:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v18M3 7l9-4 9 4M6 7l-3 6a3 3 0 0 0 6 0zM18 7l-3 6a3 3 0 0 0 6 0z"/></svg>,
  search:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
};

function Kpi({ color, label, value, sub, icon }: { color: string; label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className={`zk ${color}`}>
      <div className="zk-top"><span className="zk-lbl">{label}</span><span className="zk-ic">{icon}</span></div>
      <div className="zk-val">{value}</div>
      {sub && <div className="zk-sub">{sub}</div>}
    </div>
  );
}

function Skel() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(8)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

const fN = (n: any, d = 0) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—';
const fRate = (n: any) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—';
const fPct = (n: any) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const MNS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fDate = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}-${MNS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
};

function UtilBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: 'var(--mu)' }}>—</span>;
  const [pillBg, pillColor, barColor] =
    pct >= 100 ? ['rgba(231,76,60,.18)',  '#e74c3c', '#e74c3c'] :
    pct >= 80  ? ['rgba(230,126,34,.18)', '#e67e22', '#e67e22'] :
    pct >= 50  ? ['rgba(241,196,15,.18)', '#d4ac0d', '#f1c40f'] :
                 ['rgba(46,204,113,.18)', '#27ae60', '#2ecc71'];
  return (
    <div className="pct-wrap">
      <span className="pct-pill" style={{ background: pillBg, color: pillColor }}>{fPct(pct)}</span>
      <div className="pct-bar"><div className="pct-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} /></div>
    </div>
  );
}

type SortDir = 'asc' | 'desc';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }

const TH = ({ children, left, w, colKey, sort }: {
  children: React.ReactNode; left?: boolean; w?: number; colKey?: string; sort?: SortState;
}) => {
  const isActive = !!colKey && sort?.key === colKey;
  return (
    <th
      onClick={colKey ? () => sort?.set(colKey) : undefined}
      style={{
        textAlign: left ? 'left' : 'right', position: 'sticky', top: 0, background: 'var(--sf)', zIndex: 1,
        padding: '10px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
        color: isActive ? 'var(--turquoise)' : 'var(--mu)', whiteSpace: 'nowrap',
        borderBottom: isActive ? '2px solid var(--turquoise)' : '2px solid var(--lns)',
        cursor: colKey ? 'pointer' : 'default', userSelect: 'none', ...(w ? { width: w, minWidth: w } : {}),
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {children}
        {colKey && <span style={{ opacity: isActive ? 1 : 0.3, fontSize: 9, lineHeight: 1 }}>{isActive ? (sort?.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
      </span>
    </th>
  );
};

const TD = ({ children, left, style }: { children: React.ReactNode; left?: boolean; style?: React.CSSProperties }) => (
  <td style={{ textAlign: left ? 'left' : 'right', padding: '9px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ln)',
    fontFamily: left ? "'Hanken Grotesk',sans-serif" : "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums',
    color: 'var(--inks)', ...style }}>
    {children}
  </td>
);

type Dir = 'ALL' | 'INBOUND' | 'OUTBOUND';

export default function DealsAutomationPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [dir, setDir]             = React.useState<Dir>('ALL');
  const [search, setSearch]       = React.useState('');
  const [manager, setManager]     = React.useState('');
  const [hidePaused, setHidePaused] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: 'utilization_pct', dir: 'desc' });

  const handleSort = React.useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return { key: null, dir: 'asc' };
    });
  }, []);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    dealsAutomationApi.getData()
      .then(r => { setData(r.data); setDatasetId(r.data?.dataset_id ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  const managerOptions: string[] = React.useMemo(() => {
    if (!data?.rows) return [];
    const set = new Set<string>();
    for (const r of data.rows) if (r.account_manager) set.add(r.account_manager);
    return Array.from(set).sort();
  }, [data]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    // Augment each pool row with direction-aware commercial derivations.
    // INBOUND : rate = revenue (sell), cost_rate = approved cost.
    // OUTBOUND: rate = approved cost, cost_rate = revenue (sell).
    let f: any[] = data.rows.map((r: any) => {
      const inbound  = r.direction === 'INBOUND';
      const sellRate = inbound ? r.approved_rate : r.approved_cost_rate;
      const costRate = inbound ? r.approved_cost_rate : r.approved_rate;
      const vol      = r.committed_volume;
      const revenue  = vol != null && sellRate != null ? vol * sellRate : null;
      const cost     = vol != null && costRate != null ? vol * costRate : null;
      const margin   = revenue != null && cost != null ? revenue - cost : null;
      const marginPct= margin != null && revenue ? (margin / revenue) * 100 : null;
      const remaining= vol != null && r.consumed_volume != null ? vol - r.consumed_volume : null;
      const revDone  = r.consumed_volume != null && sellRate != null ? r.consumed_volume * sellRate : null;
      const daily    = remaining != null && r.days_to_expiry != null && r.days_to_expiry > 0 ? remaining / r.days_to_expiry : null;
      return { ...r, sell_rate: sellRate, cost_rate: costRate, revenue, cost, margin, margin_pct: marginPct, remaining, rev_done: revDone, daily_need: daily };
    });
    if (dir !== 'ALL')   f = f.filter((r: any) => r.direction === dir);
    if (hidePaused)      f = f.filter((r: any) => !r.is_paused);
    if (manager)         f = f.filter((r: any) => r.account_manager === manager);
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.account_name ?? '').toLowerCase().includes(q) ||
        (r.destinations ?? '').toLowerCase().includes(q) ||
        (r.vendors ?? '').toLowerCase().includes(q) ||
        (r.deal_reference ?? '').toLowerCase().includes(q));
    }
    if (!sort.key) return f;
    const { key, dir: sd } = sort;
    return [...f].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sd === 'asc' ? cmp : -cmp;
    });
  }, [data, dir, hidePaused, manager, search, sort]);

  // API responses pass through the backend's global SnakeCaseInterceptor,
  // so all keys arrive in snake_case (total_rows, last_refreshed, …).
  const s = data?.summary;
  const lastRefreshed: string | null = data?.last_refreshed ?? null;
  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };
  const isOut = dir === 'OUTBOUND';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{ margin: '-24px', padding: '20px 24px 0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>Deal Monitoring</div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>Deals Automation</h1>
          </div>
          {lastRefreshed && (
            <div className="zdcard" style={{ padding: '6px 14px' }}>
              <div className="dlbl">Last Updated</div>
              <div className="dval" style={{ fontSize: 14 }}><span className="zpulse" /><span>{new Date(lastRefreshed).toLocaleString()}</span></div>
            </div>
          )}
        </div>

        {error && (
          <div className="zalert" style={{ flexShrink: 0, marginBottom: 12 }}>
            <span style={{ color: 'var(--alizarin)', display: 'flex' }}>{IC.alert}</span>
            <p>Could not load data: {error}</p>
          </div>
        )}

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 14, flexShrink: 0 }}>
          <Kpi color="kd" label="Line Items"      icon={IC.deal}  value={fN(s?.total_rows)}    sub={`${fN(s?.inbound)} in · ${fN(s?.outbound)} out`} />
          <Kpi color="kc" label="≥ 80% Utilised"  icon={IC.gauge} value={fN(s?.over80)}        sub="volume alert" />
          <Kpi color="kr" label="≥ 100% Utilised" icon={IC.gauge} value={fN(s?.over100)}       sub="fully consumed" />
          <Kpi color="kp" label="Rate Mismatch"   icon={IC.scale} value={fN(s?.rate_mismatch)} sub="live ≠ approved" />
          <Kpi color="kb" label="Expiring ≤ 7d"   icon={IC.clock} value={fN(s?.near_expiry)}   sub="approaching end" />
        </div>

        {/* Table panel */}
        <div className="zpnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <div className="zph" style={{ flexWrap: 'wrap', gap: 10, flexShrink: 0, padding: '12px 16px 10px' }}>
            <div>
              <h2 style={{ fontSize: 13 }}>Deals Automation Feed</h2>
              <span className="ztag" style={{ display: 'block', marginTop: 2 }}>
                {sort.key ? `Sorted by ${sort.key.replace(/_/g, ' ')} ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Click a column header to sort'} · {rows.length} rows
              </span>
            </div>
            {/* Filters — top right */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Direction segmented toggle */}
              <div className="zseg">
                <button className={dir === 'ALL' ? 'on all' : ''} onClick={() => setDir('ALL')}>All</button>
                <button className={dir === 'INBOUND' ? 'on in' : ''} onClick={() => setDir('INBOUND')}>Inbound</button>
                <button className={dir === 'OUTBOUND' ? 'on out' : ''} onClick={() => setDir('OUTBOUND')}>Outbound</button>
              </div>
              <select value={manager} onChange={e => setManager(e.target.value)} className="zdi" style={{ width: 160, fontSize: 13, padding: '7px 10px' }}>
                <option value="">All Managers</option>
                {managerOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--mu)', pointerEvents: 'none', display: 'flex' }}>{IC.search}</span>
                <input type="text" placeholder="Search account / destination / vendor…" value={search} onChange={e => setSearch(e.target.value)} className="zdi" style={{ width: 230, fontSize: 13, padding: '7px 10px 7px 28px' }} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--inks)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={hidePaused} onChange={e => setHidePaused(e.target.checked)} />
                Hide paused
              </label>
              {(dir !== 'ALL' || manager || search || hidePaused) && (
                <button onClick={() => { setDir('ALL'); setManager(''); setSearch(''); setHidePaused(false); }}
                  style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {loading ? <Skel /> : (
              <table className="zt" style={{ minWidth: '100%' }}>
                <thead>
                  <tr>
                    <TH left w={110} colKey="deal_reference"        sort={srt}>Deal Ref</TH>
                    <TH left w={60}  colKey="direction"             sort={srt}>Dir</TH>
                    <TH left w={140} colKey="account_name"          sort={srt}>Account</TH>
                    <TH left w={230} colKey="destinations"          sort={srt}>Destinations</TH>
                    <TH left w={130} colKey="vendors"               sort={srt}>Vendor</TH>
                    <TH left w={85}  colKey="start_date"            sort={srt}>Start</TH>
                    <TH left w={85}  colKey="end_date"              sort={srt}>End</TH>
                    <TH      w={80}  colKey="days_to_expiry"        sort={srt}>Days Left</TH>
                    <TH      w={110} colKey="committed_volume"      sort={srt}>Volume</TH>
                    <TH      w={90}  colKey="sell_rate"             sort={srt}>Sell Rate</TH>
                    <TH      w={110} colKey="revenue"               sort={srt}>Revenue</TH>
                    <TH      w={90}  colKey="cost_rate"             sort={srt}>Term Cost</TH>
                    <TH      w={110} colKey="cost"                  sort={srt}>Cost</TH>
                    <TH      w={100} colKey="margin"                sort={srt}>Margin</TH>
                    <TH      w={85}  colKey="margin_pct"            sort={srt}>% Margin</TH>
                    <TH      w={100} colKey="utilization_pct"       sort={srt}>Utilised %</TH>
                    <TH      w={100} colKey="consumed_volume"       sort={srt}>Mins Done</TH>
                    <TH      w={110} colKey="remaining"             sort={srt}>Remaining</TH>
                    <TH      w={100} colKey="rev_done"              sort={srt}>Rev Done</TH>
                    <TH      w={110} colKey="rate_variance_per_min" sort={srt}>Rate Var</TH>
                    <TH left w={70}  colKey="is_paused"             sort={srt}>Paused</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={21} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : (search || manager || dir !== 'ALL') ? 'No matching rows' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r: any, i: number) => {
                    const util = r.utilization_pct;
                    const rowCls = util != null && util >= 100 ? 'row-critical' : util != null && util >= 80 ? 'row-risk' : '';
                    // Rate mismatch: variance direction is already baked in by the SQL.
                    const variance = r.rate_variance_per_min;
                    const hasMismatch = variance != null && Number(variance.toFixed(6)) !== 0;
                    const days = r.days_to_expiry;
                    const daysColor = days == null ? 'var(--mu)' : days < 0 ? '#e74c3c' : days <= 7 ? '#e67e22' : days <= 30 ? '#d4ac0d' : 'var(--inks)';
                    return (
                      <tr key={`${r.line_item_id}-${i}`} className={rowCls}>
                        <TD left style={{ fontWeight: 700, color: 'var(--ink)' }}>{r.deal_reference ?? '—'}</TD>
                        <TD left>
                          <span className={`dir-badge ${r.direction === 'OUTBOUND' ? 'dir-out' : 'dir-in'}`}>{r.direction === 'OUTBOUND' ? 'OUT' : 'IN'}</span>
                        </TD>
                        <TD left style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink)', fontWeight: 600 }}><span title={r.account_name ?? ''}>{r.account_name ?? '—'}</span></TD>
                        <TD left style={{ maxWidth: 230, whiteSpace: 'normal', lineHeight: 1.35, color: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif" }}>
                          <span title={r.destinations ?? ''}>{r.destinations ?? '—'}</span>
                        </TD>
                        <TD left style={{ maxWidth: 130, color: 'var(--inks)' }}>
                          <span title={r.vendors ?? ''} style={{ display: 'inline-block', maxWidth: 124, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom', fontSize: 12 }}>{r.vendors ?? '—'}</span>
                        </TD>
                        <TD left style={{ color: 'var(--inks)' }}>{fDate(r.start_date)}</TD>
                        <TD left style={{ color: 'var(--inks)' }}>{fDate(r.end_date)}</TD>
                        <TD style={{ color: daysColor, fontWeight: days != null && days <= 7 ? 700 : 400 }}>
                          {days == null ? '—' : `${days}d`}
                        </TD>
                        <TD>{fN(r.committed_volume, 2)}</TD>
                        <TD>{fRate(r.sell_rate)}</TD>
                        <TD>{fN(r.revenue, 2)}</TD>
                        <TD>{fRate(r.cost_rate)}</TD>
                        <TD>{fN(r.cost, 2)}</TD>
                        <TD style={{ color: r.margin != null ? (r.margin >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--inks)', fontWeight: 600 }}>{fN(r.margin, 2)}</TD>
                        <TD style={{ color: r.margin_pct != null ? (r.margin_pct >= 0 ? 'var(--pos)' : 'var(--neg)') : 'var(--inks)', fontWeight: 600 }}>{r.margin_pct != null ? `${r.margin_pct.toFixed(2)}%` : '—'}</TD>
                        <TD><div style={{ display: 'flex', justifyContent: 'flex-end' }}><UtilBadge pct={util} /></div></TD>
                        <TD>{fN(r.consumed_volume, 2)}</TD>
                        <TD>{fN(r.remaining, 2)}</TD>
                        <TD>{fN(r.rev_done, 2)}</TD>
                        <TD style={{ color: hasMismatch ? (variance > 0 ? 'var(--neg)' : 'var(--pos)') : 'var(--inks)', fontWeight: hasMismatch ? 700 : 400 }}>
                          {variance == null ? '—' : `${variance > 0 ? '+' : ''}${fRate(variance)}`}
                        </TD>
                        <TD left>
                          {r.is_paused
                            ? <span className="dir-badge" style={{ background: 'rgba(230,126,34,.15)', color: 'var(--carrot)' }}>PAUSED</span>
                            : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Legend */}
          {!loading && rows.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--ln)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 700 }}>Row highlight:</span>
              <div className="zleg-row"><span className="zleg-dot" style={{ background: 'rgba(230,126,34,.35)' }} />≥ 80% utilised</div>
              <div className="zleg-row"><span className="zleg-dot" style={{ background: 'rgba(231,76,60,.35)' }} />≥ 100% utilised</div>
              <span style={{ fontSize: 11, color: 'var(--mu)', marginLeft: 8 }}>Rate Var ≠ 0 = live rate differs from approved{isOut ? ' deal rate' : ' swap-draft cost'}.</span>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
