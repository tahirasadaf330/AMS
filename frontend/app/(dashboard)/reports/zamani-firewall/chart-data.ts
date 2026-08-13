/**
 * Pure data helpers for the Zamani SMS Firewall page.
 *
 * Extracted from the page component so they can be exercised directly against adversarial payloads
 * — a report that white-screens on one unparseable timestamp is worse than one that drops the row.
 *
 * `new Date(v).toISOString()` throws RangeError('Invalid time value') for `undefined`, `''`, `NaN`
 * and for a 'T'-separated string carrying a 2-digit UTC offset ('2026-08-13T07:00:00+00' — which is
 * what Postgres-style formatting produces if a timestamp ever reaches the client as a raw string
 * rather than as a serialized Date). Every entry point below therefore goes through `toDate`.
 */

export const STREAMS = ['ss7', 'smpp', 'sri'] as const;
export type Stream = typeof STREAMS[number];

/** Parse to a valid Date, or null. Never throws, whatever it is handed. */
export function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== 'string') return null;

  let d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d;

  // Recover the one format V8 rejects but Postgres readily produces: a 'T' separator with a
  // 2-digit offset. Widening '+00' to '+00:00' makes it parseable.
  const widened = v.replace(/([+-]\d{2})$/, '$1:00');
  d = new Date(widened);
  if (!Number.isNaN(d.getTime())) return d;

  // Last resort: a space separator instead of 'T'.
  d = new Date(widened.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Canonical ISO string for use as a map key / sort key, or null when unparseable. */
export function toIso(v: unknown): string | null {
  return toDate(v)?.toISOString() ?? null;
}

/** 'HH:00' in UTC, or an em dash when the value is unusable. */
export function hourLabel(v: unknown): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
}

/** 'YYYY-MM-DD HH:00 UTC', or an em dash when the value is unusable. */
export function hourFull(v: unknown): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;
}

/** Locale timestamp for the "last refreshed" labels, or an em dash. */
export function stamp(v: unknown): string {
  const d = toDate(v);
  return d ? d.toLocaleString() : '—';
}

export type SeriesRow = { bucketHour?: unknown; stream?: unknown; messages?: unknown; rawRows?: unknown };
export type ChartCol = { iso: string } & Partial<Record<Stream, number>> & { total: number };
export type Chart = { cols: ChartCol[]; max: number; skipped: number };

/**
 * Pivot the hourly series into one column per hour, stacked by stream.
 *
 * Rows whose bucket_hour cannot be parsed are counted in `skipped` rather than thrown on — the
 * caller surfaces that count so dropped data is visible instead of silently missing.
 */
export function buildChart(rows: SeriesRow[] | null | undefined): Chart {
  const byHour = new Map<string, Record<string, number>>();
  let skipped = 0;

  for (const r of rows ?? []) {
    const iso = toIso(r?.bucketHour);
    const stream = typeof r?.stream === 'string' ? r.stream : null;
    if (!iso || !stream) { skipped++; continue; }

    const messages = Number(r?.messages);
    if (!Number.isFinite(messages)) { skipped++; continue; }

    const bucket = byHour.get(iso) ?? {};
    bucket[stream] = (bucket[stream] ?? 0) + messages;
    byHour.set(iso, bucket);
  }

  const cols: ChartCol[] = Array.from(byHour.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([iso, v]) => ({
      iso,
      ...(v as Partial<Record<Stream, number>>),
      total: STREAMS.reduce((a, s) => a + (v[s] ?? 0), 0),
    }));

  // Floor of 1 so a zero-traffic window cannot divide by zero when scaling bar heights.
  const max = Math.max(1, ...cols.map((c) => c.total));
  return { cols, max, skipped };
}

/**
 * Undo the backend's global snake_case response transform.
 *
 * `main.ts` installs a `SnakeCaseInterceptor` on every route, so a service returning `bucketHour`
 * puts `bucket_hour` on the wire. Reading camelCase in the component therefore yields `undefined`
 * for every multi-word field while single-word ones (`messages`, `stream`, `requests`) sail through
 * — which looks exactly like "the panel has no data" rather than like a key mismatch.
 *
 * Normalising once at the fetch boundary keeps the component and its tests written in the same
 * camelCase the service uses, instead of scattering snake_case reads through the JSX. Applied to
 * every payload before it reaches state.
 */
export function camelizeKeys<T = any>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelizeKeys(v)) as unknown as T;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = camelizeKeys(v);
    }
    return out as T;
  }
  return value as T;
}
