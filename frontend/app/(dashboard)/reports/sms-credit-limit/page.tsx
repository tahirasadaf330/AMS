'use client';

import * as React from 'react';
import { smsCreditLimitApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.scl{
  --turquoise:#1abc9c;--green-sea:#16a085;--emerald:#2ecc71;--nephritis:#27ae60;
  --river:#3498db;--belize:#2980b9;--amethyst:#9b59b6;
  --asphalt:#34495e;--midnight:#2c3e50;
  --carrot:#e67e22;--alizarin:#e74c3c;
  --pos:#27ae60;--neg:#e74c3c;
  --bg:#ecf0f1;--sf:#ffffff;--sf2:#f5f7f8;--stripe:#f9fafb;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  font-family:-apple-system,sans-serif;
  color:var(--ink);background:var(--bg);
}
.dark .scl{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}
.scl-pnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.scl-ph{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;border-bottom:1px solid var(--ln);flex-wrap:wrap;gap:10px}
.scl-ph h2{font-weight:700;font-size:13px;color:var(--ink)}
.scl-tag{font-size:11px;color:var(--mu);font-weight:600}
.scl-di{appearance:none;font-size:13px;color:var(--ink);background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:7px 10px;color-scheme:light}
.dark .scl-di{color-scheme:dark}
.scl-di:focus{outline:none;border-color:var(--turquoise)}
.pct-wrap{display:inline-flex;flex-direction:column;align-items:flex-end;gap:3px}
.pct-pill{display:inline-flex;align-items:center;border-radius:20px;padding:1px 8px;font-size:11.5px;font-weight:700;font-family:monospace}
.pct-bar{width:52px;height:3px;border-radius:2px;background:var(--lns);overflow:hidden}
.pct-bar-fill{height:100%;border-radius:2px}
.row-critical{background:rgba(231,76,60,.06)!important}
.row-risk{background:rgba(230,126,34,.05)!important}
.row-critical:hover{background:rgba(231,76,60,.11)!important}
.row-risk:hover{background:rgba(230,126,34,.1)!important}
.scl-alert{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);margin-bottom:16px}
.scl-alert p{font-size:13.5px;color:#e74c3c;font-weight:600}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:monospace;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
.zleg-row{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--inks)}
.zleg-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0}
`;

const IC = {
  alert:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:18,height:18}}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
};

type SortDir = 'asc' | 'desc';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }

const fmtNum = (n: any, currency?: string): string => {
  if (n == null) return '—';
  const num = Number(n);
  if (currency) {
    try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num); } catch {}
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
// A formatted number with a minus sign but no non-zero digit is a "-0" — never show the sign.
const zz = (s: string) => s.includes('-') && !/[1-9]/.test(s) ? s.replace('-', '') : s;
const fmtPct = (n: any) => n != null ? zz(`${Number(n).toFixed(1)}%`) : '—';

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
      <div className="pct-bar"><div className="pct-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} /></div>
    </div>
  );
}

const TH = ({ children, left, w, colKey, sort }: { children: React.ReactNode; left?: boolean; w?: number; colKey?: string; sort?: SortState }) => {
  const isActive = !!colKey && sort?.key === colKey;
  return (
    <th onClick={colKey ? () => sort?.set(colKey) : undefined} style={{
      textAlign: left ? 'left' : 'right', position: 'sticky', top: 0,
      background: 'var(--sf)', zIndex: 1, padding: '10px 10px',
      fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
      color: isActive ? 'var(--turquoise)' : 'var(--mu)', whiteSpace: 'nowrap',
      borderBottom: isActive ? '2px solid var(--turquoise)' : '2px solid var(--lns)',
      cursor: colKey ? 'pointer' : 'default', userSelect: 'none',
      ...(w ? { width: w, minWidth: w } : {}),
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {children}
        {colKey && <span style={{ opacity: isActive ? 1 : 0.3, fontSize: 9 }}>{isActive ? (sort?.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
      </span>
    </th>
  );
};

const TD = ({ children, left, style }: { children: React.ReactNode; left?: boolean; style?: React.CSSProperties }) => (
  <td style={{ textAlign: left ? 'left' : 'right', padding: '9px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ln)', ...style }}>
    {children}
  </td>
);

function Skel() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(8)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

export default function SmsCreditLimitPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [filterManager, setFilterManager] = React.useState('');
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: 'remaining_net_cl_pct', dir: 'asc' });

  const handleSort = React.useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: null, dir: 'asc' };
    });
  }, []);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    smsCreditLimitApi.getData()
      .then(r => { setData(r.data); setDatasetId(r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  const managerOptions: string[] = React.useMemo(() => {
    if (!data?.rows) return [];
    const set = new Set<string>();
    for (const r of data.rows) { if (r.account_manager) set.add(r.account_manager); }
    return Array.from(set).sort();
  }, [data]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let filtered = data.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((r: any) => (r.company_name ?? '').toLowerCase().includes(q));
    }
    if (filterManager) filtered = filtered.filter((r: any) => r.account_manager === filterManager);
    if (!sort.key) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, search, filterManager, sort]);

  const s = data?.summary;
  const lastRefreshed: string | null = data?.lastRefreshed ?? null;
  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };
  const clientsCritical = s?.clientsCritical ?? 0;
  const totalCreditLimit = s?.totalCreditLimit ?? 0;
  const totalRemaining   = s?.totalRemaining ?? 0;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="scl w-full" style={{ margin: '-24px', padding: '20px 24px 0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>Credit Overview</div>
            <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>SMS Credit Limit</h1>
          </div>
          {lastRefreshed && (
            <div className="zdcard">
              <div className="dlbl">Last Updated</div>
              <div className="dval"><span className="zpulse" /><span>{new Date(lastRefreshed).toLocaleString()}</span></div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="scl-alert" style={{ flexShrink: 0 }}>
            <span style={{ color: '#e74c3c', display: 'flex' }}>{IC.alert}</span>
            <p>Could not load data: {error}</p>
          </div>
        )}

        {/* Critical alert */}
        {clientsCritical > 0 && (
          <div className="scl-alert" style={{ flexShrink: 0 }}>
            <span style={{ color: '#e74c3c', display: 'flex' }}>{IC.alert}</span>
            <p><strong>{clientsCritical} client{clientsCritical > 1 ? 's' : ''}</strong> at critical credit level — less than 10% remaining.</p>
          </div>
        )}

        {/* Table panel */}
        <div className="scl-pnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <div className="scl-ph">
            <div>
              <h2>SMS Credit Limit Data</h2>
              <span className="scl-tag" style={{ display: 'block', marginTop: 2 }}>
                {sort.key ? `Sorted by ${sort.key.replace(/_/g, ' ')} ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Click column to sort'} · {rows.length} clients
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <select value={filterManager} onChange={e => setFilterManager(e.target.value)} className="scl-di" style={{ width: 160 }}>
                <option value="">All Managers</option>
                {managerOptions.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--mu)', pointerEvents: 'none', display: 'flex' }}>{IC.search}</span>
                <input type="text" placeholder="Search company…" value={search} onChange={e => setSearch(e.target.value)} className="scl-di" style={{ width: 180, paddingLeft: 28 }} />
              </div>
              {(filterManager || search) && (
                <button onClick={() => { setFilterManager(''); setSearch(''); }} style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {loading ? <Skel /> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
                <thead>
                  <tr>
                    <TH left w={170} colKey="company_name"               sort={srt}>Company Name</TH>
                    <TH left w={140} colKey="account_manager"            sort={srt}>Account Manager</TH>
                    <TH      w={110} colKey="credit_limit"               sort={srt}>Credit Limit</TH>
                    <TH      w={110} colKey="client_usage"               sort={srt}>Client Usage</TH>
                    <TH      w={110} colKey="client_balance"             sort={srt}>Client Balance</TH>
                    <TH      w={120} colKey="remaining_net_cl"           sort={srt}>Remaining Net CL</TH>
                    <TH      w={120} colKey="remaining_net_cl_pct"       sort={srt}>Remaining Net CL%</TH>
                    <TH      w={150} colKey="avg_daily_usage_last_7_days" sort={srt}>Avg Daily Usage (7d)</TH>
                    <TH      w={130} colKey="yesterday_usage"            sort={srt}>Yesterday Usage</TH>
                    <TH      w={120} colKey="days_to_reach_cl"           sort={srt}>Days to Reach CL</TH>
                    <TH      w={130} colKey="cl_in_next_7_days"          sort={srt}>CL in Next 7 Days</TH>
                    <TH left w={80}  colKey="currency"                   sort={srt}>Currency</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={12} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : search ? 'No matching clients' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r: any, i: number) => {
                    const pct      = r.remaining_net_cl_pct;
                    const rowCls   = pct != null && pct < 10 ? 'row-critical' : pct != null && pct < 20 ? 'row-risk' : '';
                    const remColor = r.remaining_net_cl < 0 ? 'var(--neg)' : pct != null && pct < 20 ? '#e67e22' : 'var(--pos)';
                    const days     = r.days_to_reach_cl;
                    const daysColor = days == null ? 'var(--mu)' : days <= 2 ? '#e74c3c' : days <= 7 ? '#e67e22' : days <= 30 ? '#d4ac0d' : '#27ae60';
                    return (
                      <tr key={i} className={rowCls}>
                        <TD left style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }} title={r.company_name}>{r.company_name}</span>
                        </TD>
                        <TD left style={{ color: 'var(--inks)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <span title={r.account_manager ?? ''}>{r.account_manager ?? '—'}</span>
                        </TD>
                        <TD style={{ fontFamily: 'monospace', color: 'var(--inks)' }}>{fmtNum(r.credit_limit, r.currency)}</TD>
                        <TD style={{ fontFamily: 'monospace', color: 'var(--inks)' }}>{fmtNum(r.client_usage, r.currency)}</TD>
                        <TD style={{ fontFamily: 'monospace', color: 'var(--inks)' }}>{fmtNum(r.client_balance, r.currency)}</TD>
                        <TD style={{ fontFamily: 'monospace', color: remColor, fontWeight: 600 }}>{fmtNum(r.remaining_net_cl, r.currency)}</TD>
                        <TD><div style={{ display: 'flex', justifyContent: 'flex-end' }}><RemainingBadge pct={pct} /></div></TD>
                        <TD style={{ fontFamily: 'monospace', color: 'var(--inks)' }}>
                          {r.avg_daily_usage_last_7_days != null ? fmtNum(r.avg_daily_usage_last_7_days, r.currency) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD style={{ fontFamily: 'monospace', color: 'var(--inks)' }}>
                          {r.yesterday_usage != null ? fmtNum(r.yesterday_usage, r.currency) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD style={{ fontFamily: 'monospace', color: daysColor, fontWeight: days != null && days <= 7 ? 700 : 400 }}>
                          {days == null ? <span style={{ color: 'var(--mu)' }}>—</span> : days <= 0 ? 'NOW' : `${days}d`}
                        </TD>
                        <TD style={{ fontFamily: 'monospace', color: r.cl_in_next_7_days != null && r.cl_in_next_7_days < 0 ? 'var(--neg)' : 'var(--inks)' }}>
                          {r.cl_in_next_7_days != null ? fmtNum(r.cl_in_next_7_days, r.currency) : <span style={{ color: 'var(--mu)' }}>—</span>}
                        </TD>
                        <TD left style={{ color: 'var(--inks)' }}>{r.currency ?? '—'}</TD>
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        Total ({rows.length} clients)
                      </td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        {fmtNum(totalCreditLimit)}
                      </td>
                      <td colSpan={2} style={{ borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }} />
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }}>
                        {fmtNum(totalRemaining)}
                      </td>
                      <td colSpan={6} style={{ borderTop: '2px solid var(--lns)', background: 'var(--sf2)' }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>

          {!loading && rows.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--ln)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, flexShrink: 0 }}>
              <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 700 }}>Colour key:</span>
              {[
                { color: 'rgba(231,76,60,.35)',  label: '< 10% Critical' },
                { color: 'rgba(230,126,34,.3)',  label: '10–20% At risk' },
                { color: 'rgba(241,196,15,.35)', label: '20–50% Watch' },
                { color: 'rgba(46,204,113,.35)', label: '> 50% Healthy' },
              ].map(item => (
                <div key={item.label} className="zleg-row">
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
