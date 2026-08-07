'use client';

import * as React from 'react';
import { specialRoutesApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.srm{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --ok:#16a34a;--accent:#2563eb;--accent-bg:rgba(37,99,235,.08);--accent-bd:rgba(37,99,235,.3);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .srm{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
  --accent-bg:rgba(37,99,235,.15);--accent-bd:rgba(37,99,235,.4);
}
.srm-body{max-width:1500px;margin:0 auto;padding:22px 20px 48px}
.srm-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.srm-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.srm-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.srm-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:srm-blink 2s infinite}
@keyframes srm-blink{0%,100%{opacity:1}50%{opacity:.3}}
.srm-lu{text-align:right}
.srm-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.srm-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.srm-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
@media(max-width:900px){.srm-cards{grid-template-columns:repeat(2,1fr)}}
.srm-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.srm-card-accent{border-color:var(--accent-bd);background:var(--accent-bg)}
.srm-card-num{font-size:1.45rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;color:var(--ink);margin-bottom:4px}
.srm-card-accent .srm-card-num{color:var(--accent)}
.srm-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.srm-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.srm-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.srm-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:250px;color-scheme:light}
.dark .srm-inp{color-scheme:dark}
.srm-inp:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.srm-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}
.srm-tbl-wrap{overflow:auto;max-height:calc(100vh - 300px);min-height:260px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.srm-tbl{width:100%;border-collapse:collapse;font-size:.79rem;table-layout:fixed}
.srm-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.srm-tbl th{padding:9px 10px;text-align:right;font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srm-tbl th.l{text-align:left}
.srm-tbl th:hover{color:var(--ink)}
.srm-tbl th.active{color:#2563eb}
.srm-tbl td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srm-tbl td.l{text-align:left}
.srm-tbl td.mono{font-family:'Courier New',monospace;font-size:.76rem}
.srm-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.srm-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.rate-t{color:var(--inks);font-weight:600}
.srm-tbl td.asr-good{color:var(--ok);font-weight:600}
.srm-tbl td.asr-bad{color:var(--danger);font-weight:600}
.srm-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

const fN    = (n: any) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
const fMin  = (n: any) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
const fRate = (n: any) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—';
const fPct  = (n: any) => n != null ? `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : '—';

type SortDir = 'asc' | 'desc' | null;

// Column widths sum to 100% so the table fits without horizontal scroll.
const COLS: { key: string; label: string; left?: boolean; w: string }[] = [
  { key: 'term_account',   label: 'Term Account',       left: true, w: '23%' },
  { key: 'orig_code_name', label: 'Orig Code Name',     left: true, w: '24%' },
  { key: 'term_rate',      label: 'Term Rate',          w: '11%' },
  { key: 'attempts',       label: 'Total Attempts',     w: '12%' },
  { key: 'success',        label: 'Total Success',      w: '11%' },
  { key: 'volume_min',     label: 'Total Volume (min)', w: '12%' },
  { key: 'asr',            label: 'ASR %',              w: '7%'  },
];

export default function SpecialRoutesMonitoringPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [sort, setSort]           = React.useState<{ key: string | null; dir: SortDir }>({ key: 'attempts', dir: 'desc' });

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : s.dir === 'desc' ? null : 'asc') : 'desc',
    }));
  }, []);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    specialRoutesApi.getData()
      .then(r => { setData(r.data); setDatasetId(r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  // Rows with the derived ASR% (success / attempts) so it sorts like any other column.
  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows.map((r: any) => ({
      ...r,
      asr: r.attempts > 0 ? Math.round((r.success / r.attempts) * 1000) / 10 : null,
    }));
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.orig_code_name ?? '').toLowerCase().includes(q) ||
        (r.term_account ?? '').toLowerCase().includes(q));
    }
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
  }, [data, search, sort]);

  // Cards derive from all rows so they always match the table's source data.
  const stats = React.useMemo(() => {
    const all: any[] = data?.rows ?? [];
    const attempts = all.reduce((s: number, r: any) => s + (r.attempts ?? 0), 0);
    const success  = all.reduce((s: number, r: any) => s + (r.success ?? 0), 0);
    const volume   = all.reduce((s: number, r: any) => s + (r.volume_min ?? 0), 0);
    return {
      routes:     all.length,
      suppliers:  new Set(all.map((r) => r.term_account)).size,
      attempts,
      success,
      volume,
      asr: attempts > 0 ? Math.round((success / attempts) * 1000) / 10 : 0,
    };
  }, [data]);

  const lastRefreshed: string | null = data?.lastRefreshed ?? null;
  const hasFilter = !!search;

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
      <div className="srm">
        <div className="srm-body">
          <div className="srm-hdr">
            <div>
              <div className="srm-title">Special Routes Monitoring</div>
              <div className="srm-sub">
                <span className="srm-dot" />
                Jerasoft VCS · Today (since midnight UTC) · per destination × supplier, incl. failed attempts
              </div>
            </div>
            {lastRefreshed && (
              <div className="srm-lu">
                <span className="srm-lu-lbl">Last Updated</span>
                <span className="srm-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="srm-err">Could not load data: {error}</div>}

          <div className="srm-cards">
            <div className="srm-card"><div className="srm-card-num">{fN(stats.routes)}</div><div className="srm-card-lbl">Routes</div></div>
            <div className="srm-card"><div className="srm-card-num">{fN(stats.suppliers)}</div><div className="srm-card-lbl">Suppliers</div></div>
            <div className="srm-card srm-card-accent"><div className="srm-card-num">{fN(stats.attempts)}</div><div className="srm-card-lbl">Total Attempts · ASR {fPct(stats.asr)}</div></div>
            <div className="srm-card"><div className="srm-card-num">{fN(stats.success)}</div><div className="srm-card-lbl">Total Success</div></div>
            <div className="srm-card"><div className="srm-card-num">{fMin(stats.volume)}</div><div className="srm-card-lbl">Total Volume (min)</div></div>
          </div>

          <div className="srm-filt">
            <input className="srm-inp" placeholder="Search destination / supplier…" value={search} onChange={e => setSearch(e.target.value)} />
            {hasFilter && <button className="srm-clr" onClick={() => setSearch('')}>Clear filters</button>}
          </div>

          <div className="srm-tbl-wrap">
            <table className="srm-tbl">
              <thead>
                <tr>{COLS.map(c => <Th key={c.key} col={c} />)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td className="srm-empty" colSpan={COLS.length}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td className="srm-empty" colSpan={COLS.length}>{error ? 'Load failed — see error above' : hasFilter ? 'No matching routes' : 'No data — refresh the dataset first'}</td></tr>
                )}
                {!loading && rows.map((r: any, i: number) => (
                  <tr key={`${r.term_account}|${r.orig_code_name}|${i}`}>
                    <td className="l" style={{ fontWeight: 600 }} title={r.term_account ?? ''}>{r.term_account ?? '—'}</td>
                    <td className="l" title={r.orig_code_name ?? ''}>{r.orig_code_name ?? '—'}</td>
                    <td className="mono rate-t">{fRate(r.term_rate)}</td>
                    <td className="mono">{fN(r.attempts)}</td>
                    <td className="mono">{fN(r.success)}</td>
                    <td className="mono">{fMin(r.volume_min)}</td>
                    <td className={`mono ${r.asr != null && r.asr >= 30 ? 'asr-good' : r.asr != null && r.asr < 10 ? 'asr-bad' : ''}`}>{fPct(r.asr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && rows.length > 0 && (
            <div className="srm-footer">{fN(rows.length)} of {fN(stats.routes)} routes</div>
          )}
        </div>
      </div>
    </>
  );
}
