'use client';
import * as React from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { smsReportApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

/* ── palette / helpers ───────────────────────────────────── */
const PAL = ['#3498db','#1abc9c','#9b59b6','#e67e22','#e74c3c','#f1c40f','#2ecc71','#16a085','#8e44ad','#d35400','#34495e','#2980b9','#27ae60','#c0392b','#f39c12','#7f8c8d'];
const MNS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const yd        = () => { const d = new Date(); d.setDate(d.getDate()-1); return iso(d); };
const iso       = (d: Date) => `${d.getFullYear()}-${zp(d.getMonth()+1)}-${zp(d.getDate())}`;
const zp        = (n: number) => String(n).padStart(2, '0');
const daysAgo   = (n: number) => { const d = new Date(); d.setDate(d.getDate()-n); return iso(d); };
const addDays   = (isoStr: string, n: number) => { const d = new Date(isoStr.slice(0,10)+'T00:00:00'); if (isNaN(d.getTime())) return isoStr; d.setDate(d.getDate()+n); return iso(d); };
const monthStart= () => { const d = new Date(); return `${d.getFullYear()}-${zp(d.getMonth()+1)}-01`; };
const monthEnd  = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${zp(new Date(y, mo, 0).getDate())}`; };

const fN  = (n: any) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
const fR  = (n: any) => { if (n == null) return '—'; const v = Number(n); return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const fM  = (n: any) => { if (n == null) return '—'; const v = Number(n); return v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(2)}`; };
const fP  = (n: any) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const fDate = (s: string) => {
  if (!s) return '';
  const d = new Date(s.slice(0,10) + 'T00:00:00');
  if (isNaN(d.getTime())) return s.slice(0,10);
  return `${zp(d.getDate())}-${MNS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
};

/* ── CSS — Zamani theme ──────────────────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
.zr{
  --turquoise:#1abc9c;--green-sea:#16a085;--emerald:#2ecc71;--nephritis:#27ae60;
  --river:#3498db;--belize:#2980b9;--amethyst:#9b59b6;
  --asphalt:#34495e;--midnight:#2c3e50;
  --carrot:#e67e22;--alizarin:#e74c3c;
  --pos:#27ae60;--neg:#e74c3c;
  --bg:#ecf0f1;--sf:#ffffff;--sf2:#f5f7f8;--stripe:#f9fafb;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;--ln:#e4e9ec;--lns:#d3dadf;
  font-family:'Hanken Grotesk',-apple-system,sans-serif;color:var(--ink);background:var(--bg);
}
.dark .zr{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;--ln:#2f4151;--lns:#3b5063;
}
.zk{border-radius:10px;padding:18px 18px 16px;color:#fff;box-shadow:0 4px 0 rgba(0,0,0,.15)}
.zk.kt{background:var(--turquoise)}.zk.kb{background:var(--river)}.zk.kg{background:var(--emerald)}
.zk.kc{background:var(--carrot)}.zk.kr{background:var(--alizarin)}.zk.kp{background:var(--amethyst)}.zk.kd{background:var(--asphalt)}
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
.zfilt{display:flex;align-items:flex-end;gap:13px;flex-wrap:wrap;padding:14px 18px;margin-bottom:16px}
.zff{min-width:155px;flex:0 1 200px;display:flex;flex-direction:column;gap:6px}
.zff label{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mu)}
.zsl,.zdi{appearance:none;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:var(--ink);
  background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:9px 12px;width:100%;
  color-scheme:light;transition:border-color .15s,box-shadow .15s;}
.dark .zsl,.dark .zdi{color-scheme:dark}
.zsl{padding-right:32px;cursor:pointer;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2395a5a6' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat:no-repeat;background-position:right 11px center}
.zsl:focus,.zdi:focus{outline:none;border-color:var(--turquoise);box-shadow:0 0 0 3px rgba(26,188,156,.18)}
.zbt{border:0;background:var(--turquoise);color:#fff;font-family:'Hanken Grotesk',sans-serif;font-weight:700;
  font-size:13px;padding:9px 18px;border-radius:7px;cursor:pointer;box-shadow:0 3px 0 var(--green-sea);transition:.12s;white-space:nowrap}
.zbt:hover{filter:brightness(1.06)}.zbt:active{transform:translateY(2px);box-shadow:0 1px 0 var(--green-sea)}
.zbt:disabled{opacity:.5;cursor:not-allowed;transform:none}
.zbt2{border:0;background:var(--asphalt);color:#fff;font-family:'Hanken Grotesk',sans-serif;font-weight:700;
  font-size:13px;padding:9px 18px;border-radius:7px;cursor:pointer;box-shadow:0 3px 0 #1a252f;transition:.12s;white-space:nowrap}
.zbt2:hover{filter:brightness(1.1)}.zbt2:active{transform:translateY(2px)}
.zt{width:100%;border-collapse:collapse;font-size:13.5px}
.zt thead th{text-align:right;font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--mu);padding:10px 16px;border-bottom:2px solid var(--lns);cursor:pointer;user-select:none;white-space:nowrap;
  position:sticky;top:0;z-index:2;background:var(--sf)}
.zt thead th:first-child{text-align:left}
.zt tfoot td{position:sticky;bottom:0;z-index:2;background:var(--sf);border-top:2px solid var(--lns)}
.zt thead th.zs{color:var(--turquoise)}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb:hover{background:var(--mu)}
.zt tbody td{padding:11px 16px;border-bottom:1px solid var(--ln);text-align:right;
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;color:var(--inks);white-space:nowrap}
.zt tbody td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif;font-weight:600;color:var(--ink)}
.zt tbody tr:nth-child(even){background:var(--stripe)}
.zt tbody tr:hover{background:var(--sf2)}
.zt tfoot td{padding:12px 16px;font-family:'JetBrains Mono',monospace;font-weight:700;font-variant-numeric:tabular-nums;
  text-align:right;color:var(--ink);border-top:2px solid var(--lns);background:var(--sf2)}
.zt tfoot td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif}
.zconn{display:flex;align-items:center;gap:9px}
.zdot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.zrc{position:relative;min-width:140px}
.zrb{position:absolute;left:0;top:50%;transform:translateY(-50%);height:20px;border-radius:4px;background:rgba(52,152,219,.16);z-index:0}
.zrv{position:relative;z-index:1}
.zpos{color:var(--pos);font-weight:600}.zneg{color:var(--neg);font-weight:600}
.znew{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(26,188,156,.16);color:var(--green-sea)}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.ztabs{display:flex;border-bottom:2px solid var(--ln);margin-bottom:20px}
.ztab{flex:1;padding:12px 8px;font-size:14px;font-weight:600;color:var(--mu);background:transparent;border:none;cursor:pointer;
  position:relative;transition:color .15s;font-family:'Hanken Grotesk',sans-serif;text-align:center}
.ztab:hover{color:var(--ink)}.ztab.za{color:var(--turquoise)}
.ztab.za::after{content:"";position:absolute;bottom:-2px;left:0;right:0;height:2.5px;background:var(--turquoise);border-radius:2px 2px 0 0}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
.zbadge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace}
.zbg{background:#d5f5e3;color:#1a7a3f}.dark .zbg{background:#1a4a2e;color:#6ee09b}
.zbw{background:#fef3cd;color:#7a5c00}.dark .zbw{background:#4a3800;color:#e6c96e}
.zbr{background:#fde8e8;color:#a82020}.dark .zbr{background:#4a1a1a;color:#f08080}
.ztarget{background:rgba(52,152,219,.12);color:var(--belize);padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;font-family:'JetBrains Mono',monospace}
.zprog-wrap{background:var(--ln);border-radius:20px;height:8px;overflow:hidden;min-width:80px}
.zprog{height:100%;border-radius:20px;transition:width .3s}
.zt.ztc thead th,.zt.ztc tbody td,.zt.ztc tfoot td{padding:6px 10px;font-size:12px;overflow:hidden;text-overflow:ellipsis}
.zpb{padding:16px 18px}
.zleg{display:flex;flex-direction:column;gap:7px;font-size:12.5px;max-height:190px;overflow-y:auto}
.zleg .li{display:flex;align-items:center;gap:8px;color:var(--inks)}
.zleg .li b{margin-left:8px;font-family:'JetBrains Mono',monospace;color:var(--ink);font-weight:600;font-size:12px}
.zleg .sw{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
`;

const IC = {
  msg:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  rev:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  trend: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/></svg>,
  pct:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 5L5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
  cal:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
};

function Kpi({ color, label, value, sub, icon, loading }: { color: string; label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode; loading?: boolean }) {
  return (
    <div className={`zk ${color}`}>
      <div className="zk-top"><span className="zk-lbl">{label}</span><span className="zk-ic">{icon}</span></div>
      {loading
        ? <div className="zskel" style={{ height: 28, margin: '6px 0 4px', borderRadius: 6 }} />
        : <div className="zk-val">{value}</div>
      }
      {sub && <div className="zk-sub" style={{ opacity: loading ? 0.4 : 1 }}>{sub}</div>}
    </div>
  );
}

function PH({ title, right }: { title: string; right?: string }) {
  return <div className="zph"><h2>{title}</h2>{right && <span className="ztag">{right}</span>}</div>;
}

function Skel() {
  return (
    <div className="zpnl" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(6)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.12 }} />)}
    </div>
  );
}

function Diff({ o, n }: { o: any; n: any }) {
  if (o == null || Number(o) === 0) return <span className="znew">NEW</span>;
  const d = (Number(n) - Number(o)) / Math.abs(Number(o)) * 100;
  return <span className={d >= 0 ? 'zpos' : 'zneg'}>{d >= 0 ? '+' : ''}{d.toFixed(1)}%</span>;
}

function useSortState(defaultKey: string) {
  const [s, set] = React.useState<{ k: string; d: 1 | -1 }>({ k: defaultKey, d: -1 });
  const th = (k: string, label: string, thProps: React.ThHTMLAttributes<HTMLTableCellElement> = {}) => (
    <th {...thProps} className={`${s.k === k ? 'zs' : ''}${thProps.className ? ' ' + thProps.className : ''}`} onClick={() => set(p => p.k === k ? { k, d: (p.d * -1) as 1 | -1 } : { k, d: -1 })}>
      {label}<span style={{ opacity: s.k === k ? 1 : 0.3, marginLeft: 3 }}>{s.k === k ? (s.d === 1 ? '▲' : '▼') : '⇅'}</span>
    </th>
  );
  const sort = <T extends Record<string, any>>(rows: T[]) => {
    const r = [...rows];
    r.sort((a, b) => {
      const av = typeof a[s.k] === 'string' ? a[s.k] : Number(a[s.k] ?? 0);
      const bv = typeof b[s.k] === 'string' ? b[s.k] : Number(b[s.k] ?? 0);
      if (typeof av === 'string') return av.localeCompare(bv) * s.d;
      return (av - bv) * s.d;
    });
    return r;
  };
  return { th, sort };
}

const TIP = { contentStyle: { background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--mu)' } };
const AX  = { tick: { fontSize: 10, fill: 'var(--mu)' }, axisLine: false, tickLine: false };

/* ── aggregate helpers ───────────────────────────────────── */
function aggBy(rows: any[], key: string) {
  const map: Record<string, any> = {};
  let idx = 0;
  rows.forEach((r: any) => {
    const k = r[key] || 'Unknown';
    if (!map[k]) map[k] = { name: k, messages: 0, income: 0, expenses: 0, profit: 0, _mSum: 0, _mCnt: 0, idx: idx++ };
    map[k].messages += Number(r.received_messages ?? 0);
    map[k].income   += Number(r.income ?? 0);
    map[k].expenses += Number(r.expenses ?? 0);
    map[k].profit   += Number(r.profit ?? 0);
    if (r.margin_pct != null) { map[k]._mSum += Number(r.margin_pct); map[k]._mCnt += 1; }
  });
  return Object.values(map).map(r => ({
    ...r,
    margin_pct: r._mCnt > 0 ? r._mSum / r._mCnt : 0,
    col: PAL[r.idx % PAL.length],
  }));
}

function aggByMonth(rows: any[]) {
  const map: Record<string, any> = {};
  rows.forEach((r: any) => {
    const d = String(r.date ?? '').slice(0, 7); // YYYY-MM
    if (!d || d.length < 7) return;
    if (!map[d]) map[d] = { month: d, messages: 0, income: 0, profit: 0 };
    map[d].messages += Number(r.received_messages ?? 0);
    map[d].income   += Number(r.income ?? 0);
    map[d].profit   += Number(r.profit ?? 0);
  });
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

function aggByDate(rows: any[]) {
  const map: Record<string, any> = {};
  rows.forEach((r: any) => {
    const d = String(r.date ?? '').slice(0, 10);
    if (!d) return;
    if (!map[d]) map[d] = { date: d, messages: 0, income: 0, profit: 0 };
    map[d].messages += Number(r.received_messages ?? 0);
    map[d].income   += Number(r.income ?? 0);
    map[d].profit   += Number(r.profit ?? 0);
  });
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

/** BI-style Margin %: the average of each row's margin_pct, ignoring rows with no
 *  margin (income = 0 → null). Matches Power BI's AVERAGE(Margin %age) rather than
 *  Σprofit ÷ Σincome, so multi-row groups reconcile with the BI report. */
function avgMarginOf(rows: any[]): number {
  let sum = 0, cnt = 0;
  for (const r of rows) {
    const m = r?.margin_pct;
    if (m != null && !Number.isNaN(Number(m))) { sum += Number(m); cnt += 1; }
  }
  return cnt > 0 ? sum / cnt : 0;
}

/* ── types ───────────────────────────────────────────────── */
type Tab = 'sale' | 'comparison' | 'saleyear' | 'overview' | 'weekly' | 'profit';
/* ── Shared expand button ────────────────────────────────── */
function ExpandBtn({ open }: { open: boolean }) {
  return (
    <span style={{
      display:'inline-flex',alignItems:'center',justifyContent:'center',
      width:14,height:14,border:'1px solid var(--lns)',borderRadius:2,
      fontSize:12,fontWeight:700,color:'var(--inks)',background:'var(--sf2)',
      marginRight:4,flexShrink:0,userSelect:'none',lineHeight:1,
    }}>{open?'−':'+'}</span>
  );
}

/* ── Shared inline (row-wise) filter bar ─────────────────── */
interface InlineFilter { label: string; value: string; options: string[]; onChange: (v: string) => void; }
function InlineFilters({ filters, dateFrom, dateTo, onDateFrom, onDateTo, onReset, extra }: {
  filters?: InlineFilter[];
  dateFrom?: string; dateTo?: string;
  onDateFrom?: (v: string) => void; onDateTo?: (v: string) => void;
  onReset?: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="zpnl zfilt" style={{ marginBottom: 14 }}>
      {onDateFrom && <div className="zff"><label>Date From</label><input className="zdi" type="date" value={dateFrom ?? ''} onChange={e => onDateFrom(e.target.value)} /></div>}
      {onDateTo   && <div className="zff"><label>Date To</label><input className="zdi" type="date" value={dateTo ?? ''} onChange={e => onDateTo(e.target.value)} /></div>}
      {(filters ?? []).map(f => (
        <div className="zff" key={f.label}>
          <label>{f.label}</label>
          <select className="zsl" value={f.value} onChange={e => f.onChange(e.target.value)}>
            <option value="">All {f.label}</option>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      ))}
      {extra}
      {onReset && <button className="zbt2" style={{ alignSelf: 'flex-end' }} onClick={onReset}>Reset</button>}
    </div>
  );
}

/* ── Sale-Year sub-component ─────────────────────────────── */
interface SaleYearTabProps { rows: any[]; lastRefreshed: string | null; }

const SY_METRIC_BTNS = [
  {key:'expenses',   label:'Expenses'  },{key:'messages',  label:'Messages'  },
  {key:'income',     label:'Income'    },{key:'margin_pct',label:'Margin %'  },
  {key:'profit',     label:'Profit'    },
] as const;
type SyMetric = typeof SY_METRIC_BTNS[number]['key'];

const SY_DIM_BTNS = [
  {key:'mcc_mnc',         label:'MCCMNC'         },{key:'customer_company',label:'Customer'       },
  {key:'country',         label:'Country'        },{key:'operator',        label:'Operator'       },
  {key:'customer_connection',label:'Cst Connection'},{key:'account_manager',label:'Account Manager'},
] as const;
type SyDim = typeof SY_DIM_BTNS[number]['key'];

const SY_XAXIS_BTNS = [
  {key:'date',label:'Date'},{key:'week_of_month',label:'Week of Month'},
  {key:'month',label:'Month'},{key:'week_of_year',label:'Week of Year'},{key:'year',label:'Year'},
] as const;
type SyXAxis = typeof SY_XAXIS_BTNS[number]['key'];

function SaleYearTab({ rows, lastRefreshed }: SaleYearTabProps) {
  const [syMetric,  setSyMetric]  = React.useState<SyMetric>('messages');
  const [syDim,     setSyDim]     = React.useState<SyDim>('country');
  const [syXAxis,   setSyXAxis]   = React.useState<SyXAxis>('date');
  const [syOp,      setSyOp]      = React.useState<string>('');
  const [syCountry, setSyCountry] = React.useState<string>('');
  const [syCust,    setSyCust]    = React.useState<string>('');
  const [syConn,    setSyConn]    = React.useState<string>('');
  const [syMgr,     setSyMgr]     = React.useState<string>('');
  const [syStart,   setSyStart]   = React.useState(() => daysAgo(89));
  const [syEnd,     setSyEnd]     = React.useState(yd);
  const detailSort = useSortState('margin_pct');

  // Filtered rows
  const filtRows = React.useMemo(() => rows.filter((r: any) => {
    const d = String(r.date ?? '').slice(0, 10);
    if (d < syStart || d > syEnd) return false;
    if (syOp      && r.operator           !== syOp)      return false;
    if (syCountry && r.country            !== syCountry)  return false;
    if (syCust    && r.customer_company   !== syCust)     return false;
    if (syConn    && r.customer_connection!== syConn)     return false;
    if (syMgr     && r.account_manager   !== syMgr)      return false;
    return true;
  }), [rows, syStart, syEnd, syOp, syCountry, syCust, syConn, syMgr]);

  // Unique filter options
  const uniq = (key: string) => Array.from(new Set(rows.map((r:any) => r[key]).filter(Boolean))).sort() as string[];
  const operators  = React.useMemo(() => uniq('operator'),            [rows]);
  const countries  = React.useMemo(() => uniq('country'),             [rows]);
  const customers  = React.useMemo(() => uniq('customer_company'),    [rows]);
  const conns      = React.useMemo(() => uniq('customer_connection'),  [rows]);
  const managers   = React.useMemo(() => uniq('account_manager'),     [rows]);

  // KPIs
  const totMsgs = filtRows.reduce((s:number,r:any)=>s+Number(r.received_messages??0),0);
  const totProfit= filtRows.reduce((s:number,r:any)=>s+Number(r.profit??0),0);
  const totInc   = filtRows.reduce((s:number,r:any)=>s+Number(r.income??0),0);
  const totExp   = filtRows.reduce((s:number,r:any)=>s+Number(r.expenses??0),0);

  // Pie by country — profit
  const profitByCountry = React.useMemo(() => {
    const m: Record<string,number> = {};
    filtRows.forEach((r:any) => { const k = r.country||'Unknown'; m[k]=(m[k]||0)+Number(r.profit??0); });
    return Object.entries(m).map(([name,value],i)=>({name,value,fill:PAL[i%PAL.length]})).sort((a,b)=>b.value-a.value).slice(0,10);
  }, [filtRows]);

  // Pie by country — income
  const incomeByCountry = React.useMemo(() => {
    const m: Record<string,number> = {};
    filtRows.forEach((r:any) => { const k = r.country||'Unknown'; m[k]=(m[k]||0)+Number(r.income??0); });
    return Object.entries(m).map(([name,value],i)=>({name,value,fill:PAL[i%PAL.length]})).sort((a,b)=>b.value-a.value).slice(0,10);
  }, [filtRows]);

  // Bar chart — metric by dimension
  const barData = React.useMemo(() => {
    const m: Record<string,any> = {};
    filtRows.forEach((r:any) => {
      const k = r[syDim] || 'Unknown';
      if (!m[k]) m[k] = { name: k, messages: 0, income: 0, expenses: 0, profit: 0, _mSum: 0, _mCnt: 0 };
      m[k].messages += Number(r.received_messages??0);
      m[k].income   += Number(r.income??0);
      m[k].expenses += Number(r.expenses??0);
      m[k].profit   += Number(r.profit??0);
      if (r.margin_pct != null) { m[k]._mSum += Number(r.margin_pct); m[k]._mCnt += 1; }
    });
    return Object.values(m)
      .map(r => ({ ...r, margin_pct: r._mCnt > 0 ? r._mSum/r._mCnt : 0, name: r.name.length > 22 ? r.name.slice(0,20)+'…' : r.name }))
      .sort((a,b)=>b[syMetric]-a[syMetric]).slice(0,20);
  }, [filtRows, syDim, syMetric]);

  // Line chart — metric by date/granularity
  const getSyXKey = React.useCallback((r: any) => {
    const d = String(r.date??'').slice(0,10);
    if (!d) return '';
    if (syXAxis === 'date') return d;
    if (syXAxis === 'month') return d.slice(0,7);
    if (syXAxis === 'year') return d.slice(0,4);
    if (syXAxis === 'week_of_month') { const day = new Date(d+'T00:00:00').getDate(); return `W${Math.ceil(day/7)}`; }
    const dt = new Date(d+'T00:00:00'); const jan1 = new Date(dt.getFullYear(),0,1); return `W${Math.ceil(((dt.getTime()-jan1.getTime())/86400000+jan1.getDay()+1)/7)}`;
  }, [syXAxis]);

  const lineData = React.useMemo(() => {
    const m: Record<string,any> = {};
    filtRows.forEach((r:any) => {
      const k = getSyXKey(r); if (!k) return;
      if (!m[k]) m[k] = { x: k, messages: 0, income: 0, expenses: 0, profit: 0, _mSum: 0, _mCnt: 0 };
      m[k].messages += Number(r.received_messages??0);
      m[k].income   += Number(r.income??0);
      m[k].expenses += Number(r.expenses??0);
      m[k].profit   += Number(r.profit??0);
      if (r.margin_pct != null) { m[k]._mSum += Number(r.margin_pct); m[k]._mCnt += 1; }
    });
    return Object.values(m).map(r=>({...r, margin_pct: r._mCnt>0?r._mSum/r._mCnt:0})).sort((a,b)=>String(a.x).localeCompare(String(b.x)));
  }, [filtRows, getSyXKey]);

  // Detail table
  const tableData = React.useMemo(() => {
    const m: Record<string,any> = {};
    filtRows.forEach((r:any) => {
      const k = r.country || 'Unknown';
      if (!m[k]) m[k] = { country: k, messages: 0, expenses: 0, income: 0, profit: 0, _mSum: 0, _mCnt: 0 };
      m[k].messages += Number(r.received_messages??0);
      m[k].expenses += Number(r.expenses??0);
      m[k].income   += Number(r.income??0);
      m[k].profit   += Number(r.profit??0);
      if (r.margin_pct != null) { m[k]._mSum += Number(r.margin_pct); m[k]._mCnt += 1; }
    });
    return Object.values(m).map(r=>({...r, margin_pct: r._mCnt>0?r._mSum/r._mCnt:0})).sort((a,b)=>b.margin_pct-a.margin_pct);
  }, [filtRows]);

  const { PieChart, Pie, Cell, Tooltip: RTooltip } = require('recharts');

  const metricLabel = SY_METRIC_BTNS.find(b=>b.key===syMetric)?.label ?? syMetric;
  const dimLabel    = SY_DIM_BTNS.find(b=>b.key===syDim)?.label ?? syDim;
  const fmtMetric   = (v:any) => syMetric==='messages' ? fN(v) : syMetric==='margin_pct' ? fP(v) : fR(v);

  const btnSy = (active: boolean) => ({
    padding:'6px 10px', fontSize:12, fontWeight:700 as const, borderRadius:5, border:'1.5px solid', cursor:'pointer' as const, transition:'.12s',
    borderColor: active?'var(--turquoise)':'var(--lns)', background: active?'var(--turquoise)':'var(--sf2)', color: active?'#fff':'var(--inks)',
  });

  const FilterList = ({ label, items, value, onSelect }: { label:string; items:string[]; value:string; onSelect:(v:string)=>void }) => (
    <div className="zpnl" style={{ padding:'10px 12px', marginBottom:8 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--mu)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{label}</div>
      <div style={{ maxHeight:120, overflowY:'auto', fontSize:12 }}>
        {items.map(item => (
          <div key={item} onClick={() => onSelect(value===item?'':item)} style={{ padding:'3px 4px', borderRadius:4, cursor:'pointer', background: value===item?'var(--turquoise)':'transparent', color: value===item?'#fff':'var(--inks)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', transition:'.1s' }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );

  const dataUpTo = lastRefreshed ? fDate(lastRefreshed.slice(0,10)) : fDate(syEnd);

  return (
    <div>
      {/* Inline row-wise filters */}
      <InlineFilters
        dateFrom={syStart} dateTo={syEnd} onDateFrom={setSyStart} onDateTo={setSyEnd}
        filters={[
          { label: 'Operator',           value: syOp,      options: operators, onChange: setSyOp },
          { label: 'Country',            value: syCountry, options: countries, onChange: setSyCountry },
          { label: 'Customer',           value: syCust,    options: customers, onChange: setSyCust },
          { label: 'Customer Connection',value: syConn,    options: conns,     onChange: setSyConn },
          { label: 'Account Manager',    value: syMgr,     options: managers,  onChange: setSyMgr },
        ]}
        onReset={() => { setSyOp(''); setSyCountry(''); setSyCust(''); setSyConn(''); setSyMgr(''); setSyStart(daysAgo(89)); setSyEnd(yd()); }}
      />

      {/* Charts */}
      <div>
        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:14 }}>
          <Kpi color="kb" label="Messages"       icon={IC.msg}   value={fN(totMsgs)}                                         sub="filtered period" />
          <Kpi color="kp" label="Profit"         icon={IC.trend} value={fN(Math.round(totProfit))}                           sub="net contribution" />
          <Kpi color="kt" label="Income"         icon={IC.rev}   value={fN(Math.round(totInc))}                              sub="period total" />
          <Kpi color="kr" label="Expenses"       icon={IC.rev}   value={fN(Math.round(totExp))}                              sub="period total" />
          <Kpi color="kc" label="Profit Per Msg" icon={IC.pct}   value={totMsgs>0?(totProfit/totMsgs).toFixed(2):'—'}       sub="profit ÷ messages" />
        </div>

        {/* Pie charts row */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
          <div className="zpnl">
            <PH title="Profit by Country" right={`${profitByCountry.length} countries`} />
            <div style={{ height:200, padding:'10px 10px 8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={profitByCountry} dataKey="value" nameKey="name" cx="45%" cy="50%" outerRadius={85} label={({percent}:any)=>`${(percent*100).toFixed(1)}%`} labelLine={false} fontSize={10}>
                    {profitByCountry.map((_:any,i:number)=><Cell key={i} fill={PAL[i%PAL.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v:any,n:string)=>[fR(v),n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="zpnl">
            <PH title="Income by Country" right={`${incomeByCountry.length} countries`} />
            <div style={{ height:200, padding:'10px 10px 8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={incomeByCountry} dataKey="value" nameKey="name" cx="45%" cy="50%" outerRadius={85} label={({percent}:any)=>`${(percent*100).toFixed(1)}%`} labelLine={false} fontSize={10}>
                    {incomeByCountry.map((_:any,i:number)=><Cell key={i} fill={PAL[i%PAL.length]} />)}
                  </Pie>
                  <RTooltip formatter={(v:any,n:string)=>[fR(v),n]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Metric + dimension toggles */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
          <div className="zpnl" style={{ padding:'10px 12px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--mu)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:7 }}>Select an Option:</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              {SY_METRIC_BTNS.map(b=><button key={b.key} onClick={()=>setSyMetric(b.key)} style={btnSy(syMetric===b.key)}>{b.label}</button>)}
            </div>
          </div>
          <div className="zpnl" style={{ padding:'10px 12px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--mu)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:7 }}>Select an Option:</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:5 }}>
              {SY_DIM_BTNS.map(b=><button key={b.key} onClick={()=>setSyDim(b.key)} style={btnSy(syDim===b.key)}>{b.label}</button>)}
            </div>
          </div>
        </div>

        {/* Horizontal bar chart */}
        <div className="zpnl" style={{ marginBottom:14 }}>
          <PH title={`${metricLabel} by ${dimLabel}`} right={`${barData.length} items`} />
          <div style={{ height:300, padding:'10px 10px 8px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" margin={{ top:4, right:70, bottom:4, left:0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" horizontal={false} />
                <XAxis type="number" {...AX} tickFormatter={(v:number)=>v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}K`:String(Math.round(v))} />
                <YAxis type="category" dataKey="name" {...AX} width={140} tick={{ fontSize:11, fill:'var(--inks)' }} />
                <Tooltip {...TIP} formatter={(v:any)=>[fmtMetric(v), metricLabel]} />
                <Bar dataKey={syMetric} radius={[0,3,3,0]}>
                  {barData.map((_:any,i:number)=><Cell key={i} fill={PAL[i%PAL.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* X-axis toggle + Line chart */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:14, marginBottom:14, alignItems:'start' }}>
          <div className="zpnl">
            <PH title={`${metricLabel} by ${SY_XAXIS_BTNS.find(b=>b.key===syXAxis)?.label}`} />
            <div style={{ height:240, padding:'10px 10px 8px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={lineData} margin={{ top:8, right:16, bottom:0, left:0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                  <XAxis dataKey="x" {...AX} tickFormatter={(v:string)=>v.length>7?v.slice(5):v} />
                  <YAxis {...AX} width={60} tickFormatter={(v:number)=>v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1000?`${(v/1000).toFixed(0)}K`:String(Math.round(v))} />
                  <Tooltip {...TIP} formatter={(v:any)=>[fmtMetric(v), metricLabel]} />
                  <Area type="monotone" dataKey={syMetric} stroke="#3498db" fill="#3498db22" strokeWidth={2} dot={false} activeDot={{r:4}} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="zpnl" style={{ padding:'10px 12px' }}>
            <div style={{ fontSize:10, fontWeight:700, color:'var(--mu)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:7 }}>Select an Option:</div>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {SY_XAXIS_BTNS.map(b=><button key={b.key} onClick={()=>setSyXAxis(b.key)} style={{...btnSy(syXAxis===b.key), minWidth:130}}>{b.label}</button>)}
            </div>
          </div>
        </div>

        {/* Detail table */}
        <div className="zpnl">
          <PH title="Detail by Country" right={`${fDate(syStart)} → ${fDate(syEnd)} · ${tableData.length} countries`} />
          <div className="tbl-scroll" style={{ overflowX:'auto', maxHeight:380 }}>
            <table className="zt">
              <thead><tr>
                {detailSort.th('country','Country')}
                {detailSort.th('messages','Messages')}{detailSort.th('expenses','Expenses')}{detailSort.th('income','Income')}{detailSort.th('profit','Profit')}{detailSort.th('margin_pct','Margin %')}
              </tr></thead>
              <tbody>
                {detailSort.sort(tableData).map((r:any,i:number)=>(
                  <tr key={i}>
                    <td style={{ color:'var(--river)', fontWeight:600 }}>{r.country}</td>
                    <td style={{ color:'var(--river)' }}>{fN(r.messages)}</td>
                    <td style={{ color:'var(--river)' }}>{fN(Math.round(r.expenses))}</td>
                    <td style={{ color:'var(--river)' }}>{fN(Math.round(r.income))}</td>
                    <td style={{ color:'var(--river)' }}>{fN(Math.round(r.profit))}</td>
                    <td style={{ color:'var(--river)' }}>{Math.round(r.margin_pct)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td style={{ fontWeight:700 }}>Total</td>
                <td>{fN(tableData.reduce((s:number,r:any)=>s+r.messages,0))}</td>
                <td>{fN(Math.round(tableData.reduce((s:number,r:any)=>s+r.expenses,0)))}</td>
                <td>{fN(Math.round(tableData.reduce((s:number,r:any)=>s+r.income,0)))}</td>
                <td>{fN(Math.round(tableData.reduce((s:number,r:any)=>s+r.profit,0)))}</td>
                <td>{totInc>0?Math.round((totProfit/totInc)*100):'—'}</td>
              </tr></tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Weekly Comparison sub-component ────────────────────── */
interface WeeklyTabProps {
  rows: any[];
  w1Start: string; w1End: string; w2Start: string; w2End: string;
  fMgr: string; fCtr: string; fCst: string; fCon: string;
}
const WK_METRIC_BTNS = [
  {key:'messages_w1',label:'Messages W1'},{key:'revenue_w1',label:'Revenue W1'},{key:'margin_w1',label:'Margin % W1'},
  {key:'messages_w2',label:'Messages W2'},{key:'revenue_w2',label:'Revenue W2'},{key:'margin_w2',label:'Margin % W2'},
  {key:'messages_diff',label:'Messages Diff'},{key:'revenue_diff',label:'Revenue Diff'},{key:'margin_diff',label:'Margin % Diff'},
] as const;

function WeeklyTab({ rows, w1Start, w1End, w2Start, w2End, fMgr, fCtr, fCst, fCon }: WeeklyTabProps) {
  const [wkExpand,  setWkExpand]  = React.useState<Set<string>>(new Set());
  const wkSort = useSortState(''); // no column pre-selected; natural order until user sorts

  const wkFilt = React.useMemo(()=>rows.filter((r:any)=>{
    if (fMgr && r.account_manager    !==fMgr) return false;
    if (fCtr && r.country            !==fCtr) return false;
    if (fCst && r.customer_company   !==fCst) return false;
    if (fCon && r.customer_connection!==fCon) return false;
    return true;
  }),[rows,fMgr,fCtr,fCst,fCon]);

  const wkW1 = React.useMemo(()=>wkFilt.filter((r:any)=>r.date>=w1Start&&r.date<=w1End),[wkFilt,w1Start,w1End]);
  const wkW2 = React.useMemo(()=>wkFilt.filter((r:any)=>r.date>=w2Start&&r.date<=w2End),[wkFilt,w2Start,w2End]);

  // Flattened rows: one per manager, with every metric value present as its own
  // sortable field, plus collapsible per-customer children.
  const flat = (t1:any,t2:any) => ({
    msgW1:t1.messages, msgW2:t2.messages, msgDiff:t2.messages-t1.messages,
    revW1:t1.income,   revW2:t2.income,   revDiff:t2.income-t1.income,
    marW1:t1.margin,   marW2:t2.margin,   marDiff:t2.margin-t1.margin,
    profit:t1.profit+t2.profit,
  });
  const wkMgrData = React.useMemo(()=>{
    const allMgrs = Array.from(new Set([...wkW1,...wkW2].map((r:any)=>r.account_manager).filter((v:any)=>v && String(v).trim()!=='' && !/auto\s*pilot/i.test(String(v)))));
    const tot=(rs:any[])=>({ messages:rs.reduce((s:number,r:any)=>s+Number(r.received_messages??0),0), income:rs.reduce((s:number,r:any)=>s+Number(r.income??0),0), profit:rs.reduce((s:number,r:any)=>s+Number(r.profit??0),0), margin:avgMarginOf(rs) });
    return allMgrs.map(mgr=>{
      const m1=wkW1.filter((r:any)=>r.account_manager===mgr);
      const m2=wkW2.filter((r:any)=>r.account_manager===mgr);
      const custs=Array.from(new Set([...m1,...m2].map((r:any)=>r.customer_company).filter((v:any)=>v && String(v).trim()!=='')));
      const t1=tot(m1), t2=tot(m2);
      return {
        name:mgr, ...flat(t1,t2),
        customers:custs.map(c=>{ const c1=tot(m1.filter((r:any)=>r.customer_company===c)); const c2=tot(m2.filter((r:any)=>r.customer_company===c)); return { name:c, ...flat(c1,c2) }; }).sort((a,b)=>b.msgW1-a.msgW1),
      };
    });
  },[wkW1,wkW2]);

  const wkSorted = wkSort.sort(wkMgrData);
  const toggleWk = (name:string)=>{ const n=new Set(wkExpand); n.has(name)?n.delete(name):n.add(name); setWkExpand(n); };
  const tot = wkMgrData.reduce((a,r)=>({msgW1:a.msgW1+r.msgW1,msgW2:a.msgW2+r.msgW2,revW1:a.revW1+r.revW1,revW2:a.revW2+r.revW2,profit:a.profit+r.profit}),{msgW1:0,msgW2:0,revW1:0,revW2:0,profit:0});
  const diffStyle=(v:number):React.CSSProperties=>({ color: v<0?'var(--neg)':v>0?'var(--pos)':'var(--inks)' });

  return (
    <div>
      <div className="zpnl">
        <PH title="Weekly Comparison by Account Manager" right={`W1 ${fDate(w1Start)}→${fDate(w1End)}  ·  W2 ${fDate(w2Start)}→${fDate(w2End)}`} />
        <div className="tbl-scroll" style={{overflowX:'auto',overflowY:'auto',maxHeight:560}}>
          <table className="zt" style={{minWidth:960}}>
            <thead>
              <tr>
                <th rowSpan={2} style={{textAlign:'left',position:'sticky',left:0,background:'var(--sf)',zIndex:3}}>Account Manager</th>
                <th colSpan={3} style={{textAlign:'center',borderLeft:'1px solid var(--ln)'}}>Messages</th>
                <th colSpan={3} style={{textAlign:'center',borderLeft:'1px solid var(--ln)'}}>Revenue</th>
                <th colSpan={3} style={{textAlign:'center',borderLeft:'1px solid var(--ln)'}}>Margin %</th>
                {wkSort.th('profit','Profit',{rowSpan:2,style:{borderLeft:'1px solid var(--ln)'}})}
              </tr>
              <tr>
                {wkSort.th('msgW1','W1')}{wkSort.th('msgW2','W2')}{wkSort.th('msgDiff','Diff')}
                {wkSort.th('revW1','W1')}{wkSort.th('revW2','W2')}{wkSort.th('revDiff','Diff')}
                {wkSort.th('marW1','W1')}{wkSort.th('marW2','W2')}{wkSort.th('marDiff','Diff')}
              </tr>
            </thead>
            <tbody>
              {wkSorted.length===0 && <tr><td colSpan={11} style={{textAlign:'center',color:'var(--mu)',padding:'18px 0'}}>No data in the selected windows.</td></tr>}
              {wkSorted.map((r:any,i:number)=>{
                const isOpen=wkExpand.has(r.name);
                return (
                  <React.Fragment key={r.name}>
                    <tr style={{cursor:'pointer',fontWeight:700}} onClick={()=>toggleWk(r.name)}>
                      <td><div className="zconn"><ExpandBtn open={isOpen}/><span className="zdot" style={{background:PAL[i%PAL.length]}}/>{r.name}</div></td>
                      <td>{fN(r.msgW1)}</td><td>{fN(r.msgW2)}</td><td style={diffStyle(r.msgDiff)}>{r.msgDiff>0?'+':''}{fN(r.msgDiff)}</td>
                      <td>{fN(Math.round(r.revW1))}</td><td>{fN(Math.round(r.revW2))}</td><td style={diffStyle(r.revDiff)}>{r.revDiff>0?'+':''}{fN(Math.round(r.revDiff))}</td>
                      <td>{Math.round(r.marW1)}</td><td>{Math.round(r.marW2)}</td><td style={diffStyle(r.marDiff)}>{r.marDiff>0?'+':''}{Math.round(r.marDiff)}</td>
                      <td className={r.profit>=0?'zpos':'zneg'}>{fN(Math.round(r.profit))}</td>
                    </tr>
                    {isOpen && r.customers.map((c:any,ci:number)=>(
                      <tr key={ci} style={{background:'var(--sf2)'}}>
                        <td style={{paddingLeft:44,color:'var(--inks)',fontWeight:500}}>{c.name}</td>
                        <td>{fN(c.msgW1)}</td><td>{fN(c.msgW2)}</td><td style={diffStyle(c.msgDiff)}>{c.msgDiff>0?'+':''}{fN(c.msgDiff)}</td>
                        <td>{fN(Math.round(c.revW1))}</td><td>{fN(Math.round(c.revW2))}</td><td style={diffStyle(c.revDiff)}>{c.revDiff>0?'+':''}{fN(Math.round(c.revDiff))}</td>
                        <td>{Math.round(c.marW1)}</td><td>{Math.round(c.marW2)}</td><td style={diffStyle(c.marDiff)}>{c.marDiff>0?'+':''}{Math.round(c.marDiff)}</td>
                        <td className={c.profit>=0?'zpos':'zneg'}>{fN(Math.round(c.profit))}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td>Total ({wkMgrData.length})</td>
              <td>{fN(tot.msgW1)}</td><td>{fN(tot.msgW2)}</td><td style={diffStyle(tot.msgW2-tot.msgW1)}>{(tot.msgW2-tot.msgW1)>0?'+':''}{fN(tot.msgW2-tot.msgW1)}</td>
              <td>{fN(Math.round(tot.revW1))}</td><td>{fN(Math.round(tot.revW2))}</td><td style={diffStyle(tot.revW2-tot.revW1)}>{(tot.revW2-tot.revW1)>0?'+':''}{fN(Math.round(tot.revW2-tot.revW1))}</td>
              <td>—</td><td>—</td><td>—</td>
              <td className={tot.profit>=0?'zpos':'zneg'}>{fN(Math.round(tot.profit))}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Profit Data sub-component ───────────────────────────── */
const PROFIT_MONTHLY_TARGET = 50000; // per-manager monthly goal (matches Power BI); total = summed
interface ProfitTabProps { rows: any[]; lastRefreshed: string|null; }

// Profit Data is scoped to these two account-manager "books" only.
const PROFIT_MGR_MATCHERS: { label: string; re: RegExp }[] = [
  { label: 'Gazal', re: /gazal|ghazal/i },
  { label: 'Franz', re: /franz|frans/i },
];
const isProfitMgr = (name: string) => PROFIT_MGR_MATCHERS.some(m => m.re.test(name || ''));

function ProfitDataTab({ rows, lastRefreshed }: ProfitTabProps) {
  const [prCust,  setPrCust]  = React.useState('');
  const [prOp,    setPrOp]    = React.useState('');
  const [prExpand,setPrExpand]= React.useState<Set<string>>(new Set());
  const mtdSort = useSortState('profit');
  const ydSort  = useSortState('profit');

  const uniqPr=(key:string)=>Array.from(new Set(rows.filter((r:any)=>isProfitMgr(r.account_manager)).map((r:any)=>r[key]).filter(Boolean))).sort() as string[];
  const prCusts = React.useMemo(()=>uniqPr('customer_company'),[rows]);
  const prOps   = React.useMemo(()=>uniqPr('operator'),[rows]);

  // Fixed windows anchored to the calendar: current month 1st → yesterday, and
  // yesterday only. (e.g. today = 02-Jul → month table 01-Jul→01-Jul, yesterday 01-Jul)
  const mtdStart = monthStart();
  const mtdEnd   = yd();
  const ydStart  = yd();
  const ydEnd    = yd();

  const passesFilters = React.useCallback((r:any)=>{
    if (!isProfitMgr(r.account_manager)) return false;
    if (prCust && r.customer_company !== prCust) return false;
    if (prOp   && r.operator         !== prOp)   return false;
    return true;
  },[prCust,prOp]);

  // Aggregate a date-window into manager rows with expandable customers.
  const aggWindow = React.useCallback((start:string,end:string)=>{
    const m: Record<string,any> = {};
    rows.forEach((r:any)=>{
      const d=String(r.date??'').slice(0,10);
      if (d<start||d>end) return;
      if (!passesFilters(r)) return;
      const k=r.account_manager||'—';
      if (!m[k]) m[k]={name:k,messages:0,income:0,profit:0,_mSum:0,_mCnt:0,customers:{}};
      m[k].messages+=Number(r.received_messages??0); m[k].income+=Number(r.income??0); m[k].profit+=Number(r.profit??0);
      if(r.margin_pct!=null){m[k]._mSum+=Number(r.margin_pct);m[k]._mCnt+=1;}
      const co=r.customer_company||'—';
      if (!m[k].customers[co]) m[k].customers[co]={name:co,messages:0,income:0,profit:0};
      m[k].customers[co].messages+=Number(r.received_messages??0);
      m[k].customers[co].income  +=Number(r.income??0);
      m[k].customers[co].profit  +=Number(r.profit??0);
    });
    return Object.values(m).map((r:any)=>({...r,margin_pct:r._mCnt>0?r._mSum/r._mCnt:0,customers:(Object.values(r.customers) as any[]).sort((a:any,b:any)=>b.profit-a.profit)}));
  },[rows,passesFilters]);

  const mtdByMgrRaw = React.useMemo(()=>aggWindow(mtdStart,mtdEnd),[aggWindow,mtdStart,mtdEnd]);
  const ydByMgr     = React.useMemo(()=>aggWindow(ydStart,ydEnd),[aggWindow,ydStart,ydEnd]);

  // Projection factor = days in month ÷ days elapsed (up to & incl. yesterday)
  const daysInMonth = new Date(Number(mtdEnd.slice(0,4)), Number(mtdEnd.slice(5,7)), 0).getDate();
  const daysElapsed = Math.max(1, Number(mtdEnd.slice(8,10)));
  const projFactor  = daysInMonth / daysElapsed;
  // Enrich MTD rows with the BI columns: target, pending (achieved − target), projected (EOM)
  const mtdByMgr = React.useMemo(()=>mtdByMgrRaw.map((r:any)=>({
    ...r,
    target: PROFIT_MONTHLY_TARGET,
    pending: r.profit - PROFIT_MONTHLY_TARGET,
    projected: r.profit * projFactor,
    customers: (r.customers as any[]).map((c:any)=>({ ...c, projected: c.profit * projFactor })),
  })),[mtdByMgrRaw,projFactor]);

  const togglePr=(name:string)=>{const n=new Set(prExpand);n.has(name)?n.delete(name):n.add(name);setPrExpand(n);};
  const f2 = (n:number)=>Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

  // ── BI-style table: Monthly Target / Achieved Margin / Pending / Projected (EOM) ──
  const BiProfitTable = ({ title, range, data, sort }: { title:string; range:string; data:any[]; sort:ReturnType<typeof useSortState> }) => {
    const sorted = sort.sort(data);
    const totProfit = data.reduce((s,r)=>s+r.profit,0);
    const totProj   = data.reduce((s,r)=>s+r.projected,0);
    return (
      <div className="zpnl" style={{marginBottom:14}}>
        <PH title={title} right={range} />
        <div className="tbl-scroll" style={{overflowX:'auto'}}>
          <table className="zt">
            <thead><tr>
              {sort.th('name','Account Manager')}
              {sort.th('target','Monthly Target')}
              {sort.th('profit','Monthly Achieved Margin')}
              {sort.th('pending','Monthly Pending Margin')}
              {sort.th('projected','Projected Profit (EOM)')}
            </tr></thead>
            <tbody>
              {sorted.length===0 && <tr><td colSpan={5} style={{textAlign:'center',color:'var(--mu)',padding:'18px 0'}}>No data for this window.</td></tr>}
              {sorted.map((r:any,i:number)=>{
                const isOpen=prExpand.has(r.name);
                return (
                  <React.Fragment key={r.name}>
                    <tr style={{cursor:'pointer',fontWeight:700}} onClick={()=>togglePr(r.name)}>
                      <td><div className="zconn"><ExpandBtn open={isOpen}/><span className="zdot" style={{background:PAL[i%PAL.length]}}/>{r.name}</div></td>
                      <td>{fN(r.target)}</td>
                      <td className={r.profit<0?'zneg':'zpos'}>{f2(r.profit)}</td>
                      <td className={r.pending<0?'zneg':'zpos'}>{f2(r.pending)}</td>
                      <td style={{fontWeight:700,color:r.projected>=0?'var(--pos)':'var(--neg)'}}>{f2(r.projected)}</td>
                    </tr>
                    {isOpen&&(r.customers as any[]).map((c:any,ci:number)=>(
                      <tr key={ci} style={{background:'var(--sf2)'}}>
                        <td style={{paddingLeft:44,color:'var(--inks)',fontWeight:500}}>{c.name}</td>
                        <td>—</td>
                        <td className={c.profit<0?'zneg':'zpos'}>{f2(c.profit)}</td>
                        <td>—</td>
                        <td style={{color:c.projected>=0?'var(--pos)':'var(--neg)'}}>{f2(c.projected)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td>Total ({data.length})</td>
              <td>{fN(data.length*PROFIT_MONTHLY_TARGET)}</td>
              <td className={totProfit<0?'zneg':'zpos'}>{f2(totProfit)}</td>
              <td className={(totProfit-data.length*PROFIT_MONTHLY_TARGET)<0?'zneg':'zpos'}>{f2(totProfit-data.length*PROFIT_MONTHLY_TARGET)}</td>
              <td style={{fontWeight:700,color:totProj>=0?'var(--pos)':'var(--neg)'}}>{f2(totProj)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    );
  };

  // ── Account Manager Profit Data (full period): Account Manager | Profit ──
  const MgrProfitTable = ({ title, range, data, sort }: { title:string; range:string; data:any[]; sort:ReturnType<typeof useSortState> }) => {
    const sorted = sort.sort(data);
    const tot = data.reduce((s,r)=>s+r.profit,0);
    return (
      <div className="zpnl" style={{marginBottom:14}}>
        <PH title={title} right={range} />
        <div className="tbl-scroll" style={{overflowX:'auto'}}>
          <table className="zt">
            <thead><tr>
              {sort.th('name','Account Manager')}
              {sort.th('profit','Profit')}
            </tr></thead>
            <tbody>
              {sorted.length===0 && <tr><td colSpan={2} style={{textAlign:'center',color:'var(--mu)',padding:'18px 0'}}>No data.</td></tr>}
              {sorted.map((r:any,i:number)=>{
                const isOpen=prExpand.has('all:'+r.name);
                return (
                  <React.Fragment key={r.name}>
                    <tr style={{cursor:'pointer',fontWeight:700}} onClick={()=>togglePr('all:'+r.name)}>
                      <td><div className="zconn"><ExpandBtn open={isOpen}/><span className="zdot" style={{background:PAL[i%PAL.length]}}/>{r.name}</div></td>
                      <td className={r.profit<0?'zneg':'zpos'}>{fN(Math.round(r.profit))}</td>
                    </tr>
                    {isOpen&&(r.customers as any[]).map((c:any,ci:number)=>(
                      <tr key={ci} style={{background:'var(--sf2)'}}>
                        <td style={{paddingLeft:44,color:'var(--inks)',fontWeight:500}}>{c.name}</td>
                        <td className={c.profit<0?'zneg':'zpos'}>{fN(Math.round(c.profit))}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot><tr>
              <td>Total ({data.length})</td>
              <td className={tot<0?'zneg':'zpos'}>{fN(Math.round(tot))}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Inline row-wise filters — no date filter on this tab (windows are fixed) */}
      <InlineFilters
        filters={[
          { label:'Customer Company', value:prCust, options:prCusts, onChange:setPrCust },
          { label:'Operator',         value:prOp,   options:prOps,   onChange:setPrOp },
        ]}
        onReset={()=>{setPrCust('');setPrOp('');}}
      />

      <BiProfitTable  title="Current Month Data (Till Yesterday)" range={`${fDate(mtdStart)} → ${fDate(mtdEnd)}`} data={mtdByMgr} sort={mtdSort} />
      <MgrProfitTable title="Account Manager Profit Data (Yesterday)" range={fDate(ydEnd)} data={ydByMgr} sort={ydSort} />
    </div>
  );
}

/* ── Comparison sub-component (needs its own hooks) ─────── */
type CompDimExt = 'mcc_mnc'|'company'|'country'|'operator'|'connection'|'account_manager';
type CompMetric = 'expenses_p1'|'expenses_p2'|'income_p1'|'income_p2'|'messages_p1'|'messages_p2'|'profit_p1'|'profit_p2'|'margin_p1'|'margin_p2';
type CompXAxis  = 'date'|'week_of_month'|'month'|'week_of_year';

const COMP_DIM_BTNS: {key: CompDimExt; label: string}[] = [
  { key: 'mcc_mnc',        label: 'MCCMNC'          },
  { key: 'company',        label: 'Customer'         },
  { key: 'country',        label: 'Country'          },
  { key: 'operator',       label: 'Operator'         },
  { key: 'connection',     label: 'Cst Connection'   },
  { key: 'account_manager',label: 'Account Manager'  },
];
const COMP_DIM_KEY: Record<CompDimExt, string> = { mcc_mnc: 'mcc_mnc', company: 'customer_company', country: 'country', operator: 'operator', connection: 'customer_connection', account_manager: 'account_manager' };
const METRIC_BTNS: {key: CompMetric; label: string}[] = [
  {key:'expenses_p1',label:'Expenses P1'},{key:'expenses_p2',label:'Expenses P2'},
  {key:'income_p1',  label:'Income P1'  },{key:'income_p2',  label:'Income P2'  },
  {key:'messages_p1',label:'Messages P1'},{key:'messages_p2',label:'Messages P2'},
  {key:'profit_p1',  label:'Profit P1'  },{key:'profit_p2',  label:'Profit P2'  },
  {key:'margin_p1',  label:'Margin % P1'},{key:'margin_p2',  label:'Margin % P2'},
];
const XAXIS_BTNS: {key: CompXAxis; label: string}[] = [
  {key:'date',label:'Date'},{key:'week_of_month',label:'Week of Month'},
  {key:'month',label:'Month'},{key:'week_of_year',label:'Week of Year'},
];

/* ── Comparison pie helper ───────────────────────────────── */
function CmpPie({ rows, groupField, label }: { rows: any[]; groupField: string; label: string }) {
  const data = React.useMemo(() => {
    const map: Record<string, number> = {};
    rows.forEach((r: any) => { const c = r[groupField]; if (!c) return; map[c] = (map[c] || 0) + Number(r.profit ?? 0); });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const tot = sorted.reduce((s, [, v]) => s + v, 0);
    return sorted.map(([fullName, value], i) => ({ fullName, name: fullName.length > 22 ? fullName.slice(0, 20) + '…' : fullName, value, pct: tot ? value / tot * 100 : 0, fill: PAL[i % PAL.length] })).filter(d => d.value > 0);
  }, [rows, groupField]);

  if (!data.length) return <div style={{ padding: 20, color: 'var(--mu)', fontSize: 13 }}>No data.</div>;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: '12px 18px 16px', minWidth: 0 }}>
      <div style={{ flexShrink: 0 }}>
        <PieChart width={200} height={200}>
          <Pie data={data} dataKey="value" innerRadius={55} outerRadius={90} paddingAngle={2} startAngle={90} endAngle={-270} strokeWidth={0}>
            {data.map((e, i) => <Cell key={i} fill={e.fill} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v: any, _: any, p: any) => [`${fR(v)} (${p.payload.pct.toFixed(1)}%)`, label]} />
        </PieChart>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: d.fill, flexShrink: 0 }} />
            <span title={d.fullName} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--inks)' }}>{d.name}</span>
            <b style={{ flexShrink: 0, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{d.pct.toFixed(1)}%</b>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ComparisonTabProps {
  p1Rows: any[]; p2Rows: any[];
  p1Start: string; p1End: string;
  p2Start: string; p2End: string;
  fOp: string; fCtr: string; fCst: string; fCon: string; fMgr: string;
}

function ComparisonTab({ p1Rows, p2Rows, p1Start, p1End, p2Start, p2End, fOp, fCtr, fCst, fCon, fMgr }: ComparisonTabProps) {
  const [chartMetric, setChartMetric] = React.useState<string>('messages');
  const [compXAxis,  setCompXAxis]  = React.useState<CompXAxis>('date');
  const [compDimExts, setCompDimExts] = React.useState<CompDimExt[]>(['company']);
  const toggleDim = (key: CompDimExt) => setCompDimExts(prev =>
    prev.includes(key) ? (prev.length > 1 ? prev.filter(k => k !== key) : prev) : [...prev, key]
  );

  // Apply cross-filters to period rows
  const applyFilt = (rs:any[]) => rs.filter((r:any)=>{
    if (fOp  && r.operator           !==fOp)  return false;
    if (fCtr && r.country            !==fCtr)  return false;
    if (fCst && r.customer_company   !==fCst)  return false;
    if (fCon && r.customer_connection!==fCon)  return false;
    if (fMgr && r.account_manager   !==fMgr)  return false;
    return true;
  });
  const fp1 = React.useMemo(()=>applyFilt(p1Rows),[p1Rows,fOp,fCtr,fCst,fCon,fMgr]);
  const fp2 = React.useMemo(()=>applyFilt(p2Rows),[p2Rows,fOp,fCtr,fCst,fCon,fMgr]);

  // Aggregate by selected dimension(s) — composite key when multiple are chosen
  const tableRows = React.useMemo(() => {
    const compKey = (r:any) => compDimExts.map(d => r[COMP_DIM_KEY[d]] || '—').join(' / ');
    const agg = (rs:any[]) => {
      const m:Record<string,any>={};
      rs.forEach((r:any)=>{ const k=compKey(r); if(!m[k])m[k]={messages:0,income:0,expenses:0,profit:0,_mSum:0,_mCnt:0}; m[k].messages+=Number(r.received_messages??0); m[k].income+=Number(r.income??0); m[k].expenses+=Number(r.expenses??0); m[k].profit+=Number(r.profit??0); if(r.margin_pct!=null){m[k]._mSum+=Number(r.margin_pct);m[k]._mCnt+=1;} });
      return m;
    };
    const a1=agg(fp1); const a2=agg(fp2);
    const names=Array.from(new Set([...Object.keys(a1),...Object.keys(a2)]));
    const avgM=(g:any)=>g&&g._mCnt>0?g._mSum/g._mCnt:0;
    return names.map((n,i)=>({ name:n, col:PAL[i%PAL.length], msg1:(a1[n]?.messages??0), inc1:(a1[n]?.income??0), exp1:(a1[n]?.expenses??0), prf1:(a1[n]?.profit??0), mar1:avgM(a1[n]), msg2:(a2[n]?.messages??0), inc2:(a2[n]?.income??0), exp2:(a2[n]?.expenses??0), prf2:(a2[n]?.profit??0), mar2:avgM(a2[n]) }));
  }, [fp1, fp2, compDimExts]);

  // Chart data
  const getXKey = React.useCallback((r:any)=>{
    const d=String(r.date??'').slice(0,10); if(!d) return '';
    if(compXAxis==='date') return d;
    if(compXAxis==='month') return d.slice(0,7);
    if(compXAxis==='week_of_month'){const day=new Date(d+'T00:00:00').getDate();return `W${Math.ceil(day/7)}`;}
    const dt=new Date(d+'T00:00:00');const j=new Date(dt.getFullYear(),0,1);return `W${Math.ceil(((dt.getTime()-j.getTime())/86400000+j.getDay()+1)/7)}`;
  },[compXAxis]);

  const chartData = React.useMemo(()=>{
    const m:Record<string,any>={};
    const add=(rs:any[],sfx:string)=>rs.forEach((r:any)=>{const k=getXKey(r);if(!k)return;if(!m[k])m[k]={x:k};['expenses','income','messages','profit'].forEach(f=>{m[k][`${f}_${sfx}`]=(m[k][`${f}_${sfx}`]||0)+Number(f==='messages'?r.received_messages??0:r[f]??0);});});
    add(fp1,'p1');add(fp2,'p2');
    return Object.values(m).sort((a,b)=>String(a.x).localeCompare(String(b.x)));
  },[fp1,fp2,getXKey]);

  const CHART_METRIC_BTNS = [{key:'messages',label:'Messages'},{key:'profit',label:'Profit'},{key:'income',label:'Income'},{key:'expenses',label:'Expenses'}];
  const chartLabel = CHART_METRIC_BTNS.find(b=>b.key===chartMetric)?.label ?? chartMetric;
  const isMsg = chartMetric === 'messages';
  const fmtV  = (v:any)=>isMsg?fN(v):fN(Math.round(Number(v)));
  const bs    = (a:boolean)=>({ padding:'6px 10px',fontSize:12,fontWeight:700 as const,borderRadius:5,border:'1.5px solid',cursor:'pointer' as const,transition:'.12s', borderColor:a?'var(--turquoise)':'var(--lns)',background:a?'var(--turquoise)':'var(--sf2)',color:a?'#fff':'var(--inks)' });

  const tot1={msg:tableRows.reduce((s,r)=>s+r.msg1,0),inc:tableRows.reduce((s,r)=>s+r.inc1,0),exp:tableRows.reduce((s,r)=>s+r.exp1,0),prf:tableRows.reduce((s,r)=>s+r.prf1,0)};
  const tot2={msg:tableRows.reduce((s,r)=>s+r.msg2,0),inc:tableRows.reduce((s,r)=>s+r.inc2,0),exp:tableRows.reduce((s,r)=>s+r.exp2,0),prf:tableRows.reduce((s,r)=>s+r.prf2,0)};


  // ── P1/P2/Diff table helpers (Diff = P2 − P1) ──
  const dimLabel = compDimExts.map(d => COMP_DIM_BTNS.find(b=>b.key===d)?.label ?? d).join(' / ');
  const cellBase = { textAlign:'right' as const, fontVariantNumeric:'tabular-nums' as const, whiteSpace:'nowrap' as const };
  const stickyTd = { position:'sticky' as const, left:0, background:'var(--sf)', color:'var(--ink)', fontWeight:600 as const, textAlign:'left' as const };
  const money = (v:number)=>fN(Math.round(v));
  const pct   = (v:number)=>String(Math.round(v));
  const metricCells = (v1:number,v2:number,fmt:(x:number)=>string,bold=false)=>{ const d=v2-v1; return (<>
    <td style={{...cellBase,borderLeft:'1px solid var(--ln)',fontWeight:bold?700:400}}>{fmt(v1)}</td>
    <td style={{...cellBase,fontWeight:bold?700:400}}>{fmt(v2)}</td>
    <td style={{...cellBase,color:d>0?'var(--turquoise)':d<0?'var(--alizarin)':'var(--mu)',fontWeight:bold?700:600}}>{d>0?'+':''}{fmt(d)}</td>
  </>); };

  const cmpSort = useSortState('msg2');
  // sortable rows include derived diff fields so every column (incl. Diff) can sort
  const cmpRows = React.useMemo(()=>tableRows.map((r:any)=>({
    ...r, msgD:r.msg2-r.msg1, prfD:r.prf2-r.prf1, incD:r.inc2-r.inc1, expD:r.exp2-r.exp1, marD:r.mar2-r.mar1,
  })), [tableRows]);
  const cmpSorted = cmpSort.sort(cmpRows);
  const CMP_GROUPS = [
    { label:'Messages', p1:'msg1', p2:'msg2', d:'msgD' },
    { label:'Profit',   p1:'prf1', p2:'prf2', d:'prfD' },
    { label:'Income',   p1:'inc1', p2:'inc2', d:'incD' },
    { label:'Expenses', p1:'exp1', p2:'exp2', d:'expD' },
    { label:'Margin %', p1:'mar1', p2:'mar2', d:'marD' },
  ];

  const pieField = 'customer_company';
  const pieGroupLabel = 'Customer';

  return (
    <div>

      {/* ── P1 / P2 summary cards ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
        {([
          {rows:fp1,start:p1Start,end:p1End,color:'#6b8fa3'},
          {rows:fp2,start:p2Start,end:p2End,color:'#3498db'},
        ] as const).map(({rows,start,end,color},pi)=>{
          const msgs = rows.reduce((s:number,r:any)=>s+Number(r.received_messages??0),0);
          const inc  = rows.reduce((s:number,r:any)=>s+Number(r.income??0),0);
          const prf  = rows.reduce((s:number,r:any)=>s+Number(r.profit??0),0);
          const mar  = avgMarginOf(rows);
          return (
            <div key={pi} style={{borderRadius:10,padding:'16px 20px',background:color,color:'#fff',boxShadow:'0 4px 0 rgba(0,0,0,.18)'}}>
              <div style={{fontSize:12,fontWeight:700,opacity:.88,marginBottom:12}}>{fDate(start)}{start!==end?` → ${fDate(end)}`:''}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px 24px'}}>
                <div><div style={{fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',opacity:.78}}>Messages</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:22,marginTop:4,fontVariantNumeric:'tabular-nums'}}>{fN(msgs)}</div></div>
                <div><div style={{fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',opacity:.78}}>Income</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:22,marginTop:4}}>{fM(inc)}</div></div>
                <div><div style={{fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',opacity:.78}}>Profit</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:22,marginTop:4}}>{fM(prf)}</div></div>
                <div><div style={{fontSize:10.5,fontWeight:700,letterSpacing:'.08em',textTransform:'uppercase',opacity:.78}}>Margin</div><div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:600,fontSize:22,marginTop:4}}>{fP(mar)}</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Profit Share pie charts ── */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:12}}>
        <div className="zpnl">
          <div className="zph">
            <h2>Profit Share — Top 10 {pieGroupLabel}</h2>
            <span className="ztag">{fDate(p1Start)}{p1Start!==p1End?` → ${fDate(p1End)}`:''}</span>
          </div>
          <CmpPie rows={fp1} groupField={pieField} label="Profit" />
        </div>
        <div className="zpnl">
          <div className="zph">
            <h2>Profit Share — Top 10 {pieGroupLabel}</h2>
            <span className="ztag">{fDate(p2Start)}{p2Start!==p2End?` → ${fDate(p2End)}`:''}</span>
          </div>
          <CmpPie rows={fp2} groupField={pieField} label="Profit" />
        </div>
      </div>

      {/* ── Dimension selector ── */}
      <div style={{display:'flex',gap:12,marginBottom:12,flexWrap:'wrap'}}>
        <div className="zpnl" style={{padding:'10px 12px',flex:'1 1 100%'}}>
          <div style={{fontSize:11,fontWeight:700,color:'var(--mu)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6}}>Dimension</div>
          <div style={{display:'flex',gap:6}}>
            {COMP_DIM_BTNS.map(b=><button key={b.key} onClick={()=>toggleDim(b.key)} style={{...bs(compDimExts.includes(b.key)),flex:1,whiteSpace:'nowrap'}}>{b.label}</button>)}
          </div>
        </div>
      </div>

      {/* P1/P2/Diff comparison grid — matches Power BI */}
      <div className="zpnl" style={{marginBottom:12}}>
        <PH title={`Comparison by ${dimLabel}`} right={`P1 ${fDate(p1Start)}→${fDate(p1End)}  ·  P2 ${fDate(p2Start)}→${fDate(p2End)}`} />
        <div style={{overflowX:'auto',overflowY:'auto',maxHeight:420}}>
          <table className="zt" style={{minWidth:1080}}>
            <thead>
              <tr>
                {cmpSort.th('name',dimLabel,{rowSpan:2,style:{textAlign:'left',position:'sticky',left:0,background:'var(--sf)',zIndex:3}})}
                {CMP_GROUPS.map(g=><th key={g.label} colSpan={3} style={{textAlign:'center',borderLeft:'1px solid var(--ln)'}}>{g.label}</th>)}
              </tr>
              <tr>
                {CMP_GROUPS.map(g=>(
                  <React.Fragment key={g.label}>
                    {cmpSort.th(g.p1,'P1',{style:{textAlign:'right',fontSize:10,borderLeft:'1px solid var(--ln)',top:36}})}
                    {cmpSort.th(g.p2,'P2',{style:{textAlign:'right',fontSize:10,top:36}})}
                    {cmpSort.th(g.d,'Diff',{style:{textAlign:'right',fontSize:10,top:36}})}
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {cmpSorted.map((r:any,i:number)=>(
                <tr key={i}>
                  <td style={stickyTd}>{r.name}</td>
                  {metricCells(r.msg1,r.msg2,fN)}
                  {metricCells(r.prf1,r.prf2,money)}
                  {metricCells(r.inc1,r.inc2,money)}
                  {metricCells(r.exp1,r.exp2,money)}
                  {metricCells(r.mar1,r.mar2,pct)}
                </tr>
              ))}
              {cmpSorted.length===0 && (
                <tr><td colSpan={16} style={{textAlign:'center',color:'var(--mu)',padding:'18px 0'}}>No data for the selected periods / filters</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td style={{...stickyTd,fontWeight:700}}>Total ({cmpSorted.length})</td>
                {metricCells(tot1.msg,tot2.msg,fN,true)}
                {metricCells(tot1.prf,tot2.prf,money,true)}
                {metricCells(tot1.inc,tot2.inc,money,true)}
                {metricCells(tot1.exp,tot2.exp,money,true)}
                {metricCells(avgMarginOf(fp1),avgMarginOf(fp2),pct,true)}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Bar chart */}
      <div className="zpnl">
        <div className="zph">
          <h2>{chartLabel} (P1 vs P2) by {XAXIS_BTNS.find(b=>b.key===compXAxis)?.label}</h2>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
            {CHART_METRIC_BTNS.map(b=><button key={b.key} onClick={()=>setChartMetric(b.key)} style={{...bs(chartMetric===b.key),whiteSpace:'nowrap'}}>{b.label}</button>)}
          </div>
        </div>
        <div style={{height:280,padding:'0 10px 8px'}}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{top:4,right:12,bottom:0,left:0}} barGap={2} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false}/>
              <XAxis dataKey="x" {...AX} tickFormatter={(v:string)=>v.length>7?v.slice(5):v}/>
              <YAxis {...AX} width={58} tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(1)}K`:String(Math.round(v))}/>
              <Tooltip {...TIP} formatter={(v:any,n:string)=>[fmtV(v),n]}/>
              <Legend iconType="square" iconSize={10} wrapperStyle={{fontSize:11,paddingTop:4}}/>
              <Bar dataKey={`${chartMetric}_p1`} name={`P1 ${fDate(p1Start)}→${fDate(p1End)}`} fill="#1abc9c" radius={[3,3,0,0]}/>
              <Bar dataKey={`${chartMetric}_p2`} name={`P2 ${fDate(p2Start)}→${fDate(p2End)}`} fill="#3498db" radius={[3,3,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* X-Axis selector */}
        <div style={{display:'flex',gap:6,justifyContent:'center',padding:'8px 12px 12px'}}>
          {XAXIS_BTNS.map(b=><button key={b.key} onClick={()=>setCompXAxis(b.key)} style={{...bs(compXAxis===b.key),whiteSpace:'nowrap'}}>{b.label}</button>)}
        </div>
      </div>


    </div>
  );
}

const TABS: { id: Tab; l: string }[] = [
  { id: 'overview',   l: 'Overview' },
  { id: 'sale',       l: 'Sale' },
  { id: 'comparison', l: 'Comparison' },
  { id: 'profit',     l: 'Profit Data' },
];

/* ══════════════════════════════════════════════════════════
   PAGE
══════════════════════════════════════════════════════════ */
export default function SmsReportPage() {
  const [tab, setTab] = React.useState<Tab>('overview');

  /* ── data ───────────────────────────────────────────────── */
  const [rows, setRows]           = React.useState<any[]>([]);
  const [managers, setManagers]   = React.useState<string[]>([]);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = React.useState<string | null>(null);
  const [maxDate,       setMaxDate]       = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);

  /* ── sale filters ────────────────────────────────────────── */
  const [saleStart,    setSaleStart]    = React.useState(monthStart);
  const [saleEnd,      setSaleEnd]      = React.useState(() => { const d = new Date(); return monthEnd(`${d.getFullYear()}-${zp(d.getMonth()+1)}`); });
  const [saleYear,     setSaleYear]     = React.useState('');
  const [saleDateMode, setSaleDateMode] = React.useState<'day'|'month'|'range'>('month');
  const [acctMgr,      setAcctMgr]      = React.useState('');
  const [coFilt,       setCoFilt]       = React.useState('');
  const [saleCntryFilt,  setSaleCntryFilt]  = React.useState('');
  const [saleCustFilt,   setSaleCustFilt]   = React.useState('');
  const [saleConnFilt,   setSaleConnFilt]   = React.useState('');
  const [saleCntrySearch,setSaleCntrySearch]= React.useState('');
  const [saleCustSearch, setSaleCustSearch] = React.useState('');
  const [saleConnSearch, setSaleConnSearch] = React.useState('');

  /* ── comparison ─────────────────────────────────────────── */
  const [p1Start, setP1Start] = React.useState(() => daysAgo(2));
  const [p1End,   setP1End]   = React.useState(() => daysAgo(2));
  const [p2Start, setP2Start] = React.useState(yd);
  const [p2End,   setP2End]   = React.useState(yd);
  const [cDim,    setCDim]    = React.useState<'company' | 'country' | 'operator'>('company');
  /* shared Comparison-tab filters — drive both the P1/P2 table and the weekly table */
  const [cmpOp,  setCmpOp]  = React.useState('');
  const [cmpCtr, setCmpCtr] = React.useState('');
  const [cmpCst, setCmpCst] = React.useState('');
  const [cmpCon, setCmpCon] = React.useState('');
  const [cmpMgr, setCmpMgr] = React.useState('');
  const [cmpMode, setCmpMode] = React.useState<'day'|'week'|'month'|'range'>('day');
  // Day/Week/Month presets set P1 (older period) vs P2 (most recent complete period)
  const applyCmpMode = React.useCallback((mode: 'day'|'week'|'month'|'range') => {
    setCmpMode(mode);
    if (mode === 'range') return;
    const end = yd(); // yesterday = latest complete day
    if (mode === 'day') {
      setP2Start(end); setP2End(end);
      const b = addDays(end, -1); setP1Start(b); setP1End(b);
    } else if (mode === 'week') {
      setP2Start(addDays(end, -6)); setP2End(end);
      setP1Start(addDays(end, -13)); setP1End(addDays(end, -7));
    } else { // month: last full calendar month vs the month before
      const now = new Date();
      const firstThis = `${now.getFullYear()}-${zp(now.getMonth() + 1)}-01`;
      const lastEnd = addDays(firstThis, -1);      const lastStart = lastEnd.slice(0, 7) + '-01';
      const beforeEnd = addDays(lastStart, -1);    const beforeStart = beforeEnd.slice(0, 7) + '-01';
      setP2Start(lastStart); setP2End(lastEnd);
      setP1Start(beforeStart); setP1End(beforeEnd);
    }
  }, []);

  /* ── sale tab chart controls ────────────────────────────── */
  const [pieMetric, setPieMetric] = React.useState<'profit'|'income'|'expenses'|'messages'|'margin_pct'>('profit');
  const [barDim,    setBarDim]    = React.useState<'country'|'customer'|'operator'|'mcc_mnc'|'connection'|'account_manager'>('country');
  const [saleTrend, setSaleTrend] = React.useState<'messages'|'profit'|'income'|'expenses'|'ppm'>('messages');
  const [saleGran,  setSaleGran]  = React.useState<'date'|'week_of_month'|'month'|'week_of_year'|'year'>('date');
  const [ovSel,     setOvSel]     = React.useState<string>(''); // Overview: highlighted company
  const [ovGran,    setOvGran]    = React.useState<'day'|'week'|'month'|'year'>('day');
  const [ovGroupBy, setOvGroupBy] = React.useState<'customer'|'am'>('customer');

  /* ── sale-year ───────────────────────────────────────────── */
  const [yearDim, setYearDim] = React.useState<'company' | 'country'>('company');

  /* ── sort states ─────────────────────────────────────────── */
  const saleSort   = useSortState('income');
  const countrySort= useSortState('income');
  const compSort   = useSortState('inc2');
  const yearSort   = useSortState('income');
  const profitSort = useSortState('profit');
  const saleDetailSort = useSortState('income');

  /* ── expanded rows ───────────────────────────────────────── */
  const [expanded,        setExpanded]        = React.useState<Set<string>>(new Set());
  const [expandedCountry, setExpandedCountry] = React.useState<Set<string>>(new Set());
  const toggle = (s: Set<string>, name: string, set: (x: Set<string>) => void) => {
    const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); set(n);
  };

  /* ── load ────────────────────────────────────────────────── */
  const load = React.useCallback(async (startDate: string, endDate: string, am: string, co: string) => {
    setLoading(true); setError(null);
    try {
      const { data } = await smsReportApi.getData({ startDate: startDate || undefined, endDate: endDate || undefined, accountManager: am || undefined, company: co || undefined });
      setRows(data.rows ?? []);
      setManagers(data.managers ?? []);
      setDatasetId((data as any).dataset_id ?? null);
      setLastRefreshed((data as any).last_refreshed ?? null);
      setMaxDate((data as any).max_date ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(`${new Date().getFullYear()}-01-01`, iso(new Date()), '', ''); }, []);
  useDatasetSocket(datasetId ?? undefined, () => load(saleStart, saleEnd, acctMgr, coFilt));

  /* ── today info ──────────────────────────────────────────── */
  const todayStr  = React.useMemo(() => iso(new Date()), []);
  const curYear   = new Date().getFullYear();
  const curMonth  = new Date().getMonth(); // 0-based
  const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const dayOfMonth  = new Date().getDate() - 1; // days elapsed till yesterday

  /* ── derived: latestDate ─────────────────────────────────── */
  const latestDate = maxDate ?? rows.reduce((m: string, r: any) => (r.date && r.date > m ? r.date : m), '');


  /* ── sale rows ───────────────────────────────────────────── */
  // Distinct years present in the loaded data (for the Year quick-filter)
  const saleYears = React.useMemo(() => Array.from(new Set(rows.map((r: any) => String(r.date ?? '').slice(0, 4)).filter(Boolean))).sort().reverse() as string[], [rows]);

  const saleRows = React.useMemo(() =>
    rows.filter((r: any) => {
      const d = String(r.date ?? '');
      // A selected Year overrides the From/To range and shows the whole year
      if (saleYear) { if (d.slice(0, 4) !== saleYear) return false; }
      else if (d < saleStart || d > saleEnd) return false;
      if (acctMgr        && r.account_manager     !== acctMgr)       return false;
      if (saleCntryFilt  && r.country             !== saleCntryFilt) return false;
      if (saleCustFilt   && r.customer_company    !== saleCustFilt)  return false;
      if (saleConnFilt   && r.customer_connection !== saleConnFilt)  return false;
      return true;
    }),
    [rows, saleStart, saleEnd, saleYear, acctMgr, saleCntryFilt, saleCustFilt, saleConnFilt]);

  const saleTotals = React.useMemo(() => saleRows.reduce((acc, r: any) => ({
    messages: acc.messages + Number(r.received_messages ?? 0),
    income:   acc.income   + Number(r.income ?? 0),
    profit:   acc.profit   + Number(r.profit ?? 0),
  }), { messages: 0, income: 0, profit: 0 }), [saleRows]);

  const saleAvgMargin = avgMarginOf(saleRows);

  const barDimKey: Record<string, string> = { country: 'country', customer: 'customer_company', operator: 'operator', mcc_mnc: 'mcc_mnc', connection: 'customer_connection', account_manager: 'account_manager' };

  const pieData = React.useMemo(() => {
    const map: Record<string, number> = {};
    saleRows.forEach((r: any) => {
      const k = r.country || 'Unknown';
      map[k] = (map[k] || 0) + Number(r[pieMetric === 'margin_pct' ? 'profit' : pieMetric] ?? 0);
    });
    return Object.entries(map).map(([name, value], i) => ({ name, value, fill: PAL[i % PAL.length] }))
      .sort((a, b) => b.value - a.value).slice(0, 10);
  }, [saleRows, pieMetric]);

  const barData = React.useMemo(() => {
    const map: Record<string, any> = {};
    saleRows.forEach((r: any) => {
      const k = r[barDimKey[barDim]] || 'Unknown';
      if (!map[k]) map[k] = { name: k, profit: 0, income: 0, expenses: 0, messages: 0 };
      map[k].profit   += Number(r.profit ?? 0);
      map[k].income   += Number(r.income ?? 0);
      map[k].expenses += Number(r.expenses ?? 0);
      map[k].messages += Number(r.received_messages ?? 0);
    });
    return Object.values(map).sort((a, b) => b.profit - a.profit).slice(0, 20)
      .map(r => ({ ...r, name: r.name.length > 18 ? r.name.slice(0, 16) + '…' : r.name }));
  }, [saleRows, barDim]);

  /* ── by company ──────────────────────────────────────────── */
  const byCompany  = React.useMemo(() => aggBy(saleRows, 'customer_company'), [saleRows]);
  const saleSorted = saleSort.sort(byCompany);
  const saleMaxInc = Math.max(1, ...saleSorted.map((r: any) => r.income));

  const countryByCompany = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    saleRows.forEach((r: any) => {
      const co = r.customer_company || 'Unknown';
      if (!map[co]) map[co] = [];
      const key = r.country || 'Unknown';
      const ex = map[co].find((x: any) => x.name === key);
      if (ex) { ex.messages += Number(r.received_messages ?? 0); ex.income += Number(r.income ?? 0); ex.profit += Number(r.profit ?? 0); }
      else map[co].push({ name: key, messages: Number(r.received_messages ?? 0), income: Number(r.income ?? 0), profit: Number(r.profit ?? 0) });
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => b.income - a.income));
    return map;
  }, [saleRows]);

  /* ── by country ──────────────────────────────────────────── */
  const byCountry     = React.useMemo(() => aggBy(saleRows, 'country'), [saleRows]);
  const countrySorted = countrySort.sort(byCountry);
  const countryMaxInc = Math.max(1, ...countrySorted.map((r: any) => r.income));

  const companyByCountry = React.useMemo(() => {
    const map: Record<string, any[]> = {};
    saleRows.forEach((r: any) => {
      const ct = r.country || 'Unknown';
      if (!map[ct]) map[ct] = [];
      const key = r.customer_company || 'Unknown';
      const ex = map[ct].find((x: any) => x.name === key);
      if (ex) { ex.messages += Number(r.received_messages ?? 0); ex.income += Number(r.income ?? 0); ex.profit += Number(r.profit ?? 0); }
      else map[ct].push({ name: key, messages: Number(r.received_messages ?? 0), income: Number(r.income ?? 0), profit: Number(r.profit ?? 0) });
    });
    Object.values(map).forEach(arr => arr.sort((a, b) => b.income - a.income));
    return map;
  }, [saleRows]);

  /* ── comparison ──────────────────────────────────────────── */
  const cmpOpts = React.useMemo(() => {
    const u = (k: string) => Array.from(new Set(rows.map((r: any) => String(r[k] ?? '')).filter(Boolean))).sort() as string[];
    return { ops: u('operator'), ctrs: u('country'), csts: u('customer_company'), cons: u('customer_connection'), mgrs: u('account_manager') };
  }, [rows]);
  const p1Rows = React.useMemo(() => rows.filter((r: any) => r.date >= p1Start && r.date <= p1End), [rows, p1Start, p1End]);
  const p2Rows = React.useMemo(() => rows.filter((r: any) => r.date >= p2Start && r.date <= p2End), [rows, p2Start, p2End]);
  const cKey   = cDim === 'company' ? 'customer_company' : cDim === 'country' ? 'country' : 'operator';
  const p1Agg  = React.useMemo(() => aggBy(p1Rows, cKey), [p1Rows, cKey]);
  const p2Agg  = React.useMemo(() => aggBy(p2Rows, cKey), [p2Rows, cKey]);

  const compRows = React.useMemo(() => {
    const m2: Record<string, any> = {};
    p2Agg.forEach(r => { m2[r.name] = r; });
    const names = Array.from(new Set([...p1Agg.map(r => r.name), ...p2Agg.map(r => r.name)]));
    return names.map((n, i) => ({
      name: n, col: PAL[i % PAL.length],
      msg1: p1Agg.find(r => r.name === n)?.messages ?? 0, msg2: m2[n]?.messages ?? 0,
      inc1: p1Agg.find(r => r.name === n)?.income   ?? 0, inc2: m2[n]?.income   ?? 0,
      prf1: p1Agg.find(r => r.name === n)?.profit   ?? 0, prf2: m2[n]?.profit   ?? 0,
    }));
  }, [p1Agg, p2Agg]);

  const compSorted = compSort.sort(compRows);
  const p1T = { messages: p1Rows.reduce((s: number, r: any) => s + Number(r.received_messages ?? 0), 0), income: p1Rows.reduce((s: number, r: any) => s + Number(r.income ?? 0), 0), profit: p1Rows.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0) };
  const p2T = { messages: p2Rows.reduce((s: number, r: any) => s + Number(r.received_messages ?? 0), 0), income: p2Rows.reduce((s: number, r: any) => s + Number(r.income ?? 0), 0), profit: p2Rows.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0) };

  /* ── sale - year (all rows grouped by month) ─────────────── */
  const yearKey  = yearDim === 'company' ? 'customer_company' : 'country';
  const yearRows = rows; // all loaded rows regardless of sale filter
  const yearNames = React.useMemo(() => {
    const s = new Set<string>(); yearRows.forEach((r: any) => { if (r[yearKey]) s.add(r[yearKey]); }); return Array.from(s).sort();
  }, [yearRows, yearKey]);

  const monthlyByName = React.useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    yearRows.forEach((r: any) => {
      const m = String(r.date ?? '').slice(0, 7);
      const n = r[yearKey] || 'Unknown';
      if (!m || m.length < 7) return;
      if (!map[n]) map[n] = {};
      if (!map[n][m]) map[n][m] = { messages: 0, income: 0, profit: 0, _mSum: 0, _mCnt: 0 };
      map[n][m].messages += Number(r.received_messages ?? 0);
      map[n][m].income   += Number(r.income ?? 0);
      map[n][m].profit   += Number(r.profit ?? 0);
      if (r.margin_pct != null) { map[n][m]._mSum += Number(r.margin_pct); map[n][m]._mCnt += 1; }
    });
    return map;
  }, [yearRows, yearKey]);

  const allMonths = React.useMemo(() => {
    const s = new Set<string>(); yearRows.forEach((r: any) => { const m = String(r.date ?? '').slice(0, 7); if (m && m.length === 7) s.add(m); });
    return Array.from(s).sort();
  }, [yearRows]);

  const yearAgg = React.useMemo(() => {
    return yearNames.map((n, i) => {
      const total = { messages: 0, income: 0, profit: 0 };
      const byMo  = monthlyByName[n] ?? {};
      let mSum = 0, mCnt = 0;
      Object.values(byMo).forEach((v: any) => { total.messages += v.messages; total.income += v.income; total.profit += v.profit; mSum += v._mSum; mCnt += v._mCnt; });
      return { name: n, col: PAL[i % PAL.length], ...total, margin_pct: mCnt > 0 ? mSum / mCnt : 0, byMo };
    });
  }, [yearNames, monthlyByName]);

  const yearSorted  = yearSort.sort(yearAgg);
  const [yearExpand, setYearExpand] = React.useState<Set<string>>(new Set());

  /* ── weekly ──────────────────────────────────────────────── */
  const w2S = React.useMemo(() => daysAgo(6),  []);
  const w1S = React.useMemo(() => daysAgo(13), []);
  const w1E = React.useMemo(() => daysAgo(7),  []);
  const w2Rows = React.useMemo(() => rows.filter((r: any) => r.date >= w2S), [rows, w2S]);
  const w1Rows = React.useMemo(() => rows.filter((r: any) => r.date >= w1S && r.date <= w1E), [rows, w1S, w1E]);

  const weeklyMgrs = React.useMemo(() => {
    const mgrs = Array.from(new Set([...w1Rows, ...w2Rows].map((r: any) => r.account_manager).filter(Boolean))).sort();
    return mgrs.map(mgr => {
      const r1 = w1Rows.filter((r: any) => r.account_manager === mgr);
      const r2 = w2Rows.filter((r: any) => r.account_manager === mgr);
      const sum = (rs: any[]) => ({ messages: rs.reduce((s, r) => s + Number(r.received_messages ?? 0), 0), income: rs.reduce((s, r) => s + Number(r.income ?? 0), 0), profit: rs.reduce((s, r) => s + Number(r.profit ?? 0), 0) });
      const t1 = sum(r1); const t2 = sum(r2);
      const custs = Array.from(new Set([...r1, ...r2].map((r: any) => r.customer_company).filter(Boolean))).sort();
      return { mgr, t1, t2, customers: custs.map(c => ({ name: c, t1: sum(r1.filter((r: any) => r.customer_company === c)), t2: sum(r2.filter((r: any) => r.customer_company === c)) })) };
    });
  }, [w1Rows, w2Rows]);

  /* ── profit data (Power BI "Profit Data" tab) ────────────── */
  // Current month rows (from 1st of this month to yesterday)
  const mtdStart = monthStart();
  const mtdEnd   = yd();
  const mtdRows  = React.useMemo(() => rows.filter((r: any) => r.date >= mtdStart && r.date <= mtdEnd), [rows, mtdStart, mtdEnd]);

  const profitByMgr = React.useMemo(() => {
    const map: Record<string, any> = {};
    mtdRows.forEach((r: any) => {
      const m = r.account_manager || 'Unassigned';
      if (!map[m]) map[m] = { name: m, messages: 0, income: 0, profit: 0, _mSum: 0, _mCnt: 0, customers: {} };
      map[m].messages += Number(r.received_messages ?? 0);
      map[m].income   += Number(r.income ?? 0);
      map[m].profit   += Number(r.profit ?? 0);
      if (r.margin_pct != null) { map[m]._mSum += Number(r.margin_pct); map[m]._mCnt += 1; }
      const c = r.customer_company || 'Unknown';
      if (!map[m].customers[c]) map[m].customers[c] = { name: c, messages: 0, income: 0, profit: 0, _mSum: 0, _mCnt: 0 };
      map[m].customers[c].messages += Number(r.received_messages ?? 0);
      map[m].customers[c].income   += Number(r.income ?? 0);
      map[m].customers[c].profit   += Number(r.profit ?? 0);
      if (r.margin_pct != null) { map[m].customers[c]._mSum += Number(r.margin_pct); map[m].customers[c]._mCnt += 1; }
    });
    return Object.values(map).map(r => ({
      ...r,
      margin_pct: r._mCnt > 0 ? r._mSum / r._mCnt : 0,
      // Projected profit = achieved * (days_in_month / days_elapsed)
      projected: dayOfMonth > 0 ? r.profit * (daysInMonth / dayOfMonth) : 0,
      customers: Object.values(r.customers).sort((a: any, b: any) => b.profit - a.profit),
    }));
  }, [mtdRows, dayOfMonth, daysInMonth]);

  const MONTHLY_TARGET = 50000;

  const profitSorted = profitSort.sort(profitByMgr);
  const [profitExpand, setProfitExpand] = React.useState<Set<string>>(new Set());

  const profitTotals = React.useMemo(() => profitByMgr.reduce((acc, r) => ({
    messages: acc.messages + r.messages, income: acc.income + r.income, profit: acc.profit + r.profit,
    projected: acc.projected + r.projected,
  }), { messages: 0, income: 0, profit: 0, projected: 0 }), [profitByMgr]);

  /* ── overview KPIs ───────────────────────────────────────── */
  const curYearStr = String(curYear);
  const yearRows2026 = React.useMemo(() => rows.filter((r: any) => String(r.date ?? '').startsWith(curYearStr)), [rows, curYearStr]);
  const yearTotMsgs   = yearRows2026.reduce((s: number, r: any) => s + Number(r.received_messages ?? 0), 0);
  const yearTotProfit = yearRows2026.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0);
  const yearTotIncome = yearRows2026.reduce((s: number, r: any) => s + Number(r.income ?? 0), 0);
  // Use calendar days from Jan 1 to latest date (matches Power BI denominator)
  const yearDayCount = latestDate
    ? Math.round((new Date(latestDate + 'T00:00:00').getTime() - new Date(`${curYear}-01-01T00:00:00`).getTime()) / 86400000) + 1
    : 1;

  const curMonthRows  = React.useMemo(() => rows.filter((r: any) => {
    const d = String(r.date ?? '').slice(0, 7);
    return d === `${curYear}-${zp(curMonth + 1)}`;
  }), [rows, curYear, curMonth]);
  const curMonthTotMsgs   = curMonthRows.reduce((s: number, r: any) => s + Number(r.received_messages ?? 0), 0);
  const curMonthTotProfit = curMonthRows.reduce((s: number, r: any) => s + Number(r.profit ?? 0), 0);
  const curMonthTotIncome = curMonthRows.reduce((s: number, r: any) => s + Number(r.income ?? 0), 0);
  // Use day-of-month of latest date as denominator (matches Power BI)
  const curMonthDayCount = latestDate && latestDate.startsWith(`${curYear}-${zp(curMonth + 1)}`)
    ? new Date(latestDate + 'T00:00:00').getDate()
    : (curMonthRows.length ? new Date(curMonthRows[curMonthRows.length - 1].date + 'T00:00:00').getDate() : 1);

  /* ── overview charts ─────────────────────────────────────── */
  const top10Keys = React.useMemo(() => {
    const field = ovGroupBy === 'am' ? 'account_manager' : 'customer_company';
    const map: Record<string, number> = {};
    yearRows2026.forEach((r: any) => {
      const c = r[field]; if (!c) return;
      map[c] = (map[c] || 0) + Number(r.profit ?? 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n]) => n);
  }, [yearRows2026, ovGroupBy]);

  const ovBucket = React.useCallback((d: string) => {
    if (ovGran === 'year') return d.slice(0, 4);
    if (ovGran === 'month') return d.slice(0, 7);
    if (ovGran === 'week') {
      const dt = new Date(d.slice(0, 10) + 'T00:00:00');
      if (isNaN(dt.getTime())) return d.slice(0, 10);
      const day = dt.getDay() || 7;
      dt.setDate(dt.getDate() + 4 - day);
      const yearStart = new Date(dt.getFullYear(), 0, 1);
      const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${dt.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    return d.slice(0, 10);
  }, [ovGran]);

  const ovChartData = React.useMemo(() => {
    const groupField = ovGroupBy === 'am' ? 'account_manager' : 'customer_company';
    const build = (metricField: string, isAvg = false) => {
      const sumMap: Record<string, any> = {};
      const cntMap: Record<string, Record<string, number>> = {};
      yearRows2026.forEach((r: any) => {
        const d = ovBucket(String(r.date ?? ''));
        const c = r[groupField];
        if (!d || !top10Keys.includes(c)) return;
        if (!sumMap[d]) {
          sumMap[d] = { date: d };
          top10Keys.forEach(k => { sumMap[d][k] = 0; });
          if (isAvg) { cntMap[d] = {}; top10Keys.forEach(k => { cntMap[d][k] = 0; }); }
        }
        const v = Number(r[metricField]);
        if (!isNaN(v)) {
          sumMap[d][c] = (sumMap[d][c] || 0) + v;
          if (isAvg) cntMap[d][c] = (cntMap[d][c] || 0) + 1;
        }
      });
      if (isAvg) {
        Object.keys(sumMap).forEach(d => {
          top10Keys.forEach(c => { if ((cntMap[d]?.[c] ?? 0) > 0) sumMap[d][c] = sumMap[d][c] / cntMap[d][c]; });
        });
      }
      return Object.values(sumMap).sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)));
    };
    return {
      profit:   build('profit'),
      messages: build('received_messages'),
      income:   build('income'),
      expenses: build('expenses'),
      margin:   build('margin_pct', true),
    };
  }, [yearRows2026, top10Keys, ovBucket, ovGroupBy]);


  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{ margin: '-24px', padding: '28px 28px 50px', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── HEADER ──────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 4 }}>SMS Overview</div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 27, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>SMS Sales Dashboard</h1>
            {lastRefreshed && <p style={{ color: 'var(--mu)', fontSize: 12, marginTop: 4 }}>Refreshed {new Date(lastRefreshed).toLocaleString()}</p>}
          </div>
          {latestDate && (
            <div className="zdcard">
              <div className="dlbl">Data is up to</div>
              <div className="dval"><span className="zpulse" /><span>{fDate(latestDate)}</span></div>
            </div>
          )}
        </div>

        {/* ── TABS ─────────────────────────────────────────── */}
        <div className="ztabs">
          {TABS.map(t => (
            <button key={t.id} className={`ztab${tab === t.id ? ' za' : ''}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>


        {error && (
          <div style={{ background: '#fde8e8', border: '1px solid #f5c6c6', borderRadius: 8, padding: '12px 16px', marginBottom: 16, color: '#a82020', fontWeight: 600, fontSize: 13 }}>{error}</div>
        )}

        {/* ════════════════════════════════════════════════
            SALE TAB  (matches Power BI Sale tab)
        ════════════════════════════════════════════════ */}
        {tab === 'sale' && (() => {
          // Detail table (matches Power BI Sale detail grid)
          const detailData = (() => {
            const m: Record<string, any> = {};
            saleRows.forEach((r: any) => {
              const key = [r.mcc_mnc, r.customer_company, r.country, r.operator, r.customer_connection, r.account_manager].join('|');
              if (!m[key]) m[key] = { mcc_mnc: r.mcc_mnc || '—', customer_company: r.customer_company || '—', country: r.country || '—', operator: r.operator || '—', customer_connection: r.customer_connection || '—', account_manager: r.account_manager || '—', messages: 0, income: 0, profit: 0, _mSum: 0, _mCnt: 0 };
              m[key].messages += Number(r.received_messages ?? 0);
              m[key].income   += Number(r.income ?? 0);
              m[key].profit   += Number(r.profit ?? 0);
              if (r.margin_pct != null) { m[key]._mSum += Number(r.margin_pct); m[key]._mCnt += 1; }
            });
            return Object.values(m).map((r: any) => ({ ...r, margin_pct: r._mCnt > 0 ? r._mSum / r._mCnt : 0 }));
          })();


          const { PieChart, Pie, Cell, Tooltip: RTooltip } = require('recharts');

          // dropdown options for the inline filter bar
          const uniq = (key: string) => Array.from(new Set(rows.map((r:any)=>String(r[key] ?? '')).filter(Boolean))).sort();
          const saleCountries = uniq('country');
          const saleCustomers = uniq('customer_company');
          const saleConns     = uniq('customer_connection');

          // ── Y-Axis (metric) · X-Axis (dimension) · Trend X-Axis (granularity) ──
          const METRICS = [
            { key: 'profit'     as const, label: 'Profit',   color: '#9b59b6' },
            { key: 'income'     as const, label: 'Income',   color: '#1abc9c' },
            { key: 'expenses'   as const, label: 'Expenses', color: '#e74c3c' },
            { key: 'messages'   as const, label: 'Messages', color: '#3498db' },
            { key: 'margin_pct' as const, label: 'Margin %', color: '#e67e22' },
          ];
          const DIMS = [
            { key: 'mcc_mnc'         as const, label: 'MCCMNC'         }, { key: 'customer'        as const, label: 'Customer'       },
            { key: 'country'        as const, label: 'Country'        }, { key: 'operator'        as const, label: 'Operator'       },
            { key: 'connection'     as const, label: 'Cst Connection' }, { key: 'account_manager' as const, label: 'Account Manager'},
          ];
          const GRANS = [
            { key: 'date'          as const, label: 'Date'          }, { key: 'week_of_month' as const, label: 'Week of Month' },
            { key: 'month'         as const, label: 'Month'         }, { key: 'week_of_year'  as const, label: 'Week of Year'  },
            { key: 'year'          as const, label: 'Year'          },
          ];
          const metricCfg = METRICS.find(m => m.key === pieMetric) ?? METRICS[0];
          const dimLabel  = DIMS.find(d => d.key === barDim)?.label ?? 'Country';
          const granLabel = GRANS.find(g => g.key === saleGran)?.label ?? 'Date';
          const fmtMetric = (v: any) => pieMetric === 'messages' ? fN(v) : pieMetric === 'margin_pct' ? fP(v) : fN(Math.round(Number(v)));
          const dimKeyMap: Record<string, string> = { country: 'country', customer: 'customer_company', operator: 'operator', mcc_mnc: 'mcc_mnc', connection: 'customer_connection', account_manager: 'account_manager' };

          const barRows = aggBy(saleRows, dimKeyMap[barDim]).map((r: any) => ({ name: r.name, value: Number(r[pieMetric] ?? 0) })).sort((a: any, b: any) => b.value - a.value).slice(0, 20).map((r: any) => ({ ...r, name: r.name.length > 18 ? r.name.slice(0, 16) + '…' : r.name }));

          const granOf = (r: any) => {
            const d = String(r.date ?? '').slice(0, 10); if (!d) return '';
            if (saleGran === 'date') return d;
            if (saleGran === 'month') return d.slice(0, 7);
            if (saleGran === 'year') return d.slice(0, 4);
            if (saleGran === 'week_of_month') { const day = new Date(d + 'T00:00:00').getDate(); return `W${Math.ceil(day / 7)}`; }
            const dt = new Date(d + 'T00:00:00'); const jan1 = new Date(dt.getFullYear(), 0, 1); return `W${Math.ceil(((dt.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)}`;
          };
          const trendRows = (() => {
            const m: Record<string, any> = {};
            saleRows.forEach((r: any) => {
              const k = granOf(r); if (!k) return;
              if (!m[k]) m[k] = { x: k, messages: 0, income: 0, expenses: 0, profit: 0, _mSum: 0, _mCnt: 0 };
              m[k].messages += Number(r.received_messages ?? 0);
              m[k].income   += Number(r.income ?? 0);
              m[k].expenses += Number(r.expenses ?? 0);
              m[k].profit   += Number(r.profit ?? 0);
              if (r.margin_pct != null) { m[k]._mSum += Number(r.margin_pct); m[k]._mCnt += 1; }
            });
            return Object.values(m).map((r: any) => ({ ...r, margin_pct: r._mCnt > 0 ? r._mSum / r._mCnt : 0 })).sort((a: any, b: any) => String(a.x).localeCompare(String(b.x)));
          })();

          const tbtn = (active: boolean, color = 'var(--turquoise)'): React.CSSProperties => ({ padding: '6px 11px', fontSize: 12, fontWeight: 700, borderRadius: 5, border: '1.5px solid', cursor: 'pointer', transition: '.12s', borderColor: active ? color : 'var(--lns)', background: active ? color : 'var(--sf2)', color: active ? '#fff' : 'var(--inks)' });
          const axLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 };

          const Donut = ({ title, data }: { title: string; data: any[] }) => (
            <div className="zpnl">
              <PH title={title} right={`${data.length} items`} />
              <div className="zpb" style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div style={{ flex: '0 0 250px' }}>
                  <ResponsiveContainer width={250} height={250}>
                    <PieChart>
                      <Pie data={data} dataKey="value" innerRadius={66} outerRadius={112} paddingAngle={2} startAngle={90} endAngle={-270} strokeWidth={0}>
                        {data.map((e: any, i: number) => <Cell key={i} fill={e.fill} />)}
                      </Pie>
                      <RTooltip {...TIP} formatter={(v: any, _n: any, p: any) => [`${fmtMetric(v)} (${p.payload.pct.toFixed(1)}%)`, metricCfg.label]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="zleg" style={{ flex: '0 0 auto', marginLeft: 'auto', paddingRight: 8 }}>
                  {data.length === 0 && <div style={{ color: 'var(--mu)', fontSize: 12 }}>No data.</div>}
                  {data.map((d: any, i: number) => (
                    <div key={i} className="li"><span className="sw" style={{ background: d.fill }} />{String(d.name).length > 18 ? String(d.name).slice(0, 16) + '…' : d.name}<b>{d.pct.toFixed(1)}%</b></div>
                  ))}
                </div>
              </div>
            </div>
          );

          return (
            <>
              {/* ── KPI cards — first, matching Zamani pattern ── */}
              {!loading && rows.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 18 }}>
                  <Kpi color="kb" label="Messages"          icon={IC.msg}   value={fN(saleTotals.messages)}               sub={`${fDate(saleStart)} → ${fDate(saleEnd)}`} />
                  <Kpi color="kp" label="Profit"            icon={IC.trend} value={fN(Math.round(saleTotals.profit))}     sub="net contribution" />
                  <Kpi color="kt" label="Income"            icon={IC.rev}   value={fN(Math.round(saleTotals.income))}     sub="period total" />
                  <Kpi color="kr" label="Expenses"          icon={IC.rev}   value={fN(Math.round(saleRows.reduce((s:number,r:any)=>s+Number(r.expenses??0),0)))} sub="period total" />
                  <Kpi color="kc" label="Profit Per Msg"    icon={IC.pct}   value={(saleTotals.messages > 0 ? saleTotals.profit / saleTotals.messages : 0).toFixed(2)} sub="profit ÷ messages" />
                </div>
              )}

              {/* Inline filters — dimension dropdowns on top, date filters below */}
              <div className="zpnl zfilt" style={{ marginBottom: 16 }}>
                {/* Block 1: dropdown filters */}
                <div style={{ display: 'flex', gap: 13, flexBasis: '100%', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="zff">
                    <label>Account Manager</label>
                    <select className="zsl" value={acctMgr} onChange={e => setAcctMgr(e.target.value)}>
                      <option value="">All Managers</option>
                      {managers.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="zff"><label>Country</label>
                    <select className="zsl" value={saleCntryFilt} onChange={e => setSaleCntryFilt(e.target.value)}>
                      <option value="">All Country</option>{saleCountries.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="zff"><label>Customer</label>
                    <select className="zsl" value={saleCustFilt} onChange={e => setSaleCustFilt(e.target.value)}>
                      <option value="">All Customer</option>{saleCustomers.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="zff"><label>Customer Connection</label>
                    <select className="zsl" value={saleConnFilt} onChange={e => setSaleConnFilt(e.target.value)}>
                      <option value="">All Connection</option>{saleConns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                {/* Block 2: date filters — Day / Month / Range mode + Year */}
                <div style={{ display: 'flex', gap: 13, flexBasis: '100%', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="zff"><label>Date Mode</label>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {(['day', 'month', 'range'] as const).map(m => (
                        <button key={m} disabled={!!saleYear} onClick={() => {
                          setSaleDateMode(m);
                          if (m === 'day') { const d = iso(new Date()); setSaleStart(d); setSaleEnd(d); setSaleGran('date'); }
                          else if (m === 'month') { const mm = (saleEnd || yd()).slice(0, 7); setSaleStart(`${mm}-01`); setSaleEnd(monthEnd(mm)); setSaleGran('date'); }
                          else if (m === 'range') { setSaleGran('week_of_year'); }
                        }} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1.5px solid', cursor: saleYear ? 'not-allowed' : 'pointer', opacity: saleYear ? 0.5 : 1, borderColor: saleDateMode === m ? 'var(--turquoise)' : 'var(--lns)', background: saleDateMode === m ? 'var(--turquoise)' : 'var(--sf2)', color: saleDateMode === m ? '#fff' : 'var(--inks)' }}>{m[0].toUpperCase() + m.slice(1)}</button>
                      ))}
                    </div>
                  </div>
                  {!saleYear && saleDateMode === 'day' && (
                    <div className="zff"><label>Day</label><input className="zdi" type="date" value={saleStart} onChange={e => { setSaleStart(e.target.value); setSaleEnd(e.target.value); }} /></div>
                  )}
                  {!saleYear && saleDateMode === 'month' && (
                    <div className="zff"><label>Month</label><input className="zdi" type="month" value={saleStart.slice(0, 7)} onChange={e => { const mm = e.target.value; if (mm) { setSaleStart(`${mm}-01`); setSaleEnd(monthEnd(mm)); } }} /></div>
                  )}
                  {!saleYear && saleDateMode === 'range' && (
                    <>
                      <div className="zff"><label>Date From</label><input className="zdi" type="date" value={saleStart} onChange={e => setSaleStart(e.target.value)} /></div>
                      <div className="zff"><label>Date To</label><input className="zdi" type="date" value={saleEnd} onChange={e => setSaleEnd(e.target.value)} /></div>
                    </>
                  )}
                  <div className="zff"><label>Year</label>
                    <select className="zsl" value={saleYear} onChange={e => setSaleYear(e.target.value)}>
                      <option value="">All</option>
                      {saleYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
                    <button className="zbt2" onClick={() => { setAcctMgr(''); setCoFilt(''); setSaleYear(''); setSaleDateMode('month'); setSaleStart(monthStart()); setSaleEnd(monthEnd(`${new Date().getFullYear()}-${zp(new Date().getMonth()+1)}`)); setSaleGran('date'); setSaleCntryFilt(''); setSaleCustFilt(''); setSaleConnFilt(''); }}>Reset</button>
                  </div>
                </div>
              </div>

              {loading ? <Skel /> : !rows.length ? (
                <div className="zpnl" style={{ padding: 48, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data for the selected period.</div>
              ) : (
                <div>
                  {!saleRows.length ? (
                    <div className="zpnl" style={{ padding: 48, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data for the selected filters.</div>
                  ) : (
                <>

                  {/* Chart controls — X / Y axis selectors at the top */}
                  <div className="zpnl" style={{ padding: '12px 16px', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <div style={axLbl}>Y‑Axis · Metric</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{METRICS.map(b => <button key={b.key} onClick={() => setPieMetric(b.key)} style={tbtn(pieMetric === b.key, b.color)}>{b.label}</button>)}</div>
                    </div>
                    <div>
                      <div style={axLbl}>X‑Axis · Dimension</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{DIMS.map(b => <button key={b.key} onClick={() => setBarDim(b.key)} style={tbtn(barDim === b.key)}>{b.label}</button>)}</div>
                    </div>
                  </div>

                  {/* Bar chart: metric (Y) by dimension (X) */}
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <PH title={`${metricCfg.label} by ${dimLabel}`} right={`${barRows.length} items`} />
                    <div style={{ height: 340, padding: '12px 12px 8px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={barRows} margin={{ top: 4, right: 12, bottom: 8, left: 0 }}>
                          <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                          <XAxis type="category" dataKey="name" {...AX} interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 10, fill: 'var(--inks)' }} />
                          <YAxis type="number" {...AX} width={55} tickFormatter={(v: number) => pieMetric === 'margin_pct' ? `${Math.round(v)}%` : v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(Math.round(v))} />
                          <Tooltip {...TIP} formatter={(v: any) => [fmtMetric(v), metricCfg.label]} />
                          <Bar dataKey="value" radius={[3,3,0,0]}>
                            {barRows.map((_: any, i: number) => <Cell key={i} fill={PAL[i % PAL.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Trend: metric (Y) by granularity (X) */}
                  {trendRows.length > 0 && (
                    <div className="zpnl" style={{ marginBottom: 16 }}>
                      <PH title={`${metricCfg.label} by ${granLabel}`} right={`${fDate(saleStart)} → ${fDate(saleEnd)}`} />
                      <div style={{ height: 260, padding: '12px 12px 8px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendRows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="saleTrendFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={metricCfg.color} stopOpacity={0.35} />
                                <stop offset="100%" stopColor={metricCfg.color} stopOpacity={0.02} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                            <XAxis dataKey="x" {...AX} tickFormatter={(v: string) => v.length > 7 ? v.slice(5) : v} />
                            <YAxis {...AX} width={55} tickFormatter={(v: number) => pieMetric === 'margin_pct' ? `${Math.round(v)}%` : v >= 1000 ? `${(v/1000).toFixed(1)}K` : String(Math.round(v))} />
                            <Tooltip {...TIP} formatter={(v: any) => [fmtMetric(v), metricCfg.label]} labelFormatter={(v: string) => `${granLabel}: ${v}`} />
                            <Area type="monotone" dataKey={pieMetric} stroke={metricCfg.color} strokeWidth={2} fill="url(#saleTrendFill)" dot={false} activeDot={{ r: 4 }} name={metricCfg.label} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* Detail table — matches Power BI Sale detail grid */}
                  <div className="zpnl">
                    <PH title="Sale Detail" right={`${fDate(saleStart)} → ${fDate(saleEnd)} · ${detailData.length} rows`} />
                    <div className="tbl-scroll" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 460 }}>
                      <table className="zt ztc" style={{ width: '100%', tableLayout: 'fixed' }}>
                        <thead><tr>
                          {saleDetailSort.th('mcc_mnc', 'MCCMNC', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('customer_company', 'Customer', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('country', 'Country', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('operator', 'Operator', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('customer_connection', 'Cst Conn', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('account_manager', 'Account', { style: { textAlign: 'left' } })}
                          {saleDetailSort.th('messages', 'Messages')}
                          {saleDetailSort.th('income', 'Income')}
                          {saleDetailSort.th('profit', 'Profit')}
                          {saleDetailSort.th('margin_pct', 'Margin %')}
                        </tr></thead>
                        <tbody>
                          {saleDetailSort.sort(detailData).map((r: any, i: number) => (
                            <tr key={i}>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}>{r.mcc_mnc}</td>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}><span className="zdot" style={{ background: PAL[i % PAL.length], display: 'inline-block', marginRight: 7, verticalAlign: 'middle' }} />{r.customer_company}</td>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}>{r.country}</td>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}>{r.operator}</td>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}>{r.customer_connection}</td>
                              <td style={{ textAlign: 'left', color: 'var(--ink)' }}>{r.account_manager}</td>
                              <td>{fN(r.messages)}</td>
                              <td>{fN(Math.round(r.income))}</td>
                              <td className={r.profit < 0 ? 'zneg' : 'zpos'}>{fN(Math.round(r.profit))}</td>
                              <td className={r.margin_pct < 0 ? 'zneg' : 'zpos'}>{Math.round(r.margin_pct)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot><tr>
                          <td style={{ textAlign: 'left' }}>Total ({detailData.length})</td>
                          <td style={{ textAlign: 'left' }}>—</td><td style={{ textAlign: 'left' }}>—</td><td style={{ textAlign: 'left' }}>—</td><td style={{ textAlign: 'left' }}>—</td><td style={{ textAlign: 'left' }}>—</td>
                          {(() => { const t = detailData.reduce((a: any, r: any) => ({ m: a.m + r.messages, i: a.i + r.income, p: a.p + r.profit }), { m: 0, i: 0, p: 0 }); return (<>
                            <td>{fN(t.m)}</td>
                            <td>{fN(Math.round(t.i))}</td>
                            <td className={t.p < 0 ? 'zneg' : 'zpos'}>{fN(Math.round(t.p))}</td>
                            {(() => { const mg = t.i > 0 ? Math.round((t.p / t.i) * 100) : null; return <td className={mg != null && mg < 0 ? 'zneg' : 'zpos'}>{mg != null ? mg : '—'}</td>; })()}
                          </>); })()}
                        </tr></tfoot>
                      </table>
                    </div>
                  </div>
                </>
              )}
                </div>
              )}
            </>
          );
        })()}

        {/* ════════════════════════════════════════════════
            COMPARISON TAB  (matches Power BI SMS Comparison Dashboard)
        ════════════════════════════════════════════════ */}
        {tab === 'comparison' && (
          <>
            {/* Unified filter bar — two explicit rows */}
            <div className="zpnl" style={{ marginBottom: 14, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Row 1: dropdowns — equal-width, single line */}
              <div style={{ display: 'flex', gap: 13, alignItems: 'flex-end' }}>
                {[
                  { label: 'Operator',            value: cmpOp,  options: cmpOpts.ops,  onChange: setCmpOp },
                  { label: 'Country',             value: cmpCtr, options: cmpOpts.ctrs, onChange: setCmpCtr },
                  { label: 'Customer',            value: cmpCst, options: cmpOpts.csts, onChange: setCmpCst },
                  { label: 'Customer Connection', value: cmpCon, options: cmpOpts.cons, onChange: setCmpCon },
                  { label: 'Account Manager',     value: cmpMgr, options: cmpOpts.mgrs, onChange: setCmpMgr },
                ].map(f => (
                  <div key={f.label} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mu)', whiteSpace: 'nowrap' }}>{f.label}</label>
                    <select className="zsl" value={f.value} onChange={e => f.onChange(e.target.value)} style={{ width: '100%' }}>
                      <option value="">All {f.label}</option>
                      {f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {/* Row 2: Compare By + date pickers + Reset — single line */}
              <div style={{ display: 'flex', gap: 13, alignItems: 'flex-end', flexWrap: 'nowrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mu)' }}>Compare By</label>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {(['day', 'week', 'month', 'range'] as const).map(m => (
                      <button key={m} onClick={() => applyCmpMode(m)} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, borderRadius: 6, border: '1.5px solid', cursor: 'pointer', whiteSpace: 'nowrap', borderColor: cmpMode === m ? 'var(--turquoise)' : 'var(--lns)', background: cmpMode === m ? 'var(--turquoise)' : 'var(--sf2)', color: cmpMode === m ? '#fff' : 'var(--inks)' }}>{m[0].toUpperCase() + m.slice(1)}</button>
                    ))}
                  </div>
                </div>
                {(cmpMode === 'range' || cmpMode === 'week') && (<>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P1 From</label><input className="zdi" type="date" value={p1Start} onChange={e => setP1Start(e.target.value)} /></div>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P1 To</label><input className="zdi" type="date" value={p1End} onChange={e => setP1End(e.target.value)} /></div>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P2 From</label><input className="zdi" type="date" value={p2Start} onChange={e => setP2Start(e.target.value)} /></div>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P2 To</label><input className="zdi" type="date" value={p2End} onChange={e => setP2End(e.target.value)} /></div>
                </>)}
                {cmpMode === 'day' && (<>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P1 — Day</label><input className="zdi" type="date" value={p1Start} onChange={e => { setP1Start(e.target.value); setP1End(e.target.value); }} /></div>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P2 — Day</label><input className="zdi" type="date" value={p2Start} onChange={e => { setP2Start(e.target.value); setP2End(e.target.value); }} /></div>
                </>)}
                {cmpMode === 'month' && (<>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P1 — Month</label><input className="zdi" type="month" value={p1Start.slice(0, 7)} onChange={e => { const m = e.target.value; if (m) { setP1Start(`${m}-01`); setP1End(monthEnd(m)); } }} /></div>
                  <div className="zff" style={{ flex: '0 0 auto' }}><label>P2 — Month</label><input className="zdi" type="month" value={p2Start.slice(0, 7)} onChange={e => { const m = e.target.value; if (m) { setP2Start(`${m}-01`); setP2End(monthEnd(m)); } }} /></div>
                </>)}
                <button className="zbt2" style={{ alignSelf: 'flex-end', flexShrink: 0 }} onClick={() => { setCmpOp(''); setCmpCtr(''); setCmpCst(''); setCmpCon(''); setCmpMgr(''); setCmpMode('day'); setP1Start(daysAgo(2)); setP1End(daysAgo(2)); setP2Start(yd()); setP2End(yd()); }}>Reset</button>
              </div>
            </div>
            <ComparisonTab
              p1Rows={p1Rows} p2Rows={p2Rows}
              p1Start={p1Start} p1End={p1End} p2Start={p2Start} p2End={p2End}
              fOp={cmpOp} fCtr={cmpCtr} fCst={cmpCst} fCon={cmpCon} fMgr={cmpMgr}
            />
          </>
        )}

        {/* ════════════════════════════════════════════════
            OVERVIEW TAB  (matches Power BI SMS Overview Dashboard)
        ════════════════════════════════════════════════ */}
        {tab === 'overview' && (() => {
          const lineProps = (c: string) => ({ strokeOpacity: ovSel && ovSel !== c ? 0.12 : 1, strokeWidth: ovSel === c ? 3.4 : 1.6 });
          const ovBtn = (active: boolean): React.CSSProperties => ({ padding: '5px 11px', fontSize: 12, fontWeight: 700, borderRadius: 5, border: '1.5px solid', cursor: 'pointer', transition: '.12s', borderColor: active ? 'var(--turquoise)' : 'var(--lns)', background: active ? 'var(--turquoise)' : 'var(--sf2)', color: active ? '#fff' : 'var(--inks)' });
          const ovTick = (v: string) => {
            if (ovGran === 'year') return v;
            if (ovGran === 'week') return v.split('-')[1] ?? v;
            if (ovGran === 'month') { const p = v.split('-'); return `${MNS[Number(p[1]) - 1]} '${p[0].slice(2)}`; }
            const p = v.split('-'); return `${MNS[Number(p[1]) - 1]} ${p[2]}`;
          };
          const granLabel  = ovGran === 'week' ? 'Week' : ovGran === 'month' ? 'Month' : ovGran === 'year' ? 'Year' : 'Day';
          const groupLabel = ovGroupBy === 'am' ? 'Account Manager' : 'Customer Company';
          const chartTitle = (metric: string) => `Avg ${metric} per ${granLabel} ${curYear} by Top 10 ${groupLabel}`;

          const OvHeader = ({ title }: { title: string }) => (
            <div className="zph"><h2>{title}</h2></div>
          );
          const OvLegend = () => (
            <div style={{ fontSize: 11, padding: '4px 18px 8px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {top10Keys.map((c, i) => {
                const active = ovSel === c;
                return (
                  <span key={c} onClick={() => setOvSel(active ? '' : c)} title={c}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: '2px 9px', borderRadius: 12, userSelect: 'none',
                      background: active ? PAL[i % PAL.length] : 'transparent', color: active ? '#fff' : 'var(--inks)',
                      opacity: ovSel && !active ? 0.45 : 1, fontWeight: active ? 700 : 500, transition: '.12s' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: PAL[i % PAL.length], display: 'inline-block' }} />
                    {c.length > 22 ? c.slice(0, 20) + '…' : c}
                  </span>
                );
              })}
              {ovSel && <span onClick={() => setOvSel('')} style={{ cursor: 'pointer', color: 'var(--alizarin)', fontWeight: 700, marginLeft: 4 }}>✕ clear</span>}
            </div>
          );

          const OvChart = ({ data, title, fmt, yFmt }: { data: any[]; title: string; fmt: (v: any, n: string) => [string, string]; yFmt: (v: number) => string }) => (
            data.length > 0 ? (
              <div className="zpnl" style={{ marginBottom: 16 }}>
                <OvHeader title={title} />
                <OvLegend />
                <div style={{ height: 320, padding: '12px 12px 8px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                      <XAxis dataKey="date" {...AX} tickFormatter={ovTick} />
                      <YAxis {...AX} width={60} tickFormatter={yFmt} />
                      <Tooltip {...TIP} formatter={fmt} labelFormatter={(v: string) => v} />
                      {top10Keys.map((c, i) => <Line key={c} type="monotone" dataKey={c} stroke={PAL[i % PAL.length]} {...lineProps(c)} dot={false} activeDot={{ r: 3 }} />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null
          );

          const kFmt  = (v: number) => v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${Math.round(v)}`;
          const mFmt  = (v: number) => v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(Math.round(v));
          const pFmt  = (v: number) => `${v.toFixed(1)}%`;

          return (
          <>
            {/* ── Row 1: Yearly KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 16 }}>
              <Kpi color="kb" label={`Avg Messages per Day ${curYear}`}    icon={IC.msg}   value={fN(Math.round(yearTotMsgs / yearDayCount))}                        sub="current year" loading={loading} />
              <Kpi color="kp" label={`Avg Profit per Day ${curYear}`}      icon={IC.trend} value={fN(Math.round(yearTotProfit / yearDayCount))}                       sub="current year" loading={loading} />
              <Kpi color="kt" label={`Avg Income per Day ${curYear}`}      icon={IC.rev}   value={fN(Math.round(yearTotIncome / yearDayCount))}                       sub="current year" loading={loading} />
              <Kpi color="kc" label={`Avg Profit Per Messages ${curYear}`} icon={IC.pct}   value={yearTotMsgs > 0 ? (yearTotProfit / yearTotMsgs).toFixed(2) : '—'} sub="current year" loading={loading} />
            </div>

            {/* ── Row 2: Current Month KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
              <Kpi color="kb" label="Avg Messages Current Month"              icon={IC.msg}   value={fN(Math.round(curMonthTotMsgs / curMonthDayCount))}                           sub="current month" loading={loading} />
              <Kpi color="kp" label="Avg Profit Current Month"                icon={IC.trend} value={fN(Math.round(curMonthTotProfit / curMonthDayCount))}                         sub="current month" loading={loading} />
              <Kpi color="kt" label="Avg Income Current Month"                icon={IC.rev}   value={fN(Math.round(curMonthTotIncome / curMonthDayCount))}                         sub="current month" loading={loading} />
              <Kpi color="kc" label="Avg Profit per Message Current Month"    icon={IC.pct}   value={curMonthTotMsgs > 0 ? (curMonthTotProfit / curMonthTotMsgs).toFixed(2) : '—'} sub="current month" loading={loading} />
            </div>

            {/* ── Shared control panel ── */}
            <div className="zpnl" style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: '14px 18px', gap: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mu)', marginRight: 4 }}>Group By</span>
                  {([['customer', 'Customer'], ['am', 'Account Manager']] as [string, string][]).map(([k, l]) => (
                    <button key={k} onClick={() => { setOvGroupBy(k as 'customer'|'am'); setOvSel(''); }} style={ovBtn(ovGroupBy === k)}>{l}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', borderLeft: '1px solid var(--ln)', paddingLeft: 24 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mu)', marginRight: 4 }}>Granularity</span>
                  {(['day', 'week', 'month', 'year'] as const).map(g => (
                    <button key={g} onClick={() => setOvGran(g)} style={ovBtn(ovGran === g)}>{g[0].toUpperCase() + g.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Charts 1–5 ── */}
            <OvChart data={ovChartData.messages} title={chartTitle('Messages')}  fmt={(v, n) => [fN(v), n]}  yFmt={mFmt} />
            <OvChart data={ovChartData.profit}   title={chartTitle('Profit')}    fmt={(v, n) => [fR(v), n]}  yFmt={kFmt} />
            <OvChart data={ovChartData.income}   title={chartTitle('Income')}    fmt={(v, n) => [fR(v), n]}  yFmt={kFmt} />
            <OvChart data={ovChartData.expenses} title={chartTitle('Expenses')}  fmt={(v, n) => [fR(v), n]}  yFmt={kFmt} />
            <OvChart data={ovChartData.margin}   title={chartTitle('Margin %')}  fmt={(v, n) => [fP(v), n]}  yFmt={pFmt} />
          </>
          );
        })()}


        {/* ════════════════════════════════════════════════
            PROFIT DATA TAB  (matches Power BI "Profit Data")
            — Current Month Data (Till Yesterday)
            — Account Manager Profit Data
        ════════════════════════════════════════════════ */}
        {tab === 'profit' && (
          <ProfitDataTab rows={rows} lastRefreshed={lastRefreshed} />
        )}

      </div>
    </>
  );
}
