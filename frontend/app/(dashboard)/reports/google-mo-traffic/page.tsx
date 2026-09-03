'use client';
import * as React from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { googleMoApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const PAL = ['#3498db', '#1abc9c', '#9b59b6', '#e67e22', '#e74c3c', '#f1c40f', '#2ecc71', '#16a085', '#8e44ad', '#d35400', '#34495e', '#2980b9', '#27ae60', '#c0392b', '#f39c12', '#7f8c8d'];
const MNF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MNS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Zero-looking values: a real non-zero that would display as "0"/"-0" is revealed with
// enough decimals to act on (e.g. -0.4, -0.004); an exact zero never shows a minus sign.
const zz = (v: number, s: string) => {
  if (/[1-9]/.test(s)) return s;
  if (v !== 0 && Number.isFinite(v)) return s.replace(/-?[\d.,]+/, v.toLocaleString('en-US', { maximumSignificantDigits: 2 }));
  return s.includes('-') ? s.replace('-', '') : s;
};
const fN = (n: any) => { if (n == null) return '—'; const v = Number(n); return zz(v, v.toLocaleString('en-US', { maximumFractionDigits: 0 })); };
const fV = (n: any) => {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return fN(v);
};
const fR = (n: any) => { if (n == null) return '—'; const v = Number(n); return zz(v, `$${v.toFixed(4)}`); };
const fM = (n: any) => {
  if (n == null) return '—';
  const v = Number(n);
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return zz(v, `$${v.toFixed(2)}`);
};
const fP = (n: any) => { if (n == null) return '—'; const v = Number(n); return zz(v, `${v.toFixed(2)}%`); };
const fDate = (s: string) => {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}-${MNS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
};

/* Stable, well-separated per-country colour — same country → same colour on
   every tab/chart (pure function of the name), but spread across the full HSL
   space so different countries look distinct instead of clustering into a few
   similar palette hues. Two independent hashes drive hue vs. saturation/
   lightness, so even countries with nearby hues stay tellable apart. */
const _countryColorCache = new Map<string, string>();
function countryColor(name: any): string {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return 'var(--mu)';
  const cached = _countryColorCache.get(key);
  if (cached) return cached;
  let h1 = 0, h2 = 0, h3 = 0;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = (Math.imul(h1, 31) + c) | 0;
    h2 = (Math.imul(h2, 131) + c * 7 + 17) | 0;
    h3 = (Math.imul(h3, 159) + c * 13 + 91) | 0;
  }
  const hue = Math.abs(h1) % 360;
  const sat = 52 + (Math.abs(h2) % 7) * 6;              // 52 → 88%
  const light = 38 + (Math.abs(h3) % 5) * 7;            // 38 → 66%
  const color = `hsl(${hue}, ${sat}%, ${light}%)`;
  _countryColorCache.set(key, color);
  return color;
}

/* Volume Y-axis ticks for the Yesterday bar chart: fixed low-end anchors
   0 → 100 → 3000 → 6000, then extend upward with a rounded step so the top
   tick always clears the tallest bar without crowding the axis. */
function volumeAxisTicks(maxVal: number): number[] {
  const ticks = [0, 100, 3000, 6000];
  if (!(maxVal > 6000)) return ticks;
  const rawStep = (maxVal - 6000) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.max(3000, Math.ceil(rawStep / mag) * mag);
  for (let t = 6000 + step; ticks[ticks.length - 1] < maxVal; t += step) ticks.push(t);
  return ticks;
}

/* ── Date computation for Data Table filters ─────────────────────── */
function computeDtDates(
  mode: 'day' | 'month' | 'range',
  dayStart: string, dayEnd: string,
  monthStart: string, monthEnd: string,
  range: string,
): { date_start: string; date_end: string } {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date();

  if (mode === 'day') {
    // empty strings → let backend use its default
    return { date_start: dayStart, date_end: dayEnd };
  }
  if (mode === 'month') {
    const ms = monthStart || fmt(today).slice(0, 7);
    const me = monthEnd || fmt(today).slice(0, 7);
    const [sy, sm] = ms.split('-').map(Number);
    const [ey, em] = me.split('-').map(Number);
    const lastDay = new Date(ey, em, 0).getDate();
    return {
      date_start: `${sy}-${String(sm).padStart(2, '0')}-01`,
      date_end: `${ey}-${String(em).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  // range mode — predefined n-day window
  const n = Math.max(1, parseInt(range || '5') - 1);
  const start = new Date(today); start.setDate(today.getDate() - n);
  return { date_start: fmt(start), date_end: fmt(today) };
}


/* ── CSS (same Zamani design system) ───────────────────────────────── */
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
.zk.km1{background:#1f5f8b} .zk.km2{background:#0e7c67} .zk.km3{background:#7b3030} .zk.km4{background:#5b3480}
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
.zpb{padding:16px 18px}
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
/* Segmented toggle (P&L Monthly / By Destination). Distinct from .zbt, which is always a solid
   turquoise action button — a toggle needs a visibly UNSELECTED state, so inactive is outlined and
   only the selected option is filled. */
.ztg{background:var(--sf);color:var(--inks);border:1px solid var(--lns);font-family:'Hanken Grotesk',sans-serif;
  font-weight:600;font-size:13px;padding:9px 18px;border-radius:7px;cursor:pointer;transition:.12s;white-space:nowrap}
.ztg:hover{border-color:var(--turquoise);color:var(--ink)}
.ztg.za{background:var(--turquoise);color:#fff;border-color:var(--green-sea);font-weight:700;box-shadow:0 3px 0 var(--green-sea)}
.ztg.za:active{transform:translateY(2px);box-shadow:0 1px 0 var(--green-sea)}
.zt{width:100%;border-collapse:collapse;font-size:13.5px}
.zt thead th{text-align:right;font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--mu);padding:10px 16px 10px;border-bottom:2px solid var(--lns);cursor:pointer;user-select:none;white-space:nowrap;
  position:sticky;top:0;background:var(--sf);z-index:1}
.zt thead th:first-child{text-align:left}
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
.zrc{position:relative}
.zrb{position:absolute;left:0;top:50%;transform:translateY(-50%);height:20px;border-radius:4px;background:rgba(52,152,219,.16);z-index:0}
.zrv{position:relative;z-index:1}
.zpos{color:var(--pos);font-weight:600}
.zneg{color:var(--neg);font-weight:600}
.znew{font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:20px;background:rgba(26,188,156,.16);color:var(--green-sea)}
.zleg{display:flex;flex-direction:column;gap:7px;font-size:12.5px}
.zleg .li{display:flex;align-items:center;gap:8px;color:var(--inks)}
.zleg .li b{margin-left:auto;font-family:'JetBrains Mono',monospace;color:var(--ink);font-weight:600;font-size:12px}
.zleg .sw{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:18px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;
  box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.ztabs{display:flex;border-bottom:2px solid var(--ln);margin-bottom:20px;overflow-x:auto}
.ztab{flex:1;min-width:max-content;padding:12px 14px;font-size:13px;font-weight:600;color:var(--mu);background:transparent;border:none;cursor:pointer;
  position:relative;transition:color .15s;font-family:'Hanken Grotesk',sans-serif}
.ztab:hover{color:var(--ink)}
.ztab.za{color:var(--turquoise)}
.ztab.za::after{content:"";position:absolute;bottom:-2px;left:0;right:0;height:2.5px;background:var(--turquoise);border-radius:2px 2px 0 0}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
`;

/* ── Shared helpers ─────────────────────────────────────────────────── */
const IC_VOL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="6" height="18" /><rect x="9" y="8" width="6" height="13" /><rect x="16" y="13" width="6" height="8" /></svg>;
const IC_REV = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
const IC_COST = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4M21 12a2 2 0 0 0 0 4H5a2 2 0 0 0 0 4h16v-4" /></svg>;
const IC_TREND = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v6h-6" /></svg>;

function Kpi({ color, label, value, sub, icon }: { color: string; label: string; value: string; sub?: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className={`zk ${color}`}>
      <div className="zk-top"><span className="zk-lbl">{label}</span><span className="zk-ic">{icon}</span></div>
      <div className="zk-val">{value}</div>
      {sub && <div className="zk-sub">{sub}</div>}
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
  return <span className={d >= 0 ? 'zpos' : 'zneg'}>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>;
}
function DiffCmp({ o, n }: { o: any; n: any }) {
  if (o == null) return <span style={{ color: 'var(--mu)' }}>—</span>;
  if (Number(o) === 0) return <span style={{ color: 'var(--mu)' }}>—</span>;
  const d = (Number(n) - Number(o)) / Math.abs(Number(o)) * 100;
  return <span className={d >= 0 ? 'zpos' : 'zneg'}>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>;
}
function DiffCell({ o, n, noBg }: { o: any; n: any; noBg?: boolean }) {
  if (o == null) return <td style={{ textAlign: 'right' }}><span style={{ color: 'var(--mu)' }}>—</span></td>;
  if (Number(o) === 0) {
    return <td style={{ textAlign: 'right' }}><span style={{ color: 'var(--mu)' }}>—</span></td>;
  }
  const d = (Number(n) - Number(o)) / Math.abs(Number(o)) * 100;
  return (
    <td style={{ background: noBg ? undefined : (d >= 0 ? 'rgba(39,174,96,0.18)' : 'rgba(231,76,60,0.18)'), textAlign: 'right' }}>
      <span className={d >= 0 ? 'zpos' : 'zneg'}>{d >= 0 ? '+' : ''}{d.toFixed(2)}%</span>
    </td>
  );
}
/* Country label with its stable colour dot — used across every tab's tables */
function CountryDot({ name, center }: { name: any; center?: boolean }) {
  return (
    <div className="zconn" style={center ? { justifyContent: 'center' } : undefined}>
      <span className="zdot" style={{ background: countryColor(name) }} />
      {name}
    </div>
  );
}
const TIP = { contentStyle: { background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: 'var(--mu)' } };
const AX = { tick: { fontSize: 10, fill: 'var(--mu)' }, axisLine: false, tickLine: false };

const LEFT_SORT_KEYS = new Set(['date', 'country', 'country_name', 'operator_name', 'customer_name', 'vendor_name', 'month_name']);

function useSortState(defaultKey: string) {
  const [s, set] = React.useState<{ k: string; d: 1 | -1 }>({ k: defaultKey, d: -1 });
  const th = (k: string, label: string, align?: 'left' | 'center' | 'right') => {
    const active = s.k === k;
    const isLeft = LEFT_SORT_KEYS.has(k);
    const textAlign = align ?? (isLeft ? 'left' : 'right');
    return (
      <th
        key={k}
        className={active ? 'zs' : ''}
        onClick={() => set(p => p.k === k ? { k, d: (p.d * -1) as 1 | -1 } : { k, d: isLeft ? 1 : -1 })}
        style={{ textAlign, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      >
        {label}{' '}
        <span style={{ opacity: active ? 1 : 0.3, fontSize: 9 }}>
          {active ? (s.d === 1 ? '▲' : '▼') : '⇅'}
        </span>
      </th>
    );
  };
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

function usePagination(total: number, pageSize: number) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp page if total shrinks
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return { page: safePage, setPage, totalPages, start, end };
}

function Paginator({ page, totalPages, setPage, total, pageSize }: {
  page: number; totalPages: number; setPage: (p: number) => void; total: number; pageSize: number;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages: (number | '…')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('…');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }
  const btn = (lbl: React.ReactNode, p: number | null, disabled?: boolean) => (
    <button key={String(lbl)} onClick={() => p !== null && setPage(p)} disabled={!!disabled || p === null}
      style={{
        minWidth: 32, height: 32, padding: '0 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
        border: `1.5px solid ${p === page ? 'var(--turquoise)' : 'var(--lns)'}`,
        background: p === page ? 'var(--turquoise)' : 'var(--sf2)',
        color: p === page ? '#fff' : disabled ? 'var(--mu)' : 'var(--ink)',
        cursor: disabled ? 'default' : 'pointer', transition: '.1s',
      }}>
      {lbl}
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid var(--ln)', flexWrap: 'wrap', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--mu)' }}>{from}–{to} of {total}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {btn('‹', page > 1 ? page - 1 : null, page === 1)}
        {pages.map((p, i) => p === '…' ? <span key={`e${i}`} style={{ padding: '0 4px', color: 'var(--mu)', lineHeight: '32px' }}>…</span> : btn(p, p as number))}
        {btn('›', page < totalPages ? page + 1 : null, page === totalPages)}
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════
   PAGE
════════════════════════════════════════════════════════════════════ */
type Tab = 'data-table' | 'comparison' | 'profit-loss' | 'yesterday' | 'yesterday-iristel';
const TABS: { id: Tab; l: string }[] = [
  { id: 'data-table', l: 'Data Table' },
  { id: 'comparison', l: 'Comparison' },
  { id: 'profit-loss', l: 'Profit and Loss' },
  { id: 'yesterday', l: 'Yesterday Data' },
  { id: 'yesterday-iristel', l: 'Yesterday Data - Iristel' },
];

type Metric = 'volume' | 'revenue' | 'vendor_cost' | 'margin';
const MCFG: Record<Metric, { label: string; color: string; yAxis: 'left' | 'right'; fmt: (v: any) => string }> = {
  volume: { label: 'Volume', color: PAL[0], yAxis: 'left', fmt: fV },
  revenue: { label: 'Revenue', color: PAL[1], yAxis: 'right', fmt: fR },
  vendor_cost: { label: 'Vendor Cost', color: PAL[4], yAxis: 'right', fmt: fR },
  margin: { label: 'Margin', color: PAL[2], yAxis: 'right', fmt: fR },
};

export default function GoogleMoTrafficPage() {
  const [tab, setTab] = React.useState<Tab>('data-table');
  const [filters, setFilters] = React.useState<any>({});
  const [latestDate, setLatestDate] = React.useState('');
  const [lastRefresh, setLastRefresh] = React.useState<string | null>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);


  /* ── Data Table state ──────────────────────────────────────── */
  const [dtMode, setDtMode] = React.useState<'day' | 'month' | 'range'>('day');
  const [dtDayStart, setDtDayStart] = React.useState('');
  const [dtDayEnd, setDtDayEnd] = React.useState('');
  const [dtMonthStart, setDtMonthStart] = React.useState('');
  const [dtMonthEnd, setDtMonthEnd] = React.useState('');
  const [dtRange, setDtRange] = React.useState('5');
  const [dtMccmnc, setDtMccmnc] = React.useState('');
  const [dtCountry, setDtCountry] = React.useState('');
  const [dtOperator, setDtOperator] = React.useState('');
  const [dtData, setDtData] = React.useState<any>(null);
  const [dtLoad, setDtLoad] = React.useState(false);
  const [dtMetrics, setDtMetrics] = React.useState<Set<Metric>>(new Set<Metric>(['volume']));
  const [dtOpMetrics, setDtOpMetrics] = React.useState<Set<Metric>>(new Set<Metric>(['volume', 'revenue', 'vendor_cost', 'margin']));
  const [estimates, setEstimates] = React.useState<any>(null);

  const dtRowSort = useSortState('date');

  const toggleMetric = (m: Metric) => setDtMetrics(prev => {
    const next = new Set(prev);
    if (next.has(m) && next.size > 1) next.delete(m); else next.add(m);
    return next;
  });
  const toggleOpMetric = (m: Metric) => setDtOpMetrics(prev => {
    const next = new Set(prev);
    if (next.has(m) && next.size > 1) next.delete(m); else next.add(m);
    return next;
  });

  /* Comparison */
  const [cDateNew, setCDateNew] = React.useState('');
  const [cDateOld, setCDateOld] = React.useState('');
  const [cCountry, setCCountry] = React.useState('');
  const [cOperator, setCOperator] = React.useState('');
  const [cData, setCData] = React.useState<any>(null);
  const [cLoad, setCLoad] = React.useState(false);

  const cmpSort = useSortState('volume_new');
  const yvdbSort = useSortState('volume_td2');
  // Metric plotted on the Last-7-Days trend line chart (one line per country → single metric at a time)
  const [cTrendMetric, setCTrendMetric] = React.useState<Metric>('revenue');

  /* Profit and Loss */
  const [plMccmnc, setPlMccmnc] = React.useState('');
  const [plCountry, setPlCountry] = React.useState('');
  const [plOperator, setPlOperator] = React.useState('');
  const [plYear, setPlYear] = React.useState('');
  const [plMonth, setPlMonth] = React.useState('');
  const [plAvailableYears, setPlAvailableYears] = React.useState<number[]>([]);
  const [plAvailableMonths, setPlAvailableMonths] = React.useState<number[]>([]);
  const [plData, setPlData] = React.useState<any>(null);
  const [plLoad, setPlLoad] = React.useState(false);
  const plSort = useSortState('year');
  // P&L grouping: 'month' = the original month × country rows; 'destination' = one row per
  // country × operator × MCC/MNC aggregated over the selected period (an overall per-destination view).
  const [plMode, setPlMode] = React.useState<'month' | 'destination'>('month');
  const plDestSort = useSortState('margin');

  /* Yesterday */
  const [yMccmnc, setYMccmnc] = React.useState('');
  const [yCountry, setYCountry] = React.useState('');
  const [yOperator, setYOperator] = React.useState('');
  const [yData, setYData] = React.useState<any>(null);
  const [yLoad, setYLoad] = React.useState(false);
  const ySort = useSortState('date');
  const [yMetrics, setYMetrics] = React.useState<Set<Metric>>(new Set<Metric>(['volume', 'revenue', 'vendor_cost', 'margin']));
  const toggleYMetric = (m: Metric) => setYMetrics(prev => {
    const next = new Set(prev);
    if (next.has(m) && next.size > 1) next.delete(m); else next.add(m);
    return next;
  });

  /* Yesterday Iristel */
  const [yiFilters, setYiFilters] = React.useState<any>(null);
  const [yiMccmnc, setYiMccmnc] = React.useState('');
  const [yiCountry, setYiCountry] = React.useState('');
  const [yiOperator, setYiOperator] = React.useState('');
  const [yiData, setYiData] = React.useState<any>(null);
  const [yiLoad, setYiLoad] = React.useState(false);
  const yiSort = useSortState('date');
  const [yiMetrics, setYiMetrics] = React.useState<Set<Metric>>(new Set<Metric>(['volume', 'revenue', 'vendor_cost', 'margin']));
  const toggleYiMetric = (m: Metric) => setYiMetrics(prev => {
    const next = new Set(prev);
    if (next.has(m) && next.size > 1) next.delete(m); else next.add(m);
    return next;
  });

  /* ── Initialise date inputs after mount (client-only) ──────── */
  React.useEffect(() => {
    const today = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fiveAgo = new Date(today); fiveAgo.setDate(today.getDate() - 4);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const dayBefore = new Date(today); dayBefore.setDate(today.getDate() - 2);
    const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    setDtDayStart(fmt(fiveAgo));
    setDtDayEnd(fmt(today));
    setDtMonthStart(ym);
    setDtMonthEnd(ym);
    setCDateNew(fmt(yesterday));
    setCDateOld(fmt(dayBefore));
  }, []);

  /* ── Computed API date range ────────────────────────────────── */
  const { date_start: dtApiStart, date_end: dtApiEnd } = React.useMemo(
    () => computeDtDates(dtMode, dtDayStart, dtDayEnd, dtMonthStart, dtMonthEnd, dtRange),
    [dtMode, dtDayStart, dtDayEnd, dtMonthStart, dtMonthEnd, dtRange],
  );

  /* ── Filters ────────────────────────────────────────────────── */
  React.useEffect(() => {
    googleMoApi.getFilters().then(r => {
      const f = (r as any).data as any;
      setFilters(f);
      setLatestDate(f.latestDate ?? '');
      setLastRefresh(f.lastRefreshed ?? null);
      setDatasetId(f.datasetId ?? null);
    }).catch(console.error);
  }, [refreshTick]);

  useDatasetSocket(datasetId, React.useCallback(() => setRefreshTick(t => t + 1), []));

  /* ── Data Table fetch ───────────────────────────────────────── */
  React.useEffect(() => {
    if (tab !== 'data-table') return;
    setDtLoad(true);
    const p: Record<string, string> = {};
    if (dtApiStart) p.date_start = dtApiStart;
    if (dtApiEnd) p.date_end = dtApiEnd;
    if (dtMccmnc) p.mccmnc = dtMccmnc;
    if (dtCountry) p.country = dtCountry;
    if (dtOperator) p.operator = dtOperator;
    Promise.all([googleMoApi.getData(p), googleMoApi.getEstimates(p)])
      .then(([d, e]) => { setDtData((d as any).data); setEstimates((e as any).data); })
      .catch(console.error).finally(() => setDtLoad(false));
  }, [tab, dtApiStart, dtApiEnd, dtMccmnc, dtCountry, dtOperator, refreshTick]);

  React.useEffect(() => {
    if (tab !== 'comparison') return;
    setCLoad(true);
    const p: Record<string, string> = {};
    if (cDateOld) p.date_old = cDateOld;
    if (cDateNew) p.date_new = cDateNew;
    if (cCountry) p.countries = cCountry;
    if (cOperator) p.operators = cOperator;
    googleMoApi.getComparison(p).then(r => setCData((r as any).data)).catch(console.error).finally(() => setCLoad(false));
  }, [tab, cDateOld, cDateNew, cCountry, cOperator, refreshTick]);

  React.useEffect(() => {
    if (tab !== 'profit-loss') return;
    setPlLoad(true);
    const p: Record<string, string> = {};
    if (plMccmnc) p.mccmnc = plMccmnc;
    if (plCountry) p.countries = plCountry;
    if (plOperator) p.operators = plOperator;
    if (plYear) p.year = plYear;
    if (plMonth) p.month = plMonth;
    const req = plMode === 'destination'
      ? googleMoApi.getProfitLossDestinations(p)
      : googleMoApi.getProfitLoss(p);
    req.then(r => setPlData((r as any).data)).catch(console.error).finally(() => setPlLoad(false));
  }, [tab, plMode, plMccmnc, plCountry, plOperator, plYear, plMonth, refreshTick]);

  // On mount: cascade fetch years → pick best year → fetch months → pick best month
  React.useEffect(() => {
    const today = new Date();
    const currYear = today.getFullYear();
    const currMonth = today.getMonth() + 1;
    googleMoApi.getPlYears().then(r => {
      const years: number[] = (r as any).data?.years ?? [];
      setPlAvailableYears(years);
      if (!years.length) return;
      const bestYear = years.includes(currYear) ? currYear : years[0];
      setPlYear(String(bestYear));
      googleMoApi.getPlMonths({ year: String(bestYear) }).then(r2 => {
        const months: number[] = (r2 as any).data?.months ?? [];
        setPlAvailableMonths(months);
        if (!months.length) return;
        const bestMonth = months.includes(currMonth) ? currMonth : months[months.length - 1];
        setPlMonth(String(bestMonth));
      }).catch(console.error);
    }).catch(console.error);
  }, []);

  // When user changes year: refresh the month list
  React.useEffect(() => {
    const p: Record<string, string> = {};
    if (plYear) p.year = plYear;
    googleMoApi.getPlMonths(p)
      .then(r => setPlAvailableMonths(((r as any).data?.months ?? []) as number[]))
      .catch(console.error);
  }, [plYear]);

  React.useEffect(() => {
    if (tab !== 'yesterday') return;
    setYLoad(true);
    const p: Record<string, string> = {};
    if (yMccmnc) p.mccmnc = yMccmnc;
    if (yCountry) p.countries = yCountry;
    if (yOperator) p.operators = yOperator;
    googleMoApi.getYesterday(p).then(r => setYData((r as any).data)).catch(console.error).finally(() => setYLoad(false));
  }, [tab, yMccmnc, yCountry, yOperator, refreshTick]);

  React.useEffect(() => {
    if (tab !== 'yesterday-iristel') return;
    if (!yiFilters) {
      googleMoApi.getYesterdayIristelFilters().then(r => setYiFilters((r as any).data)).catch(console.error);
    }
    setYiLoad(true);
    const p: Record<string, string> = {};
    if (yiMccmnc) p.mccmnc = yiMccmnc;
    if (yiCountry) p.countries = yiCountry;
    if (yiOperator) p.operators = yiOperator;
    googleMoApi.getYesterdayIristel(p).then(r => setYiData((r as any).data)).catch(console.error).finally(() => setYiLoad(false));
  }, [tab, yiMccmnc, yiCountry, yiOperator, refreshTick]);

  /* ── Derived ────────────────────────────────────────────────── */
  const yRows = yData?.rows ?? [];
  const ySorted = ySort.sort(yRows);
  const yPag = usePagination(ySorted.length, 12);
  const yTotals = React.useMemo(() => {
    if (!yRows.length) return null;
    return yRows.reduce((acc: any, r: any) => ({
      volume: acc.volume + Number(r.volume || 0),
      revenue: acc.revenue + Number(r.revenue || 0),
      vendor_cost: acc.vendor_cost + Number(r.vendor_cost || 0),
      margin: acc.margin + Number(r.margin || 0),
    }), { volume: 0, revenue: 0, vendor_cost: 0, margin: 0 });
  }, [yRows]);

  const yChartData = React.useMemo(() => {
    if (!yRows.length) return [];
    const map = new Map<string, { country_name: string; volume: number; revenue: number; vendor_cost: number; margin: number }>();
    for (const r of yRows) {
      const key = r.country_name ?? '';
      if (!map.has(key)) map.set(key, { country_name: key, volume: 0, revenue: 0, vendor_cost: 0, margin: 0 });
      const e = map.get(key)!;
      e.volume += Number(r.volume || 0);
      e.revenue += Number(r.revenue || 0);
      e.vendor_cost += Number(r.vendor_cost || 0);
      e.margin += Number(r.margin || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.volume - a.volume);
  }, [yRows]);

  // Volume-axis ticks for the Yesterday bar chart (top 12 shown), upper tick adapts to the data
  const yVolTicks = React.useMemo(
    () => volumeAxisTicks(yChartData.slice(0, 12).reduce((m: number, d: any) => Math.max(m, Number(d.volume || 0)), 0)),
    [yChartData],
  );

  const yiRows = yiData?.rows ?? [];
  const yiSorted = yiSort.sort(yiRows);
  const yiPag = usePagination(yiSorted.length, 12);
  const yiTotals = React.useMemo(() => {
    if (!yiRows.length) return null;
    return yiRows.reduce((acc: any, r: any) => ({
      volume: acc.volume + Number(r.volume || 0),
      revenue: acc.revenue + Number(r.revenue || 0),
      vendor_cost: acc.vendor_cost + Number(r.vendor_cost || 0),
      margin: acc.margin + Number(r.margin || 0),
    }), { volume: 0, revenue: 0, vendor_cost: 0, margin: 0 });
  }, [yiRows]);
  const yiChartData = React.useMemo(() => {
    if (!yiRows.length) return [];
    const map = new Map<string, { country_name: string; volume: number; revenue: number; vendor_cost: number; margin: number }>();
    for (const r of yiRows) {
      const key = r.country_name ?? '';
      if (!map.has(key)) map.set(key, { country_name: key, volume: 0, revenue: 0, vendor_cost: 0, margin: 0 });
      const e = map.get(key)!;
      e.volume += Number(r.volume || 0);
      e.revenue += Number(r.revenue || 0);
      e.vendor_cost += Number(r.vendor_cost || 0);
      e.margin += Number(r.margin || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.volume - a.volume);
  }, [yiRows]);

  // Main data rows table
  const dtMainRows = React.useMemo(() => dtData?.rows ?? [], [dtData]);
  const dtMainSorted = dtRowSort.sort(dtMainRows);
  const dtRowPag = usePagination(dtMainSorted.length, 12);

  // Operator summary — always last 30 days, respects mccmnc/country/operator filters
  const dtOpRows30 = React.useMemo(() => (dtData?.operator_summary30 ?? []).map((r: any, i: number) => ({
    ...r,
    volume: Number(r.volume ?? 0),
    revenue: Number(r.revenue ?? 0),
    vendor_cost: Number(r.vendor_cost ?? 0),
    margin: Number(r.margin ?? 0),
    col: PAL[i % PAL.length],
  })), [dtData]);

  // Log-scale volume ticks so small operators stay visible next to the giants
  const DT_OP_VOL_TICKS = [100, 1_000, 10_000, 100_000, 300_000];

  // Estimates pagination
  const dtEstRows = estimates?.rows ?? [];
  const dtEstSort = useSortState('traffic_30d');
  const dtEstSorted = dtEstSort.sort(dtEstRows);
  const dtEstPag = usePagination(dtEstSorted.length, 12);

  const cTotals = cData ? {
    vol_old: Number(cData.totals_old?.volume ?? 0),
    vol_new: Number(cData.totals_new?.volume ?? 0),
    rev_old: Number(cData.totals_old?.revenue ?? 0),
    rev_new: Number(cData.totals_new?.revenue ?? 0),
    vc_old: Number(cData.totals_old?.vendor_cost ?? 0),
    vc_new: Number(cData.totals_new?.vendor_cost ?? 0),
    mar_old: Number(cData.totals_old?.margin ?? 0),
    mar_new: Number(cData.totals_new?.margin ?? 0),
  } : null;

  const cTrendPivot = React.useMemo(() => {
    const byDate: Record<string, any> = {};
    const countrySet: Set<string> = new Set();
    for (const r of cData?.trends ?? []) {
      if (!byDate[r.date]) byDate[r.date] = { date: r.date };
      byDate[r.date][r.country_name] = Number(r[cTrendMetric] ?? 0);
      countrySet.add(r.country_name);
    }
    return {
      data: Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date)),
      countries: Array.from(countrySet),
    };
  }, [cData, cTrendMetric]);

  const cOldLabel = cDateOld ? fDate(cDateOld) : (cData?.date_old ? fDate(cData.date_old) : '—');
  const cNewLabel = cDateNew ? fDate(cDateNew) : (cData?.date_new ? fDate(cData.date_new) : '—');

  const cmpRows = cData?.rows ?? [];

  const cRevShareOld = React.useMemo(() => {
    if (!cmpRows.length) return [];
    const sorted = [...cmpRows].sort((a: any, b: any) => Number(b.revenue_old) - Number(a.revenue_old));
    const total = sorted.reduce((s: number, r: any) => s + Number(r.revenue_old), 0);
    return sorted.slice(0, 10).map((r: any) => ({
      name: r.country_name,
      value: Number(r.revenue_old),
      pct: total > 0 ? (Number(r.revenue_old) / total * 100) : 0,
      fill: countryColor(r.country_name),
    }));
  }, [cmpRows]);

  const cRevShareNew = React.useMemo(() => {
    if (!cmpRows.length) return [];
    const sorted = [...cmpRows].sort((a: any, b: any) => Number(b.revenue_new) - Number(a.revenue_new));
    const total = sorted.reduce((s: number, r: any) => s + Number(r.revenue_new), 0);
    return sorted.slice(0, 10).map((r: any) => ({
      name: r.country_name,
      value: Number(r.revenue_new),
      pct: total > 0 ? (Number(r.revenue_new) / total * 100) : 0,
      fill: countryColor(r.country_name),
    }));
  }, [cmpRows]);
  const cmpSorted = cmpSort.sort(cmpRows);
  const cmpPag = usePagination(cmpSorted.length, 12);

  const yvdbRows = cData?.yesterday_vs_day_before ?? [];
  const yvdbSorted = yvdbSort.sort(yvdbRows);
  const yvdbPag = usePagination(yvdbSorted.length, 12);
  const yvdbTotals = React.useMemo(() => {
    if (!yvdbRows.length) return null;
    return yvdbRows.reduce((acc: any, r: any) => ({
      volume_td2: acc.volume_td2 + Number(r.volume_td2 || 0),
      volume_td1: acc.volume_td1 + Number(r.volume_td1 || 0),
      revenue_td2: acc.revenue_td2 + Number(r.revenue_td2 || 0),
      revenue_td1: acc.revenue_td1 + Number(r.revenue_td1 || 0),
      margin_td2: acc.margin_td2 + Number(r.margin_td2 || 0),
      margin_td1: acc.margin_td1 + Number(r.margin_td1 || 0),
    }), { volume_td2: 0, volume_td1: 0, revenue_td2: 0, revenue_td1: 0, margin_td2: 0, margin_td1: 0 });
  }, [yvdbRows]);

  const plRows = plData?.rows ?? [];
  const plSorted = plSort.sort(plRows);
  // Destination mode reads the same plData (the fetch switches endpoint by plMode) but sorts on
  // its own key set — default margin ASC so the worst destinations surface first.
  const plDestSorted = plDestSort.sort(plRows);
  const plTotals = React.useMemo(() => {
    if (!plRows.length) return null;
    // annual_fees / once_off must be summed too — the footer renders them, and without these
    // keys fR(undefined) printed an em-dash for both fee columns.
    return plRows.reduce((acc: any, r: any) => ({
      volume: acc.volume + Number(r.volume || 0),
      revenue: acc.revenue + Number(r.revenue || 0),
      vendor_cost: acc.vendor_cost + Number(r.vendor_cost || 0),
      monthly_misc_cost: acc.monthly_misc_cost + Number(r.monthly_misc_cost || 0),
      annual_fees: acc.annual_fees + Number(r.annual_fees || 0),
      once_off: acc.once_off + Number(r.once_off || 0),
      margin: acc.margin + Number(r.margin || 0),
    }), { volume: 0, revenue: 0, vendor_cost: 0, monthly_misc_cost: 0, annual_fees: 0, once_off: 0, margin: 0 });
  }, [plRows]);

  /* ── Date label for KPI cards ───────────────────────────────── */
  const dtRangeLabel = dtApiStart && dtApiEnd
    ? `${fDate(dtApiStart)} – ${fDate(dtApiEnd)}`
    : 'selected period';

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zr w-full" style={{ margin: '-24px', padding: '28px 28px 50px', minHeight: 'calc(100vh - 56px)' }}>

        {/* ── HEADER ────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 4 }}>
              Traffic Overview
            </div>
            <h1 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 27, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>
              {tab === 'yesterday-iristel' ? 'International MO Traffic' : 'Google MO Traffic Report'}
            </h1>
            {lastRefresh && <p style={{ color: 'var(--mu)', fontSize: 12, marginTop: 4 }}>Refreshed {new Date(lastRefresh).toLocaleString()}</p>}
          </div>
          {latestDate && (
            <div className="zdcard">
              <div className="dlbl">Data is up to</div>
              <div className="dval"><span className="zpulse" /><span>{fDate(latestDate)}</span></div>
            </div>
          )}
        </div>

        {/* ── TABS ──────────────────────────────────────────── */}
        <div className="ztabs">
          {TABS.map(t => (
            <button key={t.id} className={`ztab${tab === t.id ? ' za' : ''}`} onClick={() => setTab(t.id)}>{t.l}</button>
          ))}
        </div>

        {/* ════════════════ DATA TABLE ═════════════════════════ */}
        {tab === 'data-table' && (
          <>
            {/* ── Filter Panel ──────────────────────────────── */}
            <div className="zpnl" style={{ marginBottom: 16, padding: '16px 18px' }}>
              {/* Dropdown filters */}
              <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
                <div className="zff">
                  <label>MccMnc</label>
                  <select className="zsl" value={dtMccmnc} onChange={e => setDtMccmnc(e.target.value)}>
                    <option value="">All MccMnc</option>
                    {(filters.mccmncs ?? []).map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="zff">
                  <label>Country</label>
                  <select className="zsl" value={dtCountry} onChange={e => setDtCountry(e.target.value)}>
                    <option value="">All Countries</option>
                    {(filters.countries ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="zff">
                  <label>Operator</label>
                  <select className="zsl" value={dtOperator} onChange={e => setDtOperator(e.target.value)}>
                    <option value="">All Operators</option>
                    {(filters.operators ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ alignSelf: 'flex-end' }}>
                  <button className="zbt" onClick={() => {
                    setDtMccmnc(''); setDtCountry(''); setDtOperator('');
                    setDtMode('day');
                    const today = new Date();
                    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const fiveAgo = new Date(today); fiveAgo.setDate(today.getDate() - 4);
                    setDtDayStart(fmt(fiveAgo)); setDtDayEnd(fmt(today));
                    setDtRange('5');
                  }}>Reset</button>
                </div>
              </div>

              {/* Date mode tabs + inputs */}
              <div style={{ borderTop: '1px solid var(--ln)', paddingTop: 14 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
                  {(['day', 'month', 'range'] as const).map(m => (
                    <button key={m} onClick={() => setDtMode(m)} style={{
                      padding: '5px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: `1.5px solid ${dtMode === m ? 'var(--turquoise)' : 'var(--lns)'}`,
                      background: dtMode === m ? 'var(--turquoise)' : 'var(--sf2)',
                      color: dtMode === m ? '#fff' : 'var(--mu)',
                      transition: '.12s',
                    }}>
                      {m === 'day' ? 'Day' : m === 'month' ? 'Month' : 'Range'}
                    </button>
                  ))}
                </div>

                {dtMode === 'day' && (
                  <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
                    <div className="zff">
                      <label>Date 1</label>
                      <input type="date" className="zdi" value={dtDayStart} onChange={e => setDtDayStart(e.target.value)} />
                    </div>
                    <div className="zff">
                      <label>Date 2</label>
                      <input type="date" className="zdi" value={dtDayEnd} onChange={e => setDtDayEnd(e.target.value)} />
                    </div>
                  </div>
                )}

                {dtMode === 'month' && (
                  <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
                    <div className="zff">
                      <label>Month 1</label>
                      <input type="month" className="zdi" value={dtMonthStart} onChange={e => setDtMonthStart(e.target.value)} />
                    </div>
                    <div className="zff">
                      <label>Month 2</label>
                      <input type="month" className="zdi" value={dtMonthEnd} onChange={e => setDtMonthEnd(e.target.value)} />
                    </div>
                  </div>
                )}

                {dtMode === 'range' && (
                  <div style={{ display: 'flex', gap: 13, flexWrap: 'wrap' }}>
                    <div className="zff">
                      <label>Quick Range</label>
                      <select className="zsl" value={dtRange} onChange={e => setDtRange(e.target.value)}>
                        <option value="5">Last 5 days</option>
                        <option value="7">Last 7 days</option>
                        <option value="14">Last 14 days</option>
                        <option value="30">Last 30 days</option>
                        <option value="60">Last 60 days</option>
                        <option value="90">Last 90 days</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── KPI Cards ─────────────────────────────────── */}
            {dtData?.totals && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
                <Kpi color="km1" label="Volume" icon={IC_VOL} value={fN(dtData.totals.volume)} sub={dtRangeLabel} />
                <Kpi color="km2" label="Revenue" icon={IC_REV} value={fM(dtData.totals.revenue)} sub={dtRangeLabel} />
                <Kpi color="km3" label="Vendor Cost" icon={IC_COST} value={fM(dtData.totals.vendor_cost)} sub="supplier cost" />
                <Kpi color="km4" label="Margin" icon={IC_TREND} value={fM(dtData.totals.margin)} sub="net contribution" />
              </div>
            )}

            {dtLoad ? <Skel /> : (
              <>
                {/* ── 1. Traffic Data Table ─────────────────── */}
                <div className="zpnl" style={{ marginBottom: 16 }}>
                  <PH
                    title="Traffic Data"
                    right={dtMainSorted.length ? `${dtMainSorted.length} rows · ${dtRangeLabel}` : dtRangeLabel}
                  />
                  {!dtMainSorted.length ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>
                      No data for the selected period — trigger a refresh or adjust the date range.
                    </div>
                  ) : (
                    <>
                      <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
                        <table className="zt">
                          <thead><tr>
                            {dtRowSort.th('date', 'Date')}
                            {dtRowSort.th('country_name', 'Country')}
                            {dtRowSort.th('operator_name', 'Operator')}
                            {dtRowSort.th('customer_name', 'Customer')}
                            {dtRowSort.th('vendor_name', 'Vendor')}
                            {dtRowSort.th('volume', 'Volume')}
                            {dtRowSort.th('revenue', 'Revenue')}
                            {dtRowSort.th('vendor_cost', 'Vendor Cost')}
                            {dtRowSort.th('margin', 'Margin')}
                          </tr></thead>
                          <tbody>
                            {dtMainSorted.slice(dtRowPag.start, dtRowPag.end).map((r: any, i: number) => (
                              <tr key={i}>
                                <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--inks)', fontWeight: 500 }}>{fDate(r.date)}</td>
                                <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 600, color: 'var(--ink)' }}><CountryDot name={r.country_name} /></td>
                                <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--inks)', fontWeight: 500 }}>{r.operator_name}</td>
                                <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--inks)', fontWeight: 500 }}>{r.customer_name}</td>
                                <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", color: 'var(--inks)', fontWeight: 500 }}>{r.vendor_name}</td>
                                <td>{fV(r.volume)}</td>
                                <td>{fR(r.revenue)}</td>
                                <td>{fR(r.vendor_cost)}</td>
                                <td className={Number(r.margin) < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {dtData?.totals && (
                            <tfoot><tr>
                              <td colSpan={5}>Total</td>
                              <td>{fN(dtData.totals.volume)}</td>
                              <td>{fR(dtData.totals.revenue)}</td>
                              <td>{fR(dtData.totals.vendor_cost)}</td>
                              <td className={Number(dtData.totals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(dtData.totals.margin)}</td>
                            </tr></tfoot>
                          )}
                        </table>
                      </div>
                      <Paginator page={dtRowPag.page} totalPages={dtRowPag.totalPages} setPage={dtRowPag.setPage} total={dtMainSorted.length} pageSize={12} />
                    </>
                  )}
                </div>

                {/* ── 2. Trend Chart — always last 30 days ──── */}
                {dtData?.trends30?.length > 0 && (
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 12px', borderBottom: '1px solid var(--ln)' }}>
                      <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                        Trend — Last 30 Days
                      </h2>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(Object.keys(MCFG) as Metric[]).map(m => {
                          const active = dtMetrics.has(m);
                          return (
                            <button key={m} onClick={() => toggleMetric(m)} style={{
                              padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: '.12s', letterSpacing: '.02em',
                              border: `1.5px solid ${active ? MCFG[m].color : 'var(--lns)'}`,
                              background: active ? MCFG[m].color : 'var(--sf2)',
                              color: active ? '#fff' : 'var(--mu)',
                              boxShadow: active ? `0 2px 0 rgba(0,0,0,.2)` : 'none',
                            }}>
                              {MCFG[m].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ height: 260, padding: '12px 12px 8px' }}>
                      {(() => {
                        const parsed = dtData.trends30.map((d: any) => ({
                          ...d,
                          volume: Number(d.volume ?? 0),
                          revenue: Number(d.revenue ?? 0),
                          vendor_cost: Number(d.vendor_cost ?? 0),
                          margin: Number(d.margin ?? 0),
                        }));
                        const showLeft = dtMetrics.has('volume');
                        const showRight = dtMetrics.has('revenue') || dtMetrics.has('vendor_cost') || dtMetrics.has('margin');
                        const multi = dtMetrics.size > 1;
                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={parsed} margin={{ top: 8, right: showRight ? 70 : 16, bottom: 0, left: 0 }}>
                              <defs>
                                {(Object.keys(MCFG) as Metric[]).map(m => (
                                  <linearGradient key={m} id={`gmlg_${m}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={MCFG[m].color} stopOpacity={multi ? 0.22 : 0.45} />
                                    <stop offset="100%" stopColor={MCFG[m].color} stopOpacity={0.02} />
                                  </linearGradient>
                                ))}
                              </defs>
                              <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                              <XAxis dataKey="date" {...AX} tickFormatter={(v: string) => v.slice(5)} />
                              <YAxis yAxisId="left" orientation="left"  {...AX} width={showLeft ? 60 : 0} hide={!showLeft} domain={[0, (d: number) => d * 1.15]} tickFormatter={v => fV(v)} />
                              <YAxis yAxisId="right" orientation="right" {...AX} width={showRight ? 70 : 0} hide={!showRight} domain={[0, (d: number) => d * 1.15]} tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}K`} />
                              <Tooltip {...TIP}
                                formatter={(v: any, name: string) => { const m = name as Metric; return [MCFG[m]?.fmt(v) ?? v, MCFG[m]?.label ?? name]; }}
                                labelFormatter={(v: string) => `Date: ${v}`} />
                              {(Object.keys(MCFG) as Metric[]).filter(m => dtMetrics.has(m)).map(m => (
                                <Area key={m} yAxisId={MCFG[m].yAxis} type="monotone" dataKey={m} name={m} connectNulls
                                  stroke={MCFG[m].color} strokeWidth={2.5} fill={`url(#gmlg_${m})`} dot={false}
                                  activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: MCFG[m].color }} />
                              ))}
                            </AreaChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* ── 3. Operator Numbers — last 30 days ────── */}
                {dtOpRows30.length > 0 && (
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 12px', borderBottom: '1px solid var(--ln)', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                          Operator Numbers
                        </h2>
                        <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 600 }}>Last 30 Days · Top {dtOpRows30.length} by volume</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(Object.keys(MCFG) as Metric[]).map(m => {
                          const active = dtOpMetrics.has(m);
                          return (
                            <button key={m} onClick={() => toggleOpMetric(m)} style={{
                              padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: '.12s', letterSpacing: '.02em',
                              border: `1.5px solid ${active ? MCFG[m].color : 'var(--lns)'}`,
                              background: active ? MCFG[m].color : 'var(--sf2)',
                              color: active ? '#fff' : 'var(--mu)',
                              boxShadow: active ? `0 2px 0 rgba(0,0,0,.18)` : 'none',
                            }}>
                              {MCFG[m].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ height: 380, padding: '16px 8px 8px 4px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dtOpRows30}
                          margin={{ top: 4, right: 64, bottom: 80, left: 10 }}
                          barCategoryGap="28%"
                          barGap={3}
                        >
                          <defs>
                            {(Object.keys(MCFG) as Metric[]).map(m => (
                              <linearGradient key={m} id={`barlg_${m}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={MCFG[m].color} stopOpacity={1} />
                                <stop offset="100%" stopColor={MCFG[m].color} stopOpacity={0.72} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 5" stroke="var(--ln)" vertical={false} />
                          <XAxis
                            dataKey="operator_name"
                            tick={{ fontSize: 10, fill: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif" }}
                            axisLine={{ stroke: 'var(--lns)' }}
                            tickLine={false}
                            angle={-40}
                            textAnchor="end"
                            interval={0}
                            height={80}
                          />
                          <YAxis
                            yAxisId="left"
                            scale="log"
                            allowDataOverflow
                            tick={{ fontSize: 10, fill: 'var(--mu)', fontFamily: "'Hanken Grotesk',sans-serif" }}
                            axisLine={false}
                            tickLine={false}
                            width={72}
                            ticks={DT_OP_VOL_TICKS}
                            domain={[100, (dataMax: number) => Math.max(dataMax * 1.05, 300_000)]}
                            tickFormatter={(v: number) => fN(v)}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 10, fill: 'var(--mu)', fontFamily: "'Hanken Grotesk',sans-serif" }}
                            axisLine={false}
                            tickLine={false}
                            width={64}
                            tickFormatter={(v: number) => fR(v)}
                          />
                          <Tooltip
                            contentStyle={{ background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 10, fontSize: 12, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}
                            labelStyle={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}
                            itemStyle={{ color: 'var(--inks)', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}
                            formatter={(v: any, name: string) => {
                              const key = Object.keys(MCFG).find(k => MCFG[k as Metric].label === name) as Metric | undefined;
                              return [key === 'volume' ? fN(v) : key ? MCFG[key].fmt(v) : fN(v), name];
                            }}
                            cursor={{ fill: 'var(--sf2)', radius: 4 }}
                          />
                          <Legend
                            iconType="circle"
                            iconSize={8}
                            verticalAlign="top"
                            align="right"
                            wrapperStyle={{ fontSize: 11.5, fontFamily: "'Hanken Grotesk',sans-serif", paddingBottom: 8, color: 'var(--inks)' }}
                          />
                          {(Object.keys(MCFG) as Metric[]).filter(m => dtOpMetrics.has(m)).map(m => (
                            <Bar
                              key={m}
                              yAxisId={MCFG[m].yAxis}
                              dataKey={m}
                              name={MCFG[m].label}
                              fill={`url(#barlg_${m})`}
                              radius={[5, 5, 0, 0]}
                              maxBarSize={40}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* ── 5. Traffic Estimation Table ───────────── */}
                {dtEstRows.length > 0 && (
                  <div className="zpnl">
                    <PH title="Traffic Estimation Data" right={dtEstRows.length > 12 ? `${dtEstRows.length} countries` : undefined} />
                    <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
                      <table className="zt">
                        <thead><tr>
                          {dtEstSort.th('country', 'Country')}
                          {dtEstSort.th('traffic_30d', 'Last 30 Days')}
                          {dtEstSort.th('estimation', 'Traffic Estimates')}
                          {dtEstSort.th('pct_received', '% of Traffic Received')}
                        </tr></thead>
                        <tbody>
                          {dtEstSorted.slice(dtEstPag.start, dtEstPag.end).map((r: any, i: number) => (
                            <tr key={i}>
                              <td><CountryDot name={r.country} /></td>
                              <td>{fN(r.traffic_30d)}</td>
                              <td>{fN(r.estimation)}</td>
                              <td>{fP(r.pct_received)}</td>
                            </tr>
                          ))}
                        </tbody>
                        {estimates?.totals && (
                          <tfoot><tr>
                            <td>Total</td>
                            <td>{fN(estimates.totals.traffic_30d)}</td>
                            <td>{fN(estimates.totals.estimation)}</td>
                            <td>{fP(estimates.totals.pct_received)}</td>
                          </tr></tfoot>
                        )}
                      </table>
                    </div>
                    <Paginator page={dtEstPag.page} totalPages={dtEstPag.totalPages} setPage={dtEstPag.setPage} total={dtEstSorted.length} pageSize={12} />
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ════════════════ COMPARISON ═════════════════════════ */}
        {tab === 'comparison' && (
          <>
            {/* Filter panel */}
            <div className="zpnl zfilt" style={{ marginBottom: 16 }}>
              <div className="zff">
                <label>Date 1</label>
                <input type="date" className="zdi" value={cDateOld} min="2025-12-23"
                  onChange={e => setCDateOld(e.target.value)} />
              </div>
              <div className="zff">
                <label>Date 2</label>
                <input type="date" className="zdi" value={cDateNew} min="2025-12-23"
                  onChange={e => setCDateNew(e.target.value)} />
              </div>
              <div className="zff">
                <label>Country Name</label>
                <select className="zsl" value={cCountry} onChange={e => setCCountry(e.target.value)}>
                  <option value="">All Countries</option>
                  {(filters.countries ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Operator Name</label>
                <select className="zsl" value={cOperator} onChange={e => setCOperator(e.target.value)}>
                  <option value="">All Operators</option>
                  {(filters.operators ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            {cLoad ? <Skel /> : (
              <>
                {/* KPI Cards */}
                {cTotals && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    {/* Date 1 — Older */}
                    <div style={{ borderRadius: 12, background: 'linear-gradient(135deg, #4a6a8a 0%, #5a7fa0 100%)', padding: '20px 24px', color: '#fff' }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, fontFamily: "'Montserrat',sans-serif" }}>{cOldLabel}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px' }}>
                        {[
                          { label: 'MESSAGES', val: fN(cTotals.vol_old) },
                          { label: 'VENDOR COST', val: fR(cTotals.vc_old) },
                          { label: 'REVENUE', val: fR(cTotals.rev_old) },
                          { label: 'MARGIN', val: fR(cTotals.mar_old) },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', opacity: 0.72, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: "'Montserrat',sans-serif" }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Date 2 — Newer */}
                    <div style={{ borderRadius: 12, background: 'linear-gradient(135deg, #1f6fac 0%, #2e86c1 100%)', padding: '20px 24px', color: '#fff' }}>
                      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, fontFamily: "'Montserrat',sans-serif" }}>{cNewLabel}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 28px' }}>
                        {[
                          { label: 'MESSAGES', val: fN(cTotals.vol_new) },
                          { label: 'VENDOR COST', val: fR(cTotals.vc_new) },
                          { label: 'REVENUE', val: fR(cTotals.rev_new) },
                          { label: 'MARGIN', val: fR(cTotals.mar_new) },
                        ].map(({ label, val }) => (
                          <div key={label}>
                            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', opacity: 0.72, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: "'Montserrat',sans-serif" }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Revenue Share Donut Charts */}
                {(cRevShareOld.length > 0 || cRevShareNew.length > 0) && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    {([
                      { label: cOldLabel, data: cRevShareOld },
                      { label: cNewLabel, data: cRevShareNew },
                    ] as { label: string; data: typeof cRevShareOld }[]).map(({ label, data }, i) => (
                      <div key={i} className="zpnl">
                        <PH title="Revenue Share — Top 10" right={label} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px 16px' }}>
                          <div style={{ flex: '0 0 160px', height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={data} dataKey="value" innerRadius={48} outerRadius={76} paddingAngle={2} startAngle={90} endAngle={-270} stroke="none">
                                  {data.map((e, i) => <Cell key={i} fill={e.fill} />)}
                                </Pie>
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {data.map((r, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.fill, flexShrink: 0, display: 'inline-block' }} />
                                  <span style={{ fontSize: 11.5, color: 'var(--inks)', fontFamily: "'Hanken Grotesk',sans-serif" }}>{r.name}</span>
                                </div>
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink)', fontFamily: "'Hanken Grotesk',sans-serif", marginLeft: 8 }}>{r.pct.toFixed(1)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Table 1: Google MO Traffic Comparison */}
                <div className="zpnl" style={{ marginBottom: 16 }}>
                  <PH title="Google MO Traffic Comparison"
                    right={`D1: ${cNewLabel}  ·  D2: ${cOldLabel}`} />
                  {!cmpSorted.length ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>Select dates above to compare.</div>
                  ) : (
                    <>
                      <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
                        <table className="zt">
                          <thead><tr>
                            {cmpSort.th('country_name', 'Country Name')}
                            {cmpSort.th('volume_old', 'Volume Old')}
                            {cmpSort.th('volume_new', 'Volume New')}
                            {cmpSort.th('volume_diff_pct', 'Volume Diff %')}
                            {cmpSort.th('revenue_old', 'Revenue Old')}
                            {cmpSort.th('revenue_new', 'Revenue New')}
                            {cmpSort.th('revenue_diff_pct', 'Revenue Diff %')}
                            {cmpSort.th('margin_old', 'Margin Old')}
                            {cmpSort.th('margin_new', 'Margin New')}
                            {cmpSort.th('margin_diff_pct', 'Margin Diff %')}
                          </tr></thead>
                          <tbody>
                            {cmpSorted.slice(cmpPag.start, cmpPag.end).map((r: any, i: number) => (
                              <tr key={i}>
                                <td><CountryDot name={r.country_name} /></td>
                                <td>{fN(r.volume_old)}</td>
                                <td>{fN(r.volume_new)}</td>
                                <td><DiffCmp o={r.volume_old} n={r.volume_new} /></td>
                                <td>{fR(r.revenue_old)}</td>
                                <td>{fR(r.revenue_new)}</td>
                                <td><DiffCmp o={r.revenue_old} n={r.revenue_new} /></td>
                                <td className={Number(r.margin_old ?? 0) < 0 ? 'zneg' : ''}>{fR(r.margin_old)}</td>
                                <td className={Number(r.margin_new ?? 0) < 0 ? 'zneg' : ''}>{fR(r.margin_new)}</td>
                                <td><DiffCmp o={r.margin_old} n={r.margin_new} /></td>
                              </tr>
                            ))}
                          </tbody>
                          {cTotals && (
                            <tfoot><tr>
                              <td>Total</td>
                              <td>{fN(cTotals.vol_old)}</td><td>{fN(cTotals.vol_new)}</td>
                              <td><DiffCmp o={cTotals.vol_old} n={cTotals.vol_new} /></td>
                              <td>{fR(cTotals.rev_old)}</td><td>{fR(cTotals.rev_new)}</td>
                              <td><DiffCmp o={cTotals.rev_old} n={cTotals.rev_new} /></td>
                              <td>{fR(cTotals.mar_old)}</td><td>{fR(cTotals.mar_new)}</td>
                              <td><DiffCmp o={cTotals.mar_old} n={cTotals.mar_new} /></td>
                            </tr></tfoot>
                          )}
                        </table>
                      </div>
                      <Paginator page={cmpPag.page} totalPages={cmpPag.totalPages} setPage={cmpPag.setPage} total={cmpSorted.length} pageSize={12} />
                    </>
                  )}
                </div>

                {/* Trend chart: Last 7 Days Trends */}
                {cTrendPivot.data.length > 0 && (
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 12px', borderBottom: '1px solid var(--ln)', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                          Last 7 Days Trends
                        </h2>
                        <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 600 }}>{MCFG[cTrendMetric].label} by Country (incl. today)</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(Object.keys(MCFG) as Metric[]).map(m => {
                          const active = cTrendMetric === m;
                          return (
                            <button key={m} onClick={() => setCTrendMetric(m)} style={{
                              padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: '.12s', letterSpacing: '.02em',
                              border: `1.5px solid ${active ? MCFG[m].color : 'var(--lns)'}`,
                              background: active ? MCFG[m].color : 'var(--sf2)',
                              color: active ? '#fff' : 'var(--mu)',
                              boxShadow: active ? `0 2px 0 rgba(0,0,0,.18)` : 'none',
                            }}>
                              {MCFG[m].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ height: 280, padding: '12px 12px 8px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={cTrendPivot.data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="2 4" stroke="var(--ln)" vertical={false} />
                          <XAxis dataKey="date" {...AX} tickFormatter={(v: string) => v.slice(5)} />
                          <YAxis {...AX} width={70} tickFormatter={(v: number) => cTrendMetric === 'volume' ? fV(v) : `$${(v / 1000).toFixed(1)}K`} />
                          <Tooltip {...TIP} formatter={(v: any, name: string) => [MCFG[cTrendMetric].fmt(v), name]} labelFormatter={(v: string) => `Date: ${v}`} />
                          <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                          {cTrendPivot.countries.map((c) => (
                            <Line key={c} type="monotone" dataKey={c} stroke={countryColor(c)} dot={false} strokeWidth={2} connectNulls />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

              </>
            )}
          </>
        )}

        {/* ════════════════ PROFIT AND LOSS ════════════════════ */}
        {tab === 'profit-loss' && (
          <>
            <div className="zpnl zfilt" style={{ marginBottom: 16 }}>
              <div className="zff">
                <label>MccMnc</label>
                <select className="zsl" value={plMccmnc} onChange={e => setPlMccmnc(e.target.value)}>
                  <option value="">All MccMnc</option>
                  {(filters.mccmncs ?? []).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Country Name</label>
                <select className="zsl" value={plCountry} onChange={e => setPlCountry(e.target.value)}>
                  <option value="">All Countries</option>
                  {(filters.countries ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Operator Name</label>
                <select className="zsl" value={plOperator} onChange={e => setPlOperator(e.target.value)}>
                  <option value="">All Operators</option>
                  {(filters.operators ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Year</label>
                <select className="zsl" value={plYear} onChange={e => setPlYear(e.target.value)}>
                  <option value="">All Years</option>
                  {plAvailableYears.map((y: number) => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Month</label>
                <select className="zsl" value={plMonth} onChange={e => setPlMonth(e.target.value)}>
                  <option value="">All Months</option>
                  {plAvailableMonths.map((m: number) => <option key={m} value={String(m)}>{MNF[m - 1]}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>View</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className={`ztg${plMode === 'month' ? ' za' : ''}`} onClick={() => setPlMode('month')}>Monthly</button>
                  <button className={`ztg${plMode === 'destination' ? ' za' : ''}`} onClick={() => setPlMode('destination')}>By Destination</button>
                </div>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="zbt" onClick={() => { setPlMccmnc(''); setPlCountry(''); setPlOperator(''); setPlYear(''); setPlMonth(''); }}>Reset</button>
              </div>
            </div>

            {plLoad ? <Skel /> : (
              <div className="zpnl">
                <PH title="Google MO Traffic Data" right={plSorted.length ? `${plSorted.length} rows` : undefined} />
                {!plSorted.length ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data for the selected period.<br />Trigger a refresh first, then add cost entries for the P&amp;L margin.</div>
                ) : (
                  <>
                    {/* All rows in one scrollable body (no pagination); header stays sticky. */}
                    <div className="tbl-scroll" style={{ overflow: 'auto', maxHeight: 560 }}>
                      {plMode === 'destination' ? (
                        <table className="zt">
                          <thead><tr>
                            {plDestSort.th('country_name', 'Country Name')}
                            {plDestSort.th('operator_name', 'Operator')}
                            {plDestSort.th('mccmnc', 'MccMnc')}
                            {plDestSort.th('revenue', 'Revenue')}
                            {plDestSort.th('vendor_cost', 'Vendor Cost')}
                            {plDestSort.th('volume', 'Volume')}
                            {plDestSort.th('monthly_misc_cost', 'Monthly & Miscellaneous Cost')}
                            {plDestSort.th('annual_fees', 'Annual Fees')}
                            {plDestSort.th('once_off', 'Once Off Fees')}
                            {plDestSort.th('margin', 'Margin')}
                          </tr></thead>
                          <tbody>
                            {plDestSorted.map((r: any, i: number) => (
                              <tr key={i}>
                                <td><CountryDot name={r.country_name} /></td>
                                {/* cost_only = a country-wide fee row with no destination of its own */}
                                <td>{r.cost_only
                                  ? <span style={{ color: 'var(--mu)', fontStyle: 'italic' }}>country-wide fees</span>
                                  : (r.operator_name || <span style={{ color: 'var(--mu)' }}>—</span>)}</td>
                                <td>{r.mccmnc || <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                                <td>{fR(r.revenue)}</td>
                                <td>{fR(r.vendor_cost)}</td>
                                <td>{fN(r.volume)}</td>
                                <td>{Number(r.monthly_misc_cost) > 0 ? fR(r.monthly_misc_cost) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                                <td>{Number(r.annual_fees) > 0 ? fR(r.annual_fees) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                                <td>{Number(r.once_off) > 0 ? fR(r.once_off) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                                <td className={Number(r.margin) < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {plTotals && (
                            <tfoot><tr>
                              <td colSpan={3}>Total</td>
                              <td>{fR(plTotals.revenue)}</td>
                              <td>{fR(plTotals.vendor_cost)}</td>
                              <td>{fN(plTotals.volume)}</td>
                              <td>{fR(plTotals.monthly_misc_cost)}</td>
                              <td>{fR(plTotals.annual_fees)}</td>
                              <td>{fR(plTotals.once_off)}</td>
                              <td className={Number(plTotals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(plTotals.margin)}</td>
                            </tr></tfoot>
                          )}
                        </table>
                      ) : (
                      <table className="zt">
                        <thead><tr>
                          {plSort.th('month_name', 'Month Name')}
                          {plSort.th('country_name', 'Country Name')}
                          {plSort.th('revenue', 'Revenue')}
                          {plSort.th('vendor_cost', 'Vendor Cost')}
                          {plSort.th('volume', 'Volume')}
                          {plSort.th('monthly_misc_cost', 'Monthly & Miscellaneous Cost')}
                          {plSort.th('annual_fees', 'Annual Fees')}
                          {plSort.th('once_off', 'Once Off Fees')}
                          {plSort.th('margin', 'Margin')}
                        </tr></thead>
                        <tbody>
                          {plSorted.map((r: any, i: number) => (
                            <tr key={i}>
                              <td>{r.month_name?.trim()}</td>
                              <td><CountryDot name={r.country_name} /></td>
                              <td>{fR(r.revenue)}</td>
                              <td>{fR(r.vendor_cost)}</td>
                              <td>{fN(r.volume)}</td>
                              <td>{Number(r.monthly_misc_cost) > 0 ? fR(r.monthly_misc_cost) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                              <td>{Number(r.annual_fees) > 0 ? fR(r.annual_fees) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                              <td>{Number(r.once_off) > 0 ? fR(r.once_off) : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                              <td className={Number(r.margin) < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                            </tr>
                          ))}
                        </tbody>
                        {plTotals && (
                          <tfoot><tr>
                            <td colSpan={2}>Total</td>
                            <td>{fR(plTotals.revenue)}</td>
                            <td>{fR(plTotals.vendor_cost)}</td>
                            <td>{fN(plTotals.volume)}</td>
                            <td>{fR(plTotals.monthly_misc_cost)}</td>
                            <td>{fR(plTotals.annual_fees)}</td>
                            <td>{fR(plTotals.once_off)}</td>
                            <td className={Number(plTotals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(plTotals.margin)}</td>
                          </tr></tfoot>
                        )}
                      </table>
                      )}
                    </div>
                    <div style={{ padding: '10px 18px', fontSize: 12, color: 'var(--mu)', textAlign: 'right' }}>
                      {plSorted.length.toLocaleString()} rows
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ════════════════ YESTERDAY DATA ═════════════════════ */}
        {tab === 'yesterday' && (
          <>
            <div className="zpnl zfilt" style={{ marginBottom: 16 }}>
              <div className="zff">
                <label>MccMnc</label>
                <select className="zsl" value={yMccmnc} onChange={e => setYMccmnc(e.target.value)}>
                  <option value="">All MccMnc</option>
                  {(filters.mccmncs ?? []).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Country Name</label>
                <select className="zsl" value={yCountry} onChange={e => setYCountry(e.target.value)}>
                  <option value="">All Countries</option>
                  {(filters.countries ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Operator Name</label>
                <select className="zsl" value={yOperator} onChange={e => setYOperator(e.target.value)}>
                  <option value="">All Operators</option>
                  {(filters.operators ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="zbt" onClick={() => { setYMccmnc(''); setYCountry(''); setYOperator(''); }}>Reset</button>
              </div>
            </div>

            {yLoad ? <Skel /> : (
              <>
                <div className="zpnl" style={{ marginBottom: 16 }}>
                  <PH title="Google MO Traffic Yesterday Data" right={ySorted.length ? `${ySorted.length} rows` : undefined} />
                  {!ySorted.length ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data available for the selected period.</div>
                  ) : (
                    <>
                      <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
                        <table className="zt">
                          <thead><tr>
                            {ySort.th('date', 'Date')}
                            {ySort.th('country_name', 'Country Name')}
                            {ySort.th('operator_name', 'Operator Name')}
                            {ySort.th('vendor_name', 'Vendor Name')}
                            {ySort.th('volume', 'Volume')}
                            {ySort.th('revenue', 'Revenue')}
                            {ySort.th('vendor_cost', 'Vendor Cost')}
                            {ySort.th('margin', 'Margin')}
                          </tr></thead>
                          <tbody>
                            {ySorted.slice(yPag.start, yPag.end).map((r: any, i: number) => (
                              <tr key={i}>
                                <td>{fDate(r.date)}</td>
                                <td style={{ textAlign: 'left' }}><CountryDot name={r.country_name} /></td>
                                <td style={{ textAlign: 'left' }}>{r.operator_name}</td>
                                <td style={{ textAlign: 'left' }}>{r.vendor_name}</td>
                                <td style={{ textAlign: 'right' }}>{fN(r.volume)}</td>
                                <td style={{ textAlign: 'right' }}>{fR(r.revenue)}</td>
                                <td style={{ textAlign: 'right' }}>{fR(r.vendor_cost)}</td>
                                <td style={{ textAlign: 'right' }} className={Number(r.margin) < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {yTotals && (
                            <tfoot><tr>
                              <td colSpan={4}>Total</td>
                              <td style={{ textAlign: 'right' }}>{fN(yTotals.volume)}</td>
                              <td style={{ textAlign: 'right' }}>{fR(yTotals.revenue)}</td>
                              <td style={{ textAlign: 'right' }}>{fR(yTotals.vendor_cost)}</td>
                              <td style={{ textAlign: 'right' }} className={Number(yTotals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(yTotals.margin)}</td>
                            </tr></tfoot>
                          )}
                        </table>
                      </div>
                      <Paginator page={yPag.page} totalPages={yPag.totalPages} setPage={yPag.setPage} total={ySorted.length} pageSize={12} />
                    </>
                  )}
                </div>

                {yChartData.length > 0 && (
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 12px', borderBottom: '1px solid var(--ln)', flexWrap: 'wrap', gap: 8 }}>
                      <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                        Yesterday — Volume by Country
                      </h2>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(Object.keys(MCFG) as Metric[]).map(m => {
                          const active = yMetrics.has(m);
                          return (
                            <button key={m} onClick={() => toggleYMetric(m)} style={{
                              padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: '.12s', letterSpacing: '.02em',
                              border: `1.5px solid ${active ? MCFG[m].color : 'var(--lns)'}`,
                              background: active ? MCFG[m].color : 'var(--sf2)',
                              color: active ? '#fff' : 'var(--mu)',
                              boxShadow: active ? `0 2px 0 rgba(0,0,0,.18)` : 'none',
                            }}>
                              {MCFG[m].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ height: 340, padding: '16px 8px 8px 4px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={yChartData.slice(0, 12).map((d: any) => ({ ...d, margin: Math.max(0, d.margin) }))} margin={{ top: 4, right: 64, bottom: 80, left: 10 }} barCategoryGap="28%" barGap={3}>
                          <CartesianGrid strokeDasharray="3 5" stroke="var(--ln)" vertical={false} />
                          <XAxis dataKey="country_name" tick={{ fontSize: 10, fill: 'var(--inks)' }} axisLine={{ stroke: 'var(--lns)' }} tickLine={false} angle={-40} textAnchor="end" interval={0} height={80} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--mu)' }} axisLine={false} tickLine={false} width={yMetrics.has('volume') ? 72 : 0} hide={!yMetrics.has('volume')} ticks={yVolTicks} domain={[0, yVolTicks[yVolTicks.length - 1]]} allowDataOverflow tickFormatter={(v: number) => fN(v)} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--mu)' }} axisLine={false} tickLine={false} width={(yMetrics.has('revenue') || yMetrics.has('vendor_cost') || yMetrics.has('margin')) ? 64 : 0} hide={!(yMetrics.has('revenue') || yMetrics.has('vendor_cost') || yMetrics.has('margin'))} tickFormatter={(v: number) => fR(v)} domain={[0, (dataMax: number) => Math.max(650, Math.ceil(dataMax * 1.05))]} />
                          <Tooltip
                            contentStyle={{ background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 10, fontSize: 12, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}
                            labelStyle={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}
                            itemStyle={{ color: 'var(--inks)', fontSize: 12 }}
                            formatter={(v: any, name: string) => name === 'Volume' ? [fN(v), name] : [fR(v), name]}
                            cursor={{ fill: 'var(--sf2)', radius: 4 }}
                          />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4, color: 'var(--inks)' }} />
                          {(Object.keys(MCFG) as Metric[]).filter(m => yMetrics.has(m)).map(m => (
                            <Bar key={m} yAxisId={MCFG[m].yAxis} dataKey={m} name={MCFG[m].label} fill={MCFG[m].color} radius={[5, 5, 0, 0]} maxBarSize={40} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ════════════════ YESTERDAY IRISTEL ══════════════════ */}
        {tab === 'yesterday-iristel' && (
          <>
            <div className="zpnl zfilt" style={{ marginBottom: 16 }}>
              <div className="zff">
                <label>MccMnc</label>
                <select className="zsl" value={yiMccmnc} onChange={e => setYiMccmnc(e.target.value)}>
                  <option value="">All MccMnc</option>
                  {(yiFilters?.mccmncs ?? []).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="zff">
                <label>Country Name</label>
                <select className="zsl" value={yiCountry} onChange={e => setYiCountry(e.target.value)}>
                  <option value="">All Countries</option>
                  {(yiFilters?.countries ?? []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="zff" style={{ flex: '0 1 380px', minWidth: 260 }}>
                <label>Operator Name</label>
                <select className="zsl" value={yiOperator} onChange={e => setYiOperator(e.target.value)}>
                  <option value="">All Operators</option>
                  {(yiFilters?.operators ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button className="zbt" onClick={() => { setYiMccmnc(''); setYiCountry(''); setYiOperator(''); }}>Reset</button>
              </div>
            </div>

            {yiLoad ? <Skel /> : (
              <>
                <div className="zpnl" style={{ marginBottom: 16 }}>
                  <PH title="Google MO Traffic Yesterday Data (Iristel)" right={yiSorted.length ? `${yiSorted.length} rows` : undefined} />
                  {!yiSorted.length ? (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--mu)', fontSize: 14 }}>No data available for the selected period.</div>
                  ) : (
                    <>
                      <div className="tbl-scroll" style={{ overflowX: 'auto' }}>
                        <table className="zt">
                          <thead><tr>
                            {yiSort.th('date', 'Date')}
                            {yiSort.th('country_name', 'Country Name')}
                            {yiSort.th('operator_name', 'Operator Name')}
                            {yiSort.th('vendor_name', 'Vendor Name')}
                            {yiSort.th('volume', 'Volume')}
                            {yiSort.th('revenue', 'Revenue')}
                            {yiSort.th('vendor_cost', 'Vendor Cost')}
                            {yiSort.th('margin', 'Margin')}
                          </tr></thead>
                          <tbody>
                            {yiSorted.slice(yiPag.start, yiPag.end).map((r: any, i: number) => (
                              <tr key={i}>
                                <td>{fDate(r.date)}</td>
                                <td style={{ textAlign: 'left' }}><CountryDot name={r.country_name} /></td>
                                <td style={{ textAlign: 'left' }}>{r.operator_name}</td>
                                <td style={{ textAlign: 'left' }}>{r.vendor_name}</td>
                                <td style={{ textAlign: 'right' }}>{fN(r.volume)}</td>
                                <td style={{ textAlign: 'right' }}>{fR(r.revenue)}</td>
                                <td style={{ textAlign: 'right' }}>{fR(r.vendor_cost)}</td>
                                <td style={{ textAlign: 'right' }} className={Number(r.margin) < 0 ? 'zneg' : 'zpos'}>{fR(r.margin)}</td>
                              </tr>
                            ))}
                          </tbody>
                          {yiTotals && (
                            <tfoot><tr>
                              <td colSpan={4}>Total</td>
                              <td style={{ textAlign: 'right' }}>{fN(yiTotals.volume)}</td>
                              <td style={{ textAlign: 'right' }}>{fR(yiTotals.revenue)}</td>
                              <td style={{ textAlign: 'right' }}>{fR(yiTotals.vendor_cost)}</td>
                              <td style={{ textAlign: 'right' }} className={Number(yiTotals.margin) < 0 ? 'zneg' : 'zpos'}>{fR(yiTotals.margin)}</td>
                            </tr></tfoot>
                          )}
                        </table>
                      </div>
                      <Paginator page={yiPag.page} totalPages={yiPag.totalPages} setPage={yiPag.setPage} total={yiSorted.length} pageSize={12} />
                    </>
                  )}
                </div>

                {yiChartData.length > 0 && (
                  <div className="zpnl" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px 12px', borderBottom: '1px solid var(--ln)', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 15, color: 'var(--ink)', letterSpacing: '-.2px' }}>
                          Yesterday (Iristel) — Top 12 Countries
                        </h2>
                        <span style={{ fontSize: 11, color: 'var(--mu)', fontWeight: 600 }}>Top {Math.min(12, yiChartData.length)} of {yiChartData.length}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(Object.keys(MCFG) as Metric[]).map(m => {
                          const active = yiMetrics.has(m);
                          return (
                            <button key={m} onClick={() => toggleYiMetric(m)} style={{
                              padding: '5px 13px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: '.12s', letterSpacing: '.02em',
                              border: `1.5px solid ${active ? MCFG[m].color : 'var(--lns)'}`,
                              background: active ? MCFG[m].color : 'var(--sf2)',
                              color: active ? '#fff' : 'var(--mu)',
                              boxShadow: active ? `0 2px 0 rgba(0,0,0,.18)` : 'none',
                            }}>
                              {MCFG[m].label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ height: 340, padding: '16px 8px 8px 4px' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={yiChartData.slice(0, 12)} margin={{ top: 4, right: 64, bottom: 80, left: 10 }} barCategoryGap="28%" barGap={3}>
                          <CartesianGrid strokeDasharray="3 5" stroke="var(--ln)" vertical={false} />
                          <XAxis dataKey="country_name" tick={{ fontSize: 10, fill: 'var(--inks)' }} axisLine={{ stroke: 'var(--lns)' }} tickLine={false} angle={-40} textAnchor="end" interval={0} height={80} />
                          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--mu)' }} axisLine={false} tickLine={false} width={yiMetrics.has('volume') ? 72 : 0} hide={!yiMetrics.has('volume')} tickFormatter={(v: number) => fN(v)} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--mu)' }} axisLine={false} tickLine={false} width={(yiMetrics.has('revenue') || yiMetrics.has('vendor_cost') || yiMetrics.has('margin')) ? 64 : 0} hide={!(yiMetrics.has('revenue') || yiMetrics.has('vendor_cost') || yiMetrics.has('margin'))} tickFormatter={(v: number) => fR(v)} />
                          <Tooltip
                            contentStyle={{ background: 'var(--sf)', border: '1px solid var(--ln)', borderRadius: 10, fontSize: 12, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,.12)' }}
                            labelStyle={{ fontWeight: 700, fontSize: 12, color: 'var(--ink)', marginBottom: 6 }}
                            itemStyle={{ color: 'var(--inks)', fontSize: 12 }}
                            formatter={(v: any, name: string) => name === 'Volume' ? [fN(v), name] : [fR(v), name]}
                            cursor={{ fill: 'var(--sf2)', radius: 4 }}
                          />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4, color: 'var(--inks)' }} />
                          {(Object.keys(MCFG) as Metric[]).filter(m => yiMetrics.has(m)).map(m => (
                            <Bar key={m} yAxisId={MCFG[m].yAxis} dataKey={m} name={MCFG[m].label} fill={MCFG[m].color} radius={[5, 5, 0, 0]} maxBarSize={40} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

      </div>
    </>
  );
}

