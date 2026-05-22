'use client';

import * as React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { cn, getDaysColor, formatCurrency } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import type { ColumnMeta, DashboardRow } from '@/types';

interface MatrixViewProps {
  rows: DashboardRow[];
  columns: ColumnMeta[];
  isLoading: boolean;
}

function getBarColor(days: number | null): string {
  if (days === null || isNaN(days)) return '#6B7280';
  if (days < 5) return '#EF4444';
  if (days <= 10) return '#F59E0B';
  return '#22C55E';
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl text-sm">
      <p className="font-medium text-gray-200 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-gray-400">
          Balance:{' '}
          <span className="text-gray-200 font-medium">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  );
};

export function MatrixView({ rows, columns, isLoading }: MatrixViewProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-60">
        <Spinner />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="flex items-center justify-center h-60 text-gray-500 text-sm">
        No data available
      </div>
    );
  }

  // Identify company name column and financial columns
  const companyCol = columns.find(
    (c) =>
      c.key.toLowerCase().includes('company') ||
      c.key.toLowerCase().includes('name') ||
      c.key.toLowerCase().includes('client')
  );

  const daysCol = columns.find((c) => c.key.toLowerCase().includes('days_to_consume'));

  const numericCols = columns.filter((c) => c.type === 'numeric' && c.visible !== false);

  // Chart data
  const balanceCol = columns.find(
    (c) =>
      c.key.toLowerCase().includes('balance') ||
      c.key.toLowerCase().includes('current_balance')
  ) ?? numericCols[0];

  const chartData = rows.map((row) => ({
    name: String(
      companyCol ? row[companyCol.key] ?? 'Unknown' : row[Object.keys(row)[0]] ?? 'Unknown'
    ).slice(0, 20),
    value: Number(balanceCol ? row[balanceCol.key] : 0) || 0,
    days: daysCol ? Number(row[daysCol.key]) : null,
  }));

  return (
    <div className="space-y-6">
      {/* Pivot table */}
      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-800 border-b border-gray-700">
              {companyCol && (
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider sticky left-0 bg-gray-800">
                  {companyCol.label}
                </th>
              )}
              {numericCols.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              return (
                <tr
                  key={idx}
                  className="border-b border-gray-700/50 hover:bg-gray-700/30"
                >
                  {companyCol && (
                    <td className="px-4 py-2 font-medium sticky left-0 bg-gray-800/50">
                      {String(row[companyCol.key] ?? '—')}
                    </td>
                  )}
                  {numericCols.map((col) => {
                    const val = row[col.key];
                    const isNegative = val !== null && val !== undefined && Number(val) < 0;
                    return (
                    <td key={col.key} className={cn('px-4 py-2 text-right tabular-nums', isNegative ? 'text-red-400' : '')}>
                      {val !== null && val !== undefined
                        ? formatCurrency(Number(val))
                        : '—'}
                    </td>
                  );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bar chart */}
      {balanceCol && chartData.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">
            {balanceCol.label} by Company
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 60, left: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                angle={-35}
                textAnchor="end"
                interval={0}
                height={60}
              />
              <YAxis
                tick={{ fill: '#9CA3AF', fontSize: 11 }}
                tickFormatter={(v: number) => formatCurrency(v, 0)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(entry.days)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
