'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatDate } from '@/lib/utils';

interface TimelinePoint {
  date: string;
  sent: number;
  failed: number;
}

interface NotificationTimelineProps {
  data: TimelinePoint[];
  height?: number;
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-600 bg-gray-800 p-3 shadow-xl text-sm">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }}>
          {entry.name}: <span className="font-medium">{entry.value}</span>
        </p>
      ))}
    </div>
  );
};

export function NotificationTimeline({ data, height = 200 }: NotificationTimelineProps) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center text-gray-500 text-sm" style={{ height }}>
        No data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: '#9CA3AF', fontSize: 11 }}
          tickFormatter={(v) => formatDate(v)}
        />
        <YAxis tick={{ fill: '#9CA3AF', fontSize: 11 }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ color: '#9CA3AF', fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="sent"
          stroke="#22C55E"
          strokeWidth={2}
          dot={false}
          name="Sent"
        />
        <Line
          type="monotone"
          dataKey="failed"
          stroke="#EF4444"
          strokeWidth={2}
          dot={false}
          name="Failed"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
