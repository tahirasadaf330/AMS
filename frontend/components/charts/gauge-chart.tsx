'use client';

import * as React from 'react';

interface GaugeChartProps {
  actual: number;
  target: number;
  projected?: number;
  label?: string;
  formatValue?: (n: number) => string;
}

function pt(cx: number, cy: number, r: number, pct: number) {
  const rad = Math.PI - pct * Math.PI;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

export function GaugeChart({
  actual,
  target,
  projected,
  label = 'of monthly target',
  formatValue,
}: GaugeChartProps) {
  const uid = React.useId().replace(/:/g, '');

  // ViewBox dimensions — SVG scales to fill its container
  const VW = 340, VH = 200;
  const cx = 170, cy = 168;
  const r  = 138, sw = 22;

  const pct     = target > 0 ? Math.min(actual    / target, 1.05) : 0;
  const projPct = target > 0 && projected != null
    ? Math.min(projected / target, 1.15) : 0;

  const semi        = Math.PI * r;
  const fillLen     = Math.min(pct, 1) * semi;
  const projFillLen = Math.min(projPct, 1) * semi;

  const arcD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`;

  const fillColor =
    pct < 0.5 ? '#e74c3c' :
    pct < 0.8 ? '#f39c12' :
                '#1abc9c';

  const fmt = formatValue ?? ((n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

  const pctLabel = `${(pct * 100).toFixed(1)}%`;
  const showProj = projected != null && projPct > pct;

  const needleEnd  = pt(cx, cy, r * 0.72, Math.min(pct, 1));
  const projInner  = pt(cx, cy, r - sw / 2 - 2, Math.min(projPct, 1));
  const projOuter  = pt(cx, cy, r + sw / 2 + 5, Math.min(projPct, 1));
  const tgtInner   = pt(cx, cy, r - sw / 2 - 2, 1.0);
  const tgtOuter   = pt(cx, cy, r + sw / 2 + 5, 1.0);

  // Tick marks at 0 / 25 / 50 / 75 / 100 %
  const TICKS = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
      aria-label={`Gauge: ${pctLabel} ${label}`}
    >
      <defs>
        <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Track ── */}
      <path d={arcD} fill="none" stroke="#1e293b" strokeWidth={sw} strokeLinecap="round" />

      {/* ── Projected ghost fill ── */}
      {showProj && (
        <path d={arcD} fill="none"
          stroke={fillColor} strokeOpacity={0.18}
          strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${projFillLen} ${semi}`}
        />
      )}

      {/* ── Actual fill ── */}
      <path d={arcD} fill="none"
        stroke={fillColor} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${fillLen} ${semi}`}
        filter={`url(#glow-${uid})`}
      />

      {/* ── Graduation ticks ── */}
      {TICKS.map((p) => {
        const inner = pt(cx, cy, r - sw / 2 - 1, p);
        const outer = pt(cx, cy, r + sw / 2 + 5, p);
        return (
          <line key={p}
            x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
            stroke="#334155" strokeWidth={p === 0 || p === 1 ? 2.5 : 1.5}
          />
        );
      })}

      {/* ── Target tick (100%) – white ── */}
      <line x1={tgtInner.x} y1={tgtInner.y} x2={tgtOuter.x} y2={tgtOuter.y}
        stroke="#f8fafc" strokeWidth={3} strokeLinecap="round" />

      {/* ── Projected tick – yellow ── */}
      {showProj && (
        <line x1={projInner.x} y1={projInner.y} x2={projOuter.x} y2={projOuter.y}
          stroke="#f1c40f" strokeWidth={3.5} strokeLinecap="round" />
      )}

      {/* ── Needle ── */}
      <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y}
        stroke="#e2e8f0" strokeWidth={3} strokeLinecap="round"
        filter={`url(#glow-${uid})`}
      />
      <circle cx={cx} cy={cy} r={8}  fill="#e2e8f0" />
      <circle cx={cx} cy={cy} r={4}  fill="#0f172a" />

      {/* ── Percentage ── */}
      <text x={cx} y={cy - 44}
        textAnchor="middle" fill={fillColor}
        fontSize={40} fontWeight="800" fontFamily="inherit">
        {pctLabel}
      </text>

      {/* ── Label ── */}
      <text x={cx} y={cy - 16}
        textAnchor="middle" fill="#64748b"
        fontSize={13} fontFamily="inherit">
        {label}
      </text>

      {/* ── Actual → Projected ── */}
      <text x={cx} y={cy + 10}
        textAnchor="middle" fill="#94a3b8"
        fontSize={12} fontFamily="inherit">
        {showProj ? `${fmt(actual)} → ${fmt(projected!)}` : fmt(actual)}
      </text>

      {/* ── Edge labels ── */}
      <text x={cx - r - 4} y={cy + sw / 2 + 14}
        textAnchor="end" fill="#475569" fontSize={11} fontFamily="inherit">0</text>
      <text x={cx + r + 4} y={cy + sw / 2 + 14}
        textAnchor="start" fill="#475569" fontSize={11} fontFamily="inherit">
        {target > 0 ? fmt(target) : '—'}
      </text>

      {/* ── Legend ── */}
      {showProj && (
        <g transform={`translate(${cx}, ${cy + sw / 2 + 30})`}>
          <rect x={-80} y={0} width={10} height={10} rx={2} fill={fillColor} />
          <text x={-65} y={9} fill="#64748b" fontSize={10} fontFamily="inherit">Actual</text>
          <rect x={-10} y={0} width={10} height={10} rx={2} fill={fillColor} fillOpacity={0.35} />
          <text x={5}   y={9} fill="#64748b" fontSize={10} fontFamily="inherit">Projected</text>
          <rect x={65}  y={2} width={16} height={4} rx={2} fill="#f1c40f" />
          <text x={85}  y={9} fill="#64748b" fontSize={10} fontFamily="inherit">Proj. mark</text>
        </g>
      )}
    </svg>
  );
}
