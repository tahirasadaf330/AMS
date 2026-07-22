'use client';

import * as React from 'react';
import { negativeMarginApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.edr{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --ok:#16a34a;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .edr{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
}
.edr-body{max-width:1600px;margin:0 auto;padding:22px 20px 48px}
.edr-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.edr-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.edr-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.edr-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:edr-blink 2s infinite}
@keyframes edr-blink{0%,100%{opacity:1}50%{opacity:.3}}
.edr-lu{text-align:right}
.edr-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.edr-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.edr-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:640px){.edr-cards{grid-template-columns:repeat(2,1fr)}}
.edr-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.edr-card-danger{border-color:var(--danger-bd);background:var(--danger-bg)}
.edr-card-num{font-size:1.55rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;color:var(--ink);margin-bottom:4px}
.edr-card-danger .edr-card-num{color:var(--danger)}
.edr-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.edr-alerts{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.edr-al-neg{font-size:.74rem;font-weight:600;padding:5px 12px;border-radius:6px;background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger)}
.edr-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.edr-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.edr-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:230px;color-scheme:light}
.dark .edr-inp{color-scheme:dark}
.edr-inp:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.edr-tbtn{height:33px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.78rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:border-color .12s}
.edr-tbtn:hover{border-color:#94a3b8}
.edr-tbtn.an{background:var(--danger-bg);border-color:var(--danger-bd);color:var(--danger);font-weight:700}
.edr-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}
/* Table — fixed layout so it always fits the sheet (no horizontal scroll); long text truncates */
.edr-tbl-wrap{border-radius:10px;border:1px solid var(--ln);background:var(--sf);overflow-x:auto}
.edr-tbl{width:100%;border-collapse:collapse;font-size:.79rem;table-layout:fixed}
.edr-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.edr-tbl th{padding:9px 10px;text-align:right;font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.edr-tbl th.l{text-align:left}
.edr-tbl th:hover{color:var(--ink)}
.edr-tbl th.active{color:#2563eb}
.edr-tbl td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.edr-tbl td.l{text-align:left}
.edr-tbl td.mono{font-family:'Courier New',monospace;font-size:.76rem}
.edr-tbl tbody tr:hover td{background:rgba(220,38,38,.03)}
.edr-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.rate-o{color:var(--ok);font-weight:600}
.rate-t{color:var(--inks);font-weight:600}
/* Negative margin value shown in red text (no background).
   Scoped to .edr-tbl td.nm-red so it outranks the default .edr-tbl td color. */
.edr-tbl td.nm-red{color:var(--danger);font-weight:700}
.edr-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

const fN    = (n: any) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
const fRate = (n: any) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—';

type SortDir = 'asc' | 'desc' | null;

// Column definitions — percentage widths sum to 100% so the table fits one sheet.
const COLS: { key: string; label: string; left?: boolean; w: string }[] = [
  { key: 'orig_account',       label: 'Orig Account',       left: true, w: '16%' },
  { key: 'orig_dst_code_name', label: 'Orig Dst Code Name', left: true, w: '16%' },
  { key: 'term_account',       label: 'Term Account',       left: true, w: '16%' },
  { key: 'term_dst_code_name', label: 'Term Dst Code Name', left: true, w: '16%' },
  { key: 'orig_rate',          label: 'Orig Rate',          w: '11%' },
  { key: 'term_rate',          label: 'Term Rate',          w: '11%' },
  { key: 'negative_margin',    label: 'Negative Margin',    w: '14%' },
];

export default function NegativeMarginPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [filterNeg, setFilterNeg] = React.useState(false);
  const [sort, setSort]           = React.useState<{ key: string | null; dir: SortDir }>({ key: 'negative_margin', dir: 'asc' });

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : s.dir === 'desc' ? null : 'asc') : 'desc',
    }));
  }, []);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    negativeMarginApi.getData()
      .then(r => { setData(r.data); setDatasetId(r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.orig_account ?? '').toLowerCase().includes(q) ||
        (r.term_account ?? '').toLowerCase().includes(q) ||
        (r.orig_dst_code_name ?? '').toLowerCase().includes(q) ||
        (r.term_dst_code_name ?? '').toLowerCase().includes(q));
    }
    if (filterNeg) f = f.filter((r: any) => (r.negative_margin ?? 0) < 0);
    if (!sort.key || !sort.dir) return f;
    const { key, dir } = sort;
    return [...f].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, search, filterNeg, sort]);

  // Derive summary numbers directly from the rows we already have, so the cards
  // always match the table (independent of the backend `summary` payload shape).
  const stats = React.useMemo(() => {
    const all: any[] = data?.rows ?? [];
    return {
      totalRows:           all.length,
      affectedAccounts:    new Set(all.map((r) => r.orig_account)).size,
      affectedVendors:     new Set(all.map((r) => r.term_account)).size,
      worstNegativeMargin: all.reduce((m: number, r: any) => (r.negative_margin != null && r.negative_margin < m ? r.negative_margin : m), 0),
    };
  }, [data]);

  const lastRefreshed: string | null = data?.lastRefreshed ?? null;
  const totalRows = stats.totalRows;
  const hasFilter = search || filterNeg;

  const Th = ({ col }: { col: typeof COLS[number] }) => {
    const active = sort.key === col.key;
    return (
      <th
        className={`${col.left ? 'l' : ''} ${active ? 'active' : ''}`}
        style={{ width: col.w }}
        onClick={() => onSort(col.key)}
      >
        {col.label}
        <span className="sa">{active ? (sort.dir === 'asc' ? '▲' : sort.dir === 'desc' ? '▼' : '⇅') : '⇅'}</span>
      </th>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="edr">
        <div className="edr-body">
          <div className="edr-hdr">
            <div>
              <div className="edr-title">Voice Negative Margin</div>
              <div className="edr-sub">
                <span className="edr-dot" />
                Jerasoft VCS · Today (since midnight UTC) · term rate &gt; orig rate per route
              </div>
            </div>
            {lastRefreshed && (
              <div className="edr-lu">
                <span className="edr-lu-lbl">Last Updated</span>
                <span className="edr-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="edr-err">Could not load data: {error}</div>}

          <div className="edr-cards">
            <div className="edr-card edr-card-danger"><div className="edr-card-num">{fN(stats.totalRows)}</div><div className="edr-card-lbl">Negative Margin</div></div>
            <div className="edr-card"><div className="edr-card-num">{fN(stats.affectedAccounts)}</div><div className="edr-card-lbl">Orig Accounts</div></div>
            <div className="edr-card"><div className="edr-card-num">{fN(stats.affectedVendors)}</div><div className="edr-card-lbl">Term Account</div></div>
            <div className="edr-card edr-card-danger"><div className="edr-card-num">{fRate(stats.worstNegativeMargin)}</div><div className="edr-card-lbl">Worst Margin (Orig − Term)</div></div>
          </div>

          {!loading && totalRows > 0 && (
            <div className="edr-alerts">
              <span className="edr-al-neg">{fN(totalRows)} {totalRows === 1 ? 'route' : 'routes'} with negative margin</span>
            </div>
          )}

          <div className="edr-filt">
            <input className="edr-inp" placeholder="Search account / destination…" value={search} onChange={e => setSearch(e.target.value)} />
            <button className={`edr-tbtn${filterNeg ? ' an' : ''}`} onClick={() => setFilterNeg(v => !v)}>Negative Margin</button>
            {hasFilter && <button className="edr-clr" onClick={() => { setSearch(''); setFilterNeg(false); }}>Clear filters</button>}
          </div>

          <div className="edr-tbl-wrap">
            <table className="edr-tbl">
              <thead>
                <tr>{COLS.map(c => <Th key={c.key} col={c} />)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td className="edr-empty" colSpan={COLS.length}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td className="edr-empty" colSpan={COLS.length}>{error ? 'Load failed — see error above' : hasFilter ? 'No matching routes' : 'No data — refresh the dataset first'}</td></tr>
                )}
                {!loading && rows.map((r: any, i: number) => (
                  <tr key={`${r.orig_account}|${r.orig_dst_code_name}|${r.term_account}|${r.term_dst_code_name}|${i}`}>
                    <td className="l" style={{ fontWeight: 600 }} title={r.orig_account ?? ''}>{r.orig_account ?? '—'}</td>
                    <td className="l" title={r.orig_dst_code_name ?? ''}>{r.orig_dst_code_name ?? '—'}</td>
                    <td className="l" title={r.term_account ?? ''}>{r.term_account ?? '—'}</td>
                    <td className="l" title={r.term_dst_code_name ?? ''}>{r.term_dst_code_name ?? '—'}</td>
                    <td className="mono rate-o">{fRate(r.orig_rate)}</td>
                    <td className="mono rate-t">{fRate(r.term_rate)}</td>
                    <td className="mono nm-red">{fRate(r.negative_margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && rows.length > 0 && (
            <div className="edr-footer">{fN(rows.length)} of {fN(totalRows)} routes</div>
          )}
        </div>
      </div>
    </>
  );
}
