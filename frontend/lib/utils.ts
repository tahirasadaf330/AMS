import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, parseISO, isValid } from 'date-fns';

// ── Tailwind class merger ─────────────────────────────────────
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ── Currency formatting ───────────────────────────────────────
export function formatCurrency(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return '—';
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return value < 0 ? `(${formatted})` : formatted;
}

// ── Date formatting ───────────────────────────────────────────
export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = parseISO(isoString);
    if (!isValid(d)) return isoString;
    return format(d, 'MMM d, yyyy');
  } catch {
    return isoString;
  }
}

export function formatDatetime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = parseISO(isoString);
    if (!isValid(d)) return isoString;
    return format(d, 'MMM d, yyyy HH:mm');
  } catch {
    return isoString;
  }
}

export function formatDatetimeFull(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = parseISO(isoString);
    if (!isValid(d)) return isoString;
    return format(d, 'MMM d, yyyy HH:mm:ss');
  } catch {
    return isoString;
  }
}

// ── Cron helpers ──────────────────────────────────────────────
export function getCronHumanReadable(cron: string): string {
  if (!cron) return 'Not scheduled';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every minute
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }

  // Every N minutes: */N * * * *
  const minuteMatch = minute.match(/^\*\/(\d+)$/);
  if (minuteMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(minuteMatch[1]);
    return `Every ${n} minute${n !== 1 ? 's' : ''}`;
  }

  // Every hour: 0 * * * *
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour';
  }

  // Every N hours: 0 */N * * *
  const hourMatch = hour.match(/^\*\/(\d+)$/);
  if (hourMatch && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const n = parseInt(hourMatch[1]);
    return `Every ${n} hour${n !== 1 ? 's' : ''}`;
  }

  // Daily at HH:MM: M H * * *
  if (
    !minute.includes('*') &&
    !minute.includes('/') &&
    !hour.includes('*') &&
    !hour.includes('/') &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const h = hour.padStart(2, '0');
    const m = minute.padStart(2, '0');
    return `Daily at ${h}:${m}`;
  }

  // Weekly: M H * * DOW
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (
    !minute.includes('*') &&
    !minute.includes('/') &&
    !hour.includes('*') &&
    !hour.includes('/') &&
    dayOfMonth === '*' &&
    month === '*' &&
    !dayOfWeek.includes('*') &&
    !dayOfWeek.includes('/')
  ) {
    const dowIndex = parseInt(dayOfWeek);
    const h = hour.padStart(2, '0');
    const m = minute.padStart(2, '0');
    if (!isNaN(dowIndex) && dowNames[dowIndex]) {
      return `Weekly on ${dowNames[dowIndex]} at ${h}:${m}`;
    }
  }

  return cron;
}

export function getNextCronRun(cron: string): string {
  // Simple next run calculation without a full cron parser library
  // This provides an approximation
  if (!cron) return '—';
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return '—';

    const [minute, hour] = parts;
    const now = new Date();
    const next = new Date(now);

    const minuteMatch = minute.match(/^\*\/(\d+)$/);
    const hourMatch = hour.match(/^\*\/(\d+)$/);

    if (minuteMatch) {
      const interval = parseInt(minuteMatch[1]);
      const currentMin = now.getMinutes();
      const nextMin = Math.ceil((currentMin + 1) / interval) * interval;
      next.setMinutes(nextMin, 0, 0);
      if (next <= now) next.setMinutes(next.getMinutes() + interval);
    } else if (hourMatch) {
      const interval = parseInt(hourMatch[1]);
      const currentHour = now.getHours();
      const nextHour = Math.ceil((currentHour + 1) / interval) * interval;
      next.setHours(nextHour, 0, 0, 0);
      if (next <= now) next.setHours(next.getHours() + interval);
    } else if (hour === '*') {
      const m = parseInt(minute);
      next.setSeconds(0, 0);
      if (isNaN(m)) return '—';
      if (now.getMinutes() >= m) {
        next.setHours(now.getHours() + 1, m, 0, 0);
      } else {
        next.setMinutes(m, 0, 0);
      }
    } else {
      const h = parseInt(hour);
      const m = parseInt(minute);
      if (isNaN(h) || isNaN(m)) return '—';
      next.setHours(h, m, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
    }

    return formatDatetime(next.toISOString());
  } catch {
    return '—';
  }
}

// ── Blob download ─────────────────────────────────────────────
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Misc helpers ──────────────────────────────────────────────
export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US');
}

export function getDaysColor(_days: number | null | undefined): string {
  return '';
}
