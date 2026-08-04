'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Download, ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { auditLogApi, adminUsersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { formatDatetime } from '@/lib/utils';
import type { AuditLogEntry } from '@/types';
import type { BadgeProps } from '@/components/ui/badge';

const PAGE_SIZE = 50;

// Color per action family (prefix before ':').
const ACTION_BADGE: Record<string, BadgeProps['variant']> = {
  auth: 'gray',
  condition: 'green',
  admin: 'purple',
  schedule: 'blue',
  export: 'amber',
  mcp: 'blue',
  google_mo: 'amber',
  zamani: 'amber',
  dashboard: 'blue',
};

function actionVariant(action: string): BadgeProps['variant'] {
  return ACTION_BADGE[action.split(':')[0]] ?? 'default';
}

export default function AuditLogPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const addToast = useUIStore((s) => s.addToast);

  // ── Filters ───────────────────────────────────────────────────
  const [action, setAction] = React.useState('');
  const [userFilter, setUserFilter] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  // Debounce the action text filter so we don't query per keystroke
  const [actionDebounced, setActionDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setActionDebounced(action.trim()), 350);
    return () => clearTimeout(t);
  }, [action]);
  React.useEffect(() => { setPage(1); }, [actionDebounced, userFilter, from, to]);

  const filters = React.useMemo(
    () => ({
      action: actionDebounced || undefined,
      user: userFilter || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [actionDebounced, userFilter, from, to, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-log', filters],
    queryFn: async () => { const { data } = await auditLogApi.list(filters); return data; },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  const { data: users } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => { const { data } = await adminUsersApi.list(); return data; },
    enabled: isAdmin,
  });

  const rows: AuditLogEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await auditLogApi.export({
        action: actionDebounced || undefined,
        user: userFilter || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59.999Z` : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast({ title: 'Export failed', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Admin access required.</div>;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Log"
        description="Every create, edit, delete and login across the system"
        actions={
          <Button variant="secondary" size="sm" onClick={() => void handleExport()} isLoading={exporting}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <Input placeholder="Filter action… e.g. role, login, delete" value={action} onChange={(e) => setAction(e.target.value)} className="pl-8 h-8 text-sm" />
        </div>
        <Select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="h-8 text-sm w-52">
          <option value="">All users</option>
          {(users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-sm w-40" title="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-sm w-40" title="To" />
        {(action || userFilter || from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setAction(''); setUserFilter(''); setFrom(''); setTo(''); }}>Clear</Button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{total.toLocaleString()} entries</span>
      </div>

      {/* Table */}
      {isLoading && !data ? <SkeletonTable rows={10} cols={6} /> : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500">
          <ScrollText className="h-10 w-10 opacity-30" />
          <p className="text-sm">No audit entries match your filter.</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="w-8" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Resource</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded === r.id;
                const hasDetail = r.detail && Object.keys(r.detail).length > 0;
                return (
                  <React.Fragment key={r.id}>
                    <tr
                      className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 ${hasDetail ? 'cursor-pointer' : ''}`}
                      onClick={() => hasDetail && setExpanded(isOpen ? null : r.id)}
                    >
                      <td className="pl-3 text-gray-400">
                        {hasDetail && (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{formatDatetime(r.created_at)}</td>
                      <td className="px-4 py-2.5">
                        {r.user
                          ? <span className="text-gray-800 dark:text-gray-200">{r.user.name} <span className="text-xs text-gray-400">{r.user.email}</span></span>
                          : <span className="text-xs text-gray-400">system</span>}
                      </td>
                      <td className="px-4 py-2.5"><Badge variant={actionVariant(r.action)}>{r.action}</Badge></td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs max-w-[260px] truncate">{r.resource ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{r.ip_address ?? '—'}</td>
                    </tr>
                    {isOpen && hasDetail && (
                      <tr className="border-b border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-800/40">
                        <td />
                        <td colSpan={5} className="px-4 py-3">
                          <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                            {JSON.stringify(r.detail, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
