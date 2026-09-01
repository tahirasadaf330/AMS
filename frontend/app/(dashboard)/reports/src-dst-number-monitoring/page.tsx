'use client';

import * as React from 'react';
import { srcDstNumberApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const PAGE_SIZE = 50;

// Display row caps (server-side top-N over the pre-aggregated hourly rollup). Reads are instant.
const CAPS = [10, 100, 300, 1000, 3000, 5000, 10000];
const DEFAULT_CAP = 100;
const capLabel = (c: number) => (c >= 1000 ? `${c / 1000}k` : String(c));
// 5G-parity windows: last N hourly buckets including the current partial hour.
const WINDOWS: { key: string; label: string }[] = [
  { key: 'thishr', label: 'This Hr' },
  { key: 'prevhr', label: 'Prev Hr' },
  { key: '4h', label: '4h' },
  { key: '12h', label: '12h' },
  { key: '1d', label: '1d' },
  { key: '2d', label: '2d' },
  { key: '3d', label: '3d' },
  { key: '7d', label: '7d' },
];
const DEFAULT_WINDOW = '1d';
const fmtHour = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const CSS = `
.sdn{
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
.dark .sdn{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}
.sdn-pnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.sdn-ph{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;border-bottom:1px solid var(--ln);flex-wrap:wrap;gap:10px}
.sdn-ph h2{font-weight:700;font-size:13px;color:var(--ink)}
.sdn-tag{font-size:11px;color:var(--mu);font-weight:600}
.sdn-di{appearance:none;font-size:13px;color:var(--ink);background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:7px 10px;color-scheme:light}
.dark .sdn-di{color-scheme:dark}
.sdn-di:focus{outline:none;border-color:var(--turquoise)}
.sdn-alert{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);margin-bottom:16px}
.sdn-alert p{font-size:13.5px;color:#e74c3c;font-weight:600}
.sdn-info{display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:8px;background:rgba(26,188,156,.1);border:1px solid rgba(26,188,156,.3);margin-bottom:14px}
.sdn-info p{font-size:12.5px;color:var(--green-sea);font-weight:600}
.dark .sdn-info p{color:var(--emerald)}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:monospace;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.win-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:11.5px;font-weight:700;background:rgba(26,188,156,.12);color:var(--green-sea);border:1px solid rgba(26,188,156,.3)}
.dark .win-pill{color:var(--emerald)}
.sdn-seg{display:inline-flex;border:1px solid var(--lns);border-radius:8px;overflow:hidden;background:var(--sf2)}
.sdn-seg button{padding:8px 18px;font-size:12.5px;font-weight:700;border:none;background:none;color:var(--mu);cursor:pointer;letter-spacing:.02em}
.sdn-seg button.on{background:var(--turquoise);color:#fff}
.sdn-grp{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap}
.sdn-grp .lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);margin-right:2px}
.sdn-chipbtn{padding:6px 11px;font-size:12px;font-weight:600;border:1px solid var(--lns);border-radius:7px;background:var(--sf2);color:var(--inks);cursor:pointer}
.sdn-chipbtn.on{border-color:var(--turquoise);color:var(--turquoise);background:rgba(26,188,156,.1)}
.sdn-chipbtn:disabled{opacity:.5;cursor:not-allowed}
.sdn-go{padding:7px 16px;font-size:12.5px;font-weight:700;border:none;border-radius:8px;background:var(--turquoise);color:#fff;cursor:pointer}
.sdn-go:disabled{opacity:.5;cursor:not-allowed}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
.sdn-fil{position:relative;width:100%}
.sdn-fil-btn{display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;cursor:pointer;text-align:left;padding:5px 8px;font-size:11px;line-height:1.3}
.sdn-fil-btn .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mu)}
.sdn-fil-btn.on{border-color:var(--turquoise)}
.sdn-fil-btn.on .lbl{color:var(--turquoise);font-weight:600}
.sdn-fil-btn .caret{color:var(--mu);flex-shrink:0;font-size:8px}
.sdn-pop{position:absolute;top:calc(100% + 4px);z-index:60;background:var(--sf);border:1px solid var(--lns);border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.28);overflow:hidden}
.sdn-pop-search{padding:8px;border-bottom:1px solid var(--ln)}
.sdn-pop-search .sdn-di{width:100%}
.sdn-pop-list{max-height:240px;overflow-y:auto;padding:4px}
.sdn-pop-opt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 10px;font-size:12px;color:var(--ink);background:none;border:none;border-radius:6px;cursor:pointer}
.sdn-pop-opt:hover{background:var(--sf2)}
.sdn-pop-opt .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sdn-chk{width:14px;height:14px;flex-shrink:0;border:1px solid var(--lns);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff;line-height:1}
.sdn-chk.on{background:var(--turquoise);border-color:var(--turquoise)}
.sdn-pop-empty{padding:12px;font-size:12px;color:var(--mu);text-align:center}
.sdn-pop-foot{padding:8px;border-top:1px solid var(--ln)}
.sdn-pop-foot button{font-size:11px;color:var(--mu);background:none;border:none;cursor:pointer}
.sdn-pop-lbl{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);margin-bottom:3px}
.sdn-pag{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;border-top:1px solid var(--ln);flex-shrink:0;flex-wrap:wrap}
.sdn-pag-ctrls{display:flex;align-items:center;gap:4px}
.sdn-pag-ctrls button{min-width:28px;height:28px;padding:0 6px;border-radius:6px;border:1px solid var(--lns);background:var(--sf2);color:var(--ink);cursor:pointer;font-size:13px}
.sdn-pag-ctrls button:disabled{opacity:.35;cursor:not-allowed}
.sdn-pag-ctrls button:not(:disabled):hover{border-color:var(--turquoise)}
.sdn-pag-cur{padding:0 10px;font-size:12px;font-weight:700;color:var(--ink)}
.sdn-spin{width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sdnspin .7s linear infinite;display:inline-block}
@keyframes sdnspin{to{transform:rotate(360deg)}}
`;

const IC = {
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  hash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" /></svg>,
};

type SortDir = 'asc' | 'desc';
type Kind = 'src' | 'dst';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }
type NumRange = { min: string; max: string };

// A formatted number with a minus sign but no non-zero digit is a "-0" — never show the sign.
const zz = (s: string): string => s.includes('-') && !/[1-9]/.test(s) ? s.replace('-', '') : s;
const fmtInt = (n: any): string => n == null ? '—' : zz(Number(n).toLocaleString('en-US'));
const fmtDec = (n: any): string => n == null ? '—' : zz(Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLDivElement>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, ref, close]);
}

function TextColFilter({ colKey, allRows, selected, onChange, align }: {
  colKey: string; allRows: any[]; selected: string[]; onChange: (vals: string[]) => void; align: 'left' | 'right';
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));

  // '' is the sentinel for rows with no value (e.g. numbers with no resolved area), shown as "(blank)".
  const displayLabel = (v: string) => (v === '' ? '(blank)' : v);
  const values = React.useMemo(() => {
    const set = new Set<string>();
    let hasBlank = false;
    for (const r of allRows) { const v = r[colKey]; if (v == null || v === '') hasBlank = true; else set.add(String(v)); }
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    return hasBlank ? ['', ...arr] : arr;
  }, [allRows, colKey]);
  // Pin selected values to the top so they're visible when the dropdown reopens.
  const selectedSet = new Set(selected);
  const ordered = [...values.filter(v => selectedSet.has(v)), ...values.filter(v => !selectedSet.has(v))];
  const filtered = ordered.filter(v => displayLabel(v).toLowerCase().includes(q.toLowerCase()));
  const has = selected.length > 0;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div ref={wrapRef} className="sdn-fil">
      <button type="button" className={`sdn-di sdn-fil-btn${has ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{has ? `${selected.length} selected` : 'Filter…'}</span>
        <span className="caret">▼</span>
      </button>
      {open && (
        <div className="sdn-pop" style={{ width: 240, [align]: 0 }}>
          <div className="sdn-pop-search">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search values…" className="sdn-di" />
          </div>
          <div className="sdn-pop-list">
            {filtered.length === 0 && <div className="sdn-pop-empty">No values</div>}
            {filtered.map(v => (
              <button key={v || '(blank)'} type="button" className="sdn-pop-opt" onClick={() => toggle(v)} title={displayLabel(v)}>
                <span className={`sdn-chk${selected.includes(v) ? ' on' : ''}`}>{selected.includes(v) ? '✓' : ''}</span>
                <span className="val" style={v === '' ? { fontStyle: 'italic', color: 'var(--mu)' } : undefined}>{displayLabel(v)}</span>
              </button>
            ))}
          </div>
          {has && <div className="sdn-pop-foot"><button type="button" onClick={() => { onChange([]); setQ(''); }}>Clear selection</button></div>}
        </div>
      )}
    </div>
  );
}

// Per-column substring search (for high-cardinality columns like the number and the tried-areas list).
function SearchColFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="sdn-fil">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search…"
        className={`sdn-di${value ? ' on' : ''}`}
        style={{ width: '100%', padding: '5px 8px', fontSize: 11, ...(value ? { borderColor: 'var(--turquoise)', color: 'var(--turquoise)' } : {}) }}
      />
    </div>
  );
}

function NumColFilter({ value, onChange }: { value: NumRange; onChange: (v: NumRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));
  const has = value.min !== '' || value.max !== '';
  const label = has ? [value.min && `≥ ${value.min}`, value.max && `≤ ${value.max}`].filter(Boolean).join('  ') : 'Filter…';

  return (
    <div ref={wrapRef} className="sdn-fil">
      <button type="button" className={`sdn-di sdn-fil-btn${has ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{label}</span>
        <span className="caret">▼</span>
      </button>
      {open && (
        <div className="sdn-pop" style={{ right: 0, width: 170, padding: 10 }}>
          <label className="sdn-pop-lbl">Min</label>
          <input type="number" className="sdn-di" style={{ width: '100%' }} placeholder="No minimum" value={value.min} onChange={e => onChange({ ...value, min: e.target.value })} />
          <label className="sdn-pop-lbl" style={{ marginTop: 8 }}>Max</label>
          <input type="number" className="sdn-di" style={{ width: '100%' }} placeholder="No maximum" value={value.max} onChange={e => onChange({ ...value, max: e.target.value })} />
          {has && <button type="button" style={{ marginTop: 8, fontSize: 11, color: 'var(--mu)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => onChange({ min: '', max: '' })}>Clear</button>}
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

const wrapCell = (maxW: number): React.CSSProperties => ({ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: maxW });

type Col = { key: string; label: string; type: 'text' | 'num'; w: number; left: boolean; filter: 'text' | 'num' | 'search' | 'none' };

const SRC_COLS: Col[] = [
  { key: 'number', label: 'SRC Number', type: 'text', w: 150, left: true, filter: 'text' },
  { key: 'area', label: 'SRC Area', type: 'text', w: 150, left: true, filter: 'text' },
  { key: 'attempts', label: 'Attempt', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'conn', label: 'Conn', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'mins', label: 'Mins', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'acd', label: 'ACD', type: 'num', w: 80, left: false, filter: 'num' },
  { key: 'n_tried_areas', label: '# of tried areas', type: 'num', w: 110, left: false, filter: 'num' },
  { key: 'tried_dst_areas', label: 'Tried DST areas', type: 'text', w: 260, left: true, filter: 'search' },
];

const DST_COLS: Col[] = [
  { key: 'number', label: 'DST Number', type: 'text', w: 150, left: true, filter: 'text' },
  { key: 'area', label: 'DST Area', type: 'text', w: 150, left: true, filter: 'text' },
  { key: 'attempts', label: 'Attempt', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'conn', label: 'Conn', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'mins', label: 'Mins', type: 'num', w: 90, left: false, filter: 'num' },
  { key: 'acd', label: 'ACD', type: 'num', w: 80, left: false, filter: 'num' },
];

function BodyCell({ col, r, onExpand }: { col: Col; r: any; onExpand?: (r: any) => void }) {
  if (col.type === 'text') {
    if (col.key === 'number') {
      return <TD left style={{ ...wrapCell(col.w), fontFamily: 'monospace', color: 'var(--ink)', fontWeight: 600 }}>{r.number ?? '—'}</TD>;
    }
    if (col.key === 'tried_dst_areas') {
      // One line; click to open the full country list for this row in a modal.
      return (
        <TD left style={{ maxWidth: col.w, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.tried_dst_areas
            ? <button type="button" onClick={() => onExpand?.(r)} title="Show all areas"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--river)', font: 'inherit', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {r.tried_dst_areas}
              </button>
            : <span style={{ color: 'var(--mu)' }}>—</span>}
        </TD>
      );
    }
    return <TD left style={{ ...wrapCell(col.w), color: 'var(--inks)' }}>{r[col.key] ?? '—'}</TD>;
  }
  const decimals = col.key === 'mins' || col.key === 'acd';
  const v = r[col.key];
  const text = v == null ? '—' : decimals ? fmtDec(v) : fmtInt(v);
  const color = col.key === 'conn' ? 'var(--pos)' : 'var(--inks)';
  return <TD style={{ fontFamily: 'monospace', color, fontWeight: col.key === 'conn' ? 600 : 400 }}>{text}</TD>;
}

function Skel() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(8)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

export default function SrcDstNumberMonitoringPage() {
  const [kind, setKind] = React.useState<Kind>('src');
  const [data, setData] = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  // Default unsorted: the backend already returns rows by attempts DESC, so no column shows an active
  // sort arrow until the user clicks one.
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: null, dir: 'desc' });
  const [textFilters, setTextFilters] = React.useState<Record<string, string[]>>({});
  const [numFilters, setNumFilters] = React.useState<Record<string, NumRange>>({});
  const [searchFilters, setSearchFilters] = React.useState<Record<string, string>>({});
  const [expandRow, setExpandRow] = React.useState<any | null>(null);
  const [cap, setCap] = React.useState<number>(DEFAULT_CAP);
  const [win, setWin] = React.useState<string>(DEFAULT_WINDOW);
  const [range, setRange] = React.useState<{ from: string | null; to: string | null }>({ from: null, to: null });

  const COLS = kind === 'src' ? SRC_COLS : DST_COLS;

  const handleSort = React.useCallback((key: string) => {
    setSort(prev => {
      if (prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return { key: null, dir: 'desc' };
    });
  }, []);

  const load = React.useCallback(() => {
    setLoading(true);
    setError(null);
    const params: any = { kind, limit: cap };
    if (win === 'custom') { params.from = range.from ?? undefined; params.to = range.to ?? undefined; }
    else params.window = win;
    srcDstNumberApi.getData(params)
      // Responses are snake_cased by the backend interceptor, so read snake keys.
      .then(r => { setData(r.data); setDatasetId(r.data?.dataset_id ?? r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [kind, win, range.from, range.to, cap]);

  React.useEffect(() => { load(); }, [load]);

  // Live update: reload whenever the dataset is refreshed (the 5-min gap-fill job or a manual refresh).
  useDatasetSocket(datasetId, load);

  const curFrom: string | null = data?.from ?? null;
  const curTo: string | null = data?.to ?? null;
  const availFrom: string | null = data?.available_from ?? data?.availableFrom ?? null;
  const availTo: string | null = data?.available_to ?? data?.availableTo ?? null;
  const lastRefreshed: string | null = data?.last_refreshed ?? data?.lastRefreshed ?? null;

  React.useEffect(() => { setPage(1); }, [kind, searchFilters, textFilters, numFilters, sort, cap, win, range.from, range.to]);

  const onToggleKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setSort({ key: null, dir: 'desc' });
    setSearchFilters({});
    setTextFilters({});
    setNumFilters({});
  };

  const allRows: any[] = data?.rows ?? [];

  const hasFilters =
    Object.values(searchFilters).some(v => v && v.trim() !== '') ||
    Object.values(textFilters).some(v => v && v.length > 0) ||
    Object.values(numFilters).some(v => v && (v.min !== '' || v.max !== ''));

  const clearFilters = () => { setSearchFilters({}); setTextFilters({}); setNumFilters({}); };

  const rows: any[] = React.useMemo(() => {
    let out = allRows;

    for (const c of COLS) {
      if (c.filter === 'search') {
        const q = (searchFilters[c.key] ?? '').trim().toLowerCase();
        if (q) out = out.filter((r: any) => String(r[c.key] ?? '').toLowerCase().includes(q));
      } else if (c.filter === 'text') {
        const sel = textFilters[c.key];
        if (sel && sel.length) out = out.filter((r: any) => sel.includes(String(r[c.key] ?? '')));
      } else if (c.filter === 'num') {
        const nf = numFilters[c.key];
        if (nf) {
          if (nf.min !== '') { const mn = Number(nf.min); if (!isNaN(mn)) out = out.filter((r: any) => r[c.key] != null && Number(r[c.key]) >= mn); }
          if (nf.max !== '') { const mx = Number(nf.max); if (!isNaN(mx)) out = out.filter((r: any) => r[c.key] != null && Number(r[c.key]) <= mx); }
        }
      }
    }

    if (!sort.key) return out;
    const { key, dir } = sort;
    return [...out].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [allRows, searchFilters, textFilters, numFilters, sort, kind, COLS]);

  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, rows.length);

  const totals = React.useMemo(() => {
    let attempts = 0, conn = 0, mins = 0, nTried = 0;
    for (const r of rows) {
      attempts += r.attempts ?? 0;
      conn += r.conn ?? 0;
      mins += r.mins ?? 0;
      nTried += r.n_tried_areas ?? 0;
    }
    return { attempts, conn, mins: Math.round(mins * 100) / 100, acd: conn > 0 ? mins / conn : null, nTried };
  }, [rows]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="sdn w-full" style={{ margin: '-24px', padding: '20px 24px 0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 12, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>Number Monitoring</div>
            <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>SRC / DST Number Monitoring</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="win-pill">{IC.clock} {availTo ? `${fmtHour(availFrom)} → ${fmtHour(availTo)}` : 'no data yet'}</span>
            {lastRefreshed && (
              <div className="zdcard">
                <div className="dlbl">Last Updated</div>
                <div className="dval"><span className="zpulse" /><span>{new Date(lastRefreshed).toLocaleString()}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Controls bar: SRC/DST toggle + rows cap + day range (instant reads from the rollup) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
          <div className="sdn-seg" role="tablist" aria-label="Number type">
            <button type="button" className={kind === 'src' ? 'on' : ''} onClick={() => onToggleKind('src')}>SRC Numbers</button>
            <button type="button" className={kind === 'dst' ? 'on' : ''} onClick={() => onToggleKind('dst')}>DST Numbers</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div className="sdn-grp">
              <span className="lbl">Rows</span>
              {CAPS.map(c => (
                <button key={c} type="button" className={`sdn-chipbtn${cap === c ? ' on' : ''}`} onClick={() => setCap(c)}>{capLabel(c)}</button>
              ))}
            </div>
            <div className="sdn-grp">
              <span className="lbl">Window</span>
              {WINDOWS.map(w => (
                <button key={w.key} type="button" className={`sdn-chipbtn${win === w.key ? ' on' : ''}`} onClick={() => setWin(w.key)}>{w.label}</button>
              ))}
              <input type="date" className="sdn-di" value={range.from ?? ''} min={availFrom?.slice(0, 10)} max={availTo?.slice(0, 10)}
                onChange={e => { setWin('custom'); setRange(r => ({ ...r, from: e.target.value, to: r.to ?? e.target.value })); }} />
              <span style={{ color: 'var(--mu)', fontSize: 12 }}>→</span>
              <input type="date" className="sdn-di" value={range.to ?? ''} min={availFrom?.slice(0, 10)} max={availTo?.slice(0, 10)}
                onChange={e => { setWin('custom'); setRange(r => ({ ...r, to: e.target.value, from: r.from ?? e.target.value })); }} />
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="sdn-alert" style={{ flexShrink: 0 }}>
            <span style={{ color: '#e74c3c', display: 'flex' }}>{IC.alert}</span>
            <p>{error}</p>
          </div>
        )}

        {/* Table panel */}
        <div className="sdn-pnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <div className="sdn-ph">
            <div>
              <h2>{kind === 'src' ? 'Top SRC numbers' : 'Top DST numbers'} — {WINDOWS.find(w => w.key === win)?.label ?? 'custom'}{curFrom && curTo ? ` (${fmtHour(curFrom)} → ${fmtHour(curTo)})` : ''}</h2>
              <span className="sdn-tag" style={{ display: 'block', marginTop: 2 }}>
                {sort.key ? `Sorted by ${sort.key.replace(/_/g, ' ')} ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Click a column to sort'} · {rows.length.toLocaleString()} numbers
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {hasFilters && (
                <button onClick={clearFilters} style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Refetch overlay: keep the previous table visible (dimmed) with a spinner instead of
              collapsing to the skeleton — big windows/caps can take a few seconds server-side. */}
          {loading && data && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(20,30,40,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--sf)', border: '1px solid var(--lns)', borderRadius: 10, padding: '10px 18px', boxShadow: '0 10px 30px rgba(0,0,0,.35)' }}>
                <span className="sdn-spin" style={{ borderColor: 'rgba(26,188,156,.35)', borderTopColor: 'var(--turquoise)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Loading data…</span>
              </div>
            </div>
          )}
          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--sf2)', ...(loading && data ? { opacity: 0.45, pointerEvents: 'none' as const } : {}) }}>
            {loading && !data ? <Skel /> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
                <thead>
                  <tr>
                    {COLS.map(c => (
                      <TH key={c.key} left={c.left} w={c.w} colKey={c.key} sort={srt}>{c.label}</TH>
                    ))}
                  </tr>
                  <tr>
                    {COLS.map(c => (
                      <th key={c.key} style={{ position: 'sticky', top: 33, background: 'var(--sf2)', zIndex: 1, padding: '4px 6px', borderBottom: '2px solid var(--lns)', width: c.w, minWidth: c.w }}>
                        {c.filter === 'search'
                          ? <SearchColFilter value={searchFilters[c.key] ?? ''} onChange={v => setSearchFilters(f => ({ ...f, [c.key]: v }))} />
                          : c.filter === 'text'
                            ? <TextColFilter colKey={c.key} allRows={allRows} selected={textFilters[c.key] ?? []} onChange={vals => setTextFilters(f => ({ ...f, [c.key]: vals }))} align={c.left ? 'left' : 'right'} />
                            : c.filter === 'num'
                              ? <NumColFilter value={numFilters[c.key] ?? { min: '', max: '' }} onChange={v => setNumFilters(f => ({ ...f, [c.key]: v }))} />
                              : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : hasFilters ? 'No matching numbers' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {pagedRows.map((r: any, i: number) => (
                    <tr key={(safePage - 1) * PAGE_SIZE + i}>
                      {COLS.map(c => <BodyCell key={c.key} col={c} r={r} onExpand={setExpandRow} />)}
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      {COLS.map((c, idx) => {
                        const base: React.CSSProperties = { padding: '10px 10px', borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 };
                        if (idx === 0) {
                          return <td key={c.key} style={{ ...base, fontWeight: 700, color: 'var(--ink)', textAlign: 'left' }}>Total ({rows.length.toLocaleString()} numbers)</td>;
                        }
                        if (c.type === 'text') return <td key={c.key} style={base} />;
                        let content: React.ReactNode = '';
                        let color = 'var(--ink)';
                        if (c.key === 'attempts') content = fmtInt(totals.attempts);
                        else if (c.key === 'conn') { content = fmtInt(totals.conn); color = 'var(--pos)'; }
                        else if (c.key === 'mins') content = fmtDec(totals.mins);
                        else if (c.key === 'acd') content = fmtDec(totals.acd);
                        else if (c.key === 'n_tried_areas') content = fmtInt(totals.nTried);
                        return <td key={c.key} style={{ ...base, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color }}>{content}</td>;
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
          </div>

          {!loading && rows.length > 0 && (
            <div className="sdn-pag">
              <span className="sdn-tag">
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {rows.length.toLocaleString()} numbers
              </span>
              {totalPages > 1 && (
                <div className="sdn-pag-ctrls">
                  <button onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
                  <span className="sdn-pag-cur">{safePage} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}>›</button>
                  <button onClick={() => setPage(totalPages)} disabled={safePage >= totalPages}>»</button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Tried DST areas — full list for one SRC number */}
      {expandRow && (
        <div onClick={() => setExpandRow(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.5)', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} className="sdn"
            style={{ maxHeight: '80vh', width: '100%', maxWidth: 560, overflow: 'auto', background: 'var(--sf)', border: '1px solid var(--lns)', borderRadius: 10, padding: 18, boxShadow: '0 14px 40px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>Tried DST areas</div>
                <div style={{ fontSize: 12, color: 'var(--mu)', fontFamily: 'monospace', marginTop: 2 }}>SRC {expandRow.number}</div>
              </div>
              <button type="button" onClick={() => setExpandRow(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mu)', fontSize: 18, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {String(expandRow.tried_dst_areas ?? '').split(',').map((s: string) => s.trim()).filter(Boolean).map((c: string, i: number) => (
                <span key={i} style={{ fontSize: 11.5, color: 'var(--inks)', background: 'var(--sf2)', border: '1px solid var(--ln)', borderRadius: 6, padding: '3px 8px' }}>{c}</span>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--mu)' }}>
              {String(expandRow.tried_dst_areas ?? '').split(',').filter((s: string) => s.trim()).length} areas
            </div>
          </div>
        </div>
      )}
    </>
  );
}
