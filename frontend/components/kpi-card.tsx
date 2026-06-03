import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label?: string;
    direction: 'up' | 'down' | 'neutral';
    isGood?: boolean; // up is good or bad?
  };
  isLoading?: boolean;
  className?: string;
  iconColor?: string;
  description?: string;
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  trend,
  isLoading,
  className,
  iconColor = 'text-blue-400',
  description,
}: KpiCardProps) {
  if (isLoading) {
    return (
      <Card className={cn('p-6', className)}>
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-32" />
      </Card>
    );
  }

  const trendColor =
    trend
      ? trend.direction === 'neutral'
        ? 'text-gray-400'
        : trend.isGood !== false
        ? trend.direction === 'up'
          ? 'text-green-400'
          : 'text-red-400'
        : trend.direction === 'up'
        ? 'text-red-400'
        : 'text-green-400'
      : '';

  return (
    <Card className={cn('p-6', className)}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
          <p className="mt-2 text-2xl font-bold text-gray-800 dark:text-gray-100">{value}</p>
          {description && (
            <p className="mt-1 text-xs text-gray-500">{description}</p>
          )}
          {trend && (
            <p className={cn('mt-1 text-xs font-medium', trendColor)}>
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}{' '}
              {Math.abs(trend.value)}%
              {trend.label && ` ${trend.label}`}
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('p-2 rounded-lg bg-gray-100 dark:bg-gray-700/50', iconColor)}>
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
