'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, UserX, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Drawer } from '@/components/ui/drawer';
import { StatusBadge } from '@/components/status-badge';
import { SkeletonTable } from '@/components/ui/skeleton';
import { adminUsersApi } from '@/lib/api';
import { useDatasets } from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { formatDatetime } from '@/lib/utils';
import type { AdminUser, UserSession } from '@/types';
import type { BadgeProps } from '@/components/ui/badge';

const ROLE_BADGE: Record<string, BadgeProps['variant']> = {
  admin: 'purple',
  full_rights: 'blue',
  editor: 'green',
  viewer: 'gray',
};

function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const { data } = await adminUsersApi.list();
      return data;
    },
  });
}

const AVAILABLE_REPORTS = [
  { id: 'zamani', name: 'Zamani Traffic' },
];

interface UserFormData {
  name: string;
  email: string;
  password: string;
  role: string;
  dataset_access: string[];
  report_access: string[];
  send_welcome_email: boolean;
}

const defaultFormData: UserFormData = {
  name: '',
  email: '',
  password: '',
  role: 'viewer',
  dataset_access: [],
  report_access: [],
  send_welcome_email: false,
};

export default function AdminUsersPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const { data: users, isLoading } = useAdminUsers();
  const { data: datasets } = useDatasets();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const [showForm, setShowForm] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<AdminUser | null>(null);
  const [formData, setFormData] = React.useState<UserFormData>(defaultFormData);
  const [deactivateTarget, setDeactivateTarget] = React.useState<AdminUser | null>(null);
  const [drawerUser, setDrawerUser] = React.useState<AdminUser | null>(null);
  const [sessions, setSessions] = React.useState<UserSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);
  const [accessDrawerUser, setAccessDrawerUser] = React.useState<AdminUser | null>(null);
  const [accessFormData, setAccessFormData] = React.useState<{ dataset_access: string[]; report_access: string[] }>({ dataset_access: [], report_access: [] });
  const [accessSaving, setAccessSaving] = React.useState(false);

  const createMutation = useMutation({
    mutationFn: async (data: UserFormData) =>
      adminUsersApi.create({
        name: data.name,
        email: data.email,
        password: data.password,
        role: data.role,
        dataset_access: data.dataset_access,
        report_access: data.report_access,
        send_welcome_email: data.send_welcome_email,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'User created', variant: 'success' });
      setShowForm(false);
      setFormData(defaultFormData);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      addToast({ title: msg ?? 'Failed to create user', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AdminUser> }) =>
      adminUsersApi.update(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'User updated', variant: 'success' });
      setEditingUser(null);
    },
    onError: () => addToast({ title: 'Failed to update user', variant: 'destructive' }),
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => adminUsersApi.deactivate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'User deactivated', variant: 'success' });
      setDeactivateTarget(null);
    },
    onError: () => addToast({ title: 'Failed to deactivate user', variant: 'destructive' }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async ({ userId, sessionId }: { userId: string; sessionId: string }) =>
      adminUsersApi.deleteSession(userId, sessionId),
    onSuccess: () => {
      addToast({ title: 'Session revoked', variant: 'success' });
      if (drawerUser) void loadSessions(drawerUser.id);
    },
  });

  const loadSessions = async (userId: string) => {
    setSessionsLoading(true);
    try {
      const { data } = await adminUsersApi.getSessions(userId);
      setSessions(data);
    } finally {
      setSessionsLoading(false);
    }
  };

  const openDrawer = (user: AdminUser) => {
    setDrawerUser(user);
    void loadSessions(user.id);
  };

  const openEdit = (user: AdminUser) => {
    setEditingUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      dataset_access: user.dataset_access ?? [],
      report_access: user.report_access ?? [],
      send_welcome_email: false,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      await updateMutation.mutateAsync({
        id: editingUser.id,
        data: {
          name: formData.name,
          role: formData.role as AdminUser['role'],
          dataset_access: formData.dataset_access,
          report_access: formData.report_access,
        },
      });
    } else {
      await createMutation.mutateAsync(formData);
    }
  };

  const toggleDatasetAccess = (datasetId: string) => {
    setFormData((prev) => ({
      ...prev,
      dataset_access: prev.dataset_access.includes(datasetId)
        ? prev.dataset_access.filter((id) => id !== datasetId)
        : [...prev.dataset_access, datasetId],
    }));
  };

  const toggleReportAccess = (reportId: string) => {
    setFormData((prev) => ({
      ...prev,
      report_access: prev.report_access.includes(reportId)
        ? prev.report_access.filter((id) => id !== reportId)
        : [...prev.report_access, reportId],
    }));
  };

  const openAccessDrawer = (user: AdminUser) => {
    setAccessDrawerUser(user);
    setAccessFormData({
      dataset_access: user.dataset_access ?? [],
      report_access: user.report_access ?? [],
    });
  };

  const saveAccess = async () => {
    if (!accessDrawerUser) return;
    setAccessSaving(true);
    try {
      await updateMutation.mutateAsync({
        id: accessDrawerUser.id,
        data: {
          dataset_access: accessFormData.dataset_access,
          report_access: accessFormData.report_access,
        },
      });
      addToast({ title: 'Access updated', variant: 'success' });
      setAccessDrawerUser(null);
    } catch {
      addToast({ title: 'Failed to update access', variant: 'destructive' });
    } finally {
      setAccessSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Management"
        description="Manage user accounts and permissions"
        actions={
          <Button size="sm" onClick={() => { setEditingUser(null); setFormData(defaultFormData); setShowForm(true); }}>
            <Plus className="h-4 w-4" />
            New User
          </Button>
        }
      />

      {isLoading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Datasets / Reports</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Last Login</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 cursor-pointer"
                  onClick={() => openDrawer(user)}
                >
                  <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{user.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={ROLE_BADGE[user.role] ?? 'default'}>
                      {user.role === 'full_rights' ? 'Full Rights' : user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {user.role === 'admin' ? (
                      <span className="text-purple-600 dark:text-purple-400">All</span>
                    ) : (
                      <span>
                        {(user.dataset_access ?? []).length} datasets · {(user.report_access ?? []).length} reports
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.is_active ? 'active' : 'inactive'} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                    {user.last_login ? formatDatetime(user.last_login) : '—'}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(user)} title="Edit">
                        <Edit2 className="h-3.5 w-3.5 text-blue-400" />
                      </Button>
                      {user.role !== 'admin' && (
                        <Button variant="ghost" size="icon-sm" onClick={() => openAccessDrawer(user)} title="Manage Access">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        </Button>
                      )}
                      {user.is_active && (
                        <Button variant="ghost" size="icon-sm" onClick={() => setDeactivateTarget(user)} title="Deactivate">
                          <UserX className="h-3.5 w-3.5 text-red-400" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit form */}
      <Dialog open={showForm || !!editingUser} onClose={() => { setShowForm(false); setEditingUser(null); }} className="max-w-lg">
        <DialogHeader
          title={editingUser ? 'Edit User' : 'Create User'}
          onClose={() => { setShowForm(false); setEditingUser(null); }}
        />
        <DialogBody>
          <form id="user-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Full Name</Label>
              <Input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label required>Email</Label>
              <Input type="email" value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} disabled={!!editingUser} />
            </div>
            {!editingUser && (
              <div className="space-y-1.5">
                <Label required>Temporary Password</Label>
                <Input type="password" value={formData.password} onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))} />
                <p className="text-xs text-gray-500">Min 10 chars · uppercase · lowercase · number · special character</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={formData.role} onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value }))}>
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="full_rights">Full Rights</option>
                <option value="admin">Admin</option>
              </Select>
            </div>
            {formData.role !== 'admin' && (
              <div className="space-y-1.5">
                <Label>Access</Label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Datasets */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Datasets</p>
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto p-2 rounded border border-gray-200 dark:border-gray-700">
                      {(datasets ?? []).length === 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500">No datasets</p>
                      )}
                      {(datasets ?? []).map((d) => (
                        <label key={d.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={formData.dataset_access.includes(d.id)}
                            onChange={() => toggleDatasetAccess(d.id)}
                            className="rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-blue-600"
                          />
                          <span className="truncate">{d.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Reports */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Reports</p>
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto p-2 rounded border border-gray-200 dark:border-gray-700">
                      {AVAILABLE_REPORTS.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={formData.report_access.includes(r.id)}
                            onChange={() => toggleReportAccess(r.id)}
                            className="rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-emerald-600"
                          />
                          <span className="truncate">{r.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!editingUser && (
              <Toggle
                checked={!!formData.send_welcome_email}
                onChange={(v) => setFormData((p) => ({ ...p, send_welcome_email: v }))}
                label="Send welcome email"
              />
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setShowForm(false); setEditingUser(null); }}>Cancel</Button>
          <Button type="submit" form="user-form" isLoading={createMutation.isPending || updateMutation.isPending}>
            {editingUser ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Deactivate confirmation */}
      <Dialog open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)} className="max-w-sm">
        <DialogHeader title="Deactivate User" onClose={() => setDeactivateTarget(null)} />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Deactivate <span className="font-medium text-gray-800 dark:text-gray-100">{deactivateTarget?.name}</span>?
            They will no longer be able to log in.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deactivateTarget && void deactivateMutation.mutateAsync(deactivateTarget.id)}
              isLoading={deactivateMutation.isPending}
            >
              Deactivate
            </Button>
          </div>
        </DialogBody>
      </Dialog>

      {/* Manage Access drawer */}
      <Drawer
        open={!!accessDrawerUser}
        onClose={() => setAccessDrawerUser(null)}
        title={`Access — ${accessDrawerUser?.name ?? ''}`}
        description={accessDrawerUser?.email}
      >
        <div className="p-6 space-y-6">
          {accessDrawerUser && (
            <>
              {/* Datasets */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span>Datasets</span>
                  <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                    {accessFormData.dataset_access.length} of {(datasets ?? []).length} granted
                  </span>
                </h3>
                <div className="space-y-2">
                  {(datasets ?? []).map((d) => {
                    const checked = accessFormData.dataset_access.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{d.name}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAccessFormData((prev) => ({
                            ...prev,
                            dataset_access: checked
                              ? prev.dataset_access.filter((id) => id !== d.id)
                              : [...prev.dataset_access, d.id],
                          }))}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
                        />
                      </label>
                    );
                  })}
                  {(datasets ?? []).length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">No datasets configured.</p>
                  )}
                </div>
              </div>

              {/* Reports */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span>Reports</span>
                  <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                    {accessFormData.report_access.length} of {AVAILABLE_REPORTS.length} granted
                  </span>
                </h3>
                <div className="space-y-2">
                  {AVAILABLE_REPORTS.map((r) => {
                    const checked = accessFormData.report_access.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{r.name}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAccessFormData((prev) => ({
                            ...prev,
                            report_access: checked
                              ? prev.report_access.filter((id) => id !== r.id)
                              : [...prev.report_access, r.id],
                          }))}
                          className="rounded border-gray-300 dark:border-gray-600 text-emerald-600"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setAccessDrawerUser(null)}>Cancel</Button>
                <Button onClick={() => void saveAccess()} isLoading={accessSaving}>
                  Save Access
                </Button>
              </div>
            </>
          )}
        </div>
      </Drawer>

      {/* User detail drawer */}
      <Drawer open={!!drawerUser} onClose={() => setDrawerUser(null)} title={drawerUser?.name} description={drawerUser?.email}>
        <div className="p-6 space-y-6">
          {drawerUser && (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Role</p>
                  <Badge variant={ROLE_BADGE[drawerUser.role] ?? 'default'}>
                    {drawerUser.role === 'full_rights' ? 'Full Rights' : drawerUser.role}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Status</p>
                  <StatusBadge status={drawerUser.is_active ? 'active' : 'inactive'} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Created</p>
                  <p className="text-gray-700 dark:text-gray-300">{formatDatetime(drawerUser.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Last Login</p>
                  <p className="text-gray-700 dark:text-gray-300">{drawerUser.last_login ? formatDatetime(drawerUser.last_login) : '—'}</p>
                </div>
              </div>

              {/* Access summary */}
              {drawerUser.role !== 'admin' && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Access</h3>
                  <div className="space-y-2 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Datasets ({(drawerUser.dataset_access ?? []).length})</p>
                      {(drawerUser.dataset_access ?? []).length === 0 ? (
                        <p className="text-gray-400 dark:text-gray-500">No datasets granted</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(drawerUser.dataset_access ?? []).map((id) => {
                            const ds = (datasets ?? []).find((d) => d.id === id);
                            return ds ? (
                              <span key={id} className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{ds.name}</span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">Reports ({(drawerUser.report_access ?? []).length})</p>
                      {(drawerUser.report_access ?? []).length === 0 ? (
                        <p className="text-gray-400 dark:text-gray-500">No reports granted</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(drawerUser.report_access ?? []).map((slug) => {
                            const rpt = AVAILABLE_REPORTS.find((r) => r.id === slug);
                            return rpt ? (
                              <span key={slug} className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">{rpt.name}</span>
                            ) : null;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Active sessions */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Active Sessions</h3>
                {sessionsLoading ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">Loading...</p>
                ) : sessions.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500">No active sessions</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex items-start justify-between rounded border border-gray-200 dark:border-gray-700 p-3 text-xs">
                        <div>
                          <p className="text-gray-700 dark:text-gray-300 font-medium">{session.device}</p>
                          <p className="text-gray-400 dark:text-gray-500">{session.ip}</p>
                          <p className="text-gray-400 dark:text-gray-500">{formatDatetime(session.login_time)}</p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void deleteSessionMutation.mutateAsync({ userId: drawerUser.id, sessionId: session.id })}
                        >
                          Revoke
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}
