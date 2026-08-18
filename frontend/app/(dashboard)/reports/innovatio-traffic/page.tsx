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
.it-inp,.it-sel{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none}
.it-inp{width:260px}
.it-inp:focus,.it-sel:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.it-sel-lbl{font-size:.72rem;color:var(--mu);text-transform:uppercase;letter-spacing:.05em}
.it-tabs{display:flex;gap:6px;margin-bottom:12px}
.it-tab{height:33px;padding:0 14px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.79rem;font-weight:600;cursor:pointer}
.it-tab:hover{border-color:#94a3b8}
.it-tab.on{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.45);color:var(--accent)}
.it-tbl-wrap{overflow:auto;max-height:calc(100vh - 320px);min-height:240px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.it-tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.it-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.it-tbl th{padding:9px 12px;text-align:right;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap}
.it-tbl th.l{text-align:left}
.it-tbl th:hover{color:var(--ink)}
.it-tbl th.active{color:var(--accent)}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
.it-tbl td{padding:8px 12px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.it-tbl td.l{text-align:left}
.it-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.it-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.it-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.it-bar{display:inline-block;height:8px;background:rgba(37,99,235,.35);border-radius:4px;vertical-align:middle;margin-right:8px}
`;

const fN = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');

type Tab = 'detail' | 'client' | 'sender';
type SortDir = 'asc' | 'desc';

function sortRows<T extends Record<string, any>>(rows: T[], key: string, dir: SortDir): T[] {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

export default function InnovatioTrafficPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [tab, setTab]             = React.useState<Tab>('detail');
  const [day, setDay]             = React.useState<string>('');   // '' = latest
  // One sort state per tab (each tab has its own columns); default volume desc everywhere.
  const [sorts, setSorts] = React.useState<Record<Tab, { key: string; dir: SortDir }>>({
    detail: { key: 'volume', dir: 'desc' },
    client: { key: 'volume', dir: 'desc' },
    sender: { key: 'volume', dir: 'desc' },
  });
  const onSort = React.useCallback((t: Tab, key: string) => {
    setSorts((s) => ({ ...s, [t]: { key, dir: s[t].key === key ? (s[t].dir === 'asc' ? 'desc' : 'asc') : 'desc' } }));
  }, []);

  const load = React.useCallback((wantedDay?: string) => {
    setLoading(true); setError(null);
    innovatioTrafficApi.getData(wantedDay || undefined)
      .then((r) => { setData(r.data); setDatasetId(r.data?.datasetId ?? r.data?.dataset_id ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(day); }, [load, day]);
  useDatasetSocket(datasetId ?? undefined, () => load(day));

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.client ?? '').toLowerCase().includes(q) ||
        (r.sender_id ?? '').toLowerCase().includes(q));
    }
    return sortRows(f, sorts.detail.key, sorts.detail.dir);
  }, [data, search, sorts.detail]);

  const byClient: any[] = React.useMemo(
    () => sortRows(data?.byClient ?? data?.by_client ?? [], sorts.client.key, sorts.client.dir),
    [data, sorts.client]);
  const bySender: any[] = React.useMemo(
    () => sortRows(data?.bySender ?? data?.by_sender ?? [], sorts.sender.key, sorts.sender.dir),
    [data, sorts.sender]);
  const days: string[]  = data?.days ?? [];
  const s = data?.summary ?? {};
  const selDay: string = data?.day ?? '';
  const lastRefreshed: string | null = data?.lastRefreshed ?? data?.last_refreshed ?? null;
  const scope = data?.scope ?? {};
  const maxClientVol = byClient.length ? Math.max(...byClient.map((r: any) => Number(r.volume) || 0)) : 0;
  const maxSenderVol = bySender.length ? Math.max(...bySender.map((r: any) => Number(r.volume) || 0)) : 0;

  const bar = (v: number, max: number) => (
    <span className="it-bar" style={{ width: `${max > 0 ? Math.max(3, Math.round((v / max) * 90)) : 3}px` }} />
  );

  const Th = ({ t, k, label, left }: { t: Tab; k: string; label: string; left?: boolean }) => {
    const active = sorts[t].key === k;
    return (
      <th className={`${left ? 'l' : ''} ${active ? 'active' : ''}`} onClick={() => onSort(t, k)}>
        {label}<span className="sa">{active ? (sorts[t].dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
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
                aSMSC · supplier {scope.vendor ?? 'Innovatio'} · MCC/MNC {scope.mccmnc ?? '614004'} · whole UTC day{selDay ? ` · ${selDay}` : ''}
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
            <span className="it-sel-lbl">Day</span>
            <select className="it-sel" value={selDay} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="it-tabs" style={{ marginBottom: 0 }}>
              <button className={`it-tab${tab === 'detail' ? ' on' : ''}`} onClick={() => setTab('detail')}>Details</button>
              <button className={`it-tab${tab === 'client' ? ' on' : ''}`} onClick={() => setTab('client')}>By Client</button>
              <button className={`it-tab${tab === 'sender' ? ' on' : ''}`} onClick={() => setTab('sender')}>By Sender ID</button>
            </div>
            {tab === 'detail' && (
              <input className="it-inp" placeholder="Search client / sender ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
          </div>

          <div className="it-tbl-wrap">
            {tab === 'detail' && (
              <table className="it-tbl">
                <thead><tr><Th t="detail" k="day" label="Day" left /><Th t="detail" k="client" label="Client" left /><Th t="detail" k="sender_id" label="SenderId" left /><Th t="detail" k="volume" label="Volume" /></tr></thead>
                <tbody>
                  {loading && <tr><td className="it-empty" colSpan={4}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td className="it-empty" colSpan={4}>
                      {error ? 'Load failed — see error above' : 'No data for this day yet — the dataset refreshes daily (or use Refresh Now in Admin › Datasets).'}
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
            )}
            {tab === 'client' && (
              <table className="it-tbl">
                <thead><tr><Th t="client" k="client" label="Client" left /><Th t="client" k="volume" label="Volume" /></tr></thead>
                <tbody>
                  {loading && <tr><td className="it-empty" colSpan={2}>Loading…</td></tr>}
                  {!loading && byClient.length === 0 && <tr><td className="it-empty" colSpan={2}>No data for this day.</td></tr>}
                  {!loading && byClient.map((r: any, i: number) => (
                    <tr key={`${r.client}|${i}`}>
                      <td className="l" style={{ fontWeight: 600 }}>{r.client ?? '—'}</td>
                      <td>{bar(Number(r.volume), maxClientVol)}{fN(r.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'sender' && (
              <table className="it-tbl">
                <thead><tr><Th t="sender" k="sender_id" label="SenderId" left /><Th t="sender" k="volume" label="Volume" /></tr></thead>
                <tbody>
                  {loading && <tr><td className="it-empty" colSpan={2}>Loading…</td></tr>}
                  {!loading && bySender.length === 0 && <tr><td className="it-empty" colSpan={2}>No data for this day.</td></tr>}
                  {!loading && bySender.map((r: any, i: number) => (
                    <tr key={`${r.sender_id}|${i}`}>
                      <td className="l" style={{ fontWeight: 600 }}>{r.sender_id ?? '—'}</td>
                      <td>{bar(Number(r.volume), maxSenderVol)}{fN(r.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && (
            <div className="it-footer">
              {tab === 'detail' ? `${fN(rows.length)} rows` : tab === 'client' ? `${fN(byClient.length)} clients` : `${fN(bySender.length)} sender IDs`}
              {' '}· volume = message parts sent via {scope.vendor ?? 'Innovatio'} · last {fN(days.length)} day(s) available
            </div>
          )}
        </div>
      </div>
    </>
  );
}
