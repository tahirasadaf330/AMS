'use client';

import * as React from 'react';
import { costChangesApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.ccr{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --ok:#16a34a;--accent:#2563eb;--accent-bg:rgba(37,99,235,.08);--accent-bd:rgba(37,99,235,.3);
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .ccr{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
  --accent-bg:rgba(37,99,235,.15);--accent-bd:rgba(37,99,235,.4);
}
.ccr-body{max-width:1500px;margin:0 auto;padding:22px 20px 48px}
.ccr-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.ccr-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.ccr-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.ccr-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:ccr-blink 2s infinite}
@keyframes ccr-blink{0%,100%{opacity:1}50%{opacity:.3}}
.ccr-lu{text-align:right}
.ccr-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.ccr-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ink)}
.ccr-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:14px}
@media(max-width:900px){.ccr-cards{grid-template-columns:repeat(2,1fr)}}
.ccr-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.ccr-card-accent{border-color:var(--accent-bd);background:var(--accent-bg)}
.ccr-card-num{font-size:1.45rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;color:var(--ink);margin-bottom:4px}
.ccr-card-accent .ccr-card-num{color:var(--accent)}
.ccr-card-up .ccr-card-num{color:var(--danger)}
.ccr-card-down .ccr-card-num{color:var(--ok)}
.ccr-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.ccr-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.ccr-filt{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.ccr-ff{display:flex;flex-direction:column;gap:3px}
.ccr-ff label{font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu);font-weight:600}
.ccr-sel{height:33px;min-width:170px;max-width:230px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 8px;outline:none;color-scheme:light}
.dark .ccr-sel{color-scheme:dark}
.ccr-sel:focus{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.ccr-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}
.ccr-qb{height:33px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.76rem;cursor:pointer}
.ccr-qb:hover{border-color:#2563eb;color:#2563eb}
.ccr-qb.active{border-color:#2563eb;color:#2563eb;font-weight:700;background:var(--accent-bg)}
.ccr-qbs{display:flex;align-items:flex-end;gap:6px}
.ccr-tbl-wrap{overflow:auto;max-height:calc(100vh - 320px);min-height:260px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.ccr-tbl{width:100%;border-collapse:collapse;font-size:.79rem;table-layout:fixed}
.ccr-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.ccr-tbl th{padding:9px 10px;text-align:right;font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccr-tbl th.l{text-align:left}
.ccr-tbl th:hover{color:var(--ink)}
.ccr-tbl th.active{color:#2563eb}
.ccr-tbl td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ccr-tbl td.l{text-align:left}
.ccr-tbl td.mono{font-family:'Courier New',monospace;font-size:.76rem}
.ccr-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.ccr-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.ccr-tbl td.rate-up{color:var(--danger);font-weight:600}
.ccr-tbl td.rate-down{color:var(--ok);font-weight:600}
.ccr-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

const fN    = (n: any) => n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
const fRate = (n: any) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 }) : '—';

type SortDir = 'asc' | 'desc' | null;

// Column widths sum to 100% so the table fits without horizontal scroll.
const COLS: { key: string; label: string; left?: boolean; w: string }[] = [
  { key: 'date',             label: 'Date',             left: true, w: '10%' },
  { key: 'supplier_account', label: 'Supplier Account', left: true, w: '21%' },
  { key: 'country',          label: 'Country',          left: true, w: '15%' },
  { key: 'network',          label: 'Network',          left: true, w: '19%' },
  { key: 'currency',         label: 'Currency',         w: '9%'  },
  { key: 'old_rate',         label: 'Old Rate',         w: '13%' },
  { key: 'new_rate',         label: 'New Rate',         w: '13%' },
];

const fMonth = (m: string) =>
  new Date(m + '-01T00:00:00Z').toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Quick ranges (calendar days including today): Last 24h ≈ yesterday + today.
const QUICK_RANGES = [
  { key: '24h', label: 'Last 24h',  days: 2 },
  { key: '7d',  label: 'Last 7 D',  days: 7 },
  { key: '30d', label: 'Last 30 D', days: 30 },
] as const;
type QuickRange = typeof QUICK_RANGES[number]['key'] | '';

const EMPTY_FILTERS = { supplier: '', country: '', network: '', currency: '' };

export default function CostChangesPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [filters, setFilters]     = React.useState(EMPTY_FILTERS);
  const [month, setMonth]         = React.useState(''); // '' = server default (current month)
  const [range, setRange]         = React.useState<QuickRange>(''); // quick range wins over month
  const [sort, setSort]           = React.useState<{ key: string | null; dir: SortDir }>({ key: 'date', dir: 'desc' });

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({
      key,
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : s.dir === 'desc' ? null : 'asc') : 'desc',
    }));
  }, []);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    const rangeDef = QUICK_RANGES.find((q) => q.key === range);
    costChangesApi.getData(rangeDef ? { days: rangeDef.days } : month ? { month } : undefined)
      .then(r => { setData(r.data); setDatasetId(r.data?.datasetId ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [month, range]);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId, load);

  // Distinct dropdown options always come from ALL rows, so picking one filter
  // never empties the other dropdowns' choices.
  const options = React.useMemo(() => {
    const all: any[] = data?.rows ?? [];
    const distinct = (key: string) =>
      Array.from(new Set(all.map((r) => r[key]).filter((v) => v != null && v !== ''))).sort((a, b) =>
        String(a).localeCompare(String(b)));
    return {
      supplier: distinct('supplier_account'),
      country:  distinct('country'),
      network:  distinct('network'),
      currency: distinct('currency'),
    };
  }, [data]);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows;
    if (filters.supplier) f = f.filter((r: any) => r.supplier_account === filters.supplier);
    if (filters.country)  f = f.filter((r: any) => r.country === filters.country);
    if (filters.network)  f = f.filter((r: any) => r.network === filters.network);
    if (filters.currency) f = f.filter((r: any) => r.currency === filters.currency);
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
  }, [data, filters, sort]);

  // Cards derive from all rows so they always match the table's source data.
  const stats = React.useMemo(() => {
    const all: any[] = data?.rows ?? [];
    return {
      changes:   all.length,
      suppliers: new Set(all.map((r) => r.supplier_account)).size,
      countries: new Set(all.map((r) => r.country)).size,
      increases: all.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate > r.old_rate).length,
      decreases: all.filter((r) => r.old_rate != null && r.new_rate != null && r.new_rate < r.old_rate).length,
    };
  }, [data]);

  const lastRefreshed: string | null = data?.lastRefreshed ?? null;
  const hasFilter = Object.values(filters).some(Boolean);

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

  const FILTER_DEFS = [
    { key: 'supplier' as const, label: 'Supplier Account', opts: options.supplier },
    { key: 'country'  as const, label: 'Country',          opts: options.country },
    { key: 'network'  as const, label: 'Network',          opts: options.network },
    { key: 'currency' as const, label: 'Currency',         opts: options.currency },
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="ccr">
        <div className="ccr-body">
          <div className="ccr-hdr">
            <div>
              <div className="ccr-title">Cost Changes Report</div>
              <div className="ccr-sub">
                <span className="ccr-dot" />
                ASMSC · daily rate-change history · latest supplier rate per day vs the previous day
              </div>
            </div>
            {lastRefreshed && (
              <div className="ccr-lu">
                <span className="ccr-lu-lbl">Last Updated</span>
                <span className="ccr-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="ccr-err">Could not load data: {error}</div>}

          <div className="ccr-cards">
            <div className="ccr-card ccr-card-accent"><div className="ccr-card-num">{fN(stats.changes)}</div><div className="ccr-card-lbl">Rate Changes</div></div>
            <div className="ccr-card"><div className="ccr-card-num">{fN(stats.suppliers)}</div><div className="ccr-card-lbl">Suppliers</div></div>
            <div className="ccr-card"><div className="ccr-card-num">{fN(stats.countries)}</div><div className="ccr-card-lbl">Countries</div></div>
            <div className="ccr-card ccr-card-up"><div className="ccr-card-num">{fN(stats.increases)}</div><div className="ccr-card-lbl">Increases</div></div>
            <div className="ccr-card ccr-card-down"><div className="ccr-card-num">{fN(stats.decreases)}</div><div className="ccr-card-lbl">Decreases</div></div>
          </div>

          <div className="ccr-filt">
            <div className="ccr-qbs">
              {QUICK_RANGES.map((q) => (
                <button
                  key={q.key}
                  className={`ccr-qb ${range === q.key ? 'active' : ''}`}
                  onClick={() => { setRange(q.key); setMonth(''); }}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="ccr-ff">
              <label>Month</label>
              <select
                className="ccr-sel"
                value={range ? '' : (month || data?.month || '')}
                onChange={(e) => { setMonth(e.target.value); setRange(''); }}
              >
                {range && <option value="">—</option>}
                {(data?.months ?? []).map((m: string) => <option key={m} value={m}>{fMonth(m)}</option>)}
              </select>
            </div>
            {FILTER_DEFS.map((f) => (
              <div className="ccr-ff" key={f.key}>
                <label>{f.label}</label>
                <select
                  className="ccr-sel"
                  value={filters[f.key]}
                  onChange={(e) => setFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}
                >
                  <option value="">All</option>
                  {f.opts.map((o: any) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            {hasFilter && <button className="ccr-clr" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
          </div>

          <div className="ccr-tbl-wrap">
            <table className="ccr-tbl">
              <thead>
                <tr>{COLS.map(c => <Th key={c.key} col={c} />)}</tr>
              </thead>
              <tbody>
                {loading && <tr><td className="ccr-empty" colSpan={COLS.length}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td className="ccr-empty" colSpan={COLS.length}>{error ? 'Load failed — see error above' : hasFilter ? 'No matching rate changes' : `No rate changes in ${range ? QUICK_RANGES.find((q) => q.key === range)?.label.toLowerCase() : data?.month ? fMonth(data.month) : 'this month'}`}</td></tr>
                )}
                {!loading && rows.map((r: any, i: number) => {
                  const up = r.old_rate != null && r.new_rate != null && r.new_rate > r.old_rate;
                  const down = r.old_rate != null && r.new_rate != null && r.new_rate < r.old_rate;
                  return (
                    <tr key={`${r.date}|${r.supplier_account}|${r.network}|${i}`}>
                      <td className="l mono">{r.date ?? '—'}</td>
                      <td className="l" style={{ fontWeight: 600 }} title={r.supplier_account ?? ''}>{r.supplier_account ?? '—'}</td>
                      <td className="l" title={r.country ?? ''}>{r.country ?? '—'}</td>
                      <td className="l" title={r.network ?? ''}>{r.network ?? '—'}</td>
                      <td className="mono">{r.currency ?? '—'}</td>
                      <td className="mono">{fRate(r.old_rate)}</td>
                      <td className={`mono ${up ? 'rate-up' : down ? 'rate-down' : ''}`}>{fRate(r.new_rate)}{up ? ' ▲' : down ? ' ▼' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && rows.length > 0 && (
            <div className="ccr-footer">{fN(rows.length)} of {fN(stats.changes)} rate changes</div>
          )}
        </div>
      </div>
    </>
  );
}
