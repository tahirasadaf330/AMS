'use client';
import * as React from 'react';

interface GaugeChartProps {
  actual: number;
  target: number;
  projected?: number;
  formatValue?: (n: number) => string;
}

export function GaugeChart({ actual, target, projected, formatValue }: GaugeChartProps) {
  const fmt = formatValue ?? ((n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 }));

  const cx = 230, cy = 210, r = 150, sw = 30;

  const pct     = target > 0 ? Math.min(actual    / target, 1) : 0;
  const projPct = target > 0 && projected != null ? Math.min(projected / target, 1) : null;

  function ptOnArc(p: number) {
    const angle = Math.PI * (1 - p);
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  }

  const split = ptOnArc(pct);

  const fullArc     = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const achievedArc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${split.x.toFixed(3)} ${split.y.toFixed(3)}`;

  // Projected needle: thick dark outline + thin amber line + dot at tip
  const projAngle  = projPct != null ? Math.PI * (1 - projPct) : null;
  const projInner  = projAngle != null ? { x: cx + (r - sw / 2 - 4) * Math.cos(projAngle), y: cy - (r - sw / 2 - 4) * Math.sin(projAngle) } : null;
  const projOuter  = projAngle != null ? { x: cx + (r + sw / 2 + 10) * Math.cos(projAngle), y: cy - (r + sw / 2 + 10) * Math.sin(projAngle) } : null;

  const pctNum  = target > 0 ? Math.round(actual / target * 100) : 0;
  const subText = `${pctNum}% of ${fmt(target)} target`;

  const legendY  = cy + sw / 2 + 48;
  const textOffY = legendY + 4;

  return (
    <svg viewBox="0 0 460 290" width="100%" height="100%"
      preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>

      {/* Indigo background arc (remainder) */}
      <path d={fullArc} fill="none" stroke="#46527D" strokeWidth={sw} strokeLinecap="round" />

      {/* Teal achieved arc */}
      {pct > 0 && pct < 1 && (
        <path d={achievedArc} fill="none" stroke="#2BD4A6" strokeWidth={sw} strokeLinecap="round" />
      )}
      {pct >= 1 && (
        <path d={fullArc} fill="none" stroke="#2BD4A6" strokeWidth={sw} strokeLinecap="round" />
      )}

      {/* Projected needle */}
      {projInner && projOuter && (
        <>
          <line x1={projInner.x} y1={projInner.y} x2={projOuter.x} y2={projOuter.y}
            stroke="#0E141F" strokeWidth={8} strokeLinecap="round" />
          <line x1={projInner.x} y1={projInner.y} x2={projOuter.x} y2={projOuter.y}
            stroke="#F6B23C" strokeWidth={4} strokeLinecap="round" />
          <circle cx={projOuter.x} cy={projOuter.y} r={4.5} fill="#F6B23C" />
        </>
      )}

      {/* Centre text */}
      <text x={cx} y={cy - 50} textAnchor="middle" fill="#8B94A8" fontSize={12}>Achieved</text>
      <text x={cx} y={cy - 4}  textAnchor="middle" fill="#FFFFFF" fontSize={46} fontWeight="700">{fmt(actual)}</text>
      <text x={cx} y={cy + 18} textAnchor="middle" fill="#8B94A8" fontSize={12.5}>{subText}</text>

      {/* Edge labels */}
      <text x={cx - r} y={cy + sw / 2 + 22} textAnchor="middle" fill="#6B7488" fontSize={12}>0</text>
      <text x={cx + r} y={cy + sw / 2 + 22} textAnchor="middle" fill="#6B7488" fontSize={12}>{fmt(target)}</text>

      {/* Legend */}
      <circle cx={52}  cy={legendY} r={5} fill="#2BD4A6" />
      <text x={64}  y={textOffY} fill="#8B94A8" fontSize={12.5}>
        Achieved <tspan fill="#F5F7FA" fontWeight="500">{fmt(actual)}</tspan>
      </text>

      {projPct != null && (
        <>
          <circle cx={200} cy={legendY} r={5} fill="#F6B23C" />
          <text x={212} y={textOffY} fill="#8B94A8" fontSize={12.5}>
            Projected <tspan fill="#F5F7FA" fontWeight="500">{fmt(projected!)}</tspan>
          </text>
        </>
      )}

      <circle cx={360} cy={legendY} r={5} fill="#46527D" />
      <text x={372} y={textOffY} fill="#8B94A8" fontSize={12.5}>
        Target <tspan fill="#F5F7FA" fontWeight="500">{fmt(target)}</tspan>
      </text>
    </svg>
  );
}
