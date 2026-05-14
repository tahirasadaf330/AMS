'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Download,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogHeader, DialogBody } from '@/components/ui/dialog';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/status-badge';
import { adminSettingsApi, auditLogApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { downloadBlob, formatDatetimeFull, truncate } from '@/lib/utils';
import type { SystemSettings, AuditLogEntry } from '@/types';

function MaskedInput({ value, onChange, placeholder, id }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

type TestStatus = { success: boolean; message: string } | null;

function TestResult({ result, isLoading }: { result: TestStatus; isLoading: boolean }) {
  if (isLoading) return <Spinner size="sm" />;
  if (!result) return null;
  return (
    <div className={`flex items-center gap-2 text-sm ${result.success ? 'text-green-400' : 'text-red-400'}`}>
      {result.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      {result.message}
    </div>
  );
}

function useSettings() {
  return useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const { data } = await adminSettingsApi.get();
      return data;
    },
  });
}

// ── DATA SOURCE TAB ─────────────────────────────────────────
function DataSourceTab({ settings, onSave, isSaving }: {
  settings: SystemSettings;
  onSave: (s: Partial<SystemSettings>) => void;
  isSaving: boolean;
}) {
  const [host, setHost] = React.useState(settings.jerasoft.host);
  const [port, setPort] = React.useState(String(settings.jerasoft.port));
  const [db, setDb] = React.useState(settings.jerasoft.db);
  const [user, setUser] = React.useState(settings.jerasoft.user);
  const [password, setPassword] = React.useState('');
  const [testResult, setTestResult] = React.useState<TestStatus>(null);
  const [testing, setTesting] = React.useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await adminSettingsApi.testJerasoft();
      setTestResult({
        success: data.connected,
        message: data.connected
          ? `Connected | ${data.latency_ms}ms | PG ${data.pg_version}`
          : 'Connection failed',
      });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    onSave({
      jerasoft: {
        host,
        port: parseInt(port),
        db,
        user,
        password: password || settings.jerasoft.password,
      },
    });
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="js-host">Host</Label>
          <Input id="js-host" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="js-port">Port</Label>
          <Input id="js-port" type="number" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="js-db">Database</Label>
        <Input id="js-db" value={db} onChange={(e) => setDb(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="js-user">Username</Label>
        <Input id="js-user" value={user} onChange={(e) => setUser(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="js-pass">Password</Label>
        <MaskedInput id="js-pass" value={password} onChange={setPassword} placeholder="Leave blank to keep current" />
      </div>
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} isLoading={isSaving}>Save</Button>
        <Button variant="secondary" onClick={() => void handleTest()}>Test Connection</Button>
        <TestResult result={testResult} isLoading={testing} />
      </div>
    </div>
  );
}

// ── GRAPH / EMAIL TAB ────────────────────────────────────────
function GraphTab({ settings, onSave, isSaving }: {
  settings: SystemSettings;
  onSave: (s: Partial<SystemSettings>) => void;
  isSaving: boolean;
}) {
  const [tenantId, setTenantId] = React.useState(settings.graph.tenant_id);
  const [clientId, setClientId] = React.useState(settings.graph.client_id);
  const [clientSecret, setClientSecret] = React.useState('');
  const [senderEmail, setSenderEmail] = React.useState(settings.graph.sender_email);
  const [testResult, setTestResult] = React.useState<TestStatus>(null);
  const [testing, setTesting] = React.useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await adminSettingsApi.testGraph();
      setTestResult({ success: data.success, message: data.message });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="space-y-1.5">
        <Label>Tenant ID</Label>
        <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="space-y-1.5">
        <Label>Client ID</Label>
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="space-y-1.5">
        <Label>Client Secret</Label>
        <MaskedInput value={clientSecret} onChange={setClientSecret} placeholder="Leave blank to keep current" />
      </div>
      <div className="space-y-1.5">
        <Label>Sender Email</Label>
        <Input type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <Button onClick={() => onSave({ graph: { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret || settings.graph.client_secret, sender_email: senderEmail } })} isLoading={isSaving}>Save</Button>
        <Button variant="secondary" onClick={() => void handleTest()}>Test Graph / Send Email</Button>
        <TestResult result={testResult} isLoading={testing} />
      </div>
    </div>
  );
}

// ── TEAMS TAB ─────────────────────────────────────────────────
function TeamsTab({ settings, onSave, isSaving }: {
  settings: SystemSettings;
  onSave: (s: Partial<SystemSettings>) => void;
  isSaving: boolean;
}) {
  const [webhookUrl, setWebhookUrl] = React.useState(settings.teams.default_webhook_url);
  const [testResult, setTestResult] = React.useState<TestStatus>(null);
  const [testing, setTesting] = React.useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await adminSettingsApi.testTeams();
      setTestResult({ success: data.success, message: data.message });
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="space-y-1.5">
        <Label>Default Webhook URL</Label>
        <Input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://outlook.office.com/webhook/..." />
      </div>
      <div className="flex items-center gap-4">
        <Button onClick={() => onSave({ teams: { default_webhook_url: webhookUrl } })} isLoading={isSaving}>Save</Button>
        <Button variant="secondary" onClick={() => void handleTest()}>Send Test Card</Button>
        <TestResult result={testResult} isLoading={testing} />
      </div>
    </div>
  );
}

// ── SECURITY TAB ─────────────────────────────────────────────
function SecurityTab({ settings, onSave, isSaving }: {
  settings: SystemSettings;
  onSave: (s: Partial<SystemSettings>) => void;
  isSaving: boolean;
}) {
  const [sessionTimeout, setSessionTimeout] = React.useState(String(settings.security.session_timeout_hours));
  const [maxFailedLogins, setMaxFailedLogins] = React.useState(String(settings.security.max_failed_logins));
  const [lockoutDuration, setLockoutDuration] = React.useState(String(settings.security.lockout_duration_minutes));
  const [showRotateConfirm, setShowRotateConfirm] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const addToast = useUIStore((s) => s.addToast);

  const handleRotate = async () => {
    setRotating(true);
    try {
      await adminSettingsApi.rotateKey();
      addToast({ title: 'Encryption key rotated', variant: 'success' });
    } catch {
      addToast({ title: 'Key rotation failed', variant: 'destructive' });
    } finally {
      setRotating(false);
      setShowRotateConfirm(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Session Timeout (hours)</Label>
          <Input type="number" min={1} value={sessionTimeout} onChange={(e) => setSessionTimeout(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Max Failed Logins</Label>
          <Input type="number" min={1} value={maxFailedLogins} onChange={(e) => setMaxFailedLogins(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Lockout Duration (min)</Label>
          <Input type="number" min={0} value={lockoutDuration} onChange={(e) => setLockoutDuration(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button
          onClick={() => onSave({ security: { session_timeout_hours: parseInt(sessionTimeout), max_failed_logins: parseInt(maxFailedLogins), lockout_duration_minutes: parseInt(lockoutDuration) } })}
          isLoading={isSaving}
        >
          Save
        </Button>
      </div>

      <div className="rounded-lg border border-red-800 bg-red-900/10 p-4 mt-6">
        <h3 className="text-sm font-medium text-red-300 mb-2">Danger Zone</h3>
        <p className="text-xs text-gray-400 mb-3">
          Rotating the encryption key will invalidate all existing encrypted data. This action cannot be undone.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setShowRotateConfirm(true)}>
          <RotateCcw className="h-4 w-4" />
          Rotate Encryption Key
        </Button>
      </div>

      <Dialog open={showRotateConfirm} onClose={() => setShowRotateConfirm(false)} className="max-w-sm">
        <DialogHeader title="Confirm Key Rotation" onClose={() => setShowRotateConfirm(false)} />
        <DialogBody>
          <p className="text-sm text-gray-300 mb-4">
            This will rotate the encryption key and may require re-entering credentials. Are you absolutely sure?
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setShowRotateConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleRotate()} isLoading={rotating}>
              Rotate Key
            </Button>
          </div>
        </DialogBody>
      </Dialog>
    </div>
  );
}

// ── AUDIT LOG TAB ────────────────────────────────────────────
function AuditLogTab() {
  const [filterUser, setFilterUser] = React.useState('');
  const [filterAction, setFilterAction] = React.useState('');
  const [filterFrom, setFilterFrom] = React.useState('');
  const [filterTo, setFilterTo] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [isExporting, setIsExporting] = React.useState(false);
  const addToast = useUIStore((s) => s.addToast);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-log', { filterUser, filterAction, filterFrom, filterTo, page }],
    queryFn: async () => {
      const { data } = await auditLogApi.list({
        user: filterUser || undefined,
        action: filterAction || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        page,
        limit: 50,
      });
      return data;
    },
  });

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const blob = await auditLogApi.export();
      downloadBlob(blob, 'audit-log.csv');
      addToast({ title: 'Audit log exported', variant: 'success' });
    } catch {
      addToast({ title: 'Export failed', variant: 'destructive' });
    } finally {
      setIsExporting(false);
    }
  };

  const logs: AuditLogEntry[] = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">User</Label>
          <Input value={filterUser} onChange={(e) => setFilterUser(e.target.value)} placeholder="Search user..." className="h-8 text-xs w-40" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">Action</Label>
          <Input value={filterAction} onChange={(e) => setFilterAction(e.target.value)} placeholder="e.g. login" className="h-8 text-xs w-32" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">From</Label>
          <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs text-gray-400 mb-1 block">To</Label>
          <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="h-8 text-xs" />
        </div>
        <Button size="sm" variant="secondary" onClick={() => void handleExport()} isLoading={isExporting}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 border-b border-gray-700">
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">Timestamp</th>
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">User</th>
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">Action</th>
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">Resource</th>
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">Detail</th>
                <th className="px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-500">No audit log entries found</td></tr>
              )}
              {logs.map((entry) => (
                <tr key={entry.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap">{formatDatetimeFull(entry.created_at)}</td>
                  <td className="px-3 py-2">
                    <p className="text-gray-200">{entry.user_name}</p>
                    <p className="text-gray-500">{entry.user_email}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className="bg-blue-900/30 text-blue-300 px-1.5 py-0.5 rounded font-mono">{entry.action}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-300">
                    {entry.resource}
                    {entry.resource_id && <span className="text-gray-500 ml-1">#{entry.resource_id.slice(0, 8)}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 font-mono max-w-[200px] truncate" title={entry.detail ? JSON.stringify(entry.detail) : ''}>
                    {entry.detail ? truncate(JSON.stringify(entry.detail), 60) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono">{entry.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <p>{total.toLocaleString()} entries</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 1}>Previous</Button>
            <span className="px-2 py-1">{page}/{totalPages}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────
export default function AdminSettingsPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const { data: settings, isLoading } = useSettings();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<SystemSettings>) => adminSettingsApi.update(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      addToast({ title: 'Settings saved', variant: 'success' });
    },
    onError: () => addToast({ title: 'Failed to save settings', variant: 'destructive' }),
  });

  if (!isAdmin) {
    return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Admin access required.</div>;
  }

  if (isLoading || !settings) {
    return <div className="space-y-4"><SkeletonCard /><SkeletonCard /></div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="System Settings" description="Configure integrations, security and audit logs" />

      <Tabs defaultValue="datasource">
        <TabsList>
          <TabsTrigger value="datasource">Data Source</TabsTrigger>
          <TabsTrigger value="graph">Microsoft Graph / Email</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="datasource">
          <DataSourceTab
            settings={settings}
            onSave={(data) => void updateMutation.mutateAsync(data)}
            isSaving={updateMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="graph">
          <GraphTab
            settings={settings}
            onSave={(data) => void updateMutation.mutateAsync(data)}
            isSaving={updateMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="teams">
          <TeamsTab
            settings={settings}
            onSave={(data) => void updateMutation.mutateAsync(data)}
            isSaving={updateMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="security">
          <SecurityTab
            settings={settings}
            onSave={(data) => void updateMutation.mutateAsync(data)}
            isSaving={updateMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
