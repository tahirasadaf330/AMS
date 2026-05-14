'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { adminDatasourcesApi } from '@/lib/api';
import { useUIStore } from '@/store/ui.store';
import { formatDatetime } from '@/lib/utils';
import type { DataSource, DataSourceType } from '@/types';

const DEFAULT_PORTS: Record<DataSourceType, number> = {
  postgresql: 5432,
  mssql: 1433,
};

interface FormData {
  name: string;
  type: DataSourceType;
  host: string;
  port: number;
  db: string;
  username: string;
  password: string;
  ssl_mode: string;
  is_active: boolean;
}

const EMPTY_FORM: FormData = {
  name: '',
  type: 'mssql',
  host: '',
  port: 1433,
  db: '',
  username: '',
  password: '',
  ssl_mode: 'prefer',
  is_active: true,
};

function useDataSources() {
  return useQuery({
    queryKey: ['admin', 'datasources'],
    queryFn: async () => {
      const { data } = await adminDatasourcesApi.list();
      return data;
    },
  });
}

export default function AdminDatasourcesPage() {
  const qc = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  const { data: datasources, isLoading } = useDataSources();

  const [showForm, setShowForm] = React.useState(false);
  const [editing, setEditing] = React.useState<DataSource | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DataSource | null>(null);
  const [formData, setFormData] = React.useState<FormData>(EMPTY_FORM);
  const [testResult, setTestResult] = React.useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = React.useState(false);

  const setField = <K extends keyof FormData>(k: K, v: FormData[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [k]: v };
      if (k === 'type') next.port = DEFAULT_PORTS[v as DataSourceType];
      return next;
    });
    setTestResult(null);
  };

  const openCreate = () => {
    setFormData(EMPTY_FORM);
    setEditing(null);
    setTestResult(null);
    setShowForm(true);
  };

  const openEdit = (ds: DataSource) => {
    setFormData({
      name: ds.name,
      type: ds.type,
      host: ds.host,
      port: ds.port,
      db: ds.db,
      username: ds.username,
      password: '',
      ssl_mode: ds.ssl_mode,
      is_active: ds.is_active,
    });
    setEditing(ds);
    setTestResult(null);
    setShowForm(true);
  };

  const createMutation = useMutation({
    mutationFn: (data: FormData) => adminDatasourcesApi.create(data as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'datasources'] });
      setShowForm(false);
      addToast({ title: 'Data source created', variant: 'success' });
    },
    onError: (err: any) => {
      addToast({ title: err?.response?.data?.message ?? 'Failed to create data source', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormData> }) =>
      adminDatasourcesApi.update(id, data as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'datasources'] });
      setShowForm(false);
      setEditing(null);
      addToast({ title: 'Data source updated', variant: 'success' });
    },
    onError: (err: any) => {
      addToast({ title: err?.response?.data?.message ?? 'Failed to update data source', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminDatasourcesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'datasources'] });
      setDeleteTarget(null);
      addToast({ title: 'Data source deleted', variant: 'success' });
    },
    onError: (err: any) => {
      addToast({ title: err?.response?.data?.message ?? 'Failed to delete data source', variant: 'destructive' });
    },
  });

  const handleSave = () => {
    if (editing) {
      const patch: Partial<FormData> = { ...formData };
      if (!patch.password) delete patch.password;
      updateMutation.mutate({ id: editing.id, data: patch });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await adminDatasourcesApi.testConnection({
        type: formData.type,
        host: formData.host,
        port: formData.port,
        db: formData.db,
        username: formData.username,
        password: formData.password || (editing ? '***USE_SAVED***' : ''),
        ssl_mode: formData.ssl_mode,
      });
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, message: err?.response?.data?.message ?? 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data Sources"
        description="External database connections used by datasets for data refresh"
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New Data Source
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={4} cols={6} />
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 border-b border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Host</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Database</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">SSL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Active</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(datasources ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                    No data sources yet. Click "New Data Source" to add one.
                  </td>
                </tr>
              )}
              {(datasources ?? []).map((ds) => (
                <tr key={ds.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-200">{ds.name}</span>
                      {ds.is_builtin && (
                        <Badge variant="default">Built-in</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ds.type === 'mssql' ? 'purple' : 'blue'}>
                      {ds.type === 'mssql' ? 'SQL Server' : 'PostgreSQL'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs">{ds.host}:{ds.port}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{ds.db}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{ds.ssl_mode}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block w-2 h-2 rounded-full ${ds.is_active ? 'bg-green-400' : 'bg-gray-500'}`} />
                  </td>
                  <td className="px-4 py-3">
                    {!ds.is_builtin && (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(ds)}
                          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(ds)}
                          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)} className="max-w-lg">
        <DialogHeader
          title={editing ? 'Edit Data Source' : 'New Data Source'}
          onClose={() => setShowForm(false)}
        />
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="e.g. Billing SQL Server"
              />
            </div>

            <div>
              <Label>Type</Label>
              <Select
                value={formData.type}
                onChange={(e) => setField('type', e.target.value as DataSourceType)}
              >
                <option value="mssql">SQL Server (MSSQL)</option>
                <option value="postgresql">PostgreSQL</option>
              </Select>
            </div>

            <div>
              <Label>SSL Mode</Label>
              <Select value={formData.ssl_mode} onChange={(e) => setField('ssl_mode', e.target.value)}>
                <option value="prefer">Prefer</option>
                <option value="require">Require</option>
                <option value="disable">Disable</option>
              </Select>
            </div>

            <div className="col-span-2">
              <Label>Host</Label>
              <Input
                value={formData.host}
                onChange={(e) => setField('host', e.target.value)}
                placeholder="e.g. 192.168.1.10 or db.example.com"
              />
            </div>

            <div>
              <Label>Port</Label>
              <Input
                type="number"
                value={formData.port}
                onChange={(e) => setField('port', parseInt(e.target.value, 10) || DEFAULT_PORTS[formData.type])}
              />
            </div>

            <div>
              <Label>Database</Label>
              <Input
                value={formData.db}
                onChange={(e) => setField('db', e.target.value)}
                placeholder="Database name"
              />
            </div>

            <div>
              <Label>Username</Label>
              <Input
                value={formData.username}
                onChange={(e) => setField('username', e.target.value)}
                placeholder="DB username"
              />
            </div>

            <div>
              <Label>{editing ? 'Password (leave blank to keep)' : 'Password'}</Label>
              <Input
                type="password"
                value={formData.password}
                onChange={(e) => setField('password', e.target.value)}
                placeholder={editing ? '••••••••' : 'DB password'}
                autoComplete="new-password"
              />
            </div>

            <div className="col-span-2 flex items-center gap-3">
              <Toggle
                checked={formData.is_active}
                onChange={(v) => setField('is_active', v)}
                size="sm"
              />
              <span className="text-sm text-gray-400">Active</span>
            </div>
          </div>

          {/* Test connection */}
          <div className="flex items-center gap-3 pt-1 border-t border-gray-700">
            <Button variant="secondary" size="sm" onClick={() => void handleTest()} disabled={testing || !formData.host || !formData.db || !formData.username}>
              {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Test Connection
            </Button>
            {testResult && (
              <span className={`flex items-center gap-1.5 text-sm ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {testResult.success
                  ? <CheckCircle2 className="h-4 w-4" />
                  : <XCircle className="h-4 w-4" />}
                {testResult.message}
              </span>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          <Button onClick={handleSave} isLoading={isSaving} disabled={!formData.name || !formData.host || !formData.db || !formData.username}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} className="max-w-sm">
        <DialogHeader title="Delete Data Source" onClose={() => setDeleteTarget(null)} />
        <DialogBody>
          <p className="text-sm text-gray-300">
            Delete <span className="font-medium text-gray-100">"{deleteTarget?.name}"</span>?
            Any datasets using this data source will lose their connection.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              isLoading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </div>
        </DialogBody>
      </Dialog>
    </div>
  );
}
