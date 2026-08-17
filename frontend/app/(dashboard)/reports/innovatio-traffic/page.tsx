'use client';

import * as React from 'react';
import { innovatioTrafficApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.it{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --accent:#2563eb;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .it{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
}
.it-body{max-width:1100px;margin:0 auto;padding:22px 20px 48px}
.it-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.it-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
.it-sub{font-size:.74rem;color:var(--mu);margin-top:3px}
.it-lu{text-align:right}
.it-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.it-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.it-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:640px){.it-cards{grid-template-columns:repeat(2,1fr)}}
.it-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.it-card-num{font-size:1.55rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;margin-bottom:4px}
.it-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.it-err{background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.25);color:#dc2626;border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.it-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.it-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:260px}
.it-inp:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.it-tbl-wrap{overflow:auto;max-height:calc(100vh - 300px);min-height:260px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.it-tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.it-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.it-tbl th{padding:9px 12px;text-align:right;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap}
.it-tbl th.l{text-align:left}
.it-tbl th:hover{color:var(--ink)}
.it-tbl th.active{color:var(--accent)}
.it-tbl td{padding:8px 12px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.it-tbl td.l{text-align:left}
.it-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.it-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.it-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

const fN = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');

type SortDir = 'asc' | 'desc';
const COLS: { key: string; label: string; left?: boolean }[] = [
  { key: 'day',       label: 'Day',      left: true },
  { key: 'client',    label: 'Client',   left: true },
  { key: 'sender_id', label: 'SenderId', left: true },
  { key: 'volume',    label: 'Volume' },
];

export default function InnovatioTrafficPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [sort, setSort]           = React.useState<{ key: string; dir: SortDir }>({ key: 'volume', dir: 'desc' });

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  }, []);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    innovatioTrafficApi.getData()
      .then((r) => { setData(r.data); setDatasetId(r.data?.datasetId ?? r.data?.dataset_id ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId ?? undefined, load);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.client ?? '').toLowerCase().includes(q) ||
        (r.sender_id ?? '').toLowerCase().includes(q));
    }
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

  const s = data?.summary ?? {};
  const lastRefreshed: string | null = data?.lastRefreshed ?? data?.last_refreshed ?? null;
  const scope = data?.scope ?? {};

  const Th = ({ col }: { col: typeof COLS[number] }) => {
    const active = sort.key === col.key;
    return (
      <th className={`${col.left ? 'l' : ''} ${active ? 'active' : ''}`} onClick={() => onSort(col.key)}>
        {col.label}<span className="sa">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="it">
        <div className="it-body">
          <div className="it-hdr">
            <div>
              <div className="it-title">Innovatio Traffic Report</div>
              <div className="it-sub">
                aSMSC · supplier {scope.vendor ?? 'Innovatio'} · MCC/MNC {scope.mccmnc ?? '614004'} · whole of yesterday{s.day ? ` (${s.day})` : ''}
              </div>
            </div>
            {lastRefreshed && (
              <div className="it-lu">
                <span className="it-lu-lbl">Last Refreshed</span>
                <span className="it-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="it-err">Could not load data: {error}</div>}

          <div className="it-cards">
            <div className="it-card"><div className="it-card-num">{fN(s.totalVolume ?? s.total_volume ?? 0)}</div><div className="it-card-lbl">Total Volume</div></div>
            <div className="it-card"><div className="it-card-num">{fN(s.clients ?? 0)}</div><div className="it-card-lbl">Clients</div></div>
            <div className="it-card"><div className="it-card-num">{fN(s.senders ?? 0)}</div><div className="it-card-lbl">Sender IDs</div></div>
            <div className="it-card"><div className="it-card-num">{fN(s.rowsCount ?? s.rows_count ?? 0)}</div><div className="it-card-lbl">Rows</div></div>
          </div>

          <div className="it-filt">
            <input className="it-inp" placeholder="Search client / sender ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="it-tbl-wrap">
            <table className="it-tbl">
              <thead><tr>{COLS.map((c) => <Th key={c.key} col={c} />)}</tr></thead>
              <tbody>
                {loading && <tr><td className="it-empty" colSpan={COLS.length}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td className="it-empty" colSpan={COLS.length}>
                    {error ? 'Load failed — see error above' : 'No data yet — the dataset refreshes daily at 01:30 UTC (or use Refresh Now in Admin › Datasets).'}
                  </td></tr>
                )}
                {!loading && rows.map((r: any, i: number) => (
                  <tr key={`${r.client}|${r.sender_id}|${i}`}>
                    <td className="l">{r.day ?? '—'}</td>
                    <td className="l" style={{ fontWeight: 600 }}>{r.client ?? '—'}</td>
                    <td className="l">{r.sender_id ?? '—'}</td>
                    <td>{fN(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && rows.length > 0 && (
            <div className="it-footer">{fN(rows.length)} row{rows.length === 1 ? '' : 's'} · volume = message parts sent via {scope.vendor ?? 'Innovatio'}</div>
          )}
        </div>
      </div>
    </>
  );
}
