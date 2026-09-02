'use client';

import * as React from 'react';
import { voiceLiveTrafficApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const PAGE_SIZE = 50;

const CSS = `
.vlt{
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
.dark .vlt{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}
.vlt-pnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln)}
.vlt-ph{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;border-bottom:1px solid var(--ln);flex-wrap:wrap;gap:10px}
.vlt-ph h2{font-weight:700;font-size:13px;color:var(--ink)}
.vlt-tag{font-size:11px;color:var(--mu);font-weight:600}
.vlt-di{appearance:none;font-size:13px;color:var(--ink);background:var(--sf2);border:1px solid var(--lns);border-radius:7px;padding:7px 10px;color-scheme:light}
.dark .vlt-di{color-scheme:dark}
.vlt-di:focus{outline:none;border-color:var(--turquoise)}
.asr-pill{display:inline-flex;align-items:center;border-radius:20px;padding:1px 8px;font-size:11.5px;font-weight:700;font-family:monospace}
.vlt-alert{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:8px;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);margin-bottom:16px}
.vlt-alert p{font-size:13.5px;color:#e74c3c;font-weight:600}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:shimmer 1.4s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:.55}50%{opacity:1}}
.zdcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zdcard .dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zdcard .dval{font-family:monospace;font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin-top:1px}
.zpulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zpls 2.4s infinite}
@keyframes zpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}
.win-pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:11.5px;font-weight:700;background:rgba(26,188,156,.12);color:var(--green-sea);border:1px solid rgba(26,188,156,.3)}
.dark .win-pill{color:var(--emerald)}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}
/* Per-column filter popovers */
.vlt-fil{position:relative;width:100%}
.vlt-fil-btn{display:flex;align-items:center;justify-content:space-between;gap:4px;width:100%;cursor:pointer;text-align:left;padding:5px 8px;font-size:11px;line-height:1.3}
.vlt-fil-btn .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--mu)}
.vlt-fil-btn.on{border-color:var(--turquoise)}
.vlt-fil-btn.on .lbl{color:var(--turquoise);font-weight:600}
.vlt-fil-btn .caret{color:var(--mu);flex-shrink:0;font-size:8px}
.vlt-pop{position:absolute;top:calc(100% + 4px);z-index:60;background:var(--sf);border:1px solid var(--lns);border-radius:8px;box-shadow:0 12px 34px rgba(0,0,0,.28);overflow:hidden}
.vlt-pop-search{padding:8px;border-bottom:1px solid var(--ln)}
.vlt-pop-search .vlt-di{width:100%}
.vlt-pop-list{max-height:240px;overflow-y:auto;padding:4px}
.vlt-pop-opt{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:6px 10px;font-size:12px;color:var(--ink);background:none;border:none;border-radius:6px;cursor:pointer}
.vlt-pop-opt:hover{background:var(--sf2)}
.vlt-pop-opt .val{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vlt-chk{width:14px;height:14px;flex-shrink:0;border:1px solid var(--lns);border-radius:3px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;color:#fff;line-height:1}
.vlt-chk.on{background:var(--turquoise);border-color:var(--turquoise)}
.vlt-pop-empty{padding:12px;font-size:12px;color:var(--mu);text-align:center}
.vlt-pop-foot{padding:8px;border-top:1px solid var(--ln)}
.vlt-pop-foot button{font-size:11px;color:var(--mu);background:none;border:none;cursor:pointer}
.vlt-pop-lbl{display:block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);margin-bottom:3px}
/* Pagination */
.vlt-pag{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;border-top:1px solid var(--ln);flex-shrink:0;flex-wrap:wrap}
.vlt-pag-ctrls{display:flex;align-items:center;gap:4px}
.vlt-pag-ctrls button{min-width:28px;height:28px;padding:0 6px;border-radius:6px;border:1px solid var(--lns);background:var(--sf2);color:var(--ink);cursor:pointer;font-size:13px}
.vlt-pag-ctrls button:disabled{opacity:.35;cursor:not-allowed}
.vlt-pag-ctrls button:not(:disabled):hover{border-color:var(--turquoise)}
.vlt-pag-cur{padding:0 10px;font-size:12px;font-weight:700;color:var(--ink)}
/* Info popover */
.vlt-info{position:relative;display:inline-flex}
.vlt-info-btn{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--lns);background:var(--sf2);color:var(--mu);cursor:pointer;font-size:11px;font-weight:700;font-style:italic;line-height:1;padding:0;font-family:Georgia,serif}
.vlt-info-btn:hover{border-color:var(--turquoise);color:var(--turquoise)}
.vlt-info-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:70;width:340px;max-width:86vw;background:var(--sf);border:1px solid var(--lns);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.3);padding:14px 16px;font-weight:400}
.vlt-info-pop h4{font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:6px}
.vlt-info-pop p{font-size:12px;line-height:1.55;color:var(--inks);margin-bottom:7px}
.vlt-info-pop p:last-child{margin-bottom:0}
.vlt-info-pop b{color:var(--ink);font-weight:700}
.vlt-info-pop .mono{font-family:monospace;font-size:11.5px;background:var(--sf2);border:1px solid var(--ln);border-radius:5px;padding:3px 7px;display:inline-block;color:var(--turquoise)}
`;

const IC = {
  alert: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  radio: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" /></svg>,
};

type SortDir = 'asc' | 'desc';
interface SortState { key: string | null; dir: SortDir; set: (k: string) => void }
type NumRange = { min: string; max: string };

// Zero-looking values: a real non-zero that would display as "0"/"-0" is revealed with
// enough decimals to act on (e.g. -0.4, -0.004); an exact zero never shows a minus sign.
const zz = (v: number, s: string): string => {
  if (/[1-9]/.test(s)) return s;
  if (v !== 0 && Number.isFinite(v)) return s.replace(/-?[\d.,]+/, v.toLocaleString('en-US', { maximumSignificantDigits: 2 }));
  return s.includes('-') ? s.replace('-', '') : s;
};
const fmtInt = (n: any): string => { if (n == null) return '—'; const v = Number(n); return zz(v, v.toLocaleString('en-US')); };
const fmtDec = (n: any): string => { if (n == null) return '—'; const v = Number(n); return zz(v, v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
const fmtPct = (n: any): string => { if (n == null) return '—'; const v = Number(n); return zz(v, `${v.toFixed(2)}%`); };

// ASR (Answer-Seizure Ratio) health colours — higher is healthier.
function asrColours(pct: number | null): [string, string] {
  if (pct == null) return ['transparent', 'var(--mu)'];
  if (pct >= 50) return ['rgba(46,204,113,.18)', '#27ae60'];
  if (pct >= 30) return ['rgba(241,196,15,.18)', '#d4ac0d'];
  if (pct >= 15) return ['rgba(230,126,34,.18)', '#e67e22'];
  return ['rgba(231,76,60,.18)', '#e74c3c'];
}

// Close a popover on outside click.
function useOutsideClose(open: boolean, ref: React.RefObject<HTMLDivElement>, close: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, ref, close]);
}

// Account values are built as "client / account". Show just the account (second)
// part in the filter so long combined names don't overflow the dropdown — the
// full value is still what's stored, selected against and matched.
const accountShort = (v: string): string => {
  const i = v.indexOf(' / ');
  return i >= 0 ? v.slice(i + 3) : v;
};

// Text column filter — multi-select of the column's values (with search), same
// behaviour as the Datasets viewer's per-column filter. `formatLabel` optionally
// shortens the displayed option text; the underlying value is unchanged.
function TextColFilter({ colKey, allRows, selected, onChange, align, formatLabel }: {
  colKey: string; allRows: any[]; selected: string[]; onChange: (vals: string[]) => void; align: 'left' | 'right'; formatLabel?: (v: string) => string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));

  const values = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) { const v = r[colKey]; if (v != null && v !== '') set.add(String(v)); }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allRows, colKey]);
  // Pin selected values to the top so the current selection is visible the
  // moment the dropdown reopens, instead of being buried alphabetically in a
  // long list (which forced a search to find it). `values` is already
  // alphabetical and Array.sort is stable, so order within each group is kept.
  const selSet = new Set(selected);
  const filtered = values
    .filter(v => v.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(selSet.has(b)) - Number(selSet.has(a)));
  const has = selected.length > 0;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div ref={wrapRef} className="vlt-fil">
      <button type="button" className={`vlt-di vlt-fil-btn${has ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{has ? `${selected.length} selected` : 'Filter…'}</span>
        <span className="caret">▼</span>
      </button>
      {open && (
        <div className="vlt-pop" style={{ width: 240, [align]: 0 }}>
          <div className="vlt-pop-search">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search values…" className="vlt-di" />
          </div>
          <div className="vlt-pop-list">
            {filtered.length === 0 && <div className="vlt-pop-empty">No values</div>}
            {filtered.map(v => (
              <button key={v} type="button" className="vlt-pop-opt" onClick={() => toggle(v)} title={v}>
                <span className={`vlt-chk${selected.includes(v) ? ' on' : ''}`}>{selected.includes(v) ? '✓' : ''}</span>
                <span className="val">{formatLabel ? formatLabel(v) : v}</span>
              </button>
            ))}
          </div>
          {has && <div className="vlt-pop-foot"><button type="button" onClick={() => { onChange([]); setQ(''); }}>Clear selection</button></div>}
        </div>
      )}
    </div>
  );
}

// Numeric column filter — min/max range, same as the Datasets viewer.
function NumColFilter({ value, onChange }: { value: NumRange; onChange: (v: NumRange) => void }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, wrapRef, () => setOpen(false));
  const has = value.min !== '' || value.max !== '';
  const label = has ? [value.min && `≥ ${value.min}`, value.max && `≤ ${value.max}`].filter(Boolean).join('  ') : 'Filter…';

  return (
    <div ref={wrapRef} className="vlt-fil">
      <button type="button" className={`vlt-di vlt-fil-btn${has ? ' on' : ''}`} onClick={() => setOpen(o => !o)}>
        <span className="lbl">{label}</span>
        <span className="caret">▼</span>
      </button>
      {open && (
        <div className="vlt-pop" style={{ right: 0, width: 170, padding: 10 }}>
          <label className="vlt-pop-lbl">Min</label>
          <input type="number" className="vlt-di" style={{ width: '100%' }} placeholder="No minimum" value={value.min} onChange={e => onChange({ ...value, min: e.target.value })} />
          <label className="vlt-pop-lbl" style={{ marginTop: 8 }}>Max</label>
          <input type="number" className="vlt-di" style={{ width: '100%' }} placeholder="No maximum" value={value.max} onChange={e => onChange({ ...value, max: e.target.value })} />
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

// Text cells wrap so long account / destination / vendor names are fully visible.
const wrapCell = (maxW: number): React.CSSProperties => ({ whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: maxW });

// Click-to-open info popover (explains the T-1 / T-2 comparison columns).
function InfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  return (
    <div ref={ref} className="vlt-info">
      <button type="button" className="vlt-info-btn" onClick={() => setOpen(o => !o)} aria-label="What do these columns mean?" title="What do these columns mean?">i</button>
      {open && <div className="vlt-info-pop">{children}</div>}
    </div>
  );
}

// Column layout — drives the header, filter row, body and footer so they stay
// aligned. History columns (hist:true) show the two prior refreshes: T-1 = the
// previous refresh, T-2 = two refreshes ago (raw values from the history table).
type Col = { key: string; label: string; type: 'text' | 'num'; w: number; left: boolean; hist?: boolean };
const COLS: Col[] = [
  { key: 'account', label: 'Account', type: 'text', w: 210, left: true },
  { key: 'destination', label: 'Destination', type: 'text', w: 150, left: true },
  { key: 'vendor', label: 'Vendor', type: 'text', w: 150, left: true },
  { key: 'attempts', label: 'Attempts', type: 'num', w: 85, left: false },
  { key: 'acd', label: 'ACD', type: 'num', w: 70, left: false },
  { key: 'acd_t1', label: 'ACD (T-1)', type: 'num', w: 82, left: false, hist: true },
  { key: 'acd_t2', label: 'ACD (T-2)', type: 'num', w: 82, left: false, hist: true },
  { key: 'asr', label: 'ASR', type: 'num', w: 80, left: false },
  { key: 'asr_t1', label: 'ASR (T-1)', type: 'num', w: 88, left: false, hist: true },
  { key: 'asr_t2', label: 'ASR (T-2)', type: 'num', w: 88, left: false, hist: true },
  { key: 'failed_calls', label: 'Failed Calls', type: 'num', w: 95, left: false },
  { key: 'failed_calls_t1', label: 'Failed (T-1)', type: 'num', w: 88, left: false, hist: true },
  { key: 'failed_calls_t2', label: 'Failed (T-2)', type: 'num', w: 88, left: false, hist: true },
  { key: 'volume', label: 'Volume', type: 'num', w: 90, left: false },
  { key: 'answered_calls', label: 'Answered Calls', type: 'num', w: 105, left: false },
];
const NUM_COLS = COLS.filter(c => c.type === 'num');

// Renders one body cell for a column — keeps the body aligned with the header.
function BodyCell({ col, r }: { col: Col; r: any }) {
  if (col.type === 'text') {
    return <TD left style={{ ...wrapCell(col.w), color: 'var(--inks)' }}>{col.key === 'account' ? r.account : (r[col.key] ?? '—')}</TD>;
  }
  // ASR (current + T-1 + T-2) → coloured health pill
  if (col.key === 'asr' || col.key === 'asr_t1' || col.key === 'asr_t2') {
    const v = r[col.key];
    const [bg, color] = asrColours(v ?? null);
    return (
      <TD>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {v == null ? <span style={{ color: 'var(--mu)' }}>—</span>
            : <span className="asr-pill" style={{ background: bg, color, opacity: col.hist ? 0.72 : 1 }}>{fmtPct(v)}</span>}
        </div>
      </TD>
    );
  }
  const decimals = col.key === 'volume' || col.key.startsWith('acd');
  const val = decimals ? fmtDec(r[col.key]) : fmtInt(r[col.key]);
  const color = col.hist ? 'var(--mu)'
    : col.key === 'failed_calls' ? (r.failed_calls > 0 ? 'var(--neg)' : 'var(--inks)')
    : col.key === 'answered_calls' ? 'var(--pos)'
    : 'var(--inks)';
  return <TD style={{ fontFamily: 'monospace', color, fontWeight: col.key === 'answered_calls' ? 600 : 400 }}>{val}</TD>;
}

function Skel() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[...Array(8)].map((_, i) => <div key={i} className="zskel" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  );
}

export default function VoiceLiveTrafficPage() {
  const [data, setData] = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [sort, setSort] = React.useState<{ key: string | null; dir: SortDir }>({ key: null, dir: 'desc' });
  // Per-column filters (same system as the Datasets viewer): text = selected values, numeric = min/max.
  const [textFilters, setTextFilters] = React.useState<Record<string, string[]>>({});
  const [numFilters, setNumFilters] = React.useState<Record<string, NumRange>>({});

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
    voiceLiveTrafficApi.getData()
      // Responses are snake_cased by the backend interceptor, so read snake keys
      // (with a camelCase fallback in case that ever changes).
      .then(r => { setData(r.data); setDatasetId(r.data?.dataset_id ?? r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  // Re-fetch when the tab/window regains focus, so a window change made in
  // Admin → Datasets (or a refresh elsewhere) is reflected here immediately.
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', load);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  // Reset to the first page whenever the visible set changes.
  React.useEffect(() => { setPage(1); }, [textFilters, numFilters, sort]);

  const hasFilters =
    Object.values(textFilters).some(v => v && v.length > 0) ||
    Object.values(numFilters).some(v => v && (v.min !== '' || v.max !== ''));

  const clearFilters = () => { setTextFilters({}); setNumFilters({}); };

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let filtered: any[] = data.rows;

    for (const c of COLS) {
      if (c.type === 'text') {
        const sel = textFilters[c.key];
        if (sel && sel.length) filtered = filtered.filter((r: any) => sel.includes(String(r[c.key] ?? '')));
      } else {
        const nf = numFilters[c.key];
        if (nf) {
          if (nf.min !== '') { const mn = Number(nf.min); if (!isNaN(mn)) filtered = filtered.filter((r: any) => r[c.key] != null && Number(r[c.key]) >= mn); }
          if (nf.max !== '') { const mx = Number(nf.max); if (!isNaN(mx)) filtered = filtered.filter((r: any) => r[c.key] != null && Number(r[c.key]) <= mx); }
        }
      }
    }

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
  }, [data, textFilters, numFilters, sort]);

  const lastRefreshed: string | null = data?.last_refreshed ?? data?.lastRefreshed ?? null;
  const windowMinutes: number = data?.window_minutes ?? data?.windowMinutes ?? 10;
  const srt: SortState = { key: sort.key, dir: sort.dir, set: handleSort };

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, rows.length);

  // Totals across the full filtered set (not just the visible page). All ratio
  // metrics are call-weighted, consistent with the per-row definitions:
  //   ASR = Σanswered / Σattempts × 100   ·   ACD = Σvolume / Σanswered   ·   Failed = Σfailed
  // T-1/T-2 use the underlying counts fetched from history (attempts_t*, etc.).
  const totals = React.useMemo(() => {
    let attempts = 0, answered = 0, failed = 0, volume = 0;
    let attemptsT1 = 0, answeredT1 = 0, failedT1 = 0, volumeT1 = 0, hasT1 = false;
    let attemptsT2 = 0, answeredT2 = 0, failedT2 = 0, volumeT2 = 0, hasT2 = false;
    for (const r of rows) {
      attempts += r.attempts ?? 0;
      answered += r.answered_calls ?? 0;
      failed   += r.failed_calls ?? 0;
      volume   += r.volume ?? 0;
      if (r.attempts_t1 != null) {
        hasT1 = true;
        attemptsT1 += r.attempts_t1 ?? 0;
        answeredT1 += r.answered_calls_t1 ?? 0;
        failedT1   += r.failed_calls_t1 ?? 0;
        volumeT1   += r.volume_t1 ?? 0;
      }
      if (r.attempts_t2 != null) {
        hasT2 = true;
        attemptsT2 += r.attempts_t2 ?? 0;
        answeredT2 += r.answered_calls_t2 ?? 0;
        failedT2   += r.failed_calls_t2 ?? 0;
        volumeT2   += r.volume_t2 ?? 0;
      }
    }
    return {
      attempts, answered, failed, volume,
      asr: attempts > 0 ? (answered / attempts) * 100 : null,
      acd: answered > 0 ? volume / answered : null,
      asr_t1: hasT1 && attemptsT1 > 0 ? (answeredT1 / attemptsT1) * 100 : null,
      acd_t1: hasT1 && answeredT1 > 0 ? volumeT1 / answeredT1 : null,
      failed_t1: hasT1 ? failedT1 : null,
      asr_t2: hasT2 && attemptsT2 > 0 ? (answeredT2 / attemptsT2) * 100 : null,
      acd_t2: hasT2 && answeredT2 > 0 ? volumeT2 / answeredT2 : null,
      failed_t2: hasT2 ? failedT2 : null,
    };
  }, [rows]);

  const allRows: any[] = data?.rows ?? [];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vlt w-full" style={{ margin: '-24px', padding: '20px 24px 0', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexShrink: 0, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--turquoise)', marginBottom: 2 }}>Voice Monitoring</div>
            <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-.3px', color: 'var(--ink)', lineHeight: 1.1 }}>Voice Live Traffic Report</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="win-pill">{IC.radio} Window: last {windowMinutes} min</span>
            {lastRefreshed && (
              <div className="zdcard">
                <div className="dlbl">Last Updated</div>
                <div className="dval"><span className="zpulse" /><span>{new Date(lastRefreshed).toLocaleString()}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="vlt-alert" style={{ flexShrink: 0 }}>
            <span style={{ color: '#e74c3c', display: 'flex' }}>{IC.alert}</span>
            <p>Could not load data: {error}</p>
          </div>
        )}

        {/* Table panel */}
        <div className="vlt-pnl" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
          <div className="vlt-ph">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2>Live Traffic (paired ASR / ACD / volume)</h2>
                <InfoTip>
                  <h4>Comparison columns (T-1 / T-2)</h4>
                  <p>Next to the latest values, each route shows its <b>last 2 refreshes</b> so you can see the trend:</p>
                  <p><b>(T-1)</b> = the previous refresh&nbsp; ·&nbsp; <b>(T-2)</b> = two refreshes ago.<br />The plain <b>ACD / ASR / Failed Calls</b> columns are the <b>latest</b> refresh.</p>
                  <p>Alerts use the <b>Change</b> of a metric, calculated as:</p>
                  <p><span className="mono">Change = latest − average(last 2 refreshes)</span></p>
                  <p>A <b>negative</b> Change means the metric <b>dropped</b>; a <b>positive</b> Change means it <b>rose</b>.</p>
                </InfoTip>
              </div>
              <span className="vlt-tag" style={{ display: 'block', marginTop: 2 }}>
                {sort.key ? `Sorted by ${sort.key.replace(/_/g, ' ')} ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Click a column to sort'} · {rows.length} routes
              </span>
            </div>
            {hasFilters && (
              <button onClick={clearFilters} style={{ fontSize: 12, color: 'var(--mu)', background: 'none', border: '1px solid var(--lns)', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>
                Clear filters
              </button>
            )}
          </div>

          <div className="tbl-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--sf2)' }}>
            {loading ? <Skel /> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: '100%' }}>
                <thead>
                  <tr>
                    {COLS.map(c => (
                      <TH key={c.key} left={c.left} w={c.w} colKey={c.key} sort={srt}>{c.label}</TH>
                    ))}
                  </tr>
                  {/* Per-column filter row (same system as the Datasets viewer) */}
                  <tr>
                    {COLS.map(c => (
                      <th key={c.key} style={{ position: 'sticky', top: 33, background: 'var(--sf2)', zIndex: 1, padding: '4px 6px', borderBottom: '2px solid var(--lns)', width: c.w, minWidth: c.w }}>
                        {c.type === 'text'
                          ? <TextColFilter colKey={c.key} allRows={allRows} selected={textFilters[c.key] ?? []} onChange={vals => setTextFilters(f => ({ ...f, [c.key]: vals }))} align={c.left ? 'left' : 'right'} formatLabel={c.key === 'account' ? accountShort : undefined} />
                          : <NumColFilter value={numFilters[c.key] ?? { min: '', max: '' }} onChange={v => setNumFilters(f => ({ ...f, [c.key]: v }))} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--mu)', fontSize: 13 }}>
                        {error ? 'Load failed — see error above' : hasFilters ? 'No matching routes' : 'No data — refresh the dataset first'}
                      </td>
                    </tr>
                  )}
                  {pagedRows.map((r: any, i: number) => (
                    <tr key={(safePage - 1) * PAGE_SIZE + i}>
                      {COLS.map(c => <BodyCell key={c.key} col={c} r={r} />)}
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ padding: '10px 10px', fontWeight: 700, color: 'var(--ink)', borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 }}>
                        Total ({rows.length} routes)
                      </td>
                      {NUM_COLS.map(c => {
                        let content: React.ReactNode = '';
                        let color = 'var(--ink)';
                        if (c.key === 'attempts') content = fmtInt(totals.attempts);
                        else if (c.key === 'acd') content = fmtDec(totals.acd);
                        else if (c.key === 'acd_t1') { content = fmtDec(totals.acd_t1); color = 'var(--mu)'; }
                        else if (c.key === 'acd_t2') { content = fmtDec(totals.acd_t2); color = 'var(--mu)'; }
                        else if (c.key === 'asr') content = fmtPct(totals.asr);
                        else if (c.key === 'asr_t1') { content = fmtPct(totals.asr_t1); color = 'var(--mu)'; }
                        else if (c.key === 'asr_t2') { content = fmtPct(totals.asr_t2); color = 'var(--mu)'; }
                        else if (c.key === 'failed_calls') { content = fmtInt(totals.failed); color = totals.failed > 0 ? 'var(--neg)' : 'var(--ink)'; }
                        else if (c.key === 'failed_calls_t1') { content = fmtInt(totals.failed_t1); color = (totals.failed_t1 ?? 0) > 0 ? 'var(--neg)' : 'var(--mu)'; }
                        else if (c.key === 'failed_calls_t2') { content = fmtInt(totals.failed_t2); color = (totals.failed_t2 ?? 0) > 0 ? 'var(--neg)' : 'var(--mu)'; }
                        else if (c.key === 'volume') content = fmtDec(totals.volume);
                        else if (c.key === 'answered_calls') { content = fmtInt(totals.answered); color = 'var(--pos)'; }
                        return (
                          <td key={c.key} style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color, borderTop: '2px solid var(--lns)', background: 'var(--sf2)', position: 'sticky', bottom: 0 }}>{content}</td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>

          {/* Pagination */}
          {!loading && rows.length > 0 && (
            <div className="vlt-pag">
              <span className="vlt-tag">
                Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {rows.length.toLocaleString()} routes
              </span>
              {totalPages > 1 && (
                <div className="vlt-pag-ctrls">
                  <button onClick={() => setPage(1)} disabled={safePage === 1}>«</button>
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹</button>
                  <span className="vlt-pag-cur">{safePage} / {totalPages}</span>
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
