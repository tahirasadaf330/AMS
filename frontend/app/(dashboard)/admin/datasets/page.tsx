'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/status-badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { adminDatasetsApi, adminDatasourcesApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { getCronHumanReadable, formatDatetime, toSnakeCase } from '@/lib/utils';
import type { Dataset, DataSource, ColumnMeta } from '@/types';

// Lazy load Monaco editor
const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="h-48 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center text-gray-500 text-sm">
      Loading editor...
    </div>
  ),
});

function useAdminDatasets() {
  return useQuery({
    queryKey: ['admin', 'datasets'],
    queryFn: async () => {
      const { data } = await adminDatasetsApi.list();
      return data;
    },
  });
}

interface DatasetFormData {
  name: string;
  description: string;
  source_db: string;
  data_source_id: string;
  sql_query: string;
  stage_table_name: string;
  schedule_cron: string;
  is_active: boolean;
  column_metadata: ColumnMeta[];
  create_stage_table: boolean;
}

const defaultForm: DatasetFormData = {
  name: '',
  description: '',
  source_db: 'jerasoft',
  data_source_id: 'jerasoft',
  sql_query: '',
  stage_table_name: '',
  schedule_cron: '0 */6 * * *',
  is_active: true,
  column_metadata: [],
  create_stage_table: true,
};

export default function AdminDatasetsPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const { data: datasets, isLoading } = useAdminDatasets();
  const { data: datasources } = useQuery<DataSource[]>({
    queryKey: ['admin', 'datasources'],
    queryFn: async () => { const { data } = await adminDatasourcesApi.list(); return data; },
  });
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [showForm, setShowForm] = React.useState(false);
  const [editingDataset, setEditingDataset] = React.useState<Dataset | null>(null);
  const [formData, setFormData] = React.useState<DatasetFormData>(defaultForm);
  const [deleteTarget, setDeleteTarget] = React.useState<Dataset | null>(null);
  const [validating, setValidating] = React.useState(false);
  const [validateResult, setValidateResult] = React.useState<{ success: boolean; message: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: DatasetFormData) =>
      adminDatasetsApi.create({
        name: data.name,
        description: data.description,
        source_db: data.source_db,
        data_source_id: data.data_source_id || 'jerasoft',
        sql_query: data.sql_query,
        stage_table_name: data.stage_table_name,
        schedule_cron: data.schedule_cron,
        is_active: data.is_active,
        column_metadata: data.column_metadata,
        create_stage_table: data.create_stage_table,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      } as any),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'datasets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'datasets'] });
      addToast({ title: 'Dataset created', variant: 'success' });
      setShowForm(false);
      setFormData(defaultForm);
    },
    onError: (err: unknown) => {
      const axiosMsg = (err as any)?.response?.data?.message;
      const msg = Array.isArray(axiosMsg) ? axiosMsg.join(', ') : (axiosMsg ?? (err as Error)?.message ?? 'Failed to create dataset');
      addToast({ title: msg, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Dataset> }) =>
      adminDatasetsApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'datasets'] });
      addToast({ title: 'Dataset updated', variant: 'success' });
      setEditingDataset(null);
    },
    onError: () => addToast({ title: 'Failed to update dataset', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => adminDatasetsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'datasets'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'datasets'] });
      addToast({ title: 'Dataset deleted', variant: 'success' });
      setDeleteTarget(null);
    },
    onError: () => addToast({ title: 'Failed to delete dataset', variant: 'destructive' }),
  });

  const openCreate = () => {
    setEditingDataset(null);
    setFormData(defaultForm);
    setValidateResult(null);
    setShowForm(true);
  };

  const openEdit = (dataset: Dataset) => {
    setEditingDataset(dataset);
    setFormData({
      name: dataset.name,
      description: dataset.description ?? '',
      source_db: dataset.source_db,
      data_source_id: dataset.data_source_id ?? 'jerasoft',
      sql_query: dataset.sql_query ?? '',
      stage_table_name: dataset.stage_table_name,
      schedule_cron: dataset.schedule_cron,
      is_active: dataset.is_active,
      column_metadata: dataset.column_metadata ?? [],
      create_stage_table: false,
    });
    setValidateResult(null);
    setShowForm(true);
  };

  const handleNameChange = (name: string) => {
    const autoTable = `stage_${toSnakeCase(name)}`.replace(/^[^a-z_]+/, '').replace(/[^a-z0-9_]/g, '_');
    setFormData((prev) => ({
      ...prev,
      name,
      stage_table_name: prev.stage_table_name || autoTable,
    }));
  };

  const handleValidateSQL = async () => {
    if (!formData.sql_query.trim()) return;
    setValidating(true);
    setValidateResult(null);
    try {
      const { data } = await adminDatasetsApi.validateSql(formData.sql_query, formData.data_source_id || 'jerasoft');
      if (!data.valid) { setValidateResult({ success: false, message: data.error ?? 'Invalid SQL' }); return; }
      const cols: ColumnMeta[] = (data.columns ?? []).map((c) => ({
        key: c.key,
        label: c.label || c.key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        type: (c.type as ColumnMeta['type']) ?? 'text',
        visible: true,
      }));
      setFormData((prev) => ({ ...prev, column_metadata: cols }));
      setValidateResult({ success: true, message: `Detected ${cols.length} columns` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SQL validation failed';
      setValidateResult({ success: false, message: msg });
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingDataset) {
      void updateMutation.mutate({
        id: editingDataset.id,
        data: {
          name: formData.name,
          description: formData.description,
          data_source_id: formData.data_source_id || 'jerasoft',
          sql_query: formData.sql_query,
          stage_table_name: formData.stage_table_name,
          schedule_cron: formData.schedule_cron,
          is_active: formData.is_active,
          column_metadata: formData.column_metadata,
        } as any,
      });
    } else {
      void createMutation.mutate(formData);
    }
  };

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Admin access required.</div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dataset Management"
        description="Configure data sources and stage tables"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Dataset
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={4} cols={7} />
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Stage Table</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Refresh</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Rows</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Schedule</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(datasets ?? []).map((ds) => (
                <tr key={ds.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{ds.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{ds.stage_table_name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {ds.last_refresh ? formatDatetime(ds.last_refresh.refreshed_at) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 text-xs">
                    {ds.last_refresh?.row_count?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{getCronHumanReadable(ds.schedule_cron)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={ds.is_active ? 'active' : 'inactive'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(ds)}>
                        <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(ds)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit form */}
      <Dialog open={showForm} onClose={() => { setShowForm(false); setEditingDataset(null); }} className="max-w-3xl">
        <DialogHeader
          title={editingDataset ? `Edit: ${editingDataset.name}` : 'Create Dataset'}
          onClose={() => { setShowForm(false); setEditingDataset(null); }}
        />
        <DialogBody className="space-y-4">
          <form id="dataset-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label required>Name</Label>
                <Input value={formData.name} onChange={(e) => handleNameChange(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data Source</Label>
                <Select
                  value={formData.data_source_id}
                  onChange={(e) => setFormData((p) => ({ ...p, data_source_id: e.target.value }))}
                >
                  {(datasources ?? []).filter((ds) => ds.is_active).map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name}{(ds as any).is_builtin ? '' : ` (${ds.type === 'mssql' ? 'SQL Server' : 'PostgreSQL'})`}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>SQL Query</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleValidateSQL()} isLoading={validating}>
                  Validate SQL
                </Button>
              </div>
              <div className="monaco-editor-container">
                <MonacoEditor
                  height="180px"
                  language="sql"
                  theme="vs-dark"
                  value={formData.sql_query}
                  onChange={(v) => setFormData((p) => ({ ...p, sql_query: v ?? '' }))}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
              {validateResult && (
                <div className={`flex items-center gap-2 text-sm p-2 rounded ${validateResult.success ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'}`}>
                  {validateResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  {validateResult.message}
                </div>
              )}
            </div>

            {/* Column metadata */}
            {(formData.column_metadata ?? []).length > 0 && (
              <div className="space-y-1.5">
                <Label>Column Configuration</Label>
                <div className="space-y-1 max-h-48 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 p-2">
                  {formData.column_metadata.map((col, i) => (
                    <div key={col.key} className="flex items-center gap-2 text-sm">
                      <code className="text-blue-400 text-xs w-32 truncate font-mono">{col.key}</code>
                      <Input
                        value={col.label}
                        onChange={(e) => setFormData((p) => ({
                          ...p,
                          column_metadata: p.column_metadata.map((c, ci) =>
                            ci === i ? { ...c, label: e.target.value } : c
                          ),
                        }))}
                        className="flex-1 h-7 text-xs"
                      />
                      <Select
                        value={col.type}
                        onChange={(e) => setFormData((p) => ({
                          ...p,
                          column_metadata: p.column_metadata.map((c, ci) =>
                            ci === i ? { ...c, type: e.target.value as ColumnMeta['type'] } : c
                          ),
                        }))}
                        className="w-24 h-7 text-xs"
                      >
                        <option value="text">Text</option>
                        <option value="numeric">Numeric</option>
                        <option value="date">Date</option>
                      </Select>
                      <Toggle
                        checked={!!col.visible}
                        onChange={(v) => setFormData((p) => ({
                          ...p,
                          column_metadata: p.column_metadata.map((c, ci) =>
                            ci === i ? { ...c, visible: v } : c
                          ),
                        }))}
                        size="sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Stage Table Name</Label>
                <Input
                  value={formData.stage_table_name}
                  onChange={(e) => {
                    const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z_]+/, '');
                    setFormData((p) => ({ ...p, stage_table_name: sanitized }));
                  }}
                  className="font-mono text-xs"
                  placeholder="stage_my_table"
                />
                {formData.stage_table_name && !/^[a-z_][a-z0-9_]{0,127}$/.test(formData.stage_table_name) && (
                  <p className="text-xs text-red-400">Must be lowercase letters, numbers, underscores. Start with a letter or underscore.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Schedule (cron)</Label>
                <Input
                  value={formData.schedule_cron}
                  onChange={(e) => setFormData((p) => ({ ...p, schedule_cron: e.target.value }))}
                  placeholder="0 */6 * * *"
                  className="font-mono text-xs"
                />
                <p className="text-xs text-gray-500">{getCronHumanReadable(formData.schedule_cron)}</p>
              </div>
            </div>

            {!editingDataset && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-1.5 bg-gray-50 dark:bg-gray-800/40">
                <div className="flex items-center gap-3">
                  <Toggle
                    checked={!!formData.create_stage_table}
                    onChange={(v) => setFormData((p) => ({ ...p, create_stage_table: v }))}
                    size="sm"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-300">Create stage table automatically</span>
                </div>
                {formData.create_stage_table ? (
                  <p className="text-xs text-gray-500 ml-10">
                    A new table <code className="text-blue-400 font-mono">{formData.stage_table_name || '…'}</code> will be created in the AMS database.
                    {formData.column_metadata.length === 0 && (
                      <span className="text-amber-400"> Validate SQL first to detect columns.</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 ml-10">
                    The stage table must already exist. Only the dataset record will be created.
                  </p>
                )}
              </div>
            )}

            <Toggle
              checked={!!formData.is_active}
              onChange={(v) => setFormData((p) => ({ ...p, is_active: v }))}
              label="Active"
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setShowForm(false); setEditingDataset(null); }}>Cancel</Button>
          <Button
            type="submit"
            form="dataset-form"
            isLoading={createMutation.isPending || updateMutation.isPending}
            disabled={
              !editingDataset &&
              formData.create_stage_table &&
              formData.column_metadata.length === 0
            }
            title={
              !editingDataset && formData.create_stage_table && formData.column_metadata.length === 0
                ? 'Validate SQL first to detect columns'
                : undefined
            }
          >
            {editingDataset ? 'Save Changes' : 'Create Dataset'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} className="max-w-sm">
        <DialogHeader title="Delete Dataset" onClose={() => setDeleteTarget(null)} />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Delete <span className="font-medium text-gray-800 dark:text-gray-100">"{deleteTarget?.name}"</span>? This will remove all associated data and cannot be undone.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && void deleteMutation.mutateAsync(deleteTarget.id)} isLoading={deleteMutation.isPending}>
              Delete
            </Button>
          </div>
        </DialogBody>
      </Dialog>
    </div>
  );
}
