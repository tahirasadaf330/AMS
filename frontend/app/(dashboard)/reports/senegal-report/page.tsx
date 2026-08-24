'use client';

import * as React from 'react';
import { senegalReportApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.sn{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --accent:#2563eb;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .sn{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
}
.sn-body{max-width:1500px;margin:0 auto;padding:22px 20px 48px}
.sn-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.sn-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
.sn-sub{font-size:.74rem;color:var(--mu);margin-top:3px}
.sn-lu{text-align:right}
.sn-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.sn-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.sn-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:14px}
@media(max-width:900px){.sn-cards{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.sn-cards{grid-template-columns:repeat(2,1fr)}}
.sn-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.sn-card-num{font-size:1.35rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;margin-bottom:4px}
.sn-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.sn-err{background:rgba(220,38,38,.07);border:1px solid rgba(220,38,38,.25);color:#dc2626;border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.sn-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.sn-inp,.sn-sel{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none}
.sn-inp{width:260px}
.sn-inp:focus,.sn-sel:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.sn-sel-lbl{font-size:.72rem;color:var(--mu);text-transform:uppercase;letter-spacing:.05em}
.sn-tabs{display:flex;gap:6px}
.sn-tab{height:33px;padding:0 14px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.79rem;font-weight:600;cursor:pointer}
.sn-tab:hover{border-color:#94a3b8}
.sn-tab.on{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.45);color:var(--accent)}
.sn-tbl-wrap{overflow:auto;max-height:calc(100vh - 340px);min-height:240px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.sn-tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.sn-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.sn-tbl th{padding:9px 12px;text-align:right;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap}
.sn-tbl th.l{text-align:left}
.sn-tbl th:hover{color:var(--ink)}
.sn-tbl th.active{color:var(--accent)}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
.sn-tbl td{padding:8px 12px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap}
.sn-tbl td.l{text-align:left}
.sn-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.sn-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.sn-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.neg{color:#dc2626}
`;

const fN = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
const fM = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const fP = (n: any) => (n != null ? `${Number(n).toFixed(2)}%` : '—');

type Tab = 'funnel' | 'detail' | 'client' | 'vendor';
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

const MoneyTd = ({ v }: { v: any }) => <td className={Number(v) < 0 ? 'neg' : ''}>{fM(v)}</td>;

export default function SenegalReportPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [tab, setTab]             = React.useState<Tab>('funnel');
  const [day, setDay]             = React.useState<string>('');   // '' = latest (previous full day)
  const [sorts, setSorts] = React.useState<Record<Tab, { key: string; dir: SortDir }>>({
    funnel: { key: 'successful_sent', dir: 'desc' },
    detail: { key: 'successful_sent', dir: 'desc' },
    client: { key: 'successful_sent', dir: 'desc' },
    vendor: { key: 'successful_sent', dir: 'desc' },
  });
  const onSort = React.useCallback((t: Tab, key: string) => {
    setSorts((s) => ({ ...s, [t]: { key, dir: s[t].key === key ? (s[t].dir === 'asc' ? 'desc' : 'asc') : 'desc' } }));
  }, []);

  const load = React.useCallback((wantedDay?: string) => {
    setLoading(true); setError(null);
    senegalReportApi.getData(wantedDay || undefined)
      .then((r) => { setData(r.data); setDatasetId(r.data?.datasetId ?? r.data?.dataset_id ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(day); }, [load, day]);
  useDatasetSocket(datasetId ?? undefined, () => load(day));

  const funnel: any[] = React.useMemo(
    () => sortRows(data?.funnel ?? [], sorts.funnel.key, sorts.funnel.dir),
    [data, sorts.funnel]);
  const rows: any[] = React.useMemo(() => {
    let f: any[] = data?.rows ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.client ?? '').toLowerCase().includes(q) ||
        (r.vendor ?? '').toLowerCase().includes(q));
    }
    return sortRows(f, sorts.detail.key, sorts.detail.dir);
  }, [data, search, sorts.detail]);
  const byClient: any[] = React.useMemo(
    () => sortRows(data?.byClient ?? data?.by_client ?? [], sorts.client.key, sorts.client.dir),
    [data, sorts.client]);
  const byVendor: any[] = React.useMemo(
    () => sortRows(data?.byVendor ?? data?.by_vendor ?? [], sorts.vendor.key, sorts.vendor.dir),
    [data, sorts.vendor]);

  const s = data?.summary ?? {};
  const days: string[] = data?.days ?? [];
  const selDay: string = data?.day ?? '';
  const lastRefreshed: string | null = data?.lastRefreshed ?? data?.last_refreshed ?? null;
  const scope = data?.scope ?? {};

  const Th = ({ t, k, label, left }: { t: Tab; k: string; label: string; left?: boolean }) => {
    const active = sorts[t].key === k;
    return (
      <th className={`${left ? 'l' : ''} ${active ? 'active' : ''}`} onClick={() => onSort(t, k)}>
        {label}<span className="sa">{active ? (sorts[t].dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  const statCols = (t: Tab) => (
    <>
      <Th t={t} k="successful_sent" label="Sent" />
      <Th t={t} k="failed" label="Failed" />
      <Th t={t} k="delivered" label="Delivered" />
      <Th t={t} k="expenses" label="Expenses" />
      <Th t={t} k="income" label="Income" />
      <Th t={t} k="profit" label="Profit" />
    </>
  );

  const statTds = (r: any) => (
    <>
      <td>{fN(r.successful_sent)}</td>
      <td>{fN(r.failed)}</td>
      <td>{fN(r.delivered)}</td>
      <MoneyTd v={r.expenses} />
      <MoneyTd v={r.income} />
      <MoneyTd v={r.profit} />
    </>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="sn">
        <div className="sn-body">
          <div className="sn-hdr">
            <div>
              <div className="sn-title">Senegal Report</div>
              <div className="sn-sub">
                aSMSC Traffic Stats · MCC MNC funnel · {scope.country ?? 'Senegal'} · MCC {scope.mcc ?? '608'} · MCC/MNC {scope.mccmnc ?? '608004'} (CSU)
                {selDay ? ` · whole UTC day: ${selDay}` : ' · previous full UTC day'}
              </div>
            </div>
            {lastRefreshed && (
              <div className="sn-lu">
                <span className="sn-lu-lbl">Last Refreshed</span>
                <span className="sn-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="sn-err">Could not load data: {error}</div>}

          <div className="sn-cards">
            <div className="sn-card"><div className="sn-card-num">{fN(s.successful_sent ?? 0)}</div><div className="sn-card-lbl">Sent</div></div>
            <div className="sn-card"><div className="sn-card-num">{fN(s.delivered ?? 0)}</div><div className="sn-card-lbl">Delivered</div></div>
            <div className="sn-card"><div className="sn-card-num">{fP(s.delivery_pct ?? 0)}</div><div className="sn-card-lbl">Delivery %</div></div>
            <div className="sn-card"><div className="sn-card-num">{fM(s.income ?? 0)}</div><div className="sn-card-lbl">Income</div></div>
            <div className="sn-card"><div className={`sn-card-num${Number(s.profit) < 0 ? ' neg' : ''}`}>{fM(s.profit ?? 0)}</div><div className="sn-card-lbl">Profit</div></div>
            <div className="sn-card"><div className="sn-card-num">{fN(s.clients ?? 0)}</div><div className="sn-card-lbl">Clients</div></div>
          </div>

          <div className="sn-filt">
            <span className="sn-sel-lbl">Date</span>
            <select className="sn-sel" value={selDay} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <div className="sn-tabs">
              <button className={`sn-tab${tab === 'funnel' ? ' on' : ''}`} onClick={() => setTab('funnel')}>MCC MNC Funnel</button>
              <button className={`sn-tab${tab === 'detail' ? ' on' : ''}`} onClick={() => setTab('detail')}>Details</button>
              <button className={`sn-tab${tab === 'client' ? ' on' : ''}`} onClick={() => setTab('client')}>By Client</button>
              <button className={`sn-tab${tab === 'vendor' ? ' on' : ''}`} onClick={() => setTab('vendor')}>By Vendor</button>
            </div>
            {tab === 'detail' && (
              <input className="sn-inp" placeholder="Search client / vendor…" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
          </div>

          <div className="sn-tbl-wrap">
            {tab === 'funnel' && (
              <table className="sn-tbl">
                <thead><tr>
                  <Th t="funnel" k="date" label="Date" left />
                  <Th t="funnel" k="country" label="Country" left />
                  <Th t="funnel" k="operator" label="Operator" left />
                  <Th t="funnel" k="mcc_mnc" label="MCC MNC" left />
                  <Th t="funnel" k="mcc" label="MCC" left />
                  <Th t="funnel" k="mnc" label="MNC" left />
                  {statCols('funnel')}
                  <Th t="funnel" k="delivery_pct" label="Delivery %" />
                  <Th t="funnel" k="margin_pct" label="Margin %" />
                </tr></thead>
                <tbody>
                  {loading && <tr><td className="sn-empty" colSpan={14}>Loading…</td></tr>}
                  {!loading && funnel.length === 0 && (
                    <tr><td className="sn-empty" colSpan={14}>
                      {error ? 'Load failed — see error above' : 'No data yet — the dataset refreshes daily at 00:30 UTC (or use Refresh Now in Admin › Datasets).'}
                    </td></tr>
                  )}
                  {!loading && funnel.map((r: any, i: number) => (
                    <tr key={`${r.mcc_mnc}|${i}`}>
                      <td className="l">{r.date ?? '—'}</td>
                      <td className="l" style={{ fontWeight: 600 }}>{r.country ?? '—'}</td>
                      <td className="l">{r.operator ?? '—'}</td>
                      <td className="l">{r.mcc_mnc ?? '—'}</td>
                      <td className="l">{r.mcc ?? '—'}</td>
                      <td className="l">{r.mnc ?? '—'}</td>
                      {statTds(r)}
                      <td>{fP(r.delivery_pct)}</td>
                      <td className={Number(r.margin_pct) < 0 ? 'neg' : ''}>{fP(r.margin_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'detail' && (
              <table className="sn-tbl">
                <thead><tr>
                  <Th t="detail" k="date" label="Date" left />
                  <Th t="detail" k="client" label="Client" left />
                  <Th t="detail" k="vendor" label="Vendor" left />
                  {statCols('detail')}
                </tr></thead>
                <tbody>
                  {loading && <tr><td className="sn-empty" colSpan={9}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td className="sn-empty" colSpan={9}>
                      {error ? 'Load failed — see error above' : 'No data for the previous day — the dataset refreshes daily at 00:30 UTC (or use Refresh Now in Admin › Datasets).'}
                    </td></tr>
                  )}
                  {!loading && rows.map((r: any, i: number) => (
                    <tr key={`${r.client}|${r.vendor}|${i}`}>
                      <td className="l">{r.date ?? '—'}</td>
                      <td className="l" style={{ fontWeight: 600 }}>{r.client ?? '—'}</td>
                      <td className="l">{r.vendor ?? '—'}</td>
                      {statTds(r)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'client' && (
              <table className="sn-tbl">
                <thead><tr><Th t="client" k="client" label="Client" left />{statCols('client')}<Th t="client" k="delivery_pct" label="Delivery %" /></tr></thead>
                <tbody>
                  {loading && <tr><td className="sn-empty" colSpan={8}>Loading…</td></tr>}
                  {!loading && byClient.length === 0 && <tr><td className="sn-empty" colSpan={8}>No data for the previous day.</td></tr>}
                  {!loading && byClient.map((r: any, i: number) => (
                    <tr key={`${r.client}|${i}`}>
                      <td className="l" style={{ fontWeight: 600 }}>{r.client ?? '—'}</td>
                      {statTds(r)}
                      <td>{fP(r.delivery_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {tab === 'vendor' && (
              <table className="sn-tbl">
                <thead><tr><Th t="vendor" k="vendor" label="Vendor" left />{statCols('vendor')}<Th t="vendor" k="delivery_pct" label="Delivery %" /></tr></thead>
                <tbody>
                  {loading && <tr><td className="sn-empty" colSpan={8}>Loading…</td></tr>}
                  {!loading && byVendor.length === 0 && <tr><td className="sn-empty" colSpan={8}>No data for the previous day.</td></tr>}
                  {!loading && byVendor.map((r: any, i: number) => (
                    <tr key={`${r.vendor}|${i}`}>
                      <td className="l" style={{ fontWeight: 600 }}>{r.vendor ?? '—'}</td>
                      {statTds(r)}
                      <td>{fP(r.delivery_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!loading && (
            <div className="sn-footer">
              {tab === 'funnel' ? 'MCC MNC funnel view'
                : tab === 'detail' ? `${fN(rows.length)} rows`
                : tab === 'client' ? `${fN(byClient.length)} clients`
                : `${fN(byVendor.length)} vendors`}
              {' '}· whole UTC days (00:00:00–23:59:59) · defaults to the previous full day · refreshed daily at 00:30 UTC · last {fN(days.length)} day(s) available
            </div>
          )}
        </div>
      </div>
    </>
  );
}
