'use client';

import * as React from 'react';
import { zamaniFirewallApi } from '@/lib/api';
import { useDatasetSocket } from '@/hooks/useDatasetSocket';

const CSS = `
.zf{
  --sf:#ffffff;--sf2:#f5f8fa;
  --ink:#1e293b;--inks:#475569;--mu:#94a3b8;
  --ln:#e2e8f0;--lns:#cbd5e1;
  --danger:#dc2626;--danger-bg:rgba(220,38,38,.07);--danger-bd:rgba(220,38,38,.25);
  --warn:#d97706;--warn-bg:rgba(217,119,6,.10);--warn-bd:rgba(217,119,6,.35);
  --ok:#16a34a;--ok-bg:rgba(22,163,74,.10);--ok-bd:rgba(22,163,74,.30);
  --accent:#2563eb;
  --ss7:#2563eb;--smpp:#7c3aed;--sri:#0891b2;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);
}
.dark .zf{
  --sf:#1e293b;--sf2:#162032;--ink:#e2e8f0;--inks:#94a3b8;--mu:#64748b;--ln:#1e3a5f;--lns:#2d4e6e;
  --danger-bg:rgba(220,38,38,.12);--danger-bd:rgba(220,38,38,.35);
  --warn-bg:rgba(217,119,6,.14);--ok-bg:rgba(22,163,74,.14);
  --ss7:#60a5fa;--smpp:#a78bfa;--sri:#22d3ee;
}
.zf-body{max-width:1600px;margin:0 auto;padding:22px 20px 48px}
.zf-hdr{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.zf-title{font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
.zf-sub{font-size:.74rem;color:var(--mu);margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.zf-dot{width:7px;height:7px;background:#22c55e;border-radius:50%;animation:zf-blink 2s infinite}
@keyframes zf-blink{0%,100%{opacity:1}50%{opacity:.3}}
.zf-lu{text-align:right}
.zf-lu-lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mu);display:block}
.zf-lu-val{font-size:.8rem;font-weight:600;font-variant-numeric:tabular-nums}
.zf-tabs{display:flex;gap:4px;border-bottom:1px solid var(--ln);margin-bottom:16px}
.zf-tab{padding:8px 15px;border:none;background:none;color:var(--mu);font-size:.83rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.zf-tab:hover{color:var(--inks)}
.zf-tab.on{color:var(--accent);border-bottom-color:var(--accent)}
.zf-filt{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.zf-tbtn{height:31px;padding:0 12px;border:1px solid var(--lns);border-radius:7px;background:var(--sf);color:var(--inks);font-size:.77rem;font-weight:500;cursor:pointer}
.zf-tbtn:hover{border-color:#94a3b8}
.zf-tbtn.on{background:rgba(37,99,235,.10);border-color:rgba(37,99,235,.35);color:var(--accent);font-weight:700}
.zf-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}
@media(max-width:900px){.zf-cards{grid-template-columns:repeat(2,1fr)}}
.zf-card{padding:13px 16px;border-radius:10px;background:var(--sf);border:1px solid var(--ln)}
.zf-card-num{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums;line-height:1;margin-bottom:4px}
.zf-card-lbl{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--mu)}
.zf-card-hint{font-size:.67rem;color:var(--mu);margin-top:5px;line-height:1.35}
.zf-card.danger{border-color:var(--danger-bd);background:var(--danger-bg)}
.zf-card.danger .zf-card-num{color:var(--danger)}
.zf-card.warn{border-color:var(--warn-bd);background:var(--warn-bg)}
.zf-card.warn .zf-card-num{color:var(--warn)}
.zf-note{font-size:.7rem;color:var(--mu);margin:10px 0 18px;line-height:1.5;padding:8px 12px;border-left:2px solid var(--lns);background:var(--sf2);border-radius:0 6px 6px 0}
.zf-err{background:var(--danger-bg);border:1px solid var(--danger-bd);color:var(--danger);border-radius:8px;padding:11px 16px;font-size:.83rem;margin-bottom:12px}
.zf-warnbox{background:var(--warn-bg);border:1px solid var(--warn-bd);color:var(--warn);border-radius:8px;padding:10px 15px;font-size:.79rem;margin-bottom:14px;line-height:1.5}
.zf-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
@media(max-width:1100px){.zf-grid{grid-template-columns:1fr}}
.zf-panel{border-radius:10px;border:1px solid var(--ln);background:var(--sf);overflow:hidden}
.zf-panel-hd{padding:11px 15px;border-bottom:1px solid var(--ln);background:var(--sf2);display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.zf-panel-ti{font-size:.83rem;font-weight:700}
.zf-panel-sub{font-size:.68rem;color:var(--mu)}
.zf-panel-bd{padding:14px 15px}
.zf-tbl{width:100%;border-collapse:collapse;font-size:.78rem}
.zf-tbl thead tr{background:var(--sf2);border-bottom:2px solid var(--lns)}
.zf-tbl th{padding:8px 10px;text-align:right;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);white-space:nowrap;position:sticky;top:0;background:var(--sf2);z-index:1}
.zf-tbl th.l{text-align:left}
.zf-tbl td{padding:7px 10px;text-align:right;border-bottom:1px solid var(--ln);font-variant-numeric:tabular-nums;white-space:nowrap}
.zf-tbl td.l{text-align:left}
.zf-tbl td.mono{font-family:'Courier New',monospace;font-size:.75rem}
.zf-tbl tbody tr:hover td{background:rgba(37,99,235,.04)}
.zf-tbl-wrap{overflow:auto;max-height:430px}
.zf-empty{text-align:center;color:var(--mu);padding:34px 20px;font-size:.82rem}
.zf-pill{display:inline-block;padding:1px 8px;border-radius:5px;font-size:.66rem;font-weight:700;white-space:nowrap;text-transform:uppercase;letter-spacing:.04em}
.zf-pill.complete{background:var(--ok-bg);color:var(--ok);border:1px solid var(--ok-bd)}
.zf-pill.partial{background:var(--warn-bg);color:var(--warn);border:1px solid var(--warn-bd)}
.zf-pill.missing{background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-bd)}
.zf-tag{display:inline-block;padding:1px 7px;border-radius:5px;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:1px solid var(--lns);color:var(--inks)}
.zf-tag.ss7{color:var(--ss7);border-color:var(--ss7);background:rgba(37,99,235,.08)}
.zf-tag.smpp{color:var(--smpp);border-color:var(--smpp);background:rgba(124,58,237,.08)}
.zf-tag.sri,.zf-tag.sri_req{color:var(--sri);border-color:var(--sri);background:rgba(8,145,178,.08)}
/* Stacked hourly bars. Height is set inline from the value; the track keeps a baseline visible
   for hours that carry no traffic, so a gap reads as a gap and not as a missing chart. */
.zf-chart{display:flex;align-items:flex-end;gap:2px;height:180px;padding-top:6px}
.zf-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-width:0;height:100%;position:relative}
.zf-col:hover .zf-tip{display:block}
.zf-seg{width:100%;border-radius:1px 1px 0 0}
.zf-seg.ss7{background:var(--ss7)}
.zf-seg.smpp{background:var(--smpp)}
.zf-seg.sri{background:var(--sri)}
.zf-track{width:100%;height:1px;background:var(--lns)}
.zf-tip{display:none;position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:6px;background:var(--ink);color:var(--sf);font-size:.68rem;padding:5px 8px;border-radius:5px;white-space:nowrap;z-index:5;pointer-events:none;font-variant-numeric:tabular-nums}
.dark .zf-tip{background:#0f172a;color:#e2e8f0;border:1px solid var(--lns)}
.zf-xax{display:flex;justify-content:space-between;font-size:.63rem;color:var(--mu);margin-top:5px;font-variant-numeric:tabular-nums}
.zf-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:.7rem;color:var(--inks);margin-top:10px}
.zf-leg span{display:flex;align-items:center;gap:5px}
.zf-sw{width:9px;height:9px;border-radius:2px}
/* Outcome-mix bars: proportion of messages per firewall verdict. */
.zf-bar{display:flex;align-items:center;gap:9px;margin-bottom:8px;font-size:.76rem}
.zf-bar-lbl{width:104px;flex-shrink:0;color:var(--inks);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.zf-bar-track{flex:1;height:15px;background:var(--sf2);border-radius:3px;overflow:hidden;border:1px solid var(--ln)}
.zf-bar-fill{height:100%;border-radius:2px}
.zf-bar-val{width:118px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums;color:var(--mu);font-size:.73rem}
.zf-foot{margin-top:9px;font-size:.71rem;color:var(--mu)}
`;

const fN = (n: any) => (n != null ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
const fPct = (n: any) => (n != null ? `${Number(n).toFixed(2)}%` : '—');

const STREAMS = ['ss7', 'smpp', 'sri'] as const;
const STREAM_LABEL: Record<string, string> = { ss7: 'SS7', smpp: 'SMPP', sri: 'SRI', sri_req: 'SRI' };
const WINDOWS = [
  { h: 6,   label: '6h' },
  { h: 24,  label: '24h' },
  { h: 72,  label: '3d' },
  { h: 168, label: '7d' },
];

// Firewall verdict colours: anything that is not a plain "send" is a firewall intervention.
const ACTION_COLOR: Record<string, string> = {
  send:         'var(--ok)',
  lookup:       'var(--sri)',
  modify:       'var(--warn)',
  positive_ack: 'var(--accent)',
  negative_ack: 'var(--danger)',
  drop:         'var(--danger)',
};

const hourLabel = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
};
const hourFull = (iso: string) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
};

export default function ZamaniFirewallPage() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'traffic' | 'pipeline'>('traffic');
  const [hours, setHours] = React.useState(24);
  const [datasetId, setDatasetId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true); setError(null);
    zamaniFirewallApi.getData(hours)
      .then((r) => {
        setData(r.data);
        setDatasetId(r.data?.datasetIds?.traffic ?? null);
      })
      .catch((err: any) => setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load data'))
      .finally(() => setLoading(false));
  }, [hours]);

  React.useEffect(() => { load(); }, [load]);
  useDatasetSocket(datasetId ?? undefined, load);

  const totals: any[] = data?.totals ?? [];
  const byStream = React.useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of totals) m[t.stream] = t;
    return m;
  }, [totals]);

  const totalMessages = totals.reduce((a, t) => a + t.messages, 0);
  const totalRawRows  = totals.reduce((a, t) => a + t.rawRows, 0);
  // The whole point of the semantic layer: show how far a naive row count would have been off.
  const inflation = totalMessages > 0 ? ((totalRawRows - totalMessages) / totalMessages) * 100 : 0;

  const outcomes: any[] = data?.outcomes ?? [];
  const interventions = outcomes
    .filter((o) => o.finalAction !== 'send' && o.finalAction !== 'lookup')
    .reduce((a, o) => a + o.messages, 0);

  // Hourly series pivoted to one column per hour, stacked by stream.
  const chart = React.useMemo(() => {
    const rows: any[] = data?.series ?? [];
    const byHour = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const k = new Date(r.bucketHour).toISOString();
      if (!byHour.has(k)) byHour.set(k, {});
      byHour.get(k)![r.stream] = (byHour.get(k)![r.stream] ?? 0) + r.messages;
    }
    const cols = Array.from(byHour.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, v]) => ({ iso, ...v, total: STREAMS.reduce((a, s) => a + ((v as any)[s] ?? 0), 0) }));
    const max = Math.max(1, ...cols.map((c) => c.total));
    return { cols, max };
  }, [data]);

  const pipelineSummary: any[] = data?.pipelineSummary ?? [];
  const badHours = pipelineSummary.reduce((a, p) => a + p.hoursPartial + p.hoursMissing, 0);
  const failedFiles = pipelineSummary.reduce((a, p) => a + p.filesFailed, 0);

  const topSenders: any[] = data?.topSenders ?? [];
  const pipeline: any[] = data?.pipeline ?? [];
  const daily: any[] = data?.daily ?? [];
  const refreshed = data?.refreshedAt ?? {};

  const outcomeGroups = React.useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const o of outcomes) {
      (g[o.stream] ??= []).push(o);
    }
    return g;
  }, [outcomes]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zf">
        <div className="zf-body">
          <div className="zf-hdr">
            <div>
              <div className="zf-title">Zamani SMS Firewall</div>
              <div className="zf-sub">
                <span className="zf-dot" />
                SS7 · SMPP · SRI firewall logs · corrected message counts (multipart reassembled, SMPP responses excluded) · all times UTC
              </div>
            </div>
            {refreshed.traffic && (
              <div className="zf-lu">
                <span className="zf-lu-lbl">Traffic Refreshed</span>
                <span className="zf-lu-val">{new Date(refreshed.traffic).toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="zf-tabs">
            <button className={`zf-tab${tab === 'traffic' ? ' on' : ''}`} onClick={() => setTab('traffic')}>Traffic Overview</button>
            <button className={`zf-tab${tab === 'pipeline' ? ' on' : ''}`} onClick={() => setTab('pipeline')}>
              Pipeline Health{badHours > 0 ? ` (${badHours})` : ''}
            </button>
          </div>

          {error && <div className="zf-err">Could not load data: {error}</div>}
          {loading && !data && <div className="zf-empty">Loading…</div>}

          {tab === 'traffic' && data && (
            <>
              <div className="zf-filt">
                {WINDOWS.map((w) => (
                  <button key={w.h} className={`zf-tbtn${hours === w.h ? ' on' : ''}`} onClick={() => setHours(w.h)}>
                    Last {w.label}
                  </button>
                ))}
              </div>

              {badHours > 0 && (
                <div className="zf-warnbox">
                  <strong>{badHours} ingest hour{badHours === 1 ? '' : 's'}</strong> {badHours === 1 ? 'is' : 'are'} incomplete
                  {failedFiles > 0 ? ` (${fN(failedFiles)} file${failedFiles === 1 ? '' : 's'} failed to load)` : ''} —
                  the volumes below undercount those hours. See Pipeline Health.
                </div>
              )}

              <div className="zf-cards">
                <div className="zf-card">
                  <div className="zf-card-num">{fN(totalMessages)}</div>
                  <div className="zf-card-lbl">Messages</div>
                  <div className="zf-card-hint">Corrected count. {fN(totalRawRows)} raw log rows — counting rows would overstate by {inflation.toFixed(1)}%.</div>
                </div>
                <div className="zf-card">
                  <div className="zf-card-num">{fN(byStream.ss7?.peakSubscribersHr)}</div>
                  <div className="zf-card-lbl">Peak Subscribers / Hour</div>
                  <div className="zf-card-hint">Distinct SS7 IMSIs in the busiest hour. Per-hour distincts cannot be summed into a window total.</div>
                </div>
                <div className="zf-card">
                  <div className="zf-card-num">{fN(byStream.ss7?.peakSendersHr)}</div>
                  <div className="zf-card-lbl">Peak Senders / Hour</div>
                  <div className="zf-card-hint">Distinct SS7 sender IDs in the busiest hour.</div>
                </div>
                <div className={`zf-card${interventions > 0 ? ' warn' : ''}`}>
                  <div className="zf-card-num">{fN(interventions)}</div>
                  <div className="zf-card-lbl">Firewall Interventions</div>
                  <div className="zf-card-hint">Messages not plainly sent — modified, dropped or acked.</div>
                </div>
              </div>

              <div className="zf-note">{data.subscribersNote}</div>

              <div className="zf-panel" style={{ marginBottom: 18 }}>
                <div className="zf-panel-hd">
                  <div className="zf-panel-ti">Messages per hour</div>
                  <div className="zf-panel-sub">stacked by stream · {chart.cols.length} hour{chart.cols.length === 1 ? '' : 's'} with data · peak {fN(chart.max)}/h</div>
                </div>
                <div className="zf-panel-bd">
                  {chart.cols.length === 0 ? (
                    <div className="zf-empty">No traffic in this window.</div>
                  ) : (
                    <>
                      <div className="zf-chart">
                        {chart.cols.map((c: any) => (
                          <div className="zf-col" key={c.iso}>
                            <div className="zf-tip">
                              {hourFull(c.iso)}<br />
                              {STREAMS.filter((s) => c[s]).map((s) => `${STREAM_LABEL[s]} ${fN(c[s])}`).join(' · ') || 'no traffic'}
                            </div>
                            {STREAMS.map((s) => (c[s] ? (
                              <div key={s} className={`zf-seg ${s}`} style={{ height: `${(c[s] / chart.max) * 100}%` }} />
                            ) : null))}
                            <div className="zf-track" />
                          </div>
                        ))}
                      </div>
                      <div className="zf-xax">
                        <span>{hourLabel(chart.cols[0].iso)}</span>
                        {chart.cols.length > 2 && <span>{hourLabel(chart.cols[Math.floor(chart.cols.length / 2)].iso)}</span>}
                        <span>{hourLabel(chart.cols[chart.cols.length - 1].iso)}</span>
                      </div>
                      <div className="zf-leg">
                        {STREAMS.map((s) => (
                          <span key={s}>
                            <i className="zf-sw" style={{ background: `var(--${s})` }} />
                            {STREAM_LABEL[s]} · {fN(byStream[s]?.messages ?? 0)} msgs
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="zf-grid">
                <div className="zf-panel">
                  <div className="zf-panel-hd">
                    <div className="zf-panel-ti">Outcome mix</div>
                    <div className="zf-panel-sub">firewall verdict per stream</div>
                  </div>
                  <div className="zf-panel-bd">
                    {outcomes.length === 0 ? <div className="zf-empty">No data.</div> : STREAMS.map((s) => {
                      const rows = outcomeGroups[s];
                      if (!rows?.length) return null;
                      const tot = rows.reduce((a, r) => a + r.messages, 0) || 1;
                      return (
                        <div key={s} style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--mu)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            {STREAM_LABEL[s]}
                          </div>
                          {rows.map((r) => (
                            <div className="zf-bar" key={r.finalAction}>
                              <div className="zf-bar-lbl" title={r.finalAction}>{r.finalAction}</div>
                              <div className="zf-bar-track">
                                <div className="zf-bar-fill" style={{
                                  width: `${Math.max((r.messages / tot) * 100, 0.4)}%`,
                                  background: ACTION_COLOR[r.finalAction] ?? 'var(--mu)',
                                }} />
                              </div>
                              <div className="zf-bar-val">{fN(r.messages)} · {fPct((r.messages / tot) * 100)}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="zf-panel">
                  <div className="zf-panel-hd">
                    <div className="zf-panel-ti">Top senders</div>
                    <div className="zf-panel-sub">by corrected message volume</div>
                  </div>
                  <div className="zf-tbl-wrap">
                    {topSenders.length === 0 ? <div className="zf-empty">No sender data.</div> : (
                      <table className="zf-tbl">
                        <thead>
                          <tr>
                            <th className="l">Sender ID</th>
                            <th className="l">Stream</th>
                            <th>Messages</th>
                            <th>Peak Subs/h</th>
                            <th>Hours</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topSenders.map((r, i) => (
                            <tr key={`${r.stream}-${r.senderId}-${i}`}>
                              <td className="l mono">{r.senderId}</td>
                              <td className="l"><span className={`zf-tag ${r.stream}`}>{STREAM_LABEL[r.stream] ?? r.stream}</span></td>
                              <td>{fN(r.messages)}</td>
                              <td>{fN(r.peakSubscribersHr)}</td>
                              <td>{fN(r.hoursActive)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <div className="zf-panel-bd" style={{ paddingTop: 10, paddingBottom: 10 }}>
                    <div style={{ fontSize: '.68rem', color: 'var(--mu)', lineHeight: 1.45 }}>
                      Sender is <code>sender_id</code>, never <code>calling_party</code> (that is the SMSC global title).
                      {' '}{data.senderCapNote}
                    </div>
                  </div>
                </div>
              </div>

              {daily.length > 0 && (
                <div className="zf-panel">
                  <div className="zf-panel-hd">
                    <div className="zf-panel-ti">Exact daily uniques — SS7</div>
                    <div className="zf-panel-sub">whole-day distinct counts, refreshed once daily</div>
                  </div>
                  <div className="zf-tbl-wrap">
                    <table className="zf-tbl">
                      <thead>
                        <tr>
                          <th className="l">Date (UTC)</th>
                          <th>Messages</th>
                          <th>Raw Rows</th>
                          <th>Unique Subscribers</th>
                          <th>Unique Senders</th>
                          <th>Msgs / Subscriber</th>
                        </tr>
                      </thead>
                      <tbody>
                        {daily.map((r) => (
                          <tr key={`${r.date}-${r.stream}`}>
                            <td className="l mono">{String(r.date).slice(0, 10)}</td>
                            <td>{fN(r.messages)}</td>
                            <td>{fN(r.rawRows)}</td>
                            <td>{fN(r.subscribers)}</td>
                            <td>{fN(r.senders)}</td>
                            <td>{r.subscribers ? (r.messages / r.subscribers).toFixed(2) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="zf-panel-bd" style={{ paddingTop: 10, paddingBottom: 10 }}>
                    <div style={{ fontSize: '.68rem', color: 'var(--mu)', lineHeight: 1.45 }}>
                      These are the only honest whole-day unique counts — a day&apos;s distinct subscribers cannot be
                      derived by summing hourly buckets, so they are computed separately over the full day.
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'pipeline' && data && (
            <>
              <div className="zf-cards">
                {pipelineSummary.map((p) => (
                  <div key={p.stream} className={`zf-card${p.hoursMissing > 0 ? ' danger' : p.hoursPartial > 0 ? ' warn' : ''}`}>
                    <div className="zf-card-num">{fN(p.hoursComplete)}</div>
                    <div className="zf-card-lbl">{STREAM_LABEL[p.stream] ?? p.stream} — Complete Hours</div>
                    <div className="zf-card-hint">
                      {p.hoursPartial} partial · {p.hoursMissing} missing · {fN(p.filesFailed)} failed files
                      {p.latestHour ? <><br />latest {hourFull(p.latestHour)}</> : null}
                    </div>
                  </div>
                ))}
                {pipelineSummary.length === 0 && (
                  <div className="zf-card"><div className="zf-card-num">—</div><div className="zf-card-lbl">No ingest history</div></div>
                )}
              </div>

              <div className="zf-note">
                An hour is <strong>complete</strong> when every delivered file loaded, <strong>partial</strong> when some
                failed, and <strong>missing</strong> when none loaded. The traffic hour comes from the file name, not the
                load time, so a backfill that loaded many hours at once still reports per-hour coverage correctly.
              </div>

              <div className="zf-panel">
                <div className="zf-panel-hd">
                  <div className="zf-panel-ti">Ingest coverage per hour</div>
                  <div className="zf-panel-sub">most recent first · retries collapsed per file</div>
                </div>
                <div className="zf-tbl-wrap" style={{ maxHeight: 620 }}>
                  {pipeline.length === 0 ? <div className="zf-empty">No ingest rows in this window.</div> : (
                    <table className="zf-tbl">
                      <thead>
                        <tr>
                          <th className="l">Traffic Hour (UTC)</th>
                          <th className="l">Stream</th>
                          <th className="l">Status</th>
                          <th>Loaded / Seen</th>
                          <th>Nodes</th>
                          <th>Rows</th>
                          <th>Rejected</th>
                          <th>Attempts</th>
                          <th className="l">Last Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pipeline.map((r, i) => (
                          <tr key={`${r.stream}-${r.fileHour}-${i}`}>
                            <td className="l mono">{hourFull(r.fileHour)}</td>
                            <td className="l"><span className={`zf-tag ${r.stream}`}>{STREAM_LABEL[r.stream] ?? r.stream}</span></td>
                            <td className="l"><span className={`zf-pill ${r.hourStatus}`}>{r.hourStatus}</span></td>
                            <td>{fN(r.filesLoaded)} / {fN(r.filesSeen)}</td>
                            <td>{fN(r.nodesSeen)}</td>
                            <td>{fN(r.rowsLoaded)}</td>
                            <td style={r.rowsRejected > 0 ? { color: 'var(--warn)', fontWeight: 700 } : undefined}>{fN(r.rowsRejected)}</td>
                            <td>{fN(r.attempts)}</td>
                            <td className="l" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', color: r.lastError ? 'var(--danger)' : 'var(--mu)' }} title={r.lastError ?? ''}>
                              {r.lastError ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="zf-foot" style={{ padding: '0 15px 12px' }}>
                  Pipeline refreshed {refreshed.pipeline ? new Date(refreshed.pipeline).toLocaleString() : '—'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
