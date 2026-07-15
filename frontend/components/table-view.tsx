'use client';

import * as React from 'react';
import {
  ArrowUp, ArrowDown, ArrowUpDown, X, ChevronDown, Check, Filter, Columns3,
} from 'lucide-react';
import { cn, getDaysColor } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import type { ColumnMeta, DashboardRow } from '@/types';

// ── Column width heuristic ───────────────────────────────────────────────────

function colWidth(col: ColumnMeta): number {
  const byLabel = col.label.length * 8 + 56;
  switch (col.type) {
    case 'numeric': return Math.max(130, Math.min(200, byLabel));
    case 'date': return Math.max(160, Math.min(220, byLabel));
    default: return Math.max(200, Math.min(340, byLabel));
  }
}

// ── Unique values for text filter ────────────────────────────────────────────

function uniqueVals(rows: DashboardRow[], key: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== '') seen.add(String(v));
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// ── Filter state helpers ─────────────────────────────────────────────────────

function getInSelected(filters: Record<string, string>, key: string): string[] {
  const v = filters[`${key}__in`];
  return v ? v.split('||').filter(Boolean) : [];
}

function getRangeMin(filters: Record<string, string>, key: string) {
  return filters[`${key}__min`] ?? '';
}

function getRangeMax(filters: Record<string, string>, key: string) {
  return filters[`${key}__max`] ?? '';
}

// ── Cell renderer ────────────────────────────────────────────────────────────

function CellValue({ value, type }: { value: string | number | null; type?: string }) {
  if (value === null || value === undefined || value === '')
    return <span className="text-gray-400 dark:text-gray-600">—</span>;
  const str = String(value);
  if (type === 'date' || /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(str))
    return <>{str.slice(0, 10)}</>;
  return <>{str}</>;
}

// ── Text multi-select filter ─────────────────────────────────────────────────

function TextFilter({
  col, rows, filters, onChange, fetchDistinctValues,
}: {
  col: ColumnMeta;
  rows: DashboardRow[];
  filters: Record<string, string>;
  onChange: (changes: Record<string, string>) => void;
  fetchDistinctValues?: (column: string) => Promise<string[]>;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [serverVals, setServerVals] = React.useState<string[] | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const selected = getInSelected(filters, col.key);
  // Prefer the full-table distinct values (fetched on first open) so the list
  // shows EVERY value; until they arrive (or if unavailable) fall back to the
  // values present on the current page.
  const pageVals = React.useMemo(() => uniqueVals(rows, col.key), [rows, col.key]);
  const allVals = serverVals ?? pageVals;
  const filtered = allVals.filter(v => v.toLowerCase().includes(search.toLowerCase()));
  const hasFilter = selected.length > 0;

  // Fetch the complete value list once, the first time the dropdown opens.
  React.useEffect(() => {
    if (!open || serverVals !== null || !fetchDistinctValues) return;
    let cancelled = false;
    fetchDistinctValues(col.key)
      .then((vals) => { if (!cancelled) setServerVals(vals); })
      .catch(() => { /* keep the page-value fallback; retry on next open */ });
    return () => { cancelled = true; };
  }, [open, serverVals, fetchDistinctValues, col.key]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    const next = selected.includes(val)
      ? selected.filter(v => v !== val)
      : [...selected, val];
    onChange({ [`${col.key}__in`]: next.join('||'), [col.key]: '' });
  };

  const clear = () => {
    onChange({ [`${col.key}__in`]: '', [col.key]: '' });
    setSearch('');
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full h-7 px-2 text-left text-xs flex items-center justify-between gap-1 rounded border transition-colors',
          hasFilter
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300'
            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
        )}
      >
        <span className="truncate min-w-0">
          {hasFilter ? `${selected.length} selected` : 'Filter…'}
        </span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {hasFilter && (
            <span
              role="button"
              tabIndex={0}
              onClick={e => { e.stopPropagation(); clear(); }}
              onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), clear())}
              className="p-0.5 rounded hover:bg-blue-500/20 text-blue-400"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-2xl">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700/60">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search values…"
              className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">No values</p>
            ) : (
              filtered.map(val => (
                <button
                  key={val}
                  type="button"
                  onClick={() => toggle(val)}
                  className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700/60 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  <span
                    className={cn(
                      'w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors',
                      selected.includes(val)
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-500',
                    )}
                  >
                    {selected.includes(val) && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  <span className="truncate" title={val}>{val}</span>
                </button>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="p-2 border-t border-gray-100 dark:border-gray-700/60">
              <button
                type="button"
                onClick={clear}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Numeric range filter ─────────────────────────────────────────────────────

function NumericFilter({
  col, filters, onChange,
}: {
  col: ColumnMeta;
  filters: Record<string, string>;
  onChange: (changes: Record<string, string>) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const min = getRangeMin(filters, col.key);
  const max = getRangeMax(filters, col.key);
  const hasFilter = min !== '' || max !== '';

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const clear = () => {
    onChange({ [`${col.key}__min`]: '', [`${col.key}__max`]: '' });
    setOpen(false);
  };

  const label = hasFilter
    ? [min && `≥ ${min}`, max && `≤ ${max}`].filter(Boolean).join('  ')
    : 'Filter…';

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'w-full h-7 px-2 text-left text-xs flex items-center justify-between gap-1 rounded border transition-colors',
          hasFilter
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300'
            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
        )}
      >
        <span className="truncate min-w-0">{label}</span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {hasFilter && (
            <span
              role="button"
              tabIndex={0}
              onClick={e => { e.stopPropagation(); clear(); }}
              onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), clear())}
              className="p-0.5 rounded hover:bg-blue-500/20 text-blue-400"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-40" />
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-2xl p-3 space-y-2.5">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Min</label>
            <input
              autoFocus
              type="number"
              placeholder="No minimum"
              value={min}
              onChange={e => onChange({ [`${col.key}__min`]: e.target.value })}
              className="w-full h-7 px-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">Max</label>
            <input
              type="number"
              placeholder="No maximum"
              value={max}
              onChange={e => onChange({ [`${col.key}__max`]: e.target.value })}
              className="w-full h-7 px-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield]"
            />
          </div>
          {hasFilter && (
            <div className="pt-1 border-t border-gray-100 dark:border-gray-700/60">
              <button
                type="button"
                onClick={clear}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Date range filter ────────────────────────────────────────────────────────

function DateFilter({
  col, filters, onChange,
}: {
  col: ColumnMeta;
  filters: Record<string, string>;
  onChange: (changes: Record<string, string>) => void;
}) {
  const from = getRangeMin(filters, col.key);
  const to = getRangeMax(filters, col.key);
  const hasFilter = from !== '' || to !== '';

  return (
    // Native date inputs have a large intrinsic min-width, so two side-by-side
    // overflow narrow columns and overlap the neighbouring filter — stack them.
    <div className={cn('flex flex-col gap-1 min-w-0', hasFilter && 'ring-1 ring-blue-500/40 rounded')}>
      <input
        type="date"
        value={from}
        title="From"
        onChange={e => onChange({ [`${col.key}__min`]: e.target.value })}
        className="w-full h-7 px-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-500"
      />
      <input
        type="date"
        value={to}
        title="To"
        onChange={e => onChange({ [`${col.key}__max`]: e.target.value })}
        className="w-full h-7 px-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-blue-500"
      />
      {hasFilter && (
        <button
          type="button"
          onClick={() => onChange({ [`${col.key}__min`]: '', [`${col.key}__max`]: '' })}
          className="flex-shrink-0 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 p-0.5 transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface TableViewProps {
  columns: ColumnMeta[];
  rows: DashboardRow[];
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
  columnFilters: Record<string, string>;
  onFilterChange: (changes: Record<string, string>) => void;
  visibleColumnKeys: string[];
  onVisibleColumnsChange: (keys: string[]) => void;
  // Optional: fetch ALL distinct values for a column across the full table, so
  // text filters list every value (not just the current page). Omit to keep the
  // page-only behaviour.
  fetchDistinctValues?: (column: string) => Promise<string[]>;
}

// ── Main component ───────────────────────────────────────────────────────────

export function TableView({
  columns,
  rows,
  total,
  page,
  limit,
  isLoading,
  sort,
  sortDir,
  onSort,
  onPageChange,
  columnFilters,
  onFilterChange,
  visibleColumnKeys,
  onVisibleColumnsChange,
  fetchDistinctValues,
}: TableViewProps) {
  const visibleColumns = columns.filter(c => visibleColumnKeys.includes(c.key));
  const totalWidth = visibleColumns.reduce((sum, c) => sum + colWidth(c), 0);
  const totalPages = Math.ceil(total / limit);
  const activeFilterCount = Object.values(columnFilters).filter(Boolean).length;

  const clearAll = () => {
    const reset: Record<string, string> = {};
    for (const k of Object.keys(columnFilters)) reset[k] = '';
    onFilterChange(reset);
  };

  // Column picker state
  const [colPickerOpen, setColPickerOpen] = React.useState(false);
  const colPickerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!colPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setColPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [colPickerOpen]);

  const toggleColumn = (key: string) => {
    if (visibleColumnKeys.includes(key)) {
      if (visibleColumnKeys.length === 1) return;
      onVisibleColumnsChange(visibleColumnKeys.filter(k => k !== key));
    } else {
      onVisibleColumnsChange(columns.filter(c => visibleColumnKeys.includes(c.key) || c.key === key).map(c => c.key));
    }
  };

  return (
    <div className="flex flex-col gap-3">

      {/* Toolbar: filters on left, column picker on right */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-3 text-xs">
          {activeFilterCount > 0 && (
            <>
              <span className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
                <Filter className="h-3 w-3 text-blue-400" />
                <span className="text-blue-400 font-medium">{activeFilterCount}</span>
                {activeFilterCount === 1 ? 'filter' : 'filters'} active
              </span>
              <button type="button" onClick={clearAll} className="text-red-400 hover:text-red-300 transition-colors">
                Clear all
              </button>
            </>
          )}
        </div>
        <div ref={colPickerRef} className="relative">
          <button
            type="button"
            onClick={() => setColPickerOpen(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors',
              colPickerOpen ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200',
            )}
          >
            <Columns3 className="h-3.5 w-3.5" />
            Columns
            {visibleColumnKeys.length < columns.length && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-semibold">
                {visibleColumnKeys.length}/{columns.length}
              </span>
            )}
          </button>
          {colPickerOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-2xl">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Columns</span>
                <button type="button" onClick={() => onVisibleColumnsChange(columns.map(c => c.key))} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">
                  Show all
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {columns.map(col => {
                  const isVis = visibleColumnKeys.includes(col.key);
                  return (
                    <button key={col.key} type="button" onClick={() => toggleColumn(col.key)}
                      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700/60 text-gray-700 dark:text-gray-300 transition-colors">
                      <span className={cn('w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors', isVis ? 'border-blue-500 bg-blue-500' : 'border-gray-500')}>
                        {isVis && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span className="truncate">{col.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table card */}
      <div
        className="rounded-lg border border-gray-200 dark:border-gray-700"
        style={{ maxHeight: 'calc(100vh - 26rem)', overflow: 'auto' }}
      >
        <table
          style={{
            minWidth: totalWidth,
            width: '100%',
            tableLayout: 'fixed',
            borderCollapse: 'collapse',
          }}
        >
          <colgroup>
            {visibleColumns.map(col => (
              <col key={col.key} style={{ width: colWidth(col) }} />
            ))}
          </colgroup>

          <thead className="sticky top-0 z-10">
            {/* Column header row */}
            <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className={cn(
                    'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors',
                    'hover:bg-gray-200/60 dark:hover:bg-gray-700/60',
                    sort === col.key ? 'text-blue-600 dark:text-blue-400 bg-gray-200/60 dark:bg-gray-700/30' : 'text-gray-500 dark:text-gray-400',
                  )}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{col.label}</span>
                    <span className="flex-shrink-0 opacity-70">
                      {sort === col.key
                        ? sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3" />
                          : <ArrowDown className="h-3 w-3" />
                        : <ArrowUpDown className="h-3 w-3 opacity-30" />}
                    </span>
                  </div>
                </th>
              ))}
            </tr>

            {/* Filter row — opaque background so scrolled body rows don't bleed through the sticky header */}
            <tr className="border-b border-gray-200 dark:border-gray-700/50 bg-gray-100 dark:bg-gray-900">
              {visibleColumns.map(col => (
                <th
                  key={col.key}
                  className="px-2 py-1.5 font-normal"
                  style={{ overflow: 'visible', position: 'relative' }}
                >
                  {col.type === 'numeric' ? (
                    <NumericFilter col={col} filters={columnFilters} onChange={onFilterChange} />
                  ) : col.type === 'date' ? (
                    <DateFilter col={col} filters={columnFilters} onChange={onFilterChange} />
                  ) : (
                    <TextFilter col={col} rows={rows} filters={columnFilters} onChange={onFilterChange} fetchDistinctValues={fetchDistinctValues} />
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={visibleColumns.length} className="py-16 text-center">
                  <Spinner />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="py-16 text-center text-gray-500 text-sm"
                >
                  {activeFilterCount > 0
                    ? 'No rows match the active filters.'
                    : 'No data found.'}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIdx) => {
                const daysKey = Object.keys(row).find(k =>
                  k.toLowerCase().includes('days_to_consume'),
                );
                const daysVal = daysKey ? Number(row[daysKey]) : null;
                const rowColor = !isNaN(daysVal ?? NaN) ? getDaysColor(daysVal) : '';

                return (
                  <tr
                    key={rowIdx}
                    className={cn(
                      'border-b border-gray-100 dark:border-gray-700/30 transition-colors',
                      rowColor || 'hover:bg-gray-50 dark:hover:bg-gray-700/20',
                      rowColor && 'hover:opacity-90',
                    )}
                  >
                    {visibleColumns.map(col => {
                      const raw = row[col.key] ?? null;
                      const str = raw !== null ? String(raw) : '';
                      const isNegative = col.type === 'numeric' && raw !== null && Number(raw) < 0;
                      const isTextCol = col.type !== 'numeric' && col.type !== 'date';
                      return (
                        <td
                          key={col.key}
                          title={str}
                          className={cn(
                            'px-3 py-2.5 text-sm align-top',
                            col.type === 'numeric'
                              ? cn('text-right font-mono tabular-nums', isNegative ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-200')
                              : 'text-gray-600 dark:text-gray-300',
                          )}
                          style={
                            isTextCol
                              // Text columns wrap so long values (account/destination/vendor…)
                              // are fully visible instead of truncated behind a tooltip.
                              ? { whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere' }
                              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }
                          }
                        >
                          <CellValue value={raw} type={col.type} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination + row count */}
      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400 min-h-[28px] px-1">
        {total > 0 ? (
          <p className="text-xs">
            Showing{' '}
            <span className="text-gray-800 dark:text-gray-200 font-medium">
              {((page - 1) * limit + 1).toLocaleString()}–{Math.min(page * limit, total).toLocaleString()}
            </span>{' '}
            of{' '}
            <span className="text-gray-800 dark:text-gray-200 font-medium">{total.toLocaleString()}</span> rows
          </p>
        ) : (
          <span />
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(1)}
              disabled={page === 1}
              className="px-2 py-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              «
            </button>
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 1}
              className="px-2 py-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ‹
            </button>
            <span className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-medium">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ›
            </button>
            <button
              onClick={() => onPageChange(totalPages)}
              disabled={page >= totalPages}
              className="px-2 py-1 rounded text-xs hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              »
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
