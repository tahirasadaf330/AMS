'use client';

import * as React from 'react';
import { vendorBindStatusApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const PAGE_SIZE = 50;

const CSS = `
.vbs{
  --turquoise:#1abc9c;--green-sea:#16a085;--emerald:#2ecc71;--nephritis:#27ae60;
  --river:#3498db;--belize:#2980b9;
  --asphalt:#34495e;--midnight:#2c3e50;
  --carrot:#e67e22;--alizarin:#e74c3c;--sunflower:#f1c40f;
  --pos:#27ae60;--neg:#e74c3c;--warn:#e67e22;
  --bg:#ecf0f1;--sf:#ffffff;--sf2:#f5f7f8;--stripe:#f9fafb;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  font-family:-apple-system,sans-serif;
  color:var(--ink);background:var(--bg);
}
.dark .vbs{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}
.vbs-pnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.vbs-ph{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;border-bottom:1px solid var(--ln);flex-wrap:wrap;gap:10px}
.vbs-tag{font-size:11px;color:var(--mu);font-weight:600}
.vbs-di{appearance:none;font-size:13px;color:var(--ink);background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:7px 10px;color-scheme:light}
.dark .vbs-di{color-scheme:dark}
.vbs-di:focus{outline:none;border-color:var(--turquoise)}
.vbs-alert{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);margin-bottom:16px}
.vbs-alert p{font-size:13.5px;color:#e74c3c;font-weight:600}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:monospace;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
/* A background refresh that failed: the shown data is still the last good snapshot, so the dot
   goes amber and stops pulsing rather than the page popping an error banner and shifting. */
.zpulse.st{background:#f1c40f;animation:none;box-shadow:none}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.win-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:11.5px;font-weight:700;background:rgba(26,188,156,.12);color:var(--green-sea);border:1px solid rgba(26,188,156,.3)}
.dark .win-pill{color:var(--emerald)}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
/* KPI cards */
.vbs-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;flex-shrink:0}
@media(max-width:900px){.vbs-cards{grid-template-columns:repeat(2,1fr)}}
.vbs-card{background:var(--sf);border:1px solid var(--ln);border-radius:10px;padding:12px 16px;box-shadow:0 2px 0 var(--ln)}
.vbs-card .n{font-size:22px;font-weight:800;font-family:monospace;line-height:1;color:var(--ink);margin-bottom:4px}
.vbs-card .l{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mu)}
.vbs-card.bad{border-color:rgba(231,76,60,.35);background:rgba(231,76,60,.06)}
.vbs-card.bad .n{color:var(--neg)}
.vbs-card.warn{border-color:rgba(230,126,34,.35);background:rgba(230,126,34,.06)}
.vbs-card.warn .n{color:var(--warn)}
.vbs-card.good .n{color:var(--turquoise)}
/* Status pill */
.st-pill{display:inline-flex;align-items:center;border-radius:20px;padding:1px 9px;font-size:11px;font-weight:700;white-space:nowrap}
.st-conn{background:rgba(46,204,113,.18);color:#27ae60}
.st-disc{background:rgba(231,76,60,.2);color:#e74c3c}
.st-part{background:rgba(230,126,34,.2);color:#e67e22}
.st-http{background:rgba(52,152,219,.16);color:#2980b9}
.st-unk{background:rgba(149,165,166,.18);color:#7f8c9a}
/* Per-column filter popovers */
.vbs-fil{position:relative;width:100%}
.vbs-fil-btn{display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;cursor:pointer;text-align:left;padding:5px 8px;font-size:11px;line-height:1.3}
.vbs-fil-btn .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mu)}
.vbs-fil-btn.on{border-color:var(--turquoise)}
.vbs-fil-btn.on .lbl{color:var(--turquoise);font-weight:600}
.vbs-fil-btn .caret{color:var(--mu);flex-shrink:0;font-size:8px}
.vbs-pop{position:absolute;top:calc(100% + 4px);z-index:60;background:var(--sf);border:1px solid var(--lns);border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.28);overflow:hidden}
.vbs-pop-search{padding:8px;border-bottom:1px solid var(--ln)}
.vbs-pop-search .vbs-di{width:100%}
.vbs-pop-list{max-height:240px;overflow-y:auto;padding:4px}
.vbs-pop-opt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 10px;font-size:12px;color:var(--ink);background:none;border:none;border-radius:6px;cursor:pointer}
.vbs-pop-opt:hover{background:var(--sf2)}
.vbs-pop-opt .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vbs-chk{width:14px;height:14px;flex-shrink:0;border:1px solid var(--lns);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff;line-height:1}
.vbs-chk.on{background:var(--turquoise);border-color:var(--turquoise)}
.vbs-pop-empty{padding:12px;font-size:12px;color:var(--mu);text-align:center}
.vbs-pop-foot{padding:8px;border-top:1px solid var(--ln)}
.vbs-pop-foot button{font-size:11px;color:var(--mu);background:none;border:none;cursor:pointer}
/* Pagination */
.vbs-pag{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;border-top:1px solid var(--ln);flex-shrink:0;flex-wrap:wrap}
.vbs-pag-ctrls{display:flex;align-items:center;gap:4px}
.vbs-pag-ctrls button{min-width:28px;height:28px;padding:0 6px;border-radius:6px;border:1px solid var(--lns);background:var(--sf2);color:var(--ink);cursor:pointer;font-size:13px}
.vbs-pag-ctrls button:disabled{opacity:.35;cursor:not-allowed}
.vbs-pag-ctrls button:not(:disabled):hover{border-color:var(--turquoise)}
.vbs-pag-cur{padding:0 10px;font-size:12px;font-weight:700;color:var(--ink)}
`;

const IC = {
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  radio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" /></svg>,
};

type SortDir = 'asc' | 'desc';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }

// Zero-looking values: a real non-zero that would display as "0" is revealed with enough
// significant digits to act on; an exact zero never shows a minus sign.
const zz = (v: number, s: string): string => {
  if (/[1-9]/.test(s)) return s;
  if (v !== 0 && Number.isFinite(v)) return s.replace(/-?[\d.,]+/, v.toLocaleString('en-US', { maximumSignificantDigits: 2 }));
  return s.includes('-') ? s.replace('-', '') : s;
};
const fmtInt = (n: any): string => { if (n == null) return '—'; const v = Number(n); return zz(v, v.toLocaleString('en-US')); };
// `date` arrives as a plain 'YYYY-MM-DD' string (getData uses to_char, deliberately — see the
// service). Do NOT round-trip it through Date: that reintroduces the local-midnight day shift.
const fmtDate = (d: any): string => (d ? String(d).slice(0, 10) : '—');
const fmtTs = (t: any): string => {
  if (!t) return '—';
  const d = new Date(t);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

// The alert this report feeds, kept here so the row highlight cannot drift from the condition
// configured in the Alerts UI.
const ALERT_MIN_RECENT = 20;
const isAlerting = (r: any) => r.status === 'disconnected' && Number(r.recent_traffic_volume ?? 0) > ALERT_MIN_RECENT;

const STATUS_META: Record<string, { cls: string; label: string }> = {
  connected:    { cls: 'st-conn', label: 'Connected' },
  disconnected: { cls: 'st-disc', label: 'Disconnected' },
  partial:      { cls: 'st-part', label: 'Partial' },
  http_no_bind: { cls: 'st-http', label: 'HTTP · no bind' },
  unknown:      { cls: 'st-unk',  label: 'Unknown' },
};
// Shared by the Status pill and the Status filter, so an unexpected value from the dataset reads
// the same in both rather than falling back differently.
const statusLabel = (v: string): string => STATUS_META[v]?.label ?? v;

// Close a popover on outside click.
function useOutsideClose(open: boolean, ref: React.RefObject<HTMLDivElement>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, ref, close]);
}

// Text column filter — multi-select of the column's values (with search), the same system as the
// Voice Live Traffic report and the Datasets viewer.
// `label` maps a stored value to what the option shows — Status holds enum strings
// ('http_no_bind'), which should read the same way the pill in the table reads. Filtering still
// compares the stored value, so only the display text changes.
function TextColFilter({ colKey, allRows, selected, onChange, label }: {
  colKey: string; allRows: any[]; selected: string[]; onChange: (vals: string[]) => void;
  label?: (v: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));

  const values = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) { const v = r[colKey]; if (v != null && v !== '') set.add(String(v)); }
    // Dates read best newest-first; everything else alphabetical (numeric-aware for MCC-MNC).
    return colKey === 'date'
      ? Array.from(set).sort().reverse()
      : Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [allRows, colKey]);

  // Pin selected values to the top so the current selection is visible the moment the dropdown
  // reopens instead of being buried in a long list. `values` is already ordered and Array.sort is
  // stable, so order within each group is kept.
  const selSet = new Set(selected);
  const needle = q.toLowerCase();
  const filtered = values
    // Match the displayed text as well as the stored one, so searching Status for "no bind" finds
    // 'http_no_bind' rather than missing on the underscore.
    .filter(v => v.toLowerCase().includes(needle) || (label ? label(v).toLowerCase().includes(needle) : false))
    .sort((a, b) => Number(selSet.has(b)) - Number(selSet.has(a)));
  const has = selected.length > 0;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div ref={wrapRef} className="vbs-fil">
      <button type="button" className={`vbs-di vbs-fil-btn${has ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{has ? `${selected.length} selected` : 'Filter…'}</span>
        <span className="caret">▼</span>
      </button>
      {/* The popover is pinned to BOTH edges of `.vbs-fil` (which is width:100% of the header
          cell), so it is always exactly as wide as the filter button above it — no width value to
          keep in sync with the column, and no minimum that could make it overhang. Every
          filterable column is therefore sized wide enough to host this popover comfortably; see
          the width notes on COLS. */}
      {open && (
        <div className="vbs-pop" style={{ left: 0, right: 0 }}>
          <div className="vbs-pop-search">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="vbs-di" />
          </div>
          <div className="vbs-pop-list">
            {filtered.length === 0 && <div className="vbs-pop-empty">No values</div>}
            {filtered.map(v => (
              <button key={v} type="button" className="vbs-pop-opt" onClick={() => toggle(v)} title={label ? label(v) : v}>
                <span className={`vbs-chk${selected.includes(v) ? ' on' : ''}`}>{selected.includes(v) ? '✓' : ''}</span>
                <span className="val">{label ? label(v) : v}</span>
              </button>
            ))}
          </div>
          {has && <div className="vbs-pop-foot"><button type="button" onClick={() => { onChange([]); setQ(''); }}>Clear selection</button></div>}
        </div>
      )}
    </div>
  );
}

const TH = ({ children, left, w, colKey, sort }: { children: React.ReactNode; left?: boolean; w?: number; colKey?: string; sort?: SortState }) => {
  const isActive = !!colKey && sort?.key === colKey;
  return (
    <th onClick={colKey ? () => sort?.set(colKey) : undefined} style={{
      textAlign: left ? 'left' : 'right', position: 'sticky', top: 0,
      background: 'var(--sf2)', zIndex: 2, padding: '10px 10px',
      fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
      color: isActive ? 'var(--turquoise)' : 'var(--mu)', whiteSpace: 'nowrap',
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
  <td style={{ textAlign: left ? 'left' : 'right', padding: '9px 10px', whiteSpace: 'nowrap', borderBottom: '1px solid var(--ln)', verticalAlign: 'top', background: 'var(--sf2)', ...style }}>
    {children}
  </td>
);

// Text cells wrap so long vendor / customer / operator names stay fully visible.
const wrapCell = (maxW: number): React.CSSProperties => ({ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: maxW });

// Column layout — drives the header, filter row, body and footer so they stay aligned.
// `type` still governs alignment and which columns the totals footer sums, independently of
// whether a column is filterable.
//
// `filter: false` marks a column with no filter control. Every column keeps its sort. Filterable:
// the six the report was specified with — Date, Vendor Name, Customer Connection, Country,
// Operator, MCC MNC — plus Status, which the SMS team asked for so a disconnected-only view is one
// click rather than a sort. The three without a filter are deliberate:
//   · Traffic Volume, Recent (10m) — a value picker over thousands of distinct numbers is
//     unusable, and sorting already brings the extremes to the top.
//   · Disconnection Time — every value is a distinct instant, so it would list one option per row.
// Because a filter popover is exactly its column's width, a FILTERABLE column has to be wide
// enough to host one. The popover's fixed chrome is a 14px checkbox + 8px gap + 2×8px row padding
// ≈ 38px, so the value gets (w − 12 header-cell padding − 38). The filterable widths below clear
// their longest realistic value on that basis — Date needs 'YYYY-MM-DD' (~72px → 130), MCC MNC six
// digits (~45px → 125), Country most names (→ 150). Longer values still ellipsis with a title
// tooltip. Non-filterable columns are sized purely by their content.
type Col = { key: string; label: string; type: 'text' | 'num'; w: number; left: boolean; filter?: false };
const COLS: Col[] = [
  { key: 'date',                  label: 'Date',                 type: 'text', w: 130, left: true },
  { key: 'vendor_name',           label: 'Vendor Name',          type: 'text', w: 175, left: true },
  { key: 'status',                label: 'Status',               type: 'text', w: 150, left: true },
  { key: 'traffic_volume',        label: 'Traffic Volume',       type: 'num',  w: 105, left: false, filter: false },
  { key: 'recent_traffic_volume', label: 'Recent (10m)',         type: 'num',  w: 100, left: false, filter: false },
  { key: 'disconnection_time',    label: 'Disconnection Time',   type: 'text', w: 160, left: true,  filter: false },
  { key: 'customer_connection',   label: 'Customer Connection',  type: 'text', w: 175, left: true },
  { key: 'country',               label: 'Country',              type: 'text', w: 150, left: true },
  { key: 'operator',              label: 'Operator',             type: 'text', w: 200, left: true },
  { key: 'mcc_mnc',               label: 'MCC MNC',              type: 'text', w: 125, left: true },
];
const NUM_COLS = COLS.filter(c => c.type === 'num');
// Every filterable column is a text/value picker, so there is no numeric range control.
const FILTERABLE_COLS = COLS.filter(c => c.filter !== false);
const LEAD_TEXT_COLS = 3; // date + vendor + status — the footer's "Total" label spans these

// Renders one body cell for a column, so the body stays aligned with the header.
function BodyCell({ col, r, hot }: { col: Col; r: any; hot: boolean }) {
  const bg = hot ? { background: 'rgba(231,76,60,.09)' } : undefined;

  if (col.key === 'status') {
    const meta = STATUS_META[r.status] ?? STATUS_META.unknown;
    return (
      <TD left style={bg}>
        <span className={`st-pill ${meta.cls}`}>{meta.label}</span>
      </TD>
    );
  }
  if (col.key === 'date') {
    return <TD left style={{ ...bg, fontFamily: 'monospace', color: 'var(--inks)' }}>{fmtDate(r.date)}</TD>;
  }
  if (col.key === 'disconnection_time') {
    return <TD left style={{ ...bg, fontFamily: 'monospace', fontSize: 11.5, color: r.disconnection_time ? 'var(--inks)' : 'var(--mu)' }}>{fmtTs(r.disconnection_time)}</TD>;
  }
  if (col.key === 'vendor_name') {
    return <TD left style={{ ...bg, ...wrapCell(col.w), color: 'var(--ink)', fontWeight: 600 }} >{r.vendor_name ?? '—'}</TD>;
  }
  if (col.type === 'text') {
    const mono = col.key === 'mcc_mnc';
    return (
      <TD left style={{ ...bg, ...wrapCell(col.w), color: 'var(--inks)', ...(mono ? { fontFamily: 'monospace' } : {}) }}>
        {r[col.key] ?? '—'}
      </TD>
    );
  }
  // Numeric: the 10-minute figure is the one the alert reads, so flag it when it is over the
  // threshold on a disconnected vendor.
  const v = r[col.key];
  const flagged = col.key === 'recent_traffic_volume' && hot;
  return (
    <TD style={{ ...bg, fontFamily: 'monospace', color: flagged ? 'var(--neg)' : 'var(--inks)', fontWeight: flagged ? 700 : 400 }}>
      {fmtInt(v)}
    </TD>
  );
}

function Skel() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(8)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

export default function VendorBindStatusPage() {
  const [data, setData] = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  // `loading` drives the skeleton and is therefore set ONLY by the very first fetch. Every later
  // fetch (WebSocket refresh, tab regaining focus) is a BACKGROUND fetch that leaves the table
  // mounted and swaps the rows in place — otherwise returning to the tab, or any 10-minute dataset
  // refresh, would tear the whole table down to a skeleton and rebuild it (the visible glitch).
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // A background fetch that fails must not pop an error banner: that shifts the layout under the
  // user's cursor. It marks the view stale instead, shown on the Last Updated dot.
  const [stale, setStale] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: 'traffic_volume', dir: 'desc' });
  const [textFilters, setTextFilters] = React.useState<Record<string, string[]>>({});

  const handleSort = React.useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return { key: null, dir: 'desc' };
    });
  }, []);

  // One request at a time, and remember when the last one landed — a tab switch fires both
  // `focus` and `visibilitychange`, so without these two guards returning to the tab would kick
  // off two overlapping fetches.
  const inFlight = React.useRef(false);
  const fetchedAt = React.useRef(0);

  const fetchData = React.useCallback((mode: 'initial' | 'background') => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (mode === 'initial') { setLoading(true); setError(null); }
    vendorBindStatusApi.getData()
      // Responses are snake_cased by the backend interceptor, so read snake keys.
      .then(r => {
        setData(r.data);
        setDatasetId(r.data?.dataset_id ?? r.data?.datasetId ?? null);
        setError(null);
        setStale(false);
        fetchedAt.current = Date.now();
      })
      .catch((err: any) => {
        const msg = err?.response?.data?.message ?? err?.message ?? 'Failed to load data';
        // Only the initial fetch has no data to fall back on, so only it may show the banner.
        if (mode === 'initial') setError(msg); else setStale(true);
      })
      .finally(() => {
        inFlight.current = false;
        if (mode === 'initial') setLoading(false);
      });
  }, []);

  React.useEffect(() => { fetchData('initial'); }, [fetchData]);

  // A dataset refresh (every 10 min) swaps the rows in underneath the mounted table.
  const onSocketRefresh = React.useCallback(() => fetchData('background'), [fetchData]);
  useDatasetSocket(datasetId, onSocketRefresh);

  // Catch up when the tab regains focus, in case a refresh landed while the socket was asleep.
  // Throttled: flipping between tabs inside the window does nothing at all, which is what keeps
  // tab-switching visually still.
  React.useEffect(() => {
    const MIN_REFETCH_GAP_MS = 30_000;
    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - fetchedAt.current < MIN_REFETCH_GAP_MS) return;
      fetchData('background');
    };
    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('focus', maybeRefresh);
    };
  }, [fetchData]);

  // Reset to the first page whenever the visible set changes.
  React.useEffect(() => { setPage(1); }, [textFilters, sort]);

  const hasFilters = Object.values(textFilters).some(v => v && v.length > 0);

  const clearFilters = () => setTextFilters({});

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let filtered: any[] = data.rows;

    for (const c of FILTERABLE_COLS) {
      const sel = textFilters[c.key];
      if (sel && sel.length) filtered = filtered.filter((r: any) => sel.includes(String(r[c.key] ?? '')));
    }

    if (!sort.key) return filtered;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, textFilters, sort]);

  const lastRefreshed: string | null = data?.last_refreshed ?? data?.lastRefreshed ?? null;
  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, rows.length);

  // Cards and footer totals both describe the FILTERED set, so they always agree with the table.
  const stats = React.useMemo(() => {
    const disc = rows.filter(r => r.status === 'disconnected');
    return {
      vendors:     new Set(rows.map(r => r.vendor_name)).size,
      discVendors: new Set(disc.map(r => r.vendor_name)).size,
      partVendors: new Set(rows.filter(r => r.status === 'partial').map(r => r.vendor_name)).size,
      volume:      rows.reduce((s, r) => s + Number(r.traffic_volume ?? 0), 0),
      recent:      rows.reduce((s, r) => s + Number(r.recent_traffic_volume ?? 0), 0),
    };
  }, [rows]);

  const allRows: any[] = data?.rows ?? [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vbs w-full" style={{ margin: '-24px', padding: '20px 24px 0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>SMS Monitoring</div>
            <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>Vendor Bind Status</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="win-pill">{IC.radio} aSMSC · last 48 hours</span>
            {lastRefreshed && (
              <div className="zdcard">
                <div className="dlbl">{stale ? 'Last Updated · retrying' : 'Last Updated'}</div>
                <div className="dval">
                  <span className={`zpulse${stale ? ' st' : ''}`} title={stale ? 'A background refresh failed — showing the last good snapshot' : undefined} />
                  <span>{new Date(lastRefreshed).toLocaleString()}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="vbs-alert" style={{ flexShrink: 0 }}>
            <span style={{ color: '#e74c3c', display: 'flex' }}>{IC.alert}</span>
            <p>Could not load data: {error}</p>
          </div>
        )}

        {/* KPI cards */}
        <div className="vbs-cards">
          <div className="vbs-card"><div className="n">{fmtInt(stats.vendors)}</div><div className="l">Vendors with traffic</div></div>
          <div className={`vbs-card${stats.discVendors > 0 ? ' bad' : ''}`}><div className="n">{fmtInt(stats.discVendors)}</div><div className="l">Disconnected vendors</div></div>
          <div className={`vbs-card${stats.partVendors > 0 ? ' warn' : ''}`}><div className="n">{fmtInt(stats.partVendors)}</div><div className="l">Partial binds</div></div>
          <div className="vbs-card good"><div className="n">{fmtInt(stats.volume)}</div><div className="l">Traffic volume (parts)</div></div>
        </div>

        {/* Table panel */}
        <div className="vbs-pnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          {/* Header bar exists only to host Clear filters — without a filter applied there is
              nothing to put in it, so it is omitted rather than left as an empty strip. */}
          {hasFilters && (
            <div className="vbs-ph" style={{ justifyContent: 'flex-end' }}>
              <button onClick={clearFilters} style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                Clear filters
              </button>
            </div>
          )}

          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--sf2)' }}>
            {/* `!data` as well as `loading`: the skeleton may only replace the table when there is
                nothing to show. Once rows exist the table stays mounted through every refresh. */}
            {loading && !data ? <Skel /> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
                <thead>
                  <tr>
                    {COLS.map(c => (
                      <TH key={c.key} left={c.left} w={c.w} colKey={c.key} sort={srt}>{c.label}</TH>
                    ))}
                  </tr>
                  {/* Per-column filter row */}
                  <tr>
                    {COLS.map(c => (
                      <th key={c.key} style={{ position: 'sticky', top: 33, background: 'var(--sf2)', zIndex: 1, padding: '4px 6px', borderBottom: '2px solid var(--lns)', width: c.w, minWidth: c.w }}>
                        {c.filter === false ? null : (
                          <TextColFilter
                            colKey={c.key}
                            allRows={allRows}
                            selected={textFilters[c.key] ?? []}
                            onChange={vals => setTextFilters(f => ({ ...f, [c.key]: vals }))}
                            label={c.key === 'status' ? statusLabel : undefined}
                          />
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : hasFilters ? 'No matching rows' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {pagedRows.map((r: any, i: number) => {
                    const hot = isAlerting(r);
                    return (
                      <tr key={(safePage - 1) * PAGE_SIZE + i}>
                        {COLS.map(c => <BodyCell key={c.key} col={c} r={r} hot={hot} />)}
                      </tr>
                    );
                  })}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={LEAD_TEXT_COLS} style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 }}>
                        Total ({rows.length.toLocaleString()} rows · {stats.vendors} vendors)
                      </td>
                      {NUM_COLS.map(c => (
                        <td key={c.key} style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 }}>
                          {fmtInt(c.key === 'traffic_volume' ? stats.volume : stats.recent)}
                        </td>
                      ))}
                      {/* Trailing text columns after the numeric block keep the footer aligned. */}
                      <td colSpan={COLS.length - LEAD_TEXT_COLS - NUM_COLS.length} style={{ borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>

          {/* Pagination */}
          {!loading && rows.length > 0 && (
            <div className="vbs-pag">
              <span className="vbs-tag">
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {rows.length.toLocaleString()} rows
              </span>
              {totalPages > 1 && (
                <div className="vbs-pag-ctrls">
                  <button onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
                  <span className="vbs-pag-cur">{safePage} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>›</button>
                  <button onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>»</button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
