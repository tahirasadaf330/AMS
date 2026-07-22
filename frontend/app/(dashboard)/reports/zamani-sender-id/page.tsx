'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { zamaniSenderIdApi } from '@/lib/api';

type Totals = { submitted: number; delivered: number; dlr_pct: number; misrouted: number; senders: number; aggregators: number };
type Sender = { sender_id: string; aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; dlr_pct: number; last_seen: string };
type Agg = { aggregator: string; account_manager: string; submitted: number; delivered: number; misrouted: number; senders: number; dlr_pct: number };
type Route = { sender_id: string; aggregator: string; vendor: string; vendor_id: number; msgs: number };
type Data = { totals: Totals; senders: Sender[]; aggregators: Agg[]; routing: Route[]; trend: { hour: string; submitted: number; delivered: number }[] };

const PRESETS = [
  { label: 'Last 1h', h: 1 },
  { label: 'Last 6h', h: 6 },
  { label: 'Last 24h', h: 24 },
  { label: 'Last 48h', h: 48 },
];

const fmt = (n: number) => (n ?? 0).toLocaleString();
const dlrColor = (p: number) => (p >= 80 ? 'text-green-600' : p >= 50 ? 'text-amber-600' : 'text-red-600');
const pctCell = (p: number) => <span className={`font-medium ${dlrColor(p)}`}>{p}%</span>;

function Tile({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${className ?? 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Card({ title, children, danger }: { title: string; children: ReactNode; danger?: boolean }) {
  return (
    <div className={`bg-white rounded-xl border ${danger ? 'border-red-300' : 'border-gray-200'} overflow-hidden`}>
      <div className={`px-4 py-2.5 text-sm font-semibold border-b ${danger ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-700 border-gray-200'}`}>{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Table({ head, rows, aligns }: { head: string[]; rows: ReactNode[][]; aligns: string[] }) {
  const a = (i: number) => (aligns[i] === 'right' ? 'text-right' : 'text-left');
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-gray-500">
          {head.map((h, i) => <th key={i} className={`px-4 py-2 ${a(i)} font-medium whitespace-nowrap`}>{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={head.length} className="px-4 py-6 text-center text-gray-400">No data in this window</td></tr>
        ) : rows.map((r, ri) => (
          <tr key={ri} className="border-t border-gray-100 hover:bg-gray-50">
            {r.map((c, ci) => <td key={ci} className={`px-4 py-2 ${a(ci)} whitespace-nowrap text-gray-700`}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ZamaniSenderIdPage() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    setLoading(true); setError(null);
    try {
      const from = new Date(Date.now() - h * 3600_000).toISOString();
      const res = await zamaniSenderIdApi.getData({ from });
      setData(res.data as Data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(hours); }, [hours, load]);

  const t = data?.totals;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Zamani Sender ID</h1>
          <p className="text-sm text-gray-500">Near-real-time Zamani-destination traffic by sender ID (all vendors, so mis-routing is visible). Data refreshes ~5&nbsp;min.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.h} onClick={() => setHours(p.h)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${hours === p.h ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => load(hours)} className="px-3 py-1.5 rounded-lg text-sm border bg-white text-gray-700 border-gray-300 hover:bg-gray-50">Refresh</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">{error}</div>}
      {loading && !data && <div className="text-gray-500 text-sm">Loading…</div>}

      {t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Tile label="Messages" value={fmt(t.submitted)} />
            <Tile label="Delivered" value={fmt(t.delivered)} />
            <Tile label="DLR %" value={`${t.dlr_pct}%`} className={dlrColor(t.dlr_pct)} />
            <Tile label="Mis-routed" value={fmt(t.misrouted)} className={t.misrouted > 0 ? 'text-red-600' : 'text-gray-900'} />
            <Tile label="Sender IDs" value={fmt(t.senders)} />
            <Tile label="Aggregators" value={fmt(t.aggregators)} />
          </div>

          {data!.routing.length > 0 && (
            <Card title="⚠ Routing errors — Zamani traffic sent to a vendor other than 564 (Zamani_Niger)" danger>
              <Table
                head={['Sender ID', 'Aggregator', 'Wrong Vendor', 'Messages']}
                aligns={['left', 'left', 'left', 'right']}
                rows={data!.routing.map((r) => [r.sender_id, r.aggregator, r.vendor ?? `vendor ${r.vendor_id}`, fmt(r.msgs)])}
              />
            </Card>
          )}

          <Card title={`By Sender ID (${data!.senders.length})`}>
            <Table
              head={['Sender ID', 'Aggregator', 'Account Manager', 'Messages', 'Delivered', 'DLR %', 'Last seen (UTC)']}
              aligns={['left', 'left', 'left', 'right', 'right', 'right', 'left']}
              rows={data!.senders.map((s) => [s.sender_id, s.aggregator, s.account_manager, fmt(s.submitted), fmt(s.delivered), pctCell(s.dlr_pct), s.last_seen])}
            />
          </Card>

          <Card title={`By Aggregator (${data!.aggregators.length})`}>
            <Table
              head={['Aggregator', 'Account Manager', 'Sender IDs', 'Messages', 'Delivered', 'DLR %']}
              aligns={['left', 'left', 'right', 'right', 'right', 'right']}
              rows={data!.aggregators.map((a) => [a.aggregator, a.account_manager, fmt(a.senders), fmt(a.submitted), fmt(a.delivered), pctCell(a.dlr_pct)])}
            />
          </Card>
        </>
      )}
    </div>
  );
}
