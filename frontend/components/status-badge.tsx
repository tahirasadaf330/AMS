import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';

type StatusType = 'ok' | 'sent' | 'failed' | 'stale' | 'skipped' | 'running' | 'success' | 'warning' | string;

interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: StatusType;
  label?: string;
}

const STATUS_CONFIG: Record<string, { variant: BadgeProps['variant']; label: string }> = {
  ok: { variant: 'success', label: 'OK' },
  success: { variant: 'success', label: 'Success' },
  sent: { variant: 'success', label: 'Sent' },
  failed: { variant: 'destructive', label: 'Failed' },
  stale: { variant: 'warning', label: 'Stale' },
  pending: { variant: 'blue', label: 'Pending' },
  skipped: { variant: 'gray', label: 'Skipped' },
  running: { variant: 'blue', label: 'Running' },
  warning: { variant: 'warning', label: 'Warning' },
  active: { variant: 'success', label: 'Active' },
  inactive: { variant: 'gray', label: 'Inactive' },
};

export function StatusBadge({ status, label, ...props }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status.toLowerCase()] ?? {
    variant: 'default' as const,
    label: status,
  };

  return (
    <Badge variant={config.variant} {...props}>
      {label ?? config.label}
    </Badge>
  );
}
