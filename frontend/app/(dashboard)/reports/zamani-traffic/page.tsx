'use client';
import * as React from 'react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { zamaniApi } from '@/lib/api';
import { GaugeChart } from '@/components/charts/gauge-chart';

const PAL = ['#3498db','#1abc9c','#9b59b6','#e67e22','#e74c3c','#f1c40f','#2ecc71','#16a085','#8e44ad','#d35400','#34495e','#2980b9','#27ae60','#c0392b','#f39c12','#7f8c8d'];
const MNF = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MNS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const yd  = () => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); };
const fN  = (n: any) => n != null ? Number(n).toLocaleString('en-US',{maximumFractionDigits:0}) : '—';
const fR  = (n: any) => n != null ? `$${Number(n).toFixed(2)}` : '—';
const fM  = (n: any) => { if (n==null) return '—'; const v=Number(n); return v>=1e6?`$${(v/1e6).toFixed(2)}M`:v>=1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(2)}`; };
const fP  = (n: any) => n != null ? `${Number(n).toFixed(1)}%` : '—';
const fDate=(s: string) => {
  if (!s) return '';
  const d = new Date(s+'T00:00:00');
  return `${String(d.getDate()).padStart(2,'0')}-${MNS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
};

/* aggregate yesterday/mtd rows by customer */
function aggByCustomer(rows: any[]) {
  const map: Record<string, { name: string; messages: number; revenue: number; margin: number; idx: number }> = {};
  let idx = 0;
  rows.forEach((r: any) => {
    const n = r.customer_name ?? 'Unknown';
    if (!map[n]) map[n] = { name: n, messages: 0, revenue: 0, margin: 0, idx: idx++ };
    map[n].messages += Number(r.messages ?? 0);
    map[n].revenue  += Number(r.revenue  ?? 0);
    map[n].margin   += Number(r.margin   ?? 0);
  });
  return Object.values(map).map(r => ({
    ...r,
    pct: r.revenue ? (r.margin / r.revenue) * 100 : 0,
    col: PAL[r.idx % PAL.length],
  }));
}

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

/* ── kpi ──────────────────────────────── */
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

/* ── panel ────────────────────────────── */
.zpnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.zph{display:flex;align-items:center;justify-content:space-between;padding:15px 18px 12px;border-bottom:1px solid var(--ln)}
.zph h2{font-family:'Montserrat',sans-serif;font-weight:700;font-size:15px;color:var(--ink);letter-spacing:-.2px}
.zph .ztag{font-size:11px;color:var(--mu);font-weight:600}
.zpb{padding:16px 18px}

/* ── filters ──────────────────────────── */
.zfilt{display:flex;align-items:flex-end;gap:13px;flex-wrap:wrap;padding:14px 18px;margin-bottom:16px}
.zff{min-width:165px;flex:0 1 215px;display:flex;flex-direction:column;gap:6px}
.zff label{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mu)}
.zsl,.zdi{
  appearance:none;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:var(--ink);
  background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:9px 12px;width:100%;
  color-scheme:light;transition:border-color .15s,box-shadow .15s;
}
.dark .zsl,.dark .zdi{color-scheme:dark}
.zsl{padding-right:32px;cursor:pointer;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2395a5a6' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat:no-repeat;background-position:right 11px center}
.zsl:focus,.zdi:focus{outline:none;border-color:var(--turquoise);box-shadow:0 0 0 3px rgba(26,188,156,.18)}
.zbt{border:0;background:var(--turquoise);color:#fff;font-family:'Hanken Grotesk',sans-serif;font-weight:700;
  font-size:13px;padding:9px 18px;border-radius:7px;cursor:pointer;box-shadow:0 3px 0 var(--green-sea);transition:.12s;white-space:nowrap}
.zbt:hover{filter:brightness(1.06)}.zbt:active{transform:translateY(2px);box-shadow:0 1px 0 var(--green-sea)}

/* ── table ────────────────────────────── */
.zt{width:100%;border-collapse:collapse;font-size:13.5px}
.zt thead th{text-align:right;font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--mu);padding:0 16px 11px;border-bottom:2px solid var(--lns);cursor:pointer;user-select:none;white-space:nowrap}
.zt thead th:first-child{text-align:left}
.zt thead th.zs{color:var(--turquoise)}
.zt tbody td{padding:11px 16px;border-bottom:1px solid var(--ln);text-align:right;
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;color:var(--inks);white-space:nowrap}
.zt tbody td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif;font-weight:600;color:var(--ink)}
.zt tbody tr:nth-child(even){background:var(--stripe)}
.zt tbody tr:hover{background:var(--sf2)}
.zt tfoot td{padding:12px 16px;font-family:'JetBrains Mono',monospace;font-weight:700;font-variant-numeric:tabular-nums;
  text-align:right;color:var(--ink);border-top:2px solid var(--lns);background:var(--sf2)}
.zt tfoot td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif}

/* ── conn / dot ───────────────────────── */
.zconn{display:flex;align-items:center;gap:9px}
.zdot{width:8px;height:8px;border-radius:2px;flex:0 0 auto}

/* ── rev bar ──────────────────────────── */
.zrc{position:relative}
.zrb{position:absolute;left:0;top:50%;transform:translateY(-50%);height:20px;border-radius:4px;background:rgba(52,152,219,.16);z-index:0}
.zrv{position:relative;z-index:1}

/* ── pos / neg / new ──────────────────── */
.zpos{color:var(--pos);font-weight:600}
.zneg{color:var(--neg);font-weight:600}
.znew{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(26,188,156,.16);color:var(--green-sea)}

/* ── legend ───────────────────────────── */
.zleg{display:flex;flex-direction:column;gap:7px;font-size:12.5px;overflow-y:auto;max-height:220px}
.zleg .li{display:flex;align-items:center;gap:8px;color:var(--inks)}
.zleg .li b{margin-left:auto;font-family:'JetBrains Mono',monospace;color:var(--ink);font-weight:600;font-size:12px}
.zleg .sw{width:10px;height:10px;border-radius:3px;flex:0 0 auto}

/* ── date card ────────────────────────── */
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;
  box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}

/* ── tabs ─────────────────────────────── */
.ztabs{display:flex;border-bottom:2px solid var(--ln);margin-bottom:20px}
.ztab{flex:1;padding:12px 8px;font-size:14px;font-weight:600;color:var(--mu);background:transparent;border:none;cursor:pointer;
  position:relative;transition:color .15s;font-family:'Hanken Grotesk',sans-serif}
.ztab:hover{color:var(--ink)}
.ztab.za{color:var(--turquoise)}
.ztab.za::after{content:"";position:absolute;bottom:-2px;left:0;right:0;height:2.5px;background:var(--turquoise);border-radius:2px 2px 0 0}

/* ── skeleton ─────────────────────────── */
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
`;

/* ── icons ───────────────────────────────────────────────── */
const IC = {
  msg:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  rev:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  trend: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/></svg>,
  pct:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 5L5 19M6.5 6.5h.01M17.5 17.5h.01"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>,
  tgt:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>,
  down:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>,
  dlr:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>,
};

/* ── KPI card ────────────────────────────────────────────── */
function Kpi({ color, label, value, sub, icon }: { color: string; label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className={`zk ${color}`}>
      <div className="zk-top"><span className="zk-lbl">{label}</span><span className="zk-ic">{icon}</span></div>
      <div className="zk-val">{value}</div>
      {sub && <div className="zk-sub">{sub}</div>}
    </div>
  );
}

/* ── Panel header ────────────────────────────────────────── */
function PH({ title, right }: { title: string; right?: string }) {
  return (
    <div className="zph"><h2>{title}</h2>{right && <span className="ztag">{right}</span>}</div>
  );
}

/* ── Delta badge in KPI sub ──────────────────────────────── */
function Delta({ diff }: { diff: number | null }) {
  if (diff == null) return null;
  const up = diff >= 0;
  return (
    <span style={{ background: 'rgba(255,255,255,.22)', padding: '1px 7px', borderRadius: 20, fontWeight: 700, fontSize: 10.5, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {up ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}%
    </span>
  );
}

/* ── Comparison diff cell ────────────────────────────────── */
function Diff({ o, n }: { o: any; n: any }) {
  if (o == null || Number(o) === 0) return <span className="znew">NEW</span>;
  const d = (Number(n) - Number(o)) / Math.abs(Number(o)) * 100;
  return <span className={d >= 0 ? 'zpos' : 'zneg'}>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>;
}

/* ── Skeleton ────────────────────────────────────────────── */
function Skel() {
  return (
    <div className="zpnl" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(6)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.12 }} />)}
    </div>
  );
}

/* ── Sortable TH helper ──────────────────────────────────── */
function useSortState(defaultKey: string) {
  const [s, set] = React.useState<{ k: string; d: 1 | -1 }>({ k: defaultKey, d: -1 });
  const th = (k: string, label: string) => (
    <th className={s.k === k ? 'zs' : ''} onClick={() => set(p => p.k === k ? { k, d: (p.d * -1) as 1 | -1 } : { k, d: k === 'name' || k === 'customer_name' ? 1 : -1 })}>
      {label}{s.k === k ? (s.d === 1 ? ' ▲' : ' ▼') : ''}
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

/* ── shared chart tooltip ────────────────────────────────── */
const TIP = { contentStyle: { background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--mu)' } };
const AX  = { tick: { fontSize: 10, fill: 'var(--mu)' }, axisLine: false, tickLine: false };

/* ═══════════════════════════════════════════════════════════
   PAGE
════════════════════════════════════════════════════════════ */
type Tab = 'yesterday' | 'comparison' | 'mtd' | 'projections';

export default function ZamaniTrafficPage() {
  const [tab, setTab]                 = React.useState<Tab>('yesterday');
  const [customers, setCustomers]     = React.useState<string[]>([]);
  const [latestDate, setLatestDate]   = React.useState('');
  const [lastRefresh, setLastRefresh] = React.useState<string | null>(null);

  /* yesterday */
  const [yDate, setYDate] = React.useState(yd);
  const [yCust, setYCust] = React.useState('');
  const [yData, setYData] = React.useState<any>(null);
  const [yLoad, setYLoad] = React.useState(false);
  const ySort = useSortState('revenue');

  /* comparison */
  const [cOld, setCOld] = React.useState('');
  const [cNew, setCNew] = React.useState('');
  const [cData, setCData] = React.useState<any>(null);
  const [cLoad, setCLoad] = React.useState(false);

  /* mtd */
  const [mYear,  setMYear]  = React.useState(new Date().getFullYear());
  const [mMonth, setMMonth] = React.useState(new Date().getMonth() + 1);
  const [mCust,  setMCust]  = React.useState('');
  const [mData,  setMData]  = React.useState<any>(null);
  const [mLoad,  setMLoad]  = React.useState(false);
  const mSort = useSortState('revenue');

  /* projections */
  const [pYear,  setPYear]  = React.useState(new Date().getFullYear());
  const [pMonth, setPMonth] = React.useState(new Date().getMonth() + 1);
  const [pData,  setPData]  = React.useState<any>(null);
  const [pLoad,  setPLoad]  = React.useState(false);

  React.useEffect(() => {
    zamaniApi.getFilters().then(r => {
      const f = r.data as any;
      setCustomers(f.customers ?? []);
      setLatestDate(f.latestDate ?? '');
      setLastRefresh(f.lastRefreshed ?? null);
      if (f.latestDate) setCNew(f.latestDate);
    }).catch(console.error);
  }, []);

  React.useEffect(() => {
    if (tab !== 'yesterday' || !yDate) return;
    setYLoad(true);
    const p: Record<string, string> = { date: yDate };
    if (yCust) p.customer = yCust;
    zamaniApi.getYesterday(p).then(r => setYData(r.data)).catch(console.error).finally(() => setYLoad(false));
  }, [tab, yDate, yCust]);

  React.useEffect(() => {
    if (tab !== 'comparison' || !cOld || !cNew) return;
    setCLoad(true);
    zamaniApi.getComparison({ old_date: cOld, new_date: cNew }).then(r => setCData(r.data)).catch(console.error).finally(() => setCLoad(false));
  }, [tab, cOld, cNew]);

  React.useEffect(() => {
    if (tab !== 'mtd') return;
    setMLoad(true);
    const p: Record<string, string> = { year: String(mYear), month: String(mMonth) };
    if (mCust) p.customer = mCust;
    zamaniApi.getMtd(p).then(r => setMData(r.data)).catch(console.error).finally(() => setMLoad(false));
  }, [tab, mYear, mMonth, mCust]);

  React.useEffect(() => {
    if (tab !== 'projections') return;
    setPLoad(true);
    zamaniApi.getProjections({ year: String(pYear), month: String(pMonth) }).then(r => setPData(r.data)).catch(console.error).finally(() => setPLoad(false));
  }, [tab, pYear, pMonth]);

  /* ── derived data ─────────────────────────────────────── */
  const yRows = React.useMemo(() => aggByCustomer(yData?.rows ?? []), [yData]);
  const ySorted = ySort.sort(yRows);
  const yMaxRev = Math.max(1, ...ySorted.map((r: any) => Number(r.revenue)));

  const mRows   = React.useMemo(() => aggByCustomer(mData?.rows ?? []), [mData]);
  const mSorted = mSort.sort(mRows);

  /* comparison totals (computed from rows) */
  const cTotals = React.useMemo(() => {
    if (!cData?.rows?.length) return null;
    const t = cData.rows.reduce((acc: any, r: any) => ({
      msg_old: acc.msg_old + Number(r.messages_old ?? 0),
      msg_new: acc.msg_new + Number(r.messages_new ?? 0),
      rev_old: acc.rev_old + Number(r.revenue_old  ?? 0),
      rev_new: acc.rev_new + Number(r.revenue_new  ?? 0),
      mar_old: acc.mar_old + Number(r.margin_old   ?? 0),
      mar_new: acc.mar_new + Number(r.margin_new   ?? 0),
      dlr_old: acc.dlr_old + Number(r.dlr_old ?? 0),
      dlr_new: acc.dlr_new + Number(r.dlr_new ?? 0),
    }), { msg_old:0, msg_new:0, rev_old:0, rev_new:0, mar_old:0, mar_new:0, dlr_old:0, dlr_new:0 });
    return { ...t, dlr_pct_new: t.msg_new ? (t.dlr_new / t.msg_new) * 100 : 0 };
  }, [cData]);

  /* pie data: add percentage */
  const pieData = React.useMemo(() => {
    if (!cData?.pieData?.length) return [];
    const tot = cData.pieData.reduce((s: number, r: any) => s + Number(r.value), 0);
    return cData.pieData.map((r: any, i: number) => ({
      ...r,
      pct: tot ? (Number(r.value) / tot * 100) : 0,
      fill: PAL[i % PAL.length],
    }));
  }, [cData]);

  const TABS: { id: Tab; l: string }[] = [
    { id: 'yesterday',   l: 'Yesterday Data' },
    { id: 'comparison',  l: 'Comparison' },
    { id: 'mtd',         l: 'Month to Date' },
    { id: 'projections', l: 'Projections' },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{ margin: '-24px', padding: '28px 28px 50px', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── HEADER ──────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 4 }}>
              Traffic Overview
            </div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 27, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>
              Zamani Traffic Report
            </h1>
            {lastRefresh && (
              <p style={{ color: 'var(--mu)', fontSize: 12, marginTop: 4 }}>
                Refreshed {new Date(lastRefresh).toLocaleString()}
              </p>
            )}
          </div>
          {latestDate && (
            <div className="zdcard">
              <div className="dlbl">Data is up to</div>
              <div className="dval"><span className="zpulse" /><span>{fDate(latestDate)}</span></div>
            </div>
          )}
        </div>

        {/* ── TABS ────────────────────────────────────────── */}
        <div className="ztabs">
          {TABS.map(t => (
            <button key={t.id} className={`ztab${tab === t.id ? ' za' : ''}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════
            YESTERDAY
        ════════════════════════════════════════════════ */}
        {tab === 'yesterday' && (
          <>
            {yData?.totals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
                <Kpi color="kt" label="Total Messages" icon={IC.msg}
                  value={fN(yData.totals.messages)} sub={`for ${yDate}`} />
                <Kpi color="kb" label="Total Revenue" icon={IC.rev}
                  value={fM(yData.totals.revenue)} sub="yesterday total" />
                <Kpi color="kg" label="Total Margin" icon={IC.trend}
                  value={fM(yData.totals.margin)} sub="net contribution" />
                <Kpi color="kc" label="Avg Margin %" icon={IC.pct}
                  value={fP(yData.totals.revenue ? yData.totals.margin / yData.totals.revenue * 100 : 0)}
                  sub="margin ÷ revenue" />
              </div>
            )}

            <div className="zpnl zfilt">
              <div className="zff">
                <label>Date</label>
                <input className="zdi" type="date" value={yDate} onChange={e => setYDate(e.target.value)} />
              </div>
              <div className="zff">
                <label>Customer Connection</label>
                <select className="zsl" value={yCust} onChange={e => setYCust(e.target.value)}>
                  <option value="">All connections</option>
                  {customers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="zbt" onClick={() => setYCust('')}>Reset</button>
              </div>
            </div>

            {yLoad ? <Skel /> : (
              <div className="zpnl">
                <PH title="Yesterday Data" right={ySorted.length ? `${ySorted.length} connections` : undefined} />
                {!ySorted.length ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data for selected filters.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="zt">
                      <thead><tr>
                        {ySort.th('name', 'Customer Connection')}
                        {ySort.th('messages', 'Messages')}
                        {ySort.th('revenue', 'Revenue')}
                        {ySort.th('margin', 'Margin')}
                        {ySort.th('pct', 'Margin %')}
                      </tr></thead>
                      <tbody>
                        {ySorted.map((r: any, i: number) => {
                          const w = ((r.revenue / yMaxRev) * 100).toFixed(1);
                          return (
                            <tr key={i}>
                              <td><div className="zconn"><span className="zdot" style={{ background: r.col }} />{r.name}</div></td>
                              <td>{fN(r.messages)}</td>
                              <td className="zrc">
                                <div className="zrb" style={{ width: `${w}%` }} />
                                <span className="zrv">{fR(r.revenue)}</span>
                              </td>
                              <td className={r.margin < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                              <td>{fP(r.pct)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {yData?.totals && (
                        <tfoot><tr>
                          <td>Total</td>
                          <td>{fN(yData.totals.messages)}</td>
                          <td>{fR(yData.totals.revenue)}</td>
                          <td className={Number(yData.totals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(yData.totals.margin)}</td>
                          <td>{fP(yData.totals.revenue ? yData.totals.margin / yData.totals.revenue * 100 : 0)}</td>
                        </tr></tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════
            COMPARISON
        ════════════════════════════════════════════════ */}
        {tab === 'comparison' && (
          <>
            <div className="zpnl zfilt">
              <div className="zff">
                <label>Date New</label>
                <input className="zdi" type="date" value={cNew} onChange={e => setCNew(e.target.value)} />
              </div>
              <div className="zff">
                <label>Date Old</label>
                <input className="zdi" type="date" value={cOld} onChange={e => setCOld(e.target.value)} />
              </div>
            </div>

            {cTotals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
                <Kpi color="kt" label="Messages (New)" icon={IC.msg}
                  value={fN(cTotals.msg_new)}
                  sub={<><Delta diff={cTotals.msg_old ? (cTotals.msg_new - cTotals.msg_old) / cTotals.msg_old * 100 : null} /> vs {fN(cTotals.msg_old)}</>} />
                <Kpi color="kb" label="Revenue (New)" icon={IC.rev}
                  value={fM(cTotals.rev_new)}
                  sub={<><Delta diff={cTotals.rev_old ? (cTotals.rev_new - cTotals.rev_old) / cTotals.rev_old * 100 : null} /> vs {fM(cTotals.rev_old)}</>} />
                <Kpi color="kg" label="Margin (New)" icon={IC.trend}
                  value={fM(cTotals.mar_new)}
                  sub={<><Delta diff={cTotals.mar_old ? (cTotals.mar_new - cTotals.mar_old) / cTotals.mar_old * 100 : null} /> vs {fM(cTotals.mar_old)}</>} />
                <Kpi color="kp" label="Avg DLR %" icon={IC.dlr}
                  value={fP(cTotals.dlr_pct_new)} sub="delivered ÷ sent" />
              </div>
            )}

            {cLoad ? <Skel /> : (
              <>
                {/* Row 1: Sender donut + last 7 days area */}
                {(pieData.length > 0 || (cData?.last7Days?.length ?? 0) > 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 16, marginBottom: 16 }}>
                    <div className="zpnl">
                      <PH title="Messages by Sender ID" right={cNew || 'new date'} />
                      <div className="zpb" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                        {pieData.length > 0 ? (
                          <>
                            <div style={{ flex: '0 0 200px' }}>
                              <ResponsiveContainer width={200} height={200}>
                                <PieChart>
                                  <Pie data={pieData} dataKey="value" innerRadius={55} outerRadius={88} paddingAngle={2} startAngle={90} endAngle={-270} strokeWidth={0}>
                                    {pieData.map((e: any, i: number) => <Cell key={i} fill={e.fill} />)}
                                  </Pie>
                                  <Tooltip {...TIP} formatter={(v: any, _: any, p: any) => [`${fN(v)} (${p.payload.pct.toFixed(1)}%)`, 'Messages']} />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="zleg" style={{ flex: '1 1 150px' }}>
                              {pieData.map((d: any, i: number) => (
                                <div key={i} className="li">
                                  <span className="sw" style={{ background: d.fill }} />
                                  {d.name}
                                  <b>{d.pct.toFixed(1)}%</b>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={{ padding: 20, color: 'var(--mu)', fontSize: 13 }}>No sender data for selected date.</div>
                        )}
                      </div>
                    </div>
                    <div className="zpnl">
                      <PH title="Last 7 Days" right="Messages" />
                      <div style={{ height: 240, padding: '8px 8px 12px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={cData?.last7Days ?? []} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                            <defs><linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor={PAL[0]} stopOpacity={0.35} />
                              <stop offset="95%" stopColor={PAL[0]} stopOpacity={0.02} />
                            </linearGradient></defs>
                            <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                            <XAxis dataKey="date" {...AX} tickFormatter={v => v.slice(5)} />
                            <YAxis {...AX} width={46} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                            <Tooltip {...TIP} formatter={(v: any) => [fN(v), 'Messages']} />
                            <Area type="monotone" dataKey="messages" stroke={PAL[0]} strokeWidth={2.5}
                              fill="url(#ag1)" dot={false} activeDot={{ r: 4, fill: PAL[0], stroke: '#fff', strokeWidth: 2 }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 2: DLR table + bar chart */}
                {cData?.rows?.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1.15fr .85fr', gap: 16, marginBottom: 16 }}>
                    <div className="zpnl">
                      <PH title="Delivery Rate (DLR %)" />
                      <div style={{ overflowX: 'auto' }}>
                        <table className="zt">
                          <thead><tr>
                            <th style={{ textAlign: 'left' }}>Customer</th>
                            <th>Sent Old</th><th>Sent New</th><th>DLR Old</th><th>DLR New</th>
                          </tr></thead>
                          <tbody>
                            {cData.rows.map((r: any, i: number) => (
                              <tr key={i}>
                                <td><div className="zconn"><span className="zdot" style={{ background: PAL[i % PAL.length] }} />{r.customer_name}</div></td>
                                <td>{fN(r.messages_old)}</td>
                                <td>{fN(r.messages_new)}</td>
                                <td style={{ color: 'var(--mu)', fontSize: 12 }}>{fP(r.dlr_pct_old)}</td>
                                <td>{fP(r.dlr_pct_new)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {cTotals && (
                            <tfoot><tr>
                              <td>Total</td>
                              <td>{fN(cTotals.msg_old)}</td>
                              <td>{fN(cTotals.msg_new)}</td>
                              <td style={{ color: 'var(--mu)' }}>{fP(cTotals.msg_old ? cTotals.dlr_old / cTotals.msg_old * 100 : 0)}</td>
                              <td>{fP(cTotals.dlr_pct_new)}</td>
                            </tr></tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                    <div className="zpnl">
                      <PH title="Messages by Customer" right="New vs Old" />
                      <div style={{ height: 260, padding: '8px 8px 12px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={cData.rows.slice(0, 8).map((r: any) => ({ name: r.customer_name?.split('_')[0] ?? '?', old: Number(r.messages_old ?? 0), new: Number(r.messages_new ?? 0) }))}
                            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                            <XAxis dataKey="name" {...AX} />
                            <YAxis {...AX} width={42} tickFormatter={v => `${(v / 1000).toFixed(0)}K`} />
                            <Tooltip {...TIP} />
                            <Bar dataKey="old" fill={PAL[4]} fillOpacity={0.65} radius={[3, 3, 0, 0]} name="Old" />
                            <Bar dataKey="new" fill={PAL[0]} fillOpacity={0.85} radius={[3, 3, 0, 0]} name="New" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 3: full comparison table */}
                <div className="zpnl">
                  <PH title="Old vs New — by Customer Connection" right="Message · Revenue · Margin" />
                  {!cData?.rows?.length ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>Select two dates above to compare.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="zt">
                        <thead><tr>
                          <th style={{ textAlign: 'left' }}>Customer Connection</th>
                          <th>Msg Old</th><th>Msg New</th><th style={{ textAlign: 'center' }}>Msg Δ%</th>
                          <th>Rev Old</th><th>Rev New</th><th style={{ textAlign: 'center' }}>Rev Δ%</th>
                          <th>Mar Old</th><th>Mar New</th><th style={{ textAlign: 'center' }}>Mar Δ%</th>
                        </tr></thead>
                        <tbody>
                          {cData.rows.map((r: any, i: number) => (
                            <tr key={i}>
                              <td><div className="zconn"><span className="zdot" style={{ background: PAL[i % PAL.length] }} />{r.customer_name}</div></td>
                              <td>{r.messages_old == null ? '—' : fN(r.messages_old)}</td>
                              <td>{fN(r.messages_new)}</td>
                              <td style={{ textAlign: 'center' }}><Diff o={r.messages_old} n={r.messages_new} /></td>
                              <td>{r.revenue_old == null ? '—' : fR(r.revenue_old)}</td>
                              <td>{fR(r.revenue_new)}</td>
                              <td style={{ textAlign: 'center' }}><Diff o={r.revenue_old} n={r.revenue_new} /></td>
                              <td>{r.margin_old == null ? '—' : fR(r.margin_old)}</td>
                              <td>{fR(r.margin_new)}</td>
                              <td style={{ textAlign: 'center' }}><Diff o={r.margin_old} n={r.margin_new} /></td>
                            </tr>
                          ))}
                        </tbody>
                        {cTotals && (
                          <tfoot><tr>
                            <td>Total</td>
                            <td>{fN(cTotals.msg_old)}</td><td>{fN(cTotals.msg_new)}</td>
                            <td style={{ textAlign: 'center' }}><Diff o={cTotals.msg_old} n={cTotals.msg_new} /></td>
                            <td>{fR(cTotals.rev_old)}</td><td>{fR(cTotals.rev_new)}</td>
                            <td style={{ textAlign: 'center' }}><Diff o={cTotals.rev_old} n={cTotals.rev_new} /></td>
                            <td>{fR(cTotals.mar_old)}</td><td>{fR(cTotals.mar_new)}</td>
                            <td style={{ textAlign: 'center' }}><Diff o={cTotals.mar_old} n={cTotals.mar_new} /></td>
                          </tr></tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════
            MONTH TO DATE
        ════════════════════════════════════════════════ */}
        {tab === 'mtd' && (
          <>
            {mData?.totals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
                <Kpi color="kt" label="MTD Messages" icon={IC.msg}
                  value={fN(mData.totals.messages)} sub={`${mRows.length} connections`} />
                <Kpi color="kb" label="MTD Revenue" icon={IC.rev}
                  value={fM(mData.totals.revenue)} sub="month to date" />
                <Kpi color="kg" label="MTD Margin" icon={IC.trend}
                  value={fM(mData.totals.margin)} sub="net contribution" />
                <Kpi color="kc" label="Avg Margin %" icon={IC.pct}
                  value={fP(mData.totals.revenue ? mData.totals.margin / mData.totals.revenue * 100 : 0)}
                  sub="margin ÷ revenue" />
              </div>
            )}

            <div className="zpnl zfilt">
              <div className="zff">
                <label>Customer Connection</label>
                <select className="zsl" value={mCust} onChange={e => setMCust(e.target.value)}>
                  <option value="">All connections</option>
                  {customers.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Month</label>
                <select className="zsl" value={mMonth} onChange={e => setMMonth(Number(e.target.value))}>
                  {MNF.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div className="zff" style={{ maxWidth: 110 }}>
                <label>Year</label>
                <select className="zsl" value={mYear} onChange={e => setMYear(Number(e.target.value))}>
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="zbt" onClick={() => setMCust('')}>Reset</button>
              </div>
            </div>

            {mLoad ? <Skel /> : (
              <div className="zpnl">
                <PH title="Monthly Data" right={mSorted.length ? `${mSorted.length} of ${mRows.length}` : undefined} />
                {!mSorted.length ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data for this period.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="zt">
                      <thead><tr>
                        {mSort.th('name', 'Customer Connection')}
                        {mSort.th('messages', 'Messages')}
                        {mSort.th('revenue', 'Revenue')}
                        {mSort.th('margin', 'Margin')}
                        {mSort.th('pct', 'Margin %')}
                      </tr></thead>
                      <tbody>
                        {mSorted.map((r: any, i: number) => (
                          <tr key={i}>
                            <td><div className="zconn"><span className="zdot" style={{ background: r.col }} />{r.name}</div></td>
                            <td>{fN(r.messages)}</td>
                            <td>{fR(r.revenue)}</td>
                            <td className={r.margin < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                            <td>{fP(r.pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {mData?.totals && (
                        <tfoot><tr>
                          <td>Total</td>
                          <td>{fN(mData.totals.messages)}</td>
                          <td>{fR(mData.totals.revenue)}</td>
                          <td className={Number(mData.totals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(mData.totals.margin)}</td>
                          <td>{fP(mData.totals.revenue ? mData.totals.margin / mData.totals.revenue * 100 : 0)}</td>
                        </tr></tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════
            PROJECTIONS
        ════════════════════════════════════════════════ */}
        {tab === 'projections' && (
          <>
            {pData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
                <Kpi color="kd" label="Monthly Target" icon={IC.tgt}
                  value={fM(pData.target?.revenue ?? 0)} sub="month-end goal" />
                <Kpi color="kb" label="Monthly Projection" icon={IC.trend}
                  value={fM(pData.projected?.revenue ?? 0)} sub="forecast at run-rate" />
                <Kpi color="kt" label="MTD Revenue" icon={IC.rev}
                  value={fM(pData.actual?.revenue ?? 0)} sub="achieved so far" />
                <Kpi color="kr" label="Monthly Gap" icon={IC.down}
                  value={pData.gap != null ? fM(pData.gap) : '—'}
                  sub={pData.gap != null ? (pData.gap >= 0 ? 'on track' : 'behind target') : 'no target set'} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, marginBottom: 16 }}>
              <div className="zpnl">
                <PH title="Achieved vs Target" right="Revenue" />
                <div className="zpb">
                  {pData
                    ? <GaugeChart actual={pData.actual?.revenue ?? 0} projected={pData.projected?.revenue ?? 0} target={pData.target?.revenue ?? 0} label="of monthly target" formatValue={fM} />
                    : <div style={{ height: 180, display: 'grid', placeItems: 'center', color: 'var(--mu)', fontSize: 13 }}>No data</div>
                  }
                </div>
              </div>
              <div className="zpnl">
                <PH title="Filters" />
                <div className="zpb" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="zff" style={{ maxWidth: '100%' }}>
                    <label>Month</label>
                    <select className="zsl" value={pMonth} onChange={e => setPMonth(Number(e.target.value))}>
                      {MNF.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div className="zff" style={{ maxWidth: '100%' }}>
                    <label>Year</label>
                    <select className="zsl" value={pYear} onChange={e => setPYear(Number(e.target.value))}>
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  {pData?.daysInfo && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginTop: 4 }}>
                      {[
                        ['Days in Month', pData.daysInfo.daysInMonth],
                        ['Days Recorded', pData.daysInfo.currentDay],
                        ['Days Remaining', pData.daysInfo.remainingDays],
                        ['Avg / Day', `$${Number(pData.daysInfo.avgDayRevenue ?? 0).toFixed(0)}`],
                      ].map(([l, v]) => (
                        <div key={l as string}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--mu)', marginBottom: 3 }}>{l}</div>
                          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {pLoad ? <Skel /> : (
              <div className="zpnl">
                <PH title="Current Month Projection" right="Last 7 days → month-end" />
                {!pData?.perCustomer?.length ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No projection data available.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="zt">
                      <thead><tr>
                        <th style={{ textAlign: 'left' }}>Customer</th>
                        <th>Msg (7d)</th><th>Proj. Messages</th>
                        <th>Rev (7d)</th><th>Proj. Revenue</th>
                      </tr></thead>
                      <tbody>
                        {pData.perCustomer.map((r: any, i: number) => (
                          <tr key={i}>
                            <td><div className="zconn"><span className="zdot" style={{ background: PAL[i % PAL.length] }} />{r.customer_name}</div></td>
                            <td>{fN(r.messages_last7)}</td>
                            <td>{fN(r.projected_messages)}</td>
                            <td>{fR(r.revenue_last7)}</td>
                            <td className="zpos">{fR(r.projected_revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr>
                        <td>Total</td>
                        <td>{fN(pData.perCustomer.reduce((s: number, r: any) => s + Number(r.messages_last7 ?? 0), 0))}</td>
                        <td>{fN(pData.perCustomer.reduce((s: number, r: any) => s + Number(r.projected_messages ?? 0), 0))}</td>
                        <td>{fR(pData.perCustomer.reduce((s: number, r: any) => s + Number(r.revenue_last7 ?? 0), 0))}</td>
                        <td className="zpos">{fR(pData.perCustomer.reduce((s: number, r: any) => s + Number(r.projected_revenue ?? 0), 0))}</td>
                      </tr></tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </>
  );
}
