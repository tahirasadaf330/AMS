'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface BalanceEntry {
  name: string;
  balance: number;
  days?: number | null;
}

interface BalanceBarChartProps {
  data: BalanceEntry[];
  height?: number;
}

function getBarFill(days: number | null | undefined): string {
  if (days === null || days === undefined || isNaN(days)) return '#6B7280';
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
  payload?: Array<{ value: number }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl text-sm">
      <p className="font-medium text-gray-200 mb-1">{label}</p>
      <p className="text-gray-400">
        Balance:{' '}
        <span className="text-gray-200 font-medium">{formatCurrency(payload[0].value)}</span>
      </p>
    </div>
  );
};

export function BalanceBarChart({ data, height = 300 }: BalanceBarChartProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 16, bottom: 60, left: 16 }}>
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
        <Bar dataKey="balance" radius={[3, 3, 0, 0]} name="Current Balance">
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={getBarFill(entry.days)} />
          ))}
        </Bar>
        <Legend
          wrapperStyle={{ color: '#9CA3AF', fontSize: 12, paddingTop: 8 }}
          formatter={() => 'Current Balance'}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
