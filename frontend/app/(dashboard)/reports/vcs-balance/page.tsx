'use client';

import * as React from 'react';
import { vcsBalanceApi } from '@/lib/api';

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

.zk{border-radius:10px;padding:18px 18px 16px;color:#fff;box-shadow:0 4px 0 rgba(0,0,0,.15)}
.zk.kt{background:var(--turquoise)} .zk.kb{background:var(--river)} .zk.kg{background:var(--emerald)}
.zk.kc{background:var(--carrot)} .zk.kr{background:var(--alizarin)} .zk.kp{background:var(--amethyst)}
.zk.kd{background:var(--asphalt)}
.zk-top{display:flex;align-items:center;justify-content:space-between;opacity:.92}
.zk-lbl{font-size:12.5px;font-weight:700;letter-spacing:.01em}
.zk-ic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.22)}
.zk-ic svg{width:17px;height:17px}
.zk-val{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:26px;margin-top:14px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.zk-sub{font-size:12px;margin-top:5px;opacity:.88;display:flex;align-items:center;gap:5px}

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
.zbt{border:0;background:var(--turquoise);color:#fff;font-family:'Hanken Grotesk',sans-serif;font-weight:700;
  font-size:13px;padding:9px 18px;border-radius:7px;cursor:pointer;box-shadow:0 3px 0 var(--green-sea);transition:.12s;white-space:nowrap}
.zbt:hover{filter:brightness(1.06)}.zbt:active{transform:translateY(2px);box-shadow:0 1px 0 var(--green-sea)}
.zbt:disabled{opacity:.5;cursor:not-allowed;transform:none}

.zt{width:100%;border-collapse:collapse;font-size:13.5px}
.zt thead th{text-align:right;font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--mu);padding:0 16px 11px;border-bottom:2px solid var(--lns);white-space:nowrap}
.zt thead th:first-child,.zt thead th.tl{text-align:left}
.zt tbody td{padding:11px 16px;border-bottom:1px solid var(--ln);text-align:right;
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;color:var(--inks);white-space:nowrap}
.zt tbody td:first-child,.zt tbody td.tl{text-align:left;font-family:'Hanken Grotesk',sans-serif;font-weight:600;color:var(--ink)}
.zt tbody tr:nth-child(even){background:var(--stripe)}
.zt tbody tr:hover{background:var(--sf2)}
.zt tfoot td{padding:12px 16px;font-family:'JetBrains Mono',monospace;font-weight:700;font-variant-numeric:tabular-nums;
  text-align:right;color:var(--ink);border-top:2px solid var(--lns);background:var(--sf2)}
.zt tfoot td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif}

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
`;

const IC = {
  users:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  credit:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  alert:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  critical: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>,
  refresh:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>,
  search:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
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

// Common Jerasoft currency name → ISO 4217 code map
const CURRENCY_MAP: Record<string, string> = {
  'us dollar': 'USD', 'euro': 'EUR', 'british pound': 'GBP', 'pound sterling': 'GBP',
  'australian dollar': 'AUD', 'canadian dollar': 'CAD', 'swiss franc': 'CHF',
  'japanese yen': 'JPY', 'chinese yuan': 'CNY', 'hong kong dollar': 'HKD',
  'singapore dollar': 'SGD', 'swedish krona': 'SEK', 'norwegian krone': 'NOK',
  'danish krone': 'DKK', 'new zealand dollar': 'NZD', 'south african rand': 'ZAR',
  'uae dirham': 'AED', 'saudi riyal': 'SAR', 'turkish lira': 'TRY',
  'russian ruble': 'RUB', 'indian rupee': 'INR', 'brazilian real': 'BRL',
  'mexican peso': 'MXN', 'polish zloty': 'PLN', 'czech koruna': 'CZK',
};

const resolveCode = (name?: string): string | null => {
  if (!name) return null;
  // Try as-is (might already be ISO code like "USD")
  if (/^[A-Z]{3}$/.test(name)) return name;
  return CURRENCY_MAP[name.toLowerCase()] ?? null;
};

const fmtCur = (n: any, currency?: string): string => {
  if (n == null) return '—';
  const num = Number(n);
  const code = resolveCode(currency);
  if (code) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
    } catch { /* unknown code – fall through */ }
  }
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtRev = (n: any) =>
  n != null ? `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
const fmtPct = (n: any) => n != null ? `${Number(n).toFixed(1)}%` : '—';

function RemainingBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span style={{ color: 'var(--mu)' }}>—</span>;

  const [pillBg, pillColor, barColor] =
    pct < 10  ? ['rgba(231,76,60,.18)',  '#e74c3c', '#e74c3c'] :
    pct < 20  ? ['rgba(230,126,34,.18)', '#e67e22', '#e67e22'] :
    pct < 50  ? ['rgba(241,196,15,.18)', '#d4ac0d', '#f1c40f'] :
                ['rgba(46,204,113,.18)', '#27ae60', '#2ecc71'];

  return (
    <div className="pct-wrap">
      <span className="pct-pill" style={{ background: pillBg, color: pillColor }}>{fmtPct(pct)}</span>
      <div className="pct-bar">
        <div className="pct-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
      </div>
    </div>
  );
}

function rowClass(pct: number | null): string {
  if (pct == null) return '';
  if (pct < 10) return 'row-critical';
  if (pct < 20) return 'row-risk';
  return '';
}

const TH = ({ children, left, w, colKey, sort }: {
  children: React.ReactNode; left?: boolean; w?: number;
  colKey?: string; sort?: SortState;
}) => {
  const isActive = !!colKey && sort?.key === colKey;
  return (
    <th
      onClick={colKey ? () => sort?.set(colKey) : undefined}
      style={{
        textAlign: left ? 'left' : 'right',
        position: 'sticky', top: 0,
        background: 'var(--sf)',
        zIndex: 1,
        padding: '10px 10px 10px',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        color: isActive ? 'var(--turquoise)' : 'var(--mu)',
        whiteSpace: 'nowrap',
        borderBottom: isActive ? '2px solid var(--turquoise)' : '2px solid var(--lns)',
        cursor: colKey ? 'pointer' : 'default',
        userSelect: 'none',
        ...(w ? { width: w, minWidth: w } : {}),
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {children}
        {colKey && (
          <span style={{ opacity: isActive ? 1 : 0.3, fontSize: 9, lineHeight: 1 }}>
            {isActive ? (sort?.dir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        )}
      </span>
    </th>
  );
};

const TD = ({ children, left, style }: { children: React.ReactNode; left?: boolean; style?: React.CSSProperties }) => (
  <td style={{ textAlign: left ? 'left' : 'right', padding: '9px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ln)', ...style }}>
    {children}
  </td>
);

type SortDir = 'asc' | 'desc';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }

export default function VoiceCreditLimitPage() {
  const [data, setData]       = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError]     = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [filterCarrier, setFilterCarrier]   = React.useState('');
  const [filterManager, setFilterManager]   = React.useState('');
  const [sort, setSort]       = React.useState<{ key: string | null; dir: SortDir }>({ key: 'remaining_balance_pct', dir: 'asc' });

  const handleSort = React.useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc')  return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  }, []);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    vcsBalanceApi
      .getData()
      .then(r => { setData(r.data); })
      .catch((err: any) => {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to load data';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const managerOptions: string[] = React.useMemo(() => {
    if (!data?.rows) return [];
    const set = new Set<string>();
    for (const r of data.rows) { if (r.account_manager) set.add(r.account_manager); }
    return Array.from(set).sort();
  }, [data]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let filtered: any[] = data.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r: any) => (r.company_name ?? '').toLowerCase().includes(q));
    }
    if (filterCarrier) filtered = filtered.filter((r: any) => r.carrier === filterCarrier);
    if (filterManager) filtered = filtered.filter((r: any) => r.account_manager === filterManager);
    if (!sort.key) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, search, filterCarrier, filterManager, sort]);

  const s = data?.summary;
  const lastRefreshed: string | null = data?.lastRefreshed ?? null;
  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };

  const totalClients    = s?.totalClients    ?? 0;
  const totalCreditLim  = s?.totalCreditLimit ?? 0;
  const totalRemaining  = s?.totalRemaining   ?? 0;
  const clientsAtRisk   = s?.clientsAtRisk    ?? 0;
  const clientsCritical = s?.clientsCritical  ?? 0;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{
        margin: '-24px',
        padding: '20px 24px 0',
        height: 'calc(100vh - 56px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>Credit Overview</div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>
              Voice Credit Limit
            </h1>
          </div>
          {lastRefreshed && (
            <div className="zdcard" style={{ padding: '6px 14px' }}>
              <div className="dlbl">Last Updated</div>
              <div className="dval" style={{ fontSize: 14 }}><span className="zpulse" /><span>{new Date(lastRefreshed).toLocaleString()}</span></div>
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="zalert" style={{ flexShrink: 0, marginBottom: 12 }}>
            <span style={{ color: 'var(--alizarin)', display: 'flex' }}>{IC.alert}</span>
            <p>Could not load data: {error}</p>
          </div>
        )}

        {/* Critical alert */}
        {clientsCritical > 0 && (
          <div className="zalert" style={{ flexShrink: 0, marginBottom: 12 }}>
            <span style={{ color: 'var(--alizarin)', display: 'flex' }}>{IC.alert}</span>
            <p><strong>{clientsCritical} client{clientsCritical > 1 ? 's' : ''}</strong> at critical credit level — less than 10% remaining.</p>
          </div>
        )}


        {/* Table panel */}
        <div className="zpnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          {/* Panel header */}
          <div className="zph" style={{ flexWrap: 'wrap', gap: 10, flexShrink: 0, padding: '12px 16px 10px' }}>
            <div>
              <h2 style={{ fontSize: 13 }}>Voice Credit Limit Data</h2>
              <span className="ztag" style={{ display: 'block', marginTop: 2 }}>
                {sort.key
                  ? `Sorted by ${sort.key.replace(/_/g, ' ')} ${sort.dir === 'asc' ? '↑' : '↓'}`
                  : 'Click a column header to sort'} · {rows.length} clients
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* Carrier filter */}
              <select
                value={filterCarrier}
                onChange={e => setFilterCarrier(e.target.value)}
                className="zdi"
                style={{ width: 110, fontSize: 13, padding: '7px 10px' }}
              >
                <option value="">All Carriers</option>
                <option value="Hayo">Hayo</option>
                <option value="CN">CN</option>
                <option value="Other">Other</option>
              </select>
              {/* Account Manager filter */}
              <select
                value={filterManager}
                onChange={e => setFilterManager(e.target.value)}
                className="zdi"
                style={{ width: 160, fontSize: 13, padding: '7px 10px' }}
              >
                <option value="">All Managers</option>
                {managerOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {/* Company name search */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: 'var(--mu)', pointerEvents: 'none', display: 'flex' }}>{IC.search}</span>
                <input
                  type="text"
                  placeholder="Search company…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="zdi"
                  style={{ width: 180, fontSize: 13, padding: '7px 10px 7px 28px' }}
                />
              </div>
              {/* Clear filters */}
              {(filterCarrier || filterManager || search) && (
                <button
                  onClick={() => { setFilterCarrier(''); setFilterManager(''); setSearch(''); }}
                  style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>

          {/* Table scroll area */}
          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {loading ? <Skel /> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
                <thead>
                  <tr>
                    <TH left  w={160} colKey="company_name"           sort={srt}>Company Name</TH>
                    <TH left  w={75}  colKey="carrier"                sort={srt}>Carrier</TH>
                    <TH left  w={130} colKey="account_manager"        sort={srt}>Account Manager</TH>
                    <TH left  w={110} colKey="payment_term"           sort={srt}>Payment Term</TH>
                    <TH       w={110} colKey="credit_limit"           sort={srt}>Credit Limit</TH>
                    <TH       w={120} colKey="current_balance"        sort={srt}>Current Balance</TH>
                    <TH       w={110} colKey="remaining_balance"      sort={srt}>Remaining CL</TH>
                    <TH       w={110} colKey="remaining_balance_pct"  sort={srt}>Remaining CL %</TH>
                    <TH       w={140} colKey="avg_amount_last_3_days" sort={srt}>Avg Daily Usage (3d)</TH>
                    <TH       w={120} colKey="yesterday_amount"       sort={srt}>Yesterday Usage</TH>
                    <TH       w={110} colKey="days_until_zero"        sort={srt}>Days to Reach CL</TH>
                    <TH       w={120} colKey="cl_in_next_3_days"      sort={srt}>CL in Next 3 Days</TH>
                    <TH left  w={80}  colKey="currency_name"    sort={srt}>Currency</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={13} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : search ? 'No matching clients' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r: any) => {
                    const pct      = r.remaining_balance_pct;
                    const rowCls   = pct != null && pct < 10 ? 'row-critical' : pct != null && pct < 20 ? 'row-risk' : '';
                    const remColor = r.remaining_balance < 0 ? 'var(--neg)' : pct != null && pct < 20 ? '#e67e22' : 'var(--pos)';
                    const days     = r.days_until_zero;
                    const daysColor = days == null ? 'var(--mu)' : days <= 2 ? '#e74c3c' : days <= 7 ? '#e67e22' : days <= 30 ? '#d4ac0d' : '#27ae60';
                    return (
                      <tr key={r.clients_id} className={rowCls}>
                        <TD left style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <div style={{ fontWeight: 700, color: 'var(--ink)', fontFamily: "'Hanken Grotesk',sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.company_name}>
                            {r.company_name}
                          </div>
                        </TD>
                        <TD left>
                          {r.carrier === 'Hayo' || r.carrier === 'CN' ? (
                            <span style={{
                              display: 'inline-block', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                              background: r.carrier === 'Hayo' ? 'rgba(26,188,156,.15)' : 'rgba(52,152,219,.15)',
                              color:      r.carrier === 'Hayo' ? 'var(--turquoise)'      : 'var(--river)',
                            }}>{r.carrier}</span>
                          ) : null}
                        </TD>
                        <TD left style={{ color: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif", maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span title={r.account_manager ?? ''}>{r.account_manager ?? '—'}</span>
                        </TD>
                        <TD left style={{ color: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif" }}>{r.payment_term ?? '—'}</TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--inks)' }}>{fmtCur(r.credit_limit, r.currency_name)}</TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--inks)' }}>{fmtCur(r.current_balance, r.currency_name)}</TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: remColor, fontWeight: 600 }}>{fmtCur(r.remaining_balance, r.currency_name)}</TD>
                        <TD>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <RemainingBadge pct={pct} />
                          </div>
                        </TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--inks)' }}>
                          {r.avg_amount_last_3_days != null ? fmtCur(r.avg_amount_last_3_days, r.currency_name) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--inks)' }}>
                          {r.yesterday_amount != null ? fmtCur(r.yesterday_amount, r.currency_name) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: daysColor, fontWeight: days != null && days <= 7 ? 700 : 400 }}>
                          {days == null ? <span style={{ color: 'var(--mu)' }}>—</span> : days <= 0 ? 'NOW' : `${days}d`}
                        </TD>
                        <TD style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color: r.cl_in_next_3_days != null && r.cl_in_next_3_days < 0 ? 'var(--neg)' : 'var(--inks)' }}>
                          {r.cl_in_next_3_days != null ? fmtCur(r.cl_in_next_3_days, r.currency_name) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD left style={{ color: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif" }}>{r.currency_name ?? '—'}</TD>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={4} style={{ padding: '10px 10px', fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        Total ({rows.length} clients)
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        {fmtRev(totalCreditLim)}
                      </td>
                      <td style={{ padding: '10px 10px', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }} />
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        {fmtRev(totalRemaining)}
                      </td>
                      <td colSpan={6} style={{ padding: '10px 10px', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>

          {/* Legend */}
          {!loading && rows.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--ln)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 700 }}>Colour key:</span>
              {[
                { color: 'rgba(231,76,60,.35)',  label: '< 10% Critical' },
                { color: 'rgba(230,126,34,.3)',  label: '10–20% At risk' },
                { color: 'rgba(241,196,15,.35)', label: '20–50% Watch' },
                { color: 'rgba(46,204,113,.35)', label: '> 50% Healthy' },
              ].map(item => (
                <div key={item.label} className="zleg-row" style={{ fontSize: 11 }}>
                  <span className="zleg-dot" style={{ background: item.color }} />
                  {item.label}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
