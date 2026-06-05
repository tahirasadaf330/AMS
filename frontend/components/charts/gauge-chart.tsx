'use client';

import * as React from 'react';

interface GaugeChartProps {
  actual: number;
  target: number;
  projected?: number;
  label?: string;
  formatValue?: (n: number) => string;
}

function ptArc(cx: number, cy: number, r: number, pct: number) {
  const rad = Math.PI - pct * Math.PI;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

export function GaugeChart({ actual, target, projected, formatValue }: GaugeChartProps) {
  const VW = 500, VH = 300;
  const cx = 250, cy = 245;
  const r = 185, sw = 30;

  const fmt = formatValue ?? ((n: number) =>
    n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

  const pct     = target > 0 ? Math.min(actual    / target, 1)    : 0;
  const projPct = target > 0 && projected != null ? Math.min(projected / target, 1) : null;

  const semi    = Math.PI * r;
  const fillLen = pct * semi;

  const arcD = `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`;

  const projInner = projPct != null ? ptArc(cx, cy, r - sw / 2 - 3, projPct) : null;
  const projOuter = projPct != null ? ptArc(cx, cy, r + sw / 2 + 3, projPct) : null;

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      {/* Track */}
      <path d={arcD} fill="none" stroke="#1e293b" strokeWidth={sw} strokeLinecap="round" />

      {/* Actual fill */}
      <path d={arcD} fill="none" stroke="#1abc9c" strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${fillLen} ${semi}`}
      />

      {/* Projected tick */}
      {projInner && projOuter && (
        <line x1={projInner.x} y1={projInner.y} x2={projOuter.x} y2={projOuter.y}
          stroke="#f8fafc" strokeWidth={3.5} strokeLinecap="round" />
      )}

      {/* Actual value */}
      <text x={cx} y={cy - 42}
        textAnchor="middle" fill="#f8fafc"
        fontSize={68} fontWeight="700" fontFamily="inherit">
        {fmt(actual)}
      </text>

      {/* Sub label */}
      <text x={cx} y={cy + 8}
        textAnchor="middle" fill="#64748b" fontSize={16} fontFamily="inherit">
        {projected != null
          ? `of ${fmt(target)} · proj ${fmt(projected)}`
          : `of ${fmt(target)}`}
      </text>

      {/* Edge labels */}
      <text x={cx - r} y={cy + sw / 2 + 22}
        textAnchor="middle" fill="#475569" fontSize={13} fontFamily="inherit">0</text>
      <text x={cx + r} y={cy + sw / 2 + 22}
        textAnchor="middle" fill="#475569" fontSize={13} fontFamily="inherit">
        {fmt(target)}
      </text>
    </svg>
  );
}
