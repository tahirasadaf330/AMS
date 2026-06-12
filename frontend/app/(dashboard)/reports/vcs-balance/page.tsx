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

function DaysCell({ days }: { days: number | null }) {
  if (days == null) return <td style={{ textAlign: 'center', color: 'var(--mu)' }}>—</td>;

  const color =
    days <= 0  ? '#e74c3c' :
    days <= 2  ? '#e74c3c' :
    days <= 7  ? '#e67e22' :
    days <= 30 ? '#d4ac0d' :
                 '#27ae60';

  const weight = days <= 7 ? 700 : 600;
  const label = days <= 0 ? 'NOW' : `${days}d`;

  return (
    <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: 'tabular-nums', color, fontWeight: weight }}>
      {label}
    </td>
  );
}

function rowClass(pct: number | null): string {
  if (pct == null) return '';
  if (pct < 10) return 'row-critical';
  if (pct < 20) return 'row-risk';
  return '';
}

export default function VoiceCreditLimitPage() {
  const [data, setData]       = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch]   = React.useState('');
  const [lastLoaded, setLastLoaded] = React.useState<Date | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    vcsBalanceApi
      .getData()
      .then(r => { setData(r.data); setLastLoaded(new Date()); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    if (!search.trim()) return data.rows;
    const q = search.toLowerCase();
    return data.rows.filter((r: any) =>
      (r.company_name ?? '').toLowerCase().includes(q) ||
      (r.account_manager ?? '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const s = data?.summary;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{ margin: '-24px', padding: '28px 28px 50px', minHeight: 'calc(100vh - 56px)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 4 }}>
              Credit Overview
            </div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 27, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>
              Voice Credit Limit
            </h1>
            {lastLoaded && (
              <p style={{ color: 'var(--mu)', fontSize: 12, marginTop: 4 }}>
                Live from VCS · loaded {lastLoaded.toLocaleTimeString()}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {lastLoaded && (
              <div className="zdcard">
                <div className="dlbl">Last refreshed</div>
                <div className="dval"><span className="zpulse" /><span>{lastLoaded.toLocaleTimeString()}</span></div>
              </div>
            )}
            <button className="zbt" onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ display: 'inline-flex', width: 14, height: 14 }}>{IC.refresh}</span>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Critical alert banner */}
        {s?.clientsCritical > 0 && (
          <div className="zalert">
            <span style={{ color: 'var(--alizarin)', display: 'flex' }}>{IC.alert}</span>
            <p>
              <strong>{s.clientsCritical} client{s.clientsCritical > 1 ? 's' : ''}</strong> at critical credit level — less than 10% remaining.
            </p>
          </div>
        )}

        {/* KPI cards */}
        {s && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
            <Kpi color="kb" label="Total Clients"      icon={IC.users}    value={String(s.totalClients)}    sub="active with credit" />
            <Kpi color="kt" label="Total Credit Limit" icon={IC.credit}   value={fmtRev(s.totalCreditLimit)} sub={`Used: ${fmtRev(s.totalUsed)}`} />
            <Kpi color="kc" label="Clients at Risk"    icon={IC.alert}    value={String(s.clientsAtRisk)}   sub="< 20% remaining" />
            <Kpi color="kr" label="Critical"           icon={IC.critical} value={String(s.clientsCritical)} sub="< 10% remaining" />
          </div>
        )}

        {/* Table panel */}
        <div className="zpnl">
          <div className="zph" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2>Credit Monitor</h2>
              <span className="ztag" style={{ display: 'block', marginTop: 3 }}>Sorted by remaining balance — lowest first</span>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: 'var(--mu)', pointerEvents: 'none', display: 'flex' }}>{IC.search}</span>
              <input
                type="text"
                placeholder="Search company or manager…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="zdi"
                style={{ paddingLeft: 32, width: 230 }}
              />
            </div>
          </div>

          {loading ? <Skel /> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="zt">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Company</th>
                    <th className="tl">Account Manager</th>
                    <th>Credit Limit</th>
                    <th>Used</th>
                    <th>Remaining</th>
                    <th>Remaining %</th>
                    <th>Yesterday</th>
                    <th>3-Day Avg</th>
                    <th>Days Left</th>
                    <th style={{ textAlign: 'left' }}>Currency</th>
                    <th style={{ textAlign: 'left' }}>Payment Term</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 14 }}>
                        {search ? 'No matching clients' : 'No data'}
                      </td>
                    </tr>
                  )}
                  {rows.map((r: any) => (
                    <tr key={r.clients_id} className={rowClass(r.remaining_balance_pct)}>
                      {/* Company */}
                      <td>
                        <div>
                          <span style={{ fontWeight: 700 }}>{r.company_name}</span>
                          {r.c_email_billing && (
                            <div style={{ fontSize: 11.5, color: 'var(--mu)', fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 400, marginTop: 2 }}>
                              {r.c_email_billing}
                            </div>
                          )}
                        </div>
                      </td>
                      {/* Account Manager */}
                      <td className="tl" style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 500, color: 'var(--inks)' }}>
                        {r.account_manager ?? <span style={{ color: 'var(--mu)' }}>—</span>}
                      </td>
                      {/* Credit Limit */}
                      <td>{fmtRev(r.credit_limit)}</td>
                      {/* Used */}
                      <td style={{ color: 'var(--inks)' }}>{fmtRev(r.used)}</td>
                      {/* Remaining */}
                      <td style={{
                        color: r.remaining_balance < 0 ? 'var(--neg)' :
                               r.remaining_balance_pct != null && r.remaining_balance_pct < 20 ? '#e67e22' :
                               'var(--pos)',
                        fontWeight: 600,
                      }}>
                        {fmtRev(r.remaining_balance)}
                      </td>
                      {/* Remaining % */}
                      <td>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <RemainingBadge pct={r.remaining_balance_pct} />
                        </div>
                      </td>
                      {/* Yesterday */}
                      <td>{r.yesterday_amount != null ? fmtRev(r.yesterday_amount) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                      {/* 3-Day Avg */}
                      <td>{r.avg_amount_last_3_days != null ? fmtRev(r.avg_amount_last_3_days) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                      {/* Days Until Zero */}
                      <DaysCell days={r.days_until_zero} />
                      {/* Currency */}
                      <td className="tl" style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--inks)', fontWeight: 400 }}>{r.currency_name ?? '—'}</td>
                      {/* Payment Term */}
                      <td className="tl" style={{ fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--mu)', fontWeight: 400 }}>{r.payment_term ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && s && (
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total ({rows.length} clients)</td>
                      <td>{fmtRev(s.totalCreditLimit)}</td>
                      <td>{fmtRev(s.totalUsed)}</td>
                      <td>{fmtRev(s.totalRemaining)}</td>
                      <td colSpan={6} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Legend */}
          {!loading && rows.length > 0 && (
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--ln)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 11.5, color: 'var(--mu)', fontWeight: 700 }}>Colour key:</span>
              {[
                { color: 'rgba(231,76,60,.35)',  label: '< 10% — Critical' },
                { color: 'rgba(230,126,34,.3)',  label: '10–20% — At risk' },
                { color: 'rgba(241,196,15,.35)', label: '20–50% — Watch' },
                { color: 'rgba(46,204,113,.35)', label: '> 50% — Healthy' },
              ].map(item => (
                <div key={item.label} className="zleg-row">
                  <span className="zleg-dot" style={{ background: item.color }} />
                  {item.label}
                </div>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--mu)' }}>{rows.length} clients shown</span>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
