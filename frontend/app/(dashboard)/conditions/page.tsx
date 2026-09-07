'use client';

import * as React from 'react';
import { Plus, Edit2, Trash2, Eye, Play, Code2, Database, Terminal, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Dialog, DialogHeader, DialogBody } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { ConditionBuilder } from '@/components/condition-builder';
import { PythonAlertDialog } from '@/components/python-alert-dialog';
import { ConditionPreviewPanel } from '@/components/condition-preview-panel';
import { SkeletonTable } from '@/components/ui/skeleton';
import {
  useConditions,
  useCreateCondition,
  useUpdateCondition,
  useDeleteCondition,
  usePreviewCondition,
  useTestNotifyPreview,
  useTriggerNow,
} from '@/hooks/useConditions';
import { useDatasets } from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/auth.store';
import { formatDatetime, getCronHumanReadable } from '@/lib/utils';

import type { Condition } from '@/types';

export default function ConditionsPage() {
  const { data: conditions, isLoading } = useConditions();
  const { data: datasets } = useDatasets();
  const createCondition = useCreateCondition();
  const updateCondition = useUpdateCondition();
  const deleteCondition = useDeleteCondition();
  const previewCondition = usePreviewCondition();
  const testNotifyPreview = useTestNotifyPreview();
  const triggerNow = useTriggerNow();
  const canDelete = useAuthStore((s) => s.canAccess('delete_condition'));
  const canCreate = useAuthStore((s) => s.canAccess('create_condition'));
  const userId = useAuthStore((s) => s.user?.id);
  const userRole = useAuthStore((s) => s.user?.role);

  const [showForm, setShowForm] = React.useState(false);
  const [showPythonForm, setShowPythonForm] = React.useState(false);
  const [editingCondition, setEditingCondition] = React.useState<Condition | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Condition | null>(null);
  const [previewTarget, setPreviewTarget] = React.useState<Condition | null>(null);
  const [search, setSearch] = React.useState('');

  const allConditions = conditions ?? [];
  // Filter by name only, which is what the search box promises. Case-insensitive substring so
  // "special" finds "Special Routes — Zero Successful Calls (Jerasoft)" without typing the em
  // dash or the bracketed suffix.
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allConditions;
    return allConditions.filter((c) => (c.name ?? '').toLowerCase().includes(q));
  }, [allConditions, search]);

  const handleCreate = async (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => {
    await createCondition.mutateAsync(data);
    setShowForm(false);
  };

  const handleCreatePython = async (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => {
    await createCondition.mutateAsync(data);
    setShowPythonForm(false);
  };

  const handleUpdate = async (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => {
    if (!editingCondition) return;
    await updateCondition.mutateAsync({ id: editingCondition.id, data });
    setEditingCondition(null);
  };

  const handleToggleActive = async (condition: Condition) => {
    await updateCondition.mutateAsync({
      id: condition.id,
      data: { is_active: !condition.is_active },
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteCondition.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description="Alert conditions that trigger notifications when matched"
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowPythonForm(true)}>
                <Terminal className="h-4 w-4" />
                Python Alert
              </Button>
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" />
                New Alert
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Search by alert name. Hidden while loading and when there is nothing to search. */}
      {!isLoading && allConditions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              placeholder="Search alerts by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-8 h-8 text-sm"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {search.trim() && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {filtered.length} of {allConditions.length}
            </span>
          )}
        </div>
      )}

      {/* Conditions table */}
      {isLoading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Dataset / Script</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Channels</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trigger</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Triggered</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Active</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Created By</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-500 text-sm">
                    {search.trim() ? (
                      <>No alerts match &ldquo;{search.trim()}&rdquo;.</>
                    ) : (
                      <>No conditions yet.{canCreate && ' Click "New Alert" to create one.'}</>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map((condition) => {
                const isPython = condition.type === 'python';
                const dataset = datasets?.find((d) => d.id === condition.dataset_id);
                const channels = [];
                if (condition.channels.email?.enabled) channels.push('email');
                if (condition.channels.teams?.enabled) channels.push('teams');

                return (
                  <tr key={condition.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{condition.name}</td>
                    <td className="px-4 py-3">
                      {isPython ? (
                        <Badge variant="green" className="flex items-center gap-1 w-fit text-xs">
                          <Code2 className="h-3 w-3" />
                          Python
                        </Badge>
                      ) : (
                        <Badge variant="blue" className="flex items-center gap-1 w-fit text-xs">
                          <Database className="h-3 w-3" />
                          Dataset
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {isPython
                        ? <span className="italic text-gray-500 dark:text-gray-500">Custom script</span>
                        : (dataset?.name ?? <span className="text-gray-400">—</span>)
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {channels.map((ch) => (
                          <Badge key={ch} variant={ch === 'email' ? 'blue' : 'purple'} className="text-xs">
                            {ch}
                          </Badge>
                        ))}
                        {channels.length === 0 && <span className="text-gray-400 dark:text-gray-600 text-xs">none</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {condition.trigger_cron ? (
                        <span className="text-blue-600 dark:text-blue-300 font-mono text-xs">{getCronHumanReadable(condition.trigger_cron)}</span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-600">Manual</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {condition.last_triggered_at ? formatDatetime(condition.last_triggered_at) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={!!condition.is_active}
                        onChange={() => void handleToggleActive(condition)}
                        size="sm"
                        disabled={!canCreate}
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {condition.created_by_user?.fullname ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void triggerNow.mutateAsync(condition.id)}
                          title="Trigger Now"
                          disabled={triggerNow.isPending}
                        >
                          <Play className="h-3.5 w-3.5 text-green-400" />
                        </Button>
                        {!isPython && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setPreviewTarget(condition)}
                            title="Preview matches"
                          >
                            <Eye className="h-3.5 w-3.5 text-gray-400" />
                          </Button>
                        )}
                        {canCreate && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setEditingCondition(condition)}
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                          </Button>
                        )}
                        {canDelete && (userRole === 'admin' || condition.created_by === userId) && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(condition)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create form dialog */}
      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        className="max-w-2xl"
      >
        <DialogHeader
          title="Create Alert"
          onClose={() => setShowForm(false)}
        />
        <DialogBody>
          <ConditionBuilder
            datasets={datasets ?? []}
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            isSubmitting={createCondition.isPending}
            onTestNotify={async (data) => { await testNotifyPreview.mutateAsync(data); }}
            isTestNotifying={testNotifyPreview.isPending}
          />
        </DialogBody>
      </Dialog>

      {/* Edit form dialog — dataset alerts */}
      <Dialog
        open={!!editingCondition && editingCondition.type !== 'python'}
        onClose={() => setEditingCondition(null)}
        className="max-w-2xl"
      >
        <DialogHeader
          title="Edit Alert"
          onClose={() => setEditingCondition(null)}
        />
        <DialogBody>
          {editingCondition && editingCondition.type !== 'python' && (
            <ConditionBuilder
              key={editingCondition.id}
              datasets={datasets ?? []}
              initialValues={editingCondition}
              conditionId={editingCondition.id}
              onPreview={async (id) => {
                const result = await previewCondition.mutateAsync(id);
                return result;
              }}
              onTestNotify={async (data) => { await testNotifyPreview.mutateAsync(data); }}
              isTestNotifying={testNotifyPreview.isPending}
              onSubmit={handleUpdate}
              onCancel={() => setEditingCondition(null)}
              isSubmitting={updateCondition.isPending}
            />
          )}
        </DialogBody>
      </Dialog>

      {/* Python Alert — create */}
      <PythonAlertDialog
        open={showPythonForm}
        onClose={() => setShowPythonForm(false)}
        onSubmit={handleCreatePython}
        isSubmitting={createCondition.isPending}
      />

      {/* Python Alert — edit */}
      {editingCondition?.type === 'python' && (
        <PythonAlertDialog
          key={editingCondition.id}
          open={true}
          onClose={() => setEditingCondition(null)}
          onSubmit={handleUpdate}
          isSubmitting={updateCondition.isPending}
          initialValues={editingCondition}
        />
      )}

      {/* Preview dialog */}
      <Dialog
        open={!!previewTarget}
        onClose={() => setPreviewTarget(null)}
        className="max-w-2xl"
      >
        <DialogHeader
          title={`Preview: ${previewTarget?.name ?? ''}`}
          onClose={() => setPreviewTarget(null)}
        />
        <DialogBody>
          {previewTarget && (
            <ConditionPreviewPanel
              conditionId={previewTarget.id}
              onPreview={async (id) => {
                const result = await previewCondition.mutateAsync(id);
                return result;
              }}
            />
          )}
        </DialogBody>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        className="max-w-sm"
      >
        <DialogHeader
          title="Delete Alert"
          onClose={() => setDeleteTarget(null)}
        />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Are you sure you want to delete{' '}
            <span className="font-medium text-gray-800 dark:text-gray-100">"{deleteTarget?.name}"</span>?
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              isLoading={deleteCondition.isPending}
            >
              Delete
            </Button>
          </div>
        </DialogBody>
      </Dialog>
    </div>
  );
}
