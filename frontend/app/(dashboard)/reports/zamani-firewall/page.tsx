'use client';

import * as React from 'react';
import { zamaniFirewallApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';
import { STREAMS, buildChart, hourLabel, hourFull, stamp, toDate } from './chart-data';

/**
 * Zamani SMS Firewall — five tabs over the SS7 / SMPP / SRI firewall logs.
 *
 * Styling deliberately follows the Zamani Traffic report (flat-UI palette, Hanken Grotesk body,
 * JetBrains Mono for figures, `.ztabs` full-width tabs, chunky offset shadows) so the two Zamani
 * reports read as one family.
 *
 * All date handling and the hourly pivot come from ./chart-data and never throw — see that file.
 */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.zf{
  --turquoise:#1abc9c;--green-sea:#16a085;--emerald:#2ecc71;--nephritis:#27ae60;
  --river:#3498db;--belize:#2980b9;--amethyst:#9b59b6;
  --asphalt:#34495e;--midnight:#2c3e50;
  --carrot:#e67e22;--alizarin:#e74c3c;--sunflower:#f1c40f;
  --pos:#27ae60;--neg:#e74c3c;
  --bg:#ecf0f1;--sf:#ffffff;--sf2:#f5f7f8;--stripe:#f9fafb;
  --ink:#2c3e50;--inks:#5d6d7e;--mu:#95a5a6;
  --ln:#e4e9ec;--lns:#d3dadf;
  font-family:'Hanken Grotesk',-apple-system,sans-serif;
  color:var(--ink);background:var(--bg);
}
.dark .zf{
  --bg:#1b2733;--sf:#22303f;--sf2:#1d2a37;--stripe:#1f2d3a;
  --ink:#ecf0f1;--inks:#bdc8d2;--mu:#7f8c9a;
  --ln:#2f4151;--lns:#3b5063;
}
.zf-wrap{max-width:1640px;margin:0 auto;padding:20px 20px 48px}

/* ── header ───────────────────────────── */
.zf-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px;flex-wrap:wrap}
.zf-h1{font-family:'Montserrat',sans-serif;font-weight:800;font-size:22px;letter-spacing:-.02em}
.zf-h2{font-size:12.5px;color:var(--mu);margin-top:4px;max-width:820px;line-height:1.5}
.zf-dcard{background:var(--midnight);color:#fff;border-radius:8px;padding:9px 16px}
.zf-dlbl{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#bdc3c7}
.zf-dval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:15px;display:flex;align-items:center;gap:8px;margin-top:2px}
.zf-pulse{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex-shrink:0;
  box-shadow:0 0 0 0 rgba(46,204,113,.5);animation:zfpls 2.4s infinite}
@keyframes zfpls{0%{box-shadow:0 0 0 0 rgba(46,204,113,.5)}70%{box-shadow:0 0 0 7px rgba(46,204,113,0)}100%{box-shadow:0 0 0 0 rgba(46,204,113,0)}}

/* ── tabs ─────────────────────────────── */
.ztabs{display:flex;border-bottom:2px solid var(--ln);margin-bottom:20px;overflow-x:auto}
.ztab{flex:1;min-width:150px;padding:12px 8px;font-size:14px;font-weight:600;color:var(--mu);background:transparent;
  border:none;cursor:pointer;position:relative;transition:color .15s;font-family:'Hanken Grotesk',sans-serif;white-space:nowrap}
.ztab:hover{color:var(--ink)}
.ztab.za{color:var(--turquoise)}
.ztab.za::after{content:"";position:absolute;bottom:-2px;left:0;right:0;height:2.5px;background:var(--turquoise);border-radius:2px 2px 0 0}
.ztab .zbadge{display:inline-block;margin-left:6px;font-family:'JetBrains Mono',monospace;font-size:10.5px;font-weight:700;
  padding:1px 6px;border-radius:20px;background:rgba(231,76,60,.16);color:var(--alizarin)}

/* ── kpi ──────────────────────────────── */
.zf-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px}
@media(max-width:1100px){.zf-kpis{grid-template-columns:repeat(2,1fr)}}
.zk{border-radius:10px;padding:16px 17px 15px;color:#fff;box-shadow:0 4px 0 rgba(0,0,0,.15)}
.zk.kt{background:var(--turquoise)} .zk.kb{background:var(--river)} .zk.kg{background:var(--emerald)}
.zk.kc{background:var(--carrot)} .zk.kr{background:var(--alizarin)} .zk.kp{background:var(--amethyst)}
.zk.kd{background:var(--asphalt)}
.zk-top{display:flex;align-items:center;justify-content:space-between;opacity:.92}
.zk-lbl{font-size:12px;font-weight:700;letter-spacing:.01em}
.zk-ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.22)}
.zk-ic svg{width:16px;height:16px}
.zk-val{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:24px;margin-top:12px;font-variant-numeric:tabular-nums;letter-spacing:-.5px}
.zk-sub{font-size:11.5px;margin-top:5px;opacity:.9;line-height:1.4}

/* ── panel ────────────────────────────── */
.zpnl{background:var(--sf);border-radius:10px;border:1px solid var(--ln);box-shadow:0 2px 0 var(--ln);margin-bottom:18px}
.zph{display:flex;align-items:baseline;justify-content:space-between;padding:14px 18px 11px;border-bottom:1px solid var(--ln);gap:12px;flex-wrap:wrap}
.zph-t{font-family:'Montserrat',sans-serif;font-weight:700;font-size:14px}
.zph-s{font-size:11.5px;color:var(--mu)}
.zpb{padding:15px 18px}
.zgrid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:1100px){.zgrid2{grid-template-columns:1fr}}

/* ── table ────────────────────────────── */
.zt{width:100%;border-collapse:collapse;font-size:13px}
.zt thead th{text-align:right;font-weight:700;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;
  color:var(--mu);padding:10px 14px;border-bottom:2px solid var(--lns);white-space:nowrap;position:sticky;top:0;background:var(--sf)}
.zt thead th:first-child{text-align:left}
.zt tbody td{padding:9px 14px;border-bottom:1px solid var(--ln);text-align:right;
  font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums;color:var(--inks);white-space:nowrap}
.zt tbody td:first-child{text-align:left;font-family:'Hanken Grotesk',sans-serif;font-weight:600;color:var(--ink)}
.zt tbody tr:nth-child(even){background:var(--stripe)}
.zt tbody tr:hover{background:var(--sf2)}
.tbl-scroll{overflow:auto;max-height:460px}
.tbl-scroll::-webkit-scrollbar{height:10px;width:10px}
.tbl-scroll::-webkit-scrollbar-track{background:var(--sf2);border-radius:6px}
.tbl-scroll::-webkit-scrollbar-thumb{background:var(--lns);border-radius:6px}

/* ── bits ─────────────────────────────── */
.zbt{font-family:'Hanken Grotesk',sans-serif;font-weight:600;font-size:12.5px;padding:7px 14px;border-radius:7px;cursor:pointer;
  border:1px solid var(--lns);background:var(--sf);color:var(--inks);white-space:nowrap;transition:.12s}
.zbt:hover{filter:brightness(1.04)}
.zbt.za{background:var(--turquoise);color:#fff;border-color:var(--green-sea);box-shadow:0 3px 0 var(--green-sea);font-weight:700}
.zbtrow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center}
.zpill{display:inline-block;padding:2px 9px;border-radius:20px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.zpill.ok{background:rgba(39,174,96,.16);color:var(--nephritis)}
.zpill.warn{background:rgba(230,126,34,.16);color:var(--carrot)}
.zpill.bad{background:rgba(231,76,60,.16);color:var(--alizarin)}
.zpill.info{background:rgba(52,152,219,.16);color:var(--belize)}
.ztag{display:inline-block;padding:1px 8px;border-radius:5px;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.ztag.ss7{background:rgba(52,152,219,.16);color:var(--belize)}
.ztag.smpp{background:rgba(155,89,182,.16);color:var(--amethyst)}
.ztag.sri,.ztag.sri_req{background:rgba(26,188,156,.16);color:var(--green-sea)}
.znote{font-size:11.5px;color:var(--mu);line-height:1.55;padding:9px 13px;border-left:3px solid var(--lns);background:var(--sf2);border-radius:0 6px 6px 0;margin-bottom:16px}
.zwarn{background:rgba(230,126,34,.10);border:1px solid rgba(230,126,34,.32);color:var(--carrot);border-radius:8px;padding:11px 15px;font-size:12.5px;margin-bottom:16px;line-height:1.5}
.zerr{background:rgba(231,76,60,.10);border:1px solid rgba(231,76,60,.32);color:var(--alizarin);border-radius:8px;padding:11px 15px;font-size:13px;margin-bottom:16px}
.zempty{text-align:center;color:var(--mu);padding:34px 20px;font-size:13px}
.zskel{height:40px;border-radius:8px;background:var(--sf2);animation:zshim 1.4s ease-in-out infinite}
@keyframes zshim{0%,100%{opacity:.55}50%{opacity:1}}

/* ── stacked hourly chart ─────────────── */
.zchart{display:flex;align-items:flex-end;gap:2px;height:190px;padding-top:6px}
.zcol{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:0;height:100%;position:relative}
.zcol:hover .ztip{display:block}
.zseg{width:100%;border-radius:1px 1px 0 0}
.zseg.ss7{background:var(--river)} .zseg.smpp{background:var(--amethyst)} .zseg.sri{background:var(--turquoise)}
.ztrack{width:100%;height:1px;background:var(--lns)}
.ztip{display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:6px;background:var(--midnight);
  color:#fff;font-size:11px;padding:6px 9px;border-radius:6px;white-space:nowrap;z-index:5;pointer-events:none;
  font-family:'JetBrains Mono',monospace}
.zxax{display:flex;justify-content:space-between;font-size:10.5px;color:var(--mu);margin-top:6px;font-family:'JetBrains Mono',monospace}
.zleg{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--inks);margin-top:12px}
.zleg span{display:flex;align-items:center;gap:6px}
.zsw{width:10px;height:10px;border-radius:3px}

/* ── proportion bars ──────────────────── */
.zbar{display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:12.5px}
.zbar-l{width:150px;flex-shrink:0;color:var(--inks);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zbar-t{flex:1;height:16px;background:var(--sf2);border-radius:4px;overflow:hidden;border:1px solid var(--ln)}
.zbar-f{height:100%;border-radius:3px}
.zbar-v{width:150px;flex-shrink:0;text-align:right;font-family:'JetBrains Mono',monospace;color:var(--mu);font-size:11.5px}

/* ── sparkline (trend bars) ───────────── */
.zspark{display:flex;align-items:flex-end;gap:2px;height:110px;padding-top:4px}
.zsc{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:0;height:100%;position:relative}
.zsc:hover .ztip{display:block}
.zsb{width:100%;border-radius:1px 1px 0 0;min-height:1px;background:var(--river)}
.zsb.ok{background:var(--nephritis)} .zsb.warn{background:var(--carrot)} .zsb.bad{background:var(--alizarin)}
.zsb.alt{background:var(--amethyst)}
.zsfoot{display:flex;justify-content:space-between;font-size:10.5px;color:var(--mu);margin-top:6px;
  font-family:'JetBrains Mono',monospace}
/* ── per-hour status strip (pipeline) ─── */
.zstrip{display:flex;gap:2px;height:26px;margin-bottom:6px}
.zsq{flex:1;border-radius:3px;min-width:3px;position:relative}
.zsq:hover .ztip{display:block}
.zsq.complete{background:var(--nephritis)}
.zsq.partial{background:var(--carrot)}
.zsq.missing{background:var(--alizarin)}
.zstrip-lbl{font-size:11px;color:var(--inks);width:64px;flex-shrink:0;font-weight:600}
.zstrip-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
`;

const IC = {
  msg:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  shield: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  block: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>,
  dlr:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  net:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7"/></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>,
  pipe: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>,
};

const fN = (n: any) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const f2 = (n: any) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fPct = (n: any) => (n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`);

const STREAM_LABEL: Record<string, string> = { ss7: 'SS7', smpp: 'SMPP', sri: 'SRI', sri_req: 'SRI' };

/**
 * Coerce any value to something safe to put in the DOM. Rendering a raw API field directly is how
 * a null becomes the text "NaN" and an object throws "Objects are not valid as a React child" —
 * both of which take the page down or print nonsense. Only primitives survive; anything else
 * becomes an em dash.
 */
const txt = (v: any): string => {
  if (v == null) return '—';
  if (typeof v === 'string') return v.length ? v : '—';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return '—';
};
/** Safe for a className: only a known stream slug, never arbitrary payload text. */
const slug = (v: any): string => (typeof v === 'string' && /^[a-z0-9_-]+$/i.test(v) ? v : '');

type TabId = 'traffic' | 'firewall' | 'delivery' | 'network' | 'pipeline';
const TABS: { id: TabId; l: string }[] = [
  { id: 'traffic',  l: 'Traffic Overview' },
  { id: 'firewall', l: 'Firewall Effectiveness' },
  { id: 'delivery', l: 'Delivery Quality' },
  { id: 'network',  l: 'Network & SRI' },
  { id: 'pipeline', l: 'Pipeline Health' },
];

const WINDOWS = [{ h: 6, l: '6h' }, { h: 24, l: '24h' }, { h: 72, l: '3d' }, { h: 168, l: '7d' }];

const ACTION_COLOR: Record<string, string> = {
  send: 'var(--nephritis)', lookup: 'var(--turquoise)', modify: 'var(--carrot)',
  positive_ack: 'var(--river)', negative_ack: 'var(--alizarin)', drop: 'var(--alizarin)',
};
const DLR_COLOR: Record<string, string> = {
  DELIVRD: 'var(--nephritis)', EXPIRED: 'var(--carrot)', UNDELIV: 'var(--alizarin)', REJECTD: 'var(--amethyst)',
};
const CODING_LABEL: Record<number, string> = { 0: 'GSM 7-bit (0)', 3: 'Latin-1 (3)', 8: 'UCS2 (8)', [-1]: 'unset' };

/** Data container: owns fetching, the window selector and the live-refresh socket. */
export default function ZamaniFirewallPage() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<TabId>('traffic');
  const [hours, setHours] = React.useState(24);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    zamaniFirewallApi.getData(hours)
      .then((r) => { setData(r.data); setDatasetId(r.data?.datasetIds?.traffic ?? null); })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [hours]);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId ?? undefined, load);

  return (
    <FirewallView data={data} loading={loading} error={error}
      tab={tab} onTab={setTab} hours={hours} onHours={setHours} />
  );
}

export type FirewallViewProps = {
  data: any; loading?: boolean; error?: string | null;
  tab?: TabId; onTab?: (t: TabId) => void; hours?: number; onHours?: (h: number) => void;
};

/**
 * Pure presentation. Split from the container so the populated branch can be rendered directly
 * against real and malformed payloads. Every field is read defensively — a report should degrade to
 * an em dash or a skipped row, never to a blank page.
 */
export function FirewallView({
  data, loading = false, error = null, tab = 'traffic', onTab, hours = 24, onHours,
}: FirewallViewProps) {
  const setTab = onTab ?? (() => {});
  const setHours = onHours ?? (() => {});
  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

  const totals = arr(data?.totals);
  const byStream = React.useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of totals) if (t && typeof t.stream === 'string') m[t.stream] = t;
    return m;
  }, [totals]);

  const totalMessages = totals.reduce((a, t) => a + num(t?.messages), 0);
  const totalRawRows = totals.reduce((a, t) => a + num(t?.rawRows), 0);
  const inflation = totalMessages > 0 ? ((totalRawRows - totalMessages) / totalMessages) * 100 : 0;

  const outcomes = arr(data?.outcomes);
  const interventions = outcomes
    .filter((o) => o?.finalAction !== 'send' && o?.finalAction !== 'lookup')
    .reduce((a, o) => a + num(o?.messages), 0);

  const chart = React.useMemo(() => buildChart(data?.series), [data]);

  const pipelineSummary = arr(data?.pipelineSummary);
  const badHours = pipelineSummary.reduce((a, p) => a + num(p?.hoursPartial) + num(p?.hoursMissing), 0);
  const failedFiles = pipelineSummary.reduce((a, p) => a + num(p?.filesFailed), 0);

  const topSenders = arr(data?.topSenders);
  const pipeline = arr(data?.pipeline);
  const daily = arr(data?.daily);
  const refreshed = (data?.refreshedAt && typeof data.refreshedAt === 'object') ? data.refreshedAt : {};

  const tags = arr(data?.tags);
  const tagSenders = arr(data?.tagSenders);
  const dlrOutcomes = arr(data?.dlrOutcomes);
  const dlrSenders = arr(data?.dlrSenders);
  const latency = arr(data?.latency);
  const sri = arr(data?.sri);
  const sriSmsc = arr(data?.sriSmsc);
  const routing = arr(data?.routing);
  const contentDefects = arr(data?.contentDefects);

  // Pipeline coverage grouped per stream and ordered oldest-first, for the timeline strip.
  const pipeStrips = React.useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const r of pipeline) {
      if (!r || typeof r.stream !== 'string') continue;
      (g[r.stream] ??= []).push(r);
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => String(a?.fileHour ?? '').localeCompare(String(b?.fileHour ?? '')));
    }
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pipeline]);

  const outcomeGroups = React.useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const o of outcomes) { if (!o || typeof o.stream !== 'string') continue; (g[o.stream] ??= []).push(o); }
    return g;
  }, [outcomes]);

  // ── page 2 derivations ────────────────────────────────────────────────────────────────────
  const tagTotal = (name: string, stream?: string) => tags
    .filter((t) => t?.tag === name && (!stream || t?.stream === stream))
    .reduce((a, t) => a + num(t?.messages), 0);

  const blocked = tags.filter((t) => String(t?.tag ?? '').startsWith('dropped_'));
  const blockedTotal = blocked.reduce((a, t) => a + num(t?.messages), 0);
  const a2p = [
    { k: 'local_a2p',   l: 'Local A2P',   c: 'var(--river)' },
    { k: 'int_a2p',     l: 'International A2P', c: 'var(--carrot)' },
    { k: 'p2p_traffic', l: 'P2P',         c: 'var(--turquoise)' },
  ].map((x) => ({ ...x, n: tagTotal(x.k) }));
  const a2pTotal = a2p.reduce((a, x) => a + x.n, 0) || 1;
  const whitelisted = tagTotal('whitelist_sender');
  // Denominator is SS7 + SMPP only: SRI lookups carry no tags at all, so including them would
  // dilute whitelist coverage with traffic that could never have been whitelisted.
  const taggableMessages = num(byStream.ss7?.messages) + num(byStream.smpp?.messages);
  const nonWhitelisted = Math.max(taggableMessages - whitelisted, 0);
  /**
   * Grey-route watch. The signal differs by stream and conflating them would manufacture false
   * positives, so it is not conflated:
   *  - SS7: `via_smscs` counts distinct SMSC *global titles*. International A2P entering through
   *    more than one is the actual grey-route shape, so those are flagged as candidates.
   *  - SMPP: it counts distinct ingress links (binds). A large aggregator legitimately uses many —
   *    WhatsApp, WAVE and Apple each show 8-10 — so the count is shown as context and never flagged.
   */
  const greyRoutes = tagSenders
    .filter((t) => t?.tag === 'int_a2p' && num(t?.viaSmscs) > 0)
    .map((t) => ({ ...t, candidate: slug(t?.stream) === 'ss7' && num(t?.viaSmscs) > 1 }))
    .sort((a, b) => (Number(b.candidate) - Number(a.candidate)) || (num(b?.messages) - num(a?.messages)));
  const greyCandidates = greyRoutes.filter((g) => g.candidate).length;

  // ── page 3 derivations ────────────────────────────────────────────────────────────────────
  const dlrByStat = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of dlrOutcomes) { const k = txt(d?.dlrStat); m[k] = (m[k] ?? 0) + num(d?.receipts); }
    return m;
  }, [dlrOutcomes]);
  const dlrTotal = Object.values(dlrByStat).reduce((a, b) => a + b, 0);
  const deliveredPct = dlrTotal > 0 ? ((dlrByStat.DELIVRD ?? 0) / dlrTotal) * 100 : null;
  const worstSenders = [...dlrSenders]
    .filter((s) => num(s?.receipts) >= 5)
    .sort((a, b) => num(a?.deliveryRate) - num(b?.deliveryRate));
  const submitLat = latency.filter((l) => l?.pduKind === 'submit');
  const latP50 = submitLat.length ? submitLat[submitLat.length - 1]?.p50Ms : null;
  const latP95 = submitLat.length ? submitLat[submitLat.length - 1]?.p95Ms : null;
  const latMaxAll = latency.reduce((a, l) => Math.max(a, num(l?.maxMs)), 0);

  // ── page 4 derivations ────────────────────────────────────────────────────────────────────
  const sriLatest = sri.length ? sri[sri.length - 1] : null;
  const sriPeakRate = sri.reduce((a, s) => Math.max(a, num(s?.requestsPerSec)), 0);
  const sriPeakProbe = sri.reduce((a, s) => Math.max(a, num(s?.requestsPerMsisdn)), 0);
  const sriTotal = sri.reduce((a, s) => a + num(s?.requests), 0);

  // ── page 5 derivations ────────────────────────────────────────────────────────────────────
  const contentTotal = contentDefects.reduce((a, c) => a + num(c?.messages), 0);
  const mojibakeTotal = contentDefects.reduce((a, c) => a + num(c?.mojibake), 0);
  const mojibakePct = contentTotal > 0 ? (mojibakeTotal / contentTotal) * 100 : null;

  const Kpi = ({ cls, ic, lbl, val, sub }: any) => (
    <div className={`zk ${cls}`}>
      <div className="zk-top"><span className="zk-lbl">{lbl}</span><span className="zk-ic">{ic}</span></div>
      <div className="zk-val">{val}</div>
      {sub ? <div className="zk-sub">{sub}</div> : null}
    </div>
  );

  /**
   * Trend bars over an hourly series. Heights are scaled to the window maximum, so a flat series
   * reads flat rather than being stretched to look like variation. `band` colours each bar by
   * threshold when the metric has one (the probing ratio, the defect rate).
   */
  const Spark = ({ rows, valueOf, labelOf, band, alt }: {
    rows: any[]; valueOf: (r: any) => number; labelOf: (r: any) => string;
    band?: (v: number) => string; alt?: boolean;
  }) => {
    const vals = rows.map((r) => num(valueOf(r)));
    const max = Math.max(1, ...vals);
    if (!rows.length) return <div className="zempty">No data in this window.</div>;
    return (
      <>
        <div className="zspark">
          {rows.map((r, i) => {
            const v = vals[i];
            const cls = band ? band(v) : (alt ? 'alt' : '');
            return (
              <div className="zsc" key={i}>
                <div className="ztip">{labelOf(r)}</div>
                <div className={`zsb ${cls}`} style={{ height: `${(v / max) * 100}%` }} />
              </div>
            );
          })}
        </div>
        <div className="zsfoot">
          <span>{hourLabel(rows[0]?.bucketHour)}</span>
          {rows.length > 2 && <span>{hourLabel(rows[Math.floor(rows.length / 2)]?.bucketHour)}</span>}
          <span>{hourLabel(rows[rows.length - 1]?.bucketHour)}</span>
        </div>
      </>
    );
  };

  const Panel = ({ title, sub, children }: any) => (
    <div className="zpnl">
      <div className="zph"><div className="zph-t">{title}</div>{sub ? <div className="zph-s">{sub}</div> : null}</div>
      {children}
    </div>
  );

  const bars = (rows: { l: string; n: number; c: string }[], total: number, fmt = fN) => (
    <div className="zpb">
      {rows.length === 0 ? <div className="zempty">No data in this window.</div> : rows.map((r) => (
        <div className="zbar" key={r.l}>
          <div className="zbar-l" title={txt(r.l)}>{txt(r.l)}</div>
          <div className="zbar-t"><div className="zbar-f" style={{ width: `${Math.max((r.n / (total || 1)) * 100, 0.4)}%`, background: r.c }} /></div>
          <div className="zbar-v">{fmt(r.n)} · {fPct((r.n / (total || 1)) * 100)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zf">
        <div className="zf-wrap">
          <div className="zf-hd">
            <div>
              <div className="zf-h1">Zamani SMS Firewall</div>
              <div className="zf-h2">
                SS7 · SMPP · SRI firewall logs. Message counts are corrected — multipart SS7 reassembled,
                SMPP acknowledgements excluded — so they do not match raw log-row counts. All times UTC.
              </div>
            </div>
            <div className="zf-dcard">
              <div className="zf-dlbl">Traffic Refreshed</div>
              <div className="zf-dval">
                {toDate(refreshed.traffic) ? <span className="zf-pulse" /> : null}
                {stamp(refreshed.traffic)}
              </div>
            </div>
          </div>

          <div className="ztabs">
            {TABS.map((t) => (
              <button key={t.id} className={`ztab${tab === t.id ? ' za' : ''}`} onClick={() => setTab(t.id)}>
                {t.l}
                {t.id === 'pipeline' && badHours > 0 ? <span className="zbadge">{fN(badHours)}</span> : null}
              </button>
            ))}
          </div>

          <div className="zbtrow">
            {WINDOWS.map((w) => (
              <button key={w.h} className={`zbt${hours === w.h ? ' za' : ''}`} onClick={() => setHours(w.h)}>Last {w.l}</button>
            ))}
            {loading ? <span style={{ fontSize: 12, color: 'var(--mu)' }}>refreshing…</span> : null}
          </div>

          {!!error && <div className="zerr">Could not load data: {error}</div>}
          {loading && !data && <div className="zskel" />}

          {/* ═══ TAB 1 · TRAFFIC OVERVIEW ═══════════════════════════════════════════════ */}
          {tab === 'traffic' && !!data && (
            <>
              {badHours > 0 && (
                <div className="zwarn">
                  <strong>{fN(badHours)} ingest hour{badHours === 1 ? '' : 's'}</strong> incomplete
                  {failedFiles > 0 ? ` (${fN(failedFiles)} file${failedFiles === 1 ? '' : 's'} failed)` : ''} —
                  volumes below undercount those hours. See Pipeline Health.
                </div>
              )}

              <div className="zf-kpis">
                <Kpi cls="kt" ic={IC.msg} lbl="MESSAGES" val={fN(totalMessages)}
                  sub={`${fN(totalRawRows)} raw rows — counting rows would overstate by ${inflation.toFixed(1)}%`} />
                <Kpi cls="kb" ic={IC.user} lbl="PEAK SUBSCRIBERS / HR" val={fN(byStream.ss7?.peakSubscribersHr)}
                  sub="Distinct SS7 IMSIs in the busiest hour. Per-hour distincts do not sum." />
                <Kpi cls="kp" ic={IC.send} lbl="PEAK SENDERS / HR" val={fN(byStream.ss7?.peakSendersHr)}
                  sub="Distinct SS7 sender IDs in the busiest hour." />
                <Kpi cls={deliveredPct != null && deliveredPct < 90 ? 'kc' : 'kg'} ic={IC.dlr}
                  lbl="DELIVERY SUCCESS" val={deliveredPct == null ? '—' : fPct(deliveredPct)}
                  sub={`${fN(dlrByStat.DELIVRD ?? 0)} DELIVRD of ${fN(dlrTotal)} SMPP receipts`} />
              </div>

              <div className="znote">{data.subscribersNote}</div>

              <Panel title="Messages per hour" sub={`stacked by stream · ${chart.cols.length} hour${chart.cols.length === 1 ? '' : 's'} with data · peak ${fN(chart.max)}/h${chart.skipped > 0 ? ` · ${fN(chart.skipped)} unreadable rows skipped` : ''}`}>
                <div className="zpb">
                  {chart.cols.length === 0 ? <div className="zempty">No traffic in this window.</div> : (
                    <>
                      <div className="zchart">
                        {chart.cols.map((c: any) => (
                          <div className="zcol" key={c.iso}>
                            <div className="ztip">{hourFull(c.iso)}<br />
                              {STREAMS.filter((s) => num((c as any)[s]) > 0).map((s) => `${STREAM_LABEL[s]} ${fN((c as any)[s])}`).join(' · ') || 'no traffic'}
                            </div>
                            {STREAMS.map((s) => (num((c as any)[s]) > 0 ? (
                              <div key={s} className={`zseg ${s}`} style={{ height: `${(num((c as any)[s]) / chart.max) * 100}%` }} />
                            ) : null))}
                            <div className="ztrack" />
                          </div>
                        ))}
                      </div>
                      <div className="zxax">
                        <span>{hourLabel(chart.cols[0].iso)}</span>
                        {chart.cols.length > 2 && <span>{hourLabel(chart.cols[Math.floor(chart.cols.length / 2)].iso)}</span>}
                        <span>{hourLabel(chart.cols[chart.cols.length - 1].iso)}</span>
                      </div>
                      <div className="zleg">
                        {STREAMS.map((s) => (
                          <span key={s}><i className="zsw" style={{ background: s === 'ss7' ? 'var(--river)' : s === 'smpp' ? 'var(--amethyst)' : 'var(--turquoise)' }} />
                            {STREAM_LABEL[s]} · {fN(byStream[s]?.messages ?? 0)} msgs</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </Panel>

              <div className="zgrid2">
                <Panel title="Outcome mix" sub="firewall verdict per stream">
                  <div className="zpb">
                    {outcomes.length === 0 ? <div className="zempty">No data.</div> : STREAMS.map((s) => {
                      const rows = outcomeGroups[s];
                      if (!rows?.length) return null;
                      const tot = rows.reduce((a, r) => a + num(r?.messages), 0) || 1;
                      return (
                        <div key={s} style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mu)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>{STREAM_LABEL[s]}</div>
                          {rows.map((r) => (
                            <div className="zbar" key={r.finalAction}>
                              <div className="zbar-l">{txt(r.finalAction)}</div>
                              <div className="zbar-t"><div className="zbar-f" style={{ width: `${Math.max((num(r?.messages) / tot) * 100, 0.4)}%`, background: ACTION_COLOR[slug(r.finalAction)] ?? 'var(--mu)' }} /></div>
                              <div className="zbar-v">{fN(r?.messages)} · {fPct((num(r?.messages) / tot) * 100)}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </Panel>

                <Panel title="Top senders" sub="by corrected message volume">
                  <div className="tbl-scroll">
                    {topSenders.length === 0 ? <div className="zempty">No sender data.</div> : (
                      <table className="zt">
                        <thead><tr><th>Sender ID</th><th>Stream</th><th>Messages</th><th>Peak Subs/h</th><th>Hours</th></tr></thead>
                        <tbody>
                          {topSenders.map((r, i) => (
                            <tr key={`${r.stream}-${r.senderId}-${i}`}>
                              <td>{txt(r.senderId)}</td>
                              <td><span className={`ztag ${slug(r.stream)}`}>{STREAM_LABEL[slug(r.stream)] ?? txt(r.stream)}</span></td>
                              <td>{fN(r.messages)}</td><td>{fN(r.peakSubscribersHr)}</td><td>{fN(r.hoursActive)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                      Sender is <code>sender_id</code>, never <code>calling_party</code> (the SMSC global title). {data.senderCapNote}
                    </div>
                  </div>
                </Panel>
              </div>

              {daily.length > 0 && (
                <Panel title="Exact daily uniques — SS7" sub="whole-day distinct counts, refreshed once daily">
                  <div className="tbl-scroll">
                    <table className="zt">
                      <thead><tr><th>Date (UTC)</th><th>Messages</th><th>Raw Rows</th><th>Unique Subscribers</th><th>Unique Senders</th><th>Msgs / Sub</th></tr></thead>
                      <tbody>
                        {daily.map((r) => (
                          <tr key={`${r.date}-${r.stream}`}>
                            <td>{String(r.date ?? '').slice(0, 10) || '—'}</td>
                            <td>{fN(r.messages)}</td><td>{fN(r.rawRows)}</td>
                            <td>{fN(r.subscribers)}</td><td>{fN(r.senders)}</td>
                            <td>{num(r?.subscribers) > 0 ? f2(num(r?.messages) / num(r.subscribers)) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                      The only honest whole-day unique counts — a day&apos;s distinct subscribers cannot be derived by
                      summing hourly buckets, so they are computed separately over the full day.
                    </div>
                  </div>
                </Panel>
              )}
            </>
          )}

          {/* ═══ TAB 2 · FIREWALL EFFECTIVENESS ═════════════════════════════════════════ */}
          {tab === 'firewall' && !!data && (
            <>
              <div className="zf-kpis">
                <Kpi cls="kt" ic={IC.shield} lbl="RULES FIRING" val={fN(new Set(tags.map((t) => txt(t?.tag)).filter((t) => t !== '—')).size)}
                  sub={`across ${fN(tags.reduce((a, t) => a + num(t?.messages), 0))} tag hits on ${fN(totalMessages)} messages`} />
                <Kpi cls={blockedTotal > 0 ? 'kr' : 'kg'} ic={IC.block} lbl="BLOCKED MESSAGES" val={fN(blockedTotal)}
                  sub={`${blocked.length} distinct dropped_* reason${blocked.length === 1 ? '' : 's'}`} />
                <Kpi cls="kc" ic={IC.send} lbl="INTERNATIONAL A2P" val={fN(tagTotal('int_a2p'))}
                  sub={`${fPct((tagTotal('int_a2p') / a2pTotal) * 100)} of classified traffic — the revenue-leakage view`} />
                <Kpi cls="kb" ic={IC.user} lbl="WHITELISTED" val={fPct(taggableMessages > 0 ? (whitelisted / taggableMessages) * 100 : null)}
                  sub={`${fN(whitelisted)} of ${fN(taggableMessages)} SS7+SMPP messages (SRI carries no tags)`} />
              </div>

              <div className="znote">{data.tagsNote}</div>

              <Panel title="Top rules by volume" sub="messages carrying each tag — overlapping flags, not a share of traffic">
                {bars(
                  [...tags].sort((a, b) => num(b?.messages) - num(a?.messages)).slice(0, 12)
                    .map((t) => ({
                      l: `${txt(t?.tag)} · ${STREAM_LABEL[slug(t?.stream)] ?? txt(t?.stream)}`,
                      n: num(t?.messages),
                      c: String(t?.tag ?? '').startsWith('dropped_') ? 'var(--alizarin)'
                        : num(t?.intervened) > 0 ? 'var(--carrot)' : 'var(--river)',
                    })),
                  Math.max(1, ...tags.map((t) => num(t?.messages))))}
              </Panel>

              <div className="zgrid2">
                <Panel title="Tag frequency" sub="which rules fire, in corrected messages">
                  <div className="tbl-scroll">
                    {tags.length === 0 ? <div className="zempty">No tag data in this window.</div> : (
                      <table className="zt">
                        <thead><tr><th>Tag</th><th>Stream</th><th>Messages</th><th>Intervened</th><th>Peak Senders/h</th></tr></thead>
                        <tbody>
                          {tags.slice(0, 60).map((r, i) => (
                            <tr key={`${r.stream}-${r.tag}-${i}`}>
                              <td>{txt(r.tag)}</td>
                              <td><span className={`ztag ${slug(r.stream)}`}>{STREAM_LABEL[slug(r.stream)] ?? txt(r.stream)}</span></td>
                              <td>{fN(r.messages)}</td>
                              <td>{num(r?.intervened) > 0 ? <span className="zpill warn">{fN(r.intervened)}</span> : fN(r.intervened)}</td>
                              <td>{fN(r.peakSendersHr)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </Panel>

                <div>
                  <Panel title="A2P classification" sub="local vs international vs P2P">
                    {bars(a2p.map((x) => ({ l: x.l, n: x.n, c: x.c })), a2pTotal)}
                  </Panel>
                  <Panel title="Whitelist coverage" sub="whitelisted vs non-whitelisted volume">
                    {bars([
                      { l: 'Whitelisted sender', n: whitelisted, c: 'var(--nephritis)' },
                      { l: 'Not whitelisted', n: nonWhitelisted, c: 'var(--alizarin)' },
                    ], taggableMessages || 1)}
                  </Panel>
                </div>
              </div>

              <Panel title="Blocked traffic" sub="the dropped_* family, by reason and sender">
                <div className="tbl-scroll">
                  {blocked.length === 0 ? <div className="zempty">Nothing blocked in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Reason</th><th>Stream</th><th>Blocked</th><th>Top senders behind it</th></tr></thead>
                      <tbody>
                        {blocked.map((b, i) => {
                          const who = tagSenders.filter((s) => s?.tag === b?.tag && s?.stream === b?.stream)
                            .sort((x, y) => num(y?.messages) - num(x?.messages)).slice(0, 4);
                          return (
                            <tr key={`${b.stream}-${b.tag}-${i}`}>
                              <td>{txt(b.tag).replace(/^dropped_/, '')}</td>
                              <td><span className={`ztag ${slug(b.stream)}`}>{STREAM_LABEL[slug(b.stream)] ?? txt(b.stream)}</span></td>
                              <td><span className="zpill bad">{fN(b.messages)}</span></td>
                              <td style={{ textAlign: 'left', fontFamily: "'Hanken Grotesk',sans-serif", whiteSpace: 'normal' }}>
                                {who.length ? who.map((w) => `${txt(w.senderId)} (${fN(w.messages)})`).join(', ') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Panel>

              <Panel title="Grey-route watch" sub={`international A2P by arrival path · ${greyCandidates} SS7 candidate${greyCandidates === 1 ? '' : 's'}`}>
                <div className="tbl-scroll">
                  {greyRoutes.length === 0 ? (
                    <div className="zempty">
                      No international A2P traffic in this window.
                      {tagTotal('dropped_int_a2p') > 0 ? ` ${fN(tagTotal('dropped_int_a2p'))} int_a2p message(s) were dropped outright.` : ''}
                    </div>
                  ) : (
                    <table className="zt">
                      <thead><tr><th>Sender ID</th><th>Stream</th><th>Int. A2P Messages</th><th>Arrival Paths</th><th>Grey Route?</th><th>Intervened</th></tr></thead>
                      <tbody>
                        {greyRoutes.slice(0, 30).map((r, i) => (
                          <tr key={`${r.senderId}-${i}`}>
                            <td>{txt(r.senderId)}</td>
                            <td><span className={`ztag ${slug(r.stream)}`}>{STREAM_LABEL[slug(r.stream)] ?? txt(r.stream)}</span></td>
                            <td>{fN(r.messages)}</td>
                            <td><span className={`zpill ${r.candidate ? 'warn' : 'info'}`}>{fN(r.viaSmscs)}</span></td>
                            <td>{r.candidate
                              ? <span className="zpill bad">candidate</span>
                              : <span style={{ color: 'var(--mu)' }}>—</span>}</td>
                            <td>{fN(r.intervened)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                    Only SS7 rows are flagged. There, arrival paths are distinct SMSC global titles and more than one
                    for international A2P is the grey-route shape. On SMPP the count is distinct ingress binds, which a
                    large aggregator legitimately spreads across — flagging those would be a false positive.
                  </div>
                </div>
              </Panel>
            </>
          )}

          {/* ═══ TAB 3 · DELIVERY QUALITY ═══════════════════════════════════════════════ */}
          {tab === 'delivery' && !!data && (
            <>
              <div className="zf-kpis">
                <Kpi cls={deliveredPct != null && deliveredPct < 90 ? 'kc' : 'kg'} ic={IC.dlr} lbl="DELIVERED"
                  val={deliveredPct == null ? '—' : fPct(deliveredPct)} sub={`${fN(dlrByStat.DELIVRD ?? 0)} of ${fN(dlrTotal)} receipts`} />
                <Kpi cls="kc" ic={IC.clock} lbl="EXPIRED" val={fN(dlrByStat.EXPIRED ?? 0)}
                  sub={dlrTotal > 0 ? `${fPct(((dlrByStat.EXPIRED ?? 0) / dlrTotal) * 100)} of receipts` : '—'} />
                <Kpi cls="kr" ic={IC.block} lbl="UNDELIVERABLE" val={fN((dlrByStat.UNDELIV ?? 0) + (dlrByStat.REJECTD ?? 0))}
                  sub={`${fN(dlrByStat.UNDELIV ?? 0)} UNDELIV · ${fN(dlrByStat.REJECTD ?? 0)} REJECTD`} />
                <Kpi cls="kb" ic={IC.clock} lbl="SUBMIT LATENCY p50 / p95"
                  val={latP50 == null ? '—' : `${fN(latP50)} / ${fN(latP95)}`} sub={`ms · slowest matched pair ${fN(latMaxAll)} ms`} />
              </div>

              <div className="znote">
                {data.latencyNote} SS7 has no equivalent: the status-report fields are not stored, so this page is
                SMPP-only.
              </div>

              <div className="zgrid2">
                <Panel title="DLR outcomes" sub="share of delivery receipts">
                  {bars(Object.entries(dlrByStat).sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => ({ l: k, n: v, c: DLR_COLOR[k] ?? 'var(--mu)' })), dlrTotal || 1)}
                </Panel>

                <Panel title="Error breakdown" sub="dlr_err and network error code">
                  <div className="tbl-scroll" style={{ maxHeight: 340 }}>
                    {dlrOutcomes.length === 0 ? <div className="zempty">No receipts in this window.</div> : (
                      <table className="zt">
                        <thead><tr><th>Status</th><th>DLR Err</th><th>Network Err</th><th>Receipts</th></tr></thead>
                        <tbody>
                          {dlrOutcomes.slice(0, 40).map((r, i) => (
                            <tr key={i}>
                              <td><span className="zpill" style={{ background: 'transparent', color: DLR_COLOR[slug(r.dlrStat)] ?? 'var(--mu)' }}>{txt(r.dlrStat)}</span></td>
                              <td>{txt(r.dlrErr)}</td><td>{txt(r.networkErrorCode)}</td><td>{fN(r.receipts)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                      <code>command_status</code> is not shown: it is 0 on every response in the loaded data, so a panel
                      for it would only ever display one value.
                    </div>
                  </div>
                </Panel>
              </div>

              <Panel title="Delivery rate by sender" sub="worst first — identifies bad routes (senders with at least 5 receipts)">
                <div className="tbl-scroll">
                  {worstSenders.length === 0 ? <div className="zempty">No sender has enough receipts in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Sender ID</th><th>Delivery Rate</th><th>Receipts</th><th>DELIVRD</th><th>EXPIRED</th><th>UNDELIV</th><th>REJECTD</th><th>Peak Dests/h</th></tr></thead>
                      <tbody>
                        {worstSenders.slice(0, 40).map((r, i) => {
                          const rate = r?.deliveryRate;
                          const cls = rate == null ? 'info' : rate >= 95 ? 'ok' : rate >= 80 ? 'warn' : 'bad';
                          return (
                            <tr key={`${r.senderId}-${i}`}>
                              <td>{txt(r.senderId)}</td>
                              <td><span className={`zpill ${cls}`}>{rate == null ? '—' : fPct(rate)}</span></td>
                              <td>{fN(r.receipts)}</td><td>{fN(r.delivered)}</td><td>{fN(r.expired)}</td>
                              <td>{fN(r.undeliv)}</td><td>{fN(r.rejectd)}</td><td>{fN(r.peakDestinationsHr)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Panel>

              <Panel title="Submit latency trend" sub="p95 per hour (submit-sm), scaled to the window maximum">
                <div className="zpb">
                  <Spark rows={submitLat}
                    valueOf={(r) => num(r?.p95Ms)}
                    labelOf={(r) => `${hourFull(r?.bucketHour)} · p50 ${fN(r?.p50Ms)}ms · p95 ${fN(r?.p95Ms)}ms · ${fN(r?.pairs)} pairs`}
                    band={(v) => (v >= 1000 ? 'bad' : v >= 300 ? 'warn' : 'ok')} />
                </div>
              </Panel>

              <Panel title="Submit → response latency" sub="percentiles per hour, paired within a bind">
                <div className="tbl-scroll" style={{ maxHeight: 340 }}>
                  {latency.length === 0 ? <div className="zempty">No matched request/response pairs in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Hour (UTC)</th><th>PDU</th><th>Pairs</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>max ms</th></tr></thead>
                      <tbody>
                        {latency.map((r, i) => (
                          <tr key={i}>
                            <td>{hourFull(r.bucketHour)}</td>
                            <td><span className="zpill info">{txt(r.pduKind)}</span></td>
                            <td>{fN(r.pairs)}</td><td>{fN(r.p50Ms)}</td><td>{fN(r.p95Ms)}</td>
                            <td>{fN(r.p99Ms)}</td><td>{fN(r.maxMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </Panel>
            </>
          )}

          {/* ═══ TAB 4 · NETWORK & SRI ══════════════════════════════════════════════════ */}
          {tab === 'network' && !!data && (
            <>
              <div className="zf-kpis">
                <Kpi cls="kt" ic={IC.search} lbl="SRI REQUESTS" val={fN(sriTotal)}
                  sub={`peak ${f2(sriPeakRate)} req/sec (hourly average — bursts are understated)`} />
                <Kpi cls={sriPeakProbe >= 2 ? 'kc' : 'kg'} ic={IC.warn} lbl="PEAK REQ / MSISDN" val={f2(sriPeakProbe)}
                  sub={sriPeakProbe >= 2
                    ? 'Above 2 — the same numbers are being queried repeatedly. Watch for enumeration.'
                    : 'Near 1.0 is healthy: roughly one lookup per message.'} />
                <Kpi cls="kb" ic={IC.net} lbl="QUERYING SMSCS" val={fN(sriLatest?.smscs)}
                  sub={`${fN(sriLatest?.callers)} distinct calling global titles in the latest hour`} />
                <Kpi cls="kp" ic={IC.net} lbl="SS7 ROUTES" val={fN(routing.length)}
                  sub="distinct (traffic source, OPC, DPC, SMSC GT) combinations carrying traffic" />
              </div>

              <div className="znote">
                <strong>Requests per MSISDN is the probing detector.</strong> One lookup per delivered message is
                normal; a sustained rise means the same numbers are being queried again and again, and sequential
                MSISDN ranges would indicate enumeration. It is reported per hour because a daily average would
                flatten exactly the spike worth seeing.
              </div>

              <div className="zgrid2">
                <Panel title="SRI requests per hour" sub="lookup volume">
                  <div className="zpb">
                    <Spark rows={sri} alt
                      valueOf={(r) => num(r?.requests)}
                      labelOf={(r) => `${hourFull(r?.bucketHour)} · ${fN(r?.requests)} requests · ${f2(r?.requestsPerSec)}/sec`} />
                  </div>
                </Panel>
                <Panel title="Requests per MSISDN — probing detector" sub="green under 2, amber 2-3, red above 3">
                  <div className="zpb">
                    <Spark rows={sri}
                      valueOf={(r) => num(r?.requestsPerMsisdn)}
                      labelOf={(r) => `${hourFull(r?.bucketHour)} · ${f2(r?.requestsPerMsisdn)} req/MSISDN · ${fN(r?.msisdns)} numbers`}
                      band={(v) => (v >= 3 ? 'bad' : v >= 2 ? 'warn' : 'ok')} />
                  </div>
                </Panel>
              </div>

              <Panel title="SRI request rate" sub="requests, distinct MSISDNs and the probing ratio per hour">
                <div className="tbl-scroll" style={{ maxHeight: 340 }}>
                  {sri.length === 0 ? <div className="zempty">No SRI traffic in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Hour (UTC)</th><th>Requests</th><th>Req / sec</th><th>MSISDNs</th><th>Req / MSISDN</th><th>SMSCs</th><th>Callers</th></tr></thead>
                      <tbody>
                        {[...sri].reverse().map((r, i) => {
                          const p = num(r?.requestsPerMsisdn);
                          return (
                            <tr key={i}>
                              <td>{hourFull(r.bucketHour)}</td>
                              <td>{fN(r.requests)}</td><td>{f2(r.requestsPerSec)}</td><td>{fN(r.msisdns)}</td>
                              <td><span className={`zpill ${p >= 3 ? 'bad' : p >= 2 ? 'warn' : 'ok'}`}>{f2(p)}</span></td>
                              <td>{fN(r.smscs)}</td><td>{fN(r.callers)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </Panel>

              <div className="zgrid2">
                <Panel title="Distinct MSISDNs per source SMSC" sub="which node is driving the lookups">
                  <div className="tbl-scroll">
                    {sriSmsc.length === 0 ? <div className="zempty">No SRI source data.</div> : (
                      <table className="zt">
                        <thead><tr><th>SMSC</th><th>Calling GT</th><th>Requests</th><th>Peak MSISDNs/h</th><th>Peak Req/MSISDN</th></tr></thead>
                        <tbody>
                          {sriSmsc.map((r, i) => {
                            const p = num(r?.peakReqPerMsisdn);
                            return (
                              <tr key={i}>
                                <td>{txt(r.smsc)}</td><td>{txt(r.callingParty)}</td><td>{fN(r.requests)}</td>
                                <td>{fN(r.peakMsisdnsHr)}</td>
                                <td><span className={`zpill ${p >= 3 ? 'bad' : p >= 2 ? 'warn' : 'ok'}`}>{f2(p)}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </Panel>

                <Panel title="SS7 routing" sub="OPC/DPC pairs and traffic sources, on deduped messages">
                  <div className="tbl-scroll">
                    {routing.length === 0 ? <div className="zempty">No routing data.</div> : (
                      <table className="zt">
                        <thead><tr><th>Traffic Source</th><th>OPC</th><th>DPC</th><th>Messages</th><th>Intervened</th></tr></thead>
                        <tbody>
                          {routing.map((r, i) => (
                            <tr key={i}>
                              <td>{txt(r.trafficSourceName)}</td>
                              <td>{fN(r.opc)}</td><td>{fN(r.dpc)}</td><td>{fN(r.messages)}</td>
                              <td>{num(r?.intervened) > 0 ? <span className="zpill warn">{fN(r.intervened)}</span> : '0'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                      This is the one place <code>calling_party</code> is meaningful — as the interconnect identity it
                      actually is, never as the message sender.
                    </div>
                  </div>
                </Panel>
              </div>
            </>
          )}

          {/* ═══ TAB 5 · PIPELINE HEALTH ════════════════════════════════════════════════ */}
          {tab === 'pipeline' && !!data && (
            <>
              <div className="zf-kpis">
                {pipelineSummary.map((p) => (
                  <Kpi key={p.stream} cls={num(p?.hoursMissing) > 0 ? 'kr' : num(p?.hoursPartial) > 0 ? 'kc' : 'kg'}
                    ic={IC.pipe} lbl={`${STREAM_LABEL[slug(p.stream)] ?? txt(p.stream)} — COMPLETE HOURS`} val={fN(p.hoursComplete)}
                    sub={<>{fN(p.hoursPartial)} partial · {fN(p.hoursMissing)} missing · {fN(p.filesFailed)} failed files
                      {toDate(p.latestHour) ? <><br />latest {hourFull(p.latestHour)}</> : null}</>} />
                ))}
                <Kpi cls={mojibakePct != null && mojibakePct > 5 ? 'kc' : 'kg'} ic={IC.warn} lbl="CONTENT DEFECT RATE"
                  val={mojibakePct == null ? '—' : fPct(mojibakePct)}
                  sub={`${fN(mojibakeTotal)} of ${fN(contentTotal)} SMPP messages double-encoded at source`} />
              </div>

              <div className="znote">
                An hour is <strong>complete</strong> when every delivered file loaded, <strong>partial</strong> when some
                failed, <strong>missing</strong> when none did. The traffic hour is anchored on the file&apos;s
                modification time, not its name — the name carries a 12-hour clock with no AM/PM and names the rotation
                hour, one ahead of the traffic it holds.
              </div>

              <Panel title="Ingest coverage timeline" sub="one block per traffic hour, oldest left — green complete, amber partial, red missing">
                <div className="zpb">
                  {pipeStrips.length === 0 ? <div className="zempty">No ingest history in this window.</div> : pipeStrips.map(([stream, rows]) => (
                    <div className="zstrip-row" key={stream}>
                      <span className="zstrip-lbl">{STREAM_LABEL[slug(stream)] ?? txt(stream)}</span>
                      <div className="zstrip">
                        {rows.map((r: any, i: number) => (
                          <div key={i} className={`zsq ${slug(r?.hourStatus) || 'missing'}`}>
                            <div className="ztip">{hourFull(r?.fileHour)} · {txt(r?.hourStatus)} · {fN(r?.filesLoaded)}/{fN(r?.filesSeen)} files · {fN(r?.rowsLoaded)} rows</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Content-encoding defect rate" sub="double-encoded at source, per data_coding">
                <div className="tbl-scroll" style={{ maxHeight: 260 }}>
                  {contentDefects.length === 0 ? <div className="zempty">No SMPP content in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Data Coding</th><th>Messages</th><th>Mojibake</th><th>Defect Rate</th><th>Null Content</th></tr></thead>
                      <tbody>
                        {contentDefects.map((r, i) => {
                          const p = num(r?.mojibakePct);
                          return (
                            <tr key={i}>
                              <td>{CODING_LABEL[num(r?.dataCoding)] ?? `code ${fN(r?.dataCoding)}`}</td>
                              <td>{fN(r.messages)}</td><td>{fN(r.mojibake)}</td>
                              <td><span className={`zpill ${p > 10 ? 'bad' : p > 0 ? 'warn' : 'ok'}`}>{fPct(p)}</span></td>
                              <td>{fN(r.nullContent)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                    UTF-8 bytes declared as Latin-1, so the text reads back as mojibake. Broken out per
                    <code> data_coding</code> because an overall rate moves with the encoding mix and would mask
                    whether the source bug itself changed — the damage sits entirely in Latin-1 (3).
                  </div>
                </div>
              </Panel>

              <Panel title="Ingest coverage per hour" sub="most recent first · retries collapsed per file">
                <div className="tbl-scroll" style={{ maxHeight: 620 }}>
                  {pipeline.length === 0 ? <div className="zempty">No ingest rows in this window.</div> : (
                    <table className="zt">
                      <thead><tr><th>Traffic Hour (UTC)</th><th>Stream</th><th>Status</th><th>Loaded / Seen</th><th>Nodes</th><th>Rows</th><th>Rejected</th><th>Attempts</th><th>Last Error</th></tr></thead>
                      <tbody>
                        {pipeline.map((r, i) => (
                          <tr key={`${r.stream}-${r.fileHour}-${i}`}>
                            <td>{hourFull(r.fileHour)}</td>
                            <td><span className={`ztag ${slug(r.stream)}`}>{STREAM_LABEL[slug(r.stream)] ?? txt(r.stream)}</span></td>
                            <td><span className={`zpill ${r.hourStatus === 'complete' ? 'ok' : r.hourStatus === 'partial' ? 'warn' : 'bad'}`}>{txt(r.hourStatus)}</span></td>
                            <td>{fN(r.filesLoaded)} / {fN(r.filesSeen)}</td>
                            <td>{fN(r.nodesSeen)}</td><td>{fN(r.rowsLoaded)}</td>
                            <td style={num(r?.rowsRejected) > 0 ? { color: 'var(--carrot)', fontWeight: 700 } : undefined}>{fN(r.rowsRejected)}</td>
                            <td>{fN(r.attempts)}</td>
                            <td style={{ textAlign: 'left', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: r.lastError ? 'var(--alizarin)' : 'var(--mu)', fontFamily: "'Hanken Grotesk',sans-serif" }} title={r.lastError ?? ''}>
                              {txt(r.lastError)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="zpb" style={{ paddingTop: 10, paddingBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: 'var(--mu)', lineHeight: 1.5 }}>
                    Pipeline refreshed {stamp(refreshed.pipeline)}. <code>rows_rejected</code> is 0 throughout because
                    the loader fails a whole file rather than skipping bad rows — a single defect costs an entire
                    node-hour.
                  </div>
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}
