'use client';

import * as React from 'react';
import { voiceOutliersApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.vo{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --warn:#d97706;--ok:#16a34a;--accent:#2563eb;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .vo{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
}
.vo-body{max-width:1600px;margin:0 auto;padding:22px 20px 48px}
.vo-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;flex-wrap:wrap}
.vo-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
.vo-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px}
.vo-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:vo-blink 2s infinite}
@keyframes vo-blink{0%,100%{opacity:1}50%{opacity:.3}}
.vo-badge{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:10px;border:1px solid var(--lns);color:var(--inks)}
.vo-badge.day{background:rgba(217,119,6,.10);border-color:rgba(217,119,6,.35);color:var(--warn)}
.vo-badge.night{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.35);color:var(--accent)}
.vo-lu{text-align:right}
.vo-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.vo-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.vo-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
@media(max-width:640px){.vo-cards{grid-template-columns:repeat(2,1fr)}}
.vo-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.vo-card-danger{border-color:var(--danger-bd);background:var(--danger-bg)}
.vo-card-num{font-size:1.55rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;margin-bottom:4px}
.vo-card-danger .vo-card-num{color:var(--danger)}
.vo-card-lbl{font-size:.67rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.vo-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.vo-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.vo-inp{height:33px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--ink);font-size:.8rem;padding:0 10px;outline:none;width:250px;color-scheme:light}
.dark .vo-inp{color-scheme:dark}
.vo-inp:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(37,99,235,.15)}
.vo-tbtn{height:33px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.78rem;font-weight:500;cursor:pointer;white-space:nowrap}
.vo-tbtn:hover{border-color:#94a3b8}
.vo-tbtn.an{background:var(--danger-bg);border-color:var(--danger-bd);color:var(--danger);font-weight:700}
.vo-clr{height:33px;padding:0 11px;border:1px dashed #94a3b8;border-radius:7px;background:transparent;color:var(--mu);font-size:.74rem;cursor:pointer}
.vo-tbl-wrap{overflow:auto;max-height:calc(100vh - 300px);min-height:260px;border-radius:10px;border:1px solid var(--ln);background:var(--sf)}
.vo-tbl{width:100%;border-collapse:collapse;font-size:.79rem;table-layout:fixed}
.vo-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.vo-tbl th{padding:9px 10px;text-align:right;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);user-select:none;cursor:pointer;position:sticky;top:0;background:var(--sf2);z-index:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vo-tbl th.l{text-align:left}
.vo-tbl th:hover{color:var(--ink)}
.vo-tbl th.active{color:var(--accent)}
.vo-tbl td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--ln);color:var(--ink);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vo-tbl td.l{text-align:left}
.vo-tbl td.mono{font-family:'Courier New',monospace;font-size:.76rem}
.vo-tbl tbody tr.out td{background:var(--danger-bg)}
.vo-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.vo-tbl tbody tr.out:hover td{background:rgba(220,38,38,.10)}
.vo-empty{text-align:center;color:var(--mu);padding:38px 20px;font-size:.83rem}
.vo-pill{display:inline-block;min-width:52px;padding:2px 8px;border-radius:6px;font-weight:700;font-size:.76rem}
.vo-z{font-weight:700}
.vo-z.hot{color:var(--danger)}
.vo-flag{display:inline-block;padding:1px 7px;border-radius:5px;font-size:.66rem;font-weight:700;white-space:nowrap;background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger)}
.vo-flag.drop{background:var(--danger-bg);border-color:var(--danger-bd);color:var(--danger)}
.vo-flag.spike{background:rgba(217,119,6,.12);border-color:rgba(217,119,6,.35);color:var(--warn)}
.vo-mu{color:var(--mu)}
.vo-footer{margin-top:9px;font-size:.72rem;color:var(--mu);text-align:right}
.sa{font-size:.56rem;margin-left:3px;opacity:.4}
`;

const fN = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
const f2 = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

// ASR health pill colours (mirrors Voice Live Traffic): >=50 green, >=30 yellow, >=15 orange, else red.
function asrPill(v: any): React.CSSProperties {
  if (v == null) return { color: 'var(--mu)' };
  const n = Number(v);
  if (n >= 50) return { background: 'rgba(22,163,74,.12)', color: 'var(--ok)' };
  if (n >= 30) return { background: 'rgba(217,119,6,.14)', color: 'var(--warn)' };
  if (n >= 15) return { background: 'rgba(234,88,12,.14)', color: '#ea580c' };
  return { background: 'rgba(220,38,38,.12)', color: 'var(--danger)' };
}

type SortDir = 'asc' | 'desc';

const COLS: { key: string; label: string; left?: boolean; w: string }[] = [
  { key: 'account',        label: 'Account',            left: true, w: '18%' },
  { key: 'destination',    label: 'Destination',        left: true, w: '12%' },
  { key: 'attempts',       label: 'Attempts',           w: '7%' },
  { key: 'asr',            label: 'ASR %',              w: '8%' },
  { key: 'asr_p5',         label: 'ASR Range P5–P95',   w: '12%' },
  { key: 'acd',            label: 'ACD (min)',          w: '8%' },
  { key: 'acd_p5',         label: 'ACD Range P5–P95',   w: '12%' },
  { key: 'flags',          label: 'Outlier',            w: '15%' },
];

export default function VoiceOutliersPage() {
  const [data, setData]           = React.useState<any>(null);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);
  const [loading, setLoading]     = React.useState(true);
  const [error, setError]         = React.useState<string | null>(null);
  const [search, setSearch]       = React.useState('');
  const [onlyOut, setOnlyOut]     = React.useState(true);
  const [sort, setSort]           = React.useState<{ key: string; dir: SortDir }>({ key: 'flags', dir: 'desc' });

  const onSort = React.useCallback((key: string) => {
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  }, []);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    voiceOutliersApi.getData()
      .then((r) => { setData(r.data); setDatasetId(r.data?.datasetId ?? r.data?.dataset_id ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId ?? undefined, load);
  // Also poll every 60s so a running-in-the-background tab still catches the 10-min detection cycles.
  React.useEffect(() => {
    const id = setInterval(load, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const flagScore = (r: any) => (r.is_asr_outlier === 1 ? 1 : 0) + (r.is_acd_outlier === 1 ? 1 : 0);

  const rows: any[] = React.useMemo(() => {
    if (!data?.rows) return [];
    let f: any[] = data.rows;
    if (onlyOut) f = f.filter((r: any) => flagScore(r) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter((r: any) =>
        (r.account ?? '').toLowerCase().includes(q) ||
        (r.destination ?? '').toLowerCase().includes(q));
    }
    const { key, dir } = sort;
    const val = (r: any) => (key === 'flags' ? flagScore(r) : r[key]);
    return [...f].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [data, search, onlyOut, sort]);

  const s = data?.summary ?? {};
  const period: string = data?.period ?? '—';
  const lastRefreshed: string | null = data?.lastRefreshed ?? data?.last_refreshed ?? null;
  const hasFilter = search || onlyOut;

  const Th = ({ col }: { col: typeof COLS[number] }) => {
    const active = sort.key === col.key;
    return (
      <th className={`${col.left ? 'l' : ''} ${active ? 'active' : ''}`} style={{ width: col.w }} onClick={() => onSort(col.key)}>
        {col.label}<span className="sa">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  };

  // Baseline operating band [P5, P95]; painted red when the current value fell outside it.
  const bandCell = (p5: any, p95: any, flagged: boolean) => (
    <td className={`mono${flagged ? ' vo-z hot' : ' vo-mu'}`}>
      {p5 != null && p95 != null ? `${f2(p5)} – ${f2(p95)}` : '—'}
    </td>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vo">
        <div className="vo-body">
          <div className="vo-hdr">
            <div>
              <div className="vo-title">Voice Smart Outliers</div>
              <div className="vo-sub">
                <span className="vo-dot" />
                Jerasoft VCS · last 10 min vs each route&apos;s own [P5–P95] baseline band · day/night separated
                <span className={`vo-badge ${period === 'day' ? 'day' : period === 'night' ? 'night' : ''}`}>{period === 'day' ? 'Daytime baseline' : period === 'night' ? 'Nighttime baseline' : period}</span>
              </div>
            </div>
            {lastRefreshed && (
              <div className="vo-lu">
                <span className="vo-lu-lbl">Last Detection</span>
                <span className="vo-lu-val">{new Date(lastRefreshed).toLocaleString()}</span>
              </div>
            )}
          </div>

          {error && <div className="vo-err">Could not load data: {error}</div>}

          <div className="vo-cards">
            <div className="vo-card vo-card-danger"><div className="vo-card-num">{fN(s.outliers ?? 0)}</div><div className="vo-card-lbl">Outlier Routes</div></div>
            <div className="vo-card"><div className="vo-card-num">{fN(s.asrOutliers ?? 0)}</div><div className="vo-card-lbl">ASR Outliers</div></div>
            <div className="vo-card"><div className="vo-card-num">{fN(s.acdOutliers ?? 0)}</div><div className="vo-card-lbl">ACD Outliers</div></div>
            <div className="vo-card"><div className="vo-card-num">{fN(s.totalRoutes ?? 0)}</div><div className="vo-card-lbl">Active Routes</div></div>
          </div>

          <div className="vo-filt">
            <input className="vo-inp" placeholder="Search account / destination…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <button className={`vo-tbtn${onlyOut ? ' an' : ''}`} onClick={() => setOnlyOut((v) => !v)}>Outliers only</button>
            {hasFilter && <button className="vo-clr" onClick={() => { setSearch(''); setOnlyOut(false); }}>Clear filters</button>}
          </div>

          <div className="vo-tbl-wrap">
            <table className="vo-tbl">
              <thead><tr>{COLS.map((c) => <Th key={c.key} col={c} />)}</tr></thead>
              <tbody>
                {loading && <tr><td className="vo-empty" colSpan={COLS.length}>Loading…</td></tr>}
                {!loading && rows.length === 0 && (
                  <tr><td className="vo-empty" colSpan={COLS.length}>
                    {error ? 'Load failed — see error above'
                      : onlyOut ? 'No outliers in the current window — every active route is within its baseline.'
                      : 'No active routes in the last 10 minutes yet (or the baseline is still building).'}
                  </td></tr>
                )}
                {!loading && rows.map((r: any, i: number) => {
                  const isOut = flagScore(r) > 0;
                  return (
                    <tr key={`${r.account}|${r.destination}|${i}`} className={isOut ? 'out' : ''}>
                      <td className="l" style={{ fontWeight: 600 }} title={r.account ?? ''}>{r.account ?? '—'}</td>
                      <td className="l" title={r.destination ?? ''}>{r.destination ?? '—'}</td>
                      <td className="mono">{fN(r.attempts)}</td>
                      <td><span className="vo-pill" style={asrPill(r.asr)}>{r.asr != null ? f2(r.asr) : '—'}</span></td>
                      {bandCell(r.asr_p5, r.asr_p95, r.is_asr_outlier === 1)}
                      <td className="mono">{r.acd != null ? f2(r.acd) : '—'}</td>
                      {bandCell(r.acd_p5, r.acd_p95, r.is_acd_outlier === 1)}
                      <td>
                        {r.is_asr_outlier === 1 && (
                          <span className={`vo-flag ${r.asr_dir === 'spike' ? 'spike' : 'drop'}`} title={`ASR ${r.asr_dir ?? 'outlier'}`}>
                            ASR {r.asr_dir === 'spike' ? '▲ spike' : '▼ drop'}
                          </span>
                        )}
                        {r.is_acd_outlier === 1 && (
                          <span className={`vo-flag ${r.acd_dir === 'spike' ? 'spike' : 'drop'}`} title={`ACD ${r.acd_dir ?? 'outlier'}`} style={{ marginLeft: 4 }}>
                            ACD {r.acd_dir === 'spike' ? '▲ spike' : '▼ drop'}
                          </span>
                        )}
                        {!isOut && <span className="vo-mu">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && rows.length > 0 && (
            <div className="vo-footer">{fN(rows.length)} {onlyOut ? 'outlier' : ''} route{rows.length === 1 ? '' : 's'} · baseline: [P5, P95] band over 10-min buckets, day/night separated</div>
          )}
        </div>
      </div>
    </>
  );
}
