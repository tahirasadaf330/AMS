'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Edit2, UserX, ShieldCheck, Trash2, Lock,
  Search, ChevronUp, ChevronDown, ChevronsUpDown, Users,
  Copy, Check, KeyRound,
} from 'lucide-react';
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
import { adminUsersApi, adminReportsApi } from '@/lib/api';
import {
  useDatasets,
  useAdminGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useSetGroupMembers,
} from '@/hooks/useDashboard';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { formatDatetime } from '@/lib/utils';
import type { AdminUser, AdminGroup, UserSession } from '@/types';
import type { BadgeProps } from '@/components/ui/badge';

// ── Constants ─────────────────────────────────────────────────
const ROLE_BADGE: Record<string, BadgeProps['variant']> = {
  admin: 'purple', full_rights: 'blue', editor: 'green', viewer: 'gray',
};
const PAGE_SIZE = 20;

// ── Local hooks ───────────────────────────────────────────────
function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => { const { data } = await adminUsersApi.list(); return data; },
  });
}
function useAvailableReports() {
  return useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: async () => {
      const { data } = await adminReportsApi.list();
      return data.map((r) => ({ id: r.slug, name: r.name }));
    },
  });
}

// ── SortTh ────────────────────────────────────────────────────
function SortTh({ col, label, sortCol, sortDir, onSort }: {
  col: string; label: string; sortCol: string; sortDir: 'asc' | 'desc';
  onSort: (c: string) => void;
}) {
  const active = sortCol === col;
  return (
    <th
      className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200"
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
          : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </span>
    </th>
  );
}

// ── Tab button ────────────────────────────────────────────────
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-5 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
        active
          ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ── User form defaults ────────────────────────────────────────
const defaultUserForm = {
  name: '', email: '', role: 'viewer',
  dataset_access: [] as string[], report_access: [] as string[],
  role_ids: [] as string[],
  send_welcome_email: false, group_id: '',
};

// ────────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const isAdmin = useAuthStore((s) => s.canAccess('admin'));
  const canManageUsers = useAuthStore((s) => s.canAccess('create_condition')); // editor+
  const currentUser = useAuthStore((s) => s.user);
  const mySections = currentUser?.editor_sections ?? [];
  const { data: users, isLoading: usersLoading } = useAdminUsers();
  const { data: reports = [] } = useAvailableReports();
  const { data: datasets } = useDatasets();
  const { data: groups = [], isLoading: groupsLoading } = useAdminGroups();
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const createGroup   = useCreateGroup();
  const updateGroup   = useUpdateGroup();
  const deleteGroup   = useDeleteGroup();
  const setMembersMut = useSetGroupMembers();

  // ── Tab ───────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = React.useState<'users' | 'groups'>('users');

  // ── Users table state ─────────────────────────────────────────
  const [search, setSearch]           = React.useState('');
  const [groupFilter, setGroupFilter] = React.useState('');
  const [sortCol, setSortCol]         = React.useState('name');
  const [sortDir, setSortDir]         = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage]               = React.useState(1);

  React.useEffect(() => { setPage(1); }, [search, groupFilter, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir('asc'); }
  };

  const displayed = React.useMemo(() => {
    let rows = users ?? [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    if (groupFilter === '__none') rows = rows.filter((u) => !(u.role_ids?.length) && !u.group_id);
    else if (groupFilter) rows = rows.filter((u) => (u.role_ids ?? []).includes(groupFilter) || u.group_id === groupFilter);
    return [...rows].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      switch (sortCol) {
        case 'name':       av = a.name;              bv = b.name;              break;
        case 'email':      av = a.email;             bv = b.email;             break;
        case 'role':       av = a.role;              bv = b.role;              break;
        case 'group':      av = a.group_name ?? '';  bv = b.group_name ?? '';  break;
        case 'status':     av = a.is_active ? 1 : 0; bv = b.is_active ? 1 : 0; break;
        case 'last_login': av = a.last_login ?? '';  bv = b.last_login ?? '';  break;
      }
      if (av === bv) return 0;
      if (av === '') return 1;
      if (bv === '') return -1;
      return (av < bv ? -1 : 1) * (sortDir === 'asc' ? 1 : -1);
    });
  }, [users, search, groupFilter, sortCol, sortDir]);

  const pageRows   = displayed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(displayed.length / PAGE_SIZE);

  // ── User form (create / edit) ─────────────────────────────────
  const [showUserForm, setShowUserForm]   = React.useState(false);
  const [editingUser, setEditingUser]     = React.useState<AdminUser | null>(null);
  // Server-generated temp password, shown once after creation
  const [tempPwResult, setTempPwResult]   = React.useState<{ email: string; password: string } | null>(null);
  const [tempPwCopied, setTempPwCopied]   = React.useState(false);
  const [userForm, setUserForm]           = React.useState(defaultUserForm);
  const [deactivateTarget, setDeactivateTarget] = React.useState<AdminUser | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = React.useState<AdminUser | null>(null);
  const [deleteUserConfirm, setDeleteUserConfirm] = React.useState('');

  // ── User detail drawer ────────────────────────────────────────
  const [drawerUser, setDrawerUser]       = React.useState<AdminUser | null>(null);
  const [sessions, setSessions]           = React.useState<UserSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = React.useState(false);

  const loadSessions = async (userId: string) => {
    setSessionsLoading(true);
    try { const { data } = await adminUsersApi.getSessions(userId); setSessions(data); }
    finally { setSessionsLoading(false); }
  };

  // ── Individual access drawer ──────────────────────────────────
  const [accessUser, setAccessUser]       = React.useState<AdminUser | null>(null);
  const [accessForm, setAccessForm]       = React.useState({ dataset_access: [] as string[], report_access: [] as string[] });
  const [accessSaving, setAccessSaving]   = React.useState(false);

  // ── Group form ────────────────────────────────────────────────
  const [showCreateGroup, setShowCreateGroup] = React.useState(false);
  const [newGroupName, setNewGroupName]       = React.useState('');
  const [newGroupDesc, setNewGroupDesc]       = React.useState('');

  const [editingGroup, setEditingGroup]   = React.useState<AdminGroup | null>(null);
  const [groupForm, setGroupForm]         = React.useState({ name: '', description: '', dataset_access: [] as string[], report_access: [] as string[] });
  const [groupMembers, setGroupMembers]   = React.useState<string[]>([]);
  const [memberSearch, setMemberSearch]   = React.useState('');
  const [deleteGroupTarget, setDeleteGroupTarget] = React.useState<AdminGroup | null>(null);

  const openEditGroup = (g: AdminGroup) => {
    setEditingGroup(g);
    setGroupForm({ name: g.name, description: g.description ?? '', dataset_access: g.dataset_access, report_access: g.report_access });
    // Members come from the user_roles join (role_ids), plus any legacy single-group pointer.
    setGroupMembers(
      (users ?? [])
        .filter((u) => (u.role_ids ?? []).includes(g.id) || u.group_id === g.id)
        .map((u) => u.id),
    );
    setMemberSearch('');
  };

  const toggleGroupMember = (uid: string) =>
    setGroupMembers((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);

  const saveEditGroup = async () => {
    if (!editingGroup) return;
    await Promise.all([
      updateGroup.mutateAsync({
        id: editingGroup.id,
        data: { name: groupForm.name, description: groupForm.description || undefined, dataset_access: groupForm.dataset_access, report_access: groupForm.report_access },
      }),
      setMembersMut.mutateAsync({ id: editingGroup.id, userIds: groupMembers }),
    ]);
    // Refetch groups (member counts) and users (role badges + derived permission) after setMembers
    void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    setEditingGroup(null);
  };

  // ── User mutations ────────────────────────────────────────────
  const createUserMut = useMutation({
    mutationFn: async (f: typeof defaultUserForm) =>
      adminUsersApi.create({ name: f.name, email: f.email, role: f.role, dataset_access: f.dataset_access, report_access: f.report_access, role_ids: f.role_ids, send_welcome_email: f.send_welcome_email }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'User created', variant: 'success' });
      setShowUserForm(false);
      // Show the server-generated temp password once so the admin can share it
      setTempPwResult({ email: userForm.email, password: res.data.temp_password ?? '' });
      setUserForm(defaultUserForm);
    },
    onError: (err: unknown) => { const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message; addToast({ title: msg ?? 'Failed to create user', variant: 'destructive' }); },
  });

  const updateUserMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => adminUsersApi.update(id, data as Partial<AdminUser>),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); addToast({ title: 'User updated', variant: 'success' }); setEditingUser(null); },
    onError: () => addToast({ title: 'Failed to update user', variant: 'destructive' }),
  });

  const accessMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { dataset_access: string[]; report_access: string[] } }) =>
      adminUsersApi.update(id, data as Partial<AdminUser>),
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: string) => adminUsersApi.deactivate(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); addToast({ title: 'User deactivated', variant: 'success' }); setDeactivateTarget(null); },
    onError: () => addToast({ title: 'Failed to deactivate user', variant: 'destructive' }),
  });

  const deleteUserMut = useMutation({
    mutationFn: async (id: string) => adminUsersApi.delete(id),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }); addToast({ title: 'User deleted', variant: 'success' }); setDeleteUserTarget(null); setDeleteUserConfirm(''); },
    onError: () => addToast({ title: 'Failed to delete user', variant: 'destructive' }),
  });

  const delSessionMut = useMutation({
    mutationFn: async ({ userId, sessionId }: { userId: string; sessionId: string }) => adminUsersApi.deleteSession(userId, sessionId),
    onSuccess: () => { addToast({ title: 'Session revoked', variant: 'success' }); if (drawerUser) void loadSessions(drawerUser.id); },
  });

  const saveAccess = async () => {
    if (!accessUser) return;
    setAccessSaving(true);
    try {
      await accessMut.mutateAsync({ id: accessUser.id, data: accessForm });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'Access updated', variant: 'success' });
      setAccessUser(null);
    } catch { addToast({ title: 'Failed to update access', variant: 'destructive' }); }
    finally { setAccessSaving(false); }
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingUser) {
      await updateUserMut.mutateAsync({
        id: editingUser.id,
        data: { name: userForm.name, role: userForm.role, dataset_access: userForm.dataset_access, report_access: userForm.report_access, role_ids: userForm.role_ids, groupId: userForm.group_id || null },
      });
    } else {
      await createUserMut.mutateAsync(userForm);
    }
  };

  const openEditUser = (u: AdminUser) => {
    setEditingUser(u);
    setUserForm({ name: u.name, email: u.email, role: u.role, dataset_access: u.dataset_access ?? [], report_access: u.report_access ?? [], role_ids: u.role_ids ?? [], send_welcome_email: false, group_id: u.group_id ?? '' });
  };

  if (!canManageUsers) return <div className="flex items-center justify-center h-64 text-gray-500 text-sm">You do not have access to user management.</div>;

  const sortProps = { sortCol, sortDir, onSort: handleSort };
  // Seeded Roles (groups carrying a section+level) offered in the user dialog's multi-select.
  // Admins see all four; a delegated Editor sees only Viewer roles in their own section(s).
  const roleOptions = (groups ?? []).filter(
    (g) => g.level && (isAdmin || (g.level === 'viewer' && !!g.section && mySections.includes(g.section))),
  );
  const roleNameById = new Map((groups ?? []).map((g) => [g.id, g.name] as const));
  // Individual grant lists — Editors can only grant what they themselves can access.
  const grantableDatasets = isAdmin
    ? (datasets ?? [])
    : (datasets ?? []).filter((d) => (currentUser?.dataset_access ?? []).includes(d.id));
  const grantableReports = isAdmin
    ? reports
    : reports.filter((r) => (currentUser?.report_access ?? []).includes(r.id));
  const derivedPermission =
    userForm.role_ids.some((id) => roleOptions.find((g) => g.id === id)?.level === 'editor')
      ? 'Editor'
      : 'Viewer';
  const nonAdminUsers = (users ?? []).filter((u) => u.role !== 'admin');
  const filteredForMember = nonAdminUsers.filter((u) => {
    const q = memberSearch.trim().toLowerCase();
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="User Management"
        description="Manage users, permissions and roles"
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button variant="secondary" size="sm" onClick={() => setShowCreateGroup(true)}>
                <Plus className="h-4 w-4" />
                New Role
              </Button>
            )}
            <Button size="sm" onClick={() => { setEditingUser(null); setUserForm(defaultUserForm); setShowUserForm(true); }}>
              <Plus className="h-4 w-4" />
              New User
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        <TabBtn active={activeTab === 'users'} onClick={() => setActiveTab('users')}>
          Users{users ? ` (${users.length})` : ''}
        </TabBtn>
        {isAdmin && (
          <TabBtn active={activeTab === 'groups'} onClick={() => setActiveTab('groups')}>
            Roles{groups.length > 0 ? ` (${groups.length})` : ''}
          </TabBtn>
        )}
      </div>

      {/* ── USERS TAB ─────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>
            <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="h-8 text-sm w-44">
              <option value="">All Roles</option>
              <option value="__none">No Role</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{displayed.length} of {users?.length ?? 0} users</span>
          </div>

          {usersLoading ? <SkeletonTable rows={5} cols={8} /> : (
            <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <SortTh col="name"       label="Name"       {...sortProps} />
                    <SortTh col="email"      label="Email"      {...sortProps} />
                    <SortTh col="role"       label="Permission" {...sortProps} />
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Roles</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Access</th>
                    <SortTh col="status"     label="Status"     {...sortProps} />
                    <SortTh col="last_login" label="Last Login" {...sortProps} />
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">No users match your filter.</td></tr>
                  ) : pageRows.map((user) => (
                    <tr key={user.id} className={`border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20 ${isAdmin ? 'cursor-pointer' : ''}`} onClick={() => { if (!isAdmin) return; setDrawerUser(user); void loadSessions(user.id); }}>
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{user.name}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{user.email}</td>
                      <td className="px-4 py-3"><Badge variant={ROLE_BADGE[user.role] ?? 'default'}>{user.role}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(user.role_ids ?? []).map((rid) => (
                            <Badge key={rid} variant="blue">{roleNameById.get(rid) ?? 'role'}</Badge>
                          ))}
                          {user.group_name && <Badge variant="amber">{user.group_name}</Badge>}
                          {!(user.role_ids ?? []).length && !user.group_name && (
                            <span className="text-gray-400 dark:text-gray-600 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        {user.role === 'admin'
                          ? <span className="text-purple-600 dark:text-purple-400">All</span>
                          : <span>{(user.dataset_access ?? []).length}D · {(user.report_access ?? []).length}R</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={user.is_active ? 'active' : 'inactive'} /></td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{user.last_login ? formatDatetime(user.last_login) : '—'}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {user.is_protected || (!isAdmin && (user.role === 'admin' || user.role === 'editor')) ? (
                            <span className="flex h-7 w-7 items-center justify-center"><Lock className="h-3.5 w-3.5 text-gray-400" /></span>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon-sm" onClick={() => openEditUser(user)} title="Edit user"><Edit2 className="h-3.5 w-3.5 text-blue-400" /></Button>
                              {isAdmin && user.role !== 'admin' && (
                                <Button variant="ghost" size="icon-sm" title="Individual access" onClick={() => { setAccessUser(user); setAccessForm({ dataset_access: user.dataset_access ?? [], report_access: user.report_access ?? [] }); }}>
                                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                                </Button>
                              )}
                              {isAdmin && user.is_active && (
                                <Button variant="ghost" size="icon-sm" onClick={() => setDeactivateTarget(user)} title="Deactivate"><UserX className="h-3.5 w-3.5 text-red-400" /></Button>
                              )}
                              {isAdmin && (
                                <Button variant="ghost" size="icon-sm" onClick={() => { setDeleteUserTarget(user); setDeleteUserConfirm(''); }} title="Delete permanently"><Trash2 className="h-3.5 w-3.5 text-rose-600" /></Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, displayed.length)} of {displayed.length} users</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
                <span className="px-2">{page} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── GROUPS TAB ────────────────────────────────────────── */}
      {activeTab === 'groups' && (
        <div className="space-y-4">
          {groupsLoading ? <SkeletonTable rows={3} cols={6} /> : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400 dark:text-gray-500">
              <Users className="h-10 w-10 opacity-30" />
              <p className="text-sm">No roles yet. Click <span className="font-medium text-gray-600 dark:text-gray-300">New Role</span> to create one.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Members</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Datasets</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Reports</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/20">
                      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">{g.name}</td>
                      <td className="px-4 py-3">
                        {g.level ? (
                          <span className="flex items-center gap-1.5">
                            <Badge variant={g.section === 'sms' ? 'blue' : 'purple'}>{(g.section ?? '').toUpperCase()}</Badge>
                            <span className="text-xs text-gray-500 capitalize">{g.level}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">Custom</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs max-w-[240px] truncate">{g.description ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-700 dark:text-gray-300">{g.user_count}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">{g.dataset_access.length}</td>
                      <td className="px-4 py-3 text-center text-gray-600 dark:text-gray-300">{g.report_access.length}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditGroup(g)}>
                            <Edit2 className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
                            Edit
                          </Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => setDeleteGroupTarget(g)} title="Delete group">
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ DIALOGS ══════════════════════════════════════════════ */}

      {/* Create role */}
      <Dialog open={showCreateGroup} onClose={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc(''); }} className="max-w-sm">
        <DialogHeader title="Create Role" onClose={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc(''); }} />
        <DialogBody>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label required>Role Name</Label>
              <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="e.g. Finance Team" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc(''); }}>Cancel</Button>
          <Button
            disabled={!newGroupName.trim()}
            isLoading={createGroup.isPending}
            onClick={async () => {
              await createGroup.mutateAsync({ name: newGroupName.trim(), description: newGroupDesc.trim() || undefined });
              setShowCreateGroup(false); setNewGroupName(''); setNewGroupDesc('');
              setActiveTab('groups');
            }}
          >
            Create Role
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit role — name/description + access + members */}
      <Dialog open={!!editingGroup} onClose={() => setEditingGroup(null)} className="max-w-2xl">
        <DialogHeader title={`Edit Role: ${editingGroup?.name ?? ''}`} onClose={() => setEditingGroup(null)} />
        <DialogBody>
          <div className="space-y-5">

            {/* Name + Description */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label required>Name</Label>
                <Input value={groupForm.name} onChange={(e) => setGroupForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input value={groupForm.description} onChange={(e) => setGroupForm((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" />
              </div>
            </div>

            {/* Permissions */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Permissions</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Datasets</p>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto p-2.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
                    {(datasets ?? []).length === 0 && <p className="text-xs text-gray-400">No datasets</p>}
                    {(datasets ?? []).map((d) => (
                      <label key={d.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox"
                          checked={groupForm.dataset_access.includes(d.id)}
                          onChange={() => setGroupForm((p) => ({
                            ...p,
                            dataset_access: p.dataset_access.includes(d.id)
                              ? p.dataset_access.filter((x) => x !== d.id)
                              : [...p.dataset_access, d.id],
                          }))}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
                        />
                        <span className="truncate">{d.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Reports</p>
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto p-2.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
                    {reports.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                        <input type="checkbox"
                          checked={groupForm.report_access.includes(r.id)}
                          onChange={() => setGroupForm((p) => ({
                            ...p,
                            report_access: p.report_access.includes(r.id)
                              ? p.report_access.filter((x) => x !== r.id)
                              : [...p.report_access, r.id],
                          }))}
                          className="rounded border-gray-300 dark:border-gray-600 text-emerald-600"
                        />
                        <span className="truncate">{r.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Members */}
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Members <span className="font-normal normal-case text-gray-400 ml-1">({groupMembers.length} selected)</span>
              </p>
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <Input placeholder="Search users…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="pl-8 h-8 text-sm" />
              </div>
              <div className="flex flex-col gap-0.5 max-h-52 overflow-y-auto p-2.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40">
                {filteredForMember.length === 0 && <p className="text-xs text-gray-400 py-3 text-center">No users found.</p>}
                {filteredForMember.map((u) => {
                  const inThis  = groupMembers.includes(u.id);
                  const otherGrp = !inThis && u.group_id && u.group_name ? u.group_name : null;
                  return (
                    <label key={u.id} className="flex items-center gap-2.5 cursor-pointer rounded px-1.5 py-1.5 hover:bg-white dark:hover:bg-gray-700/40">
                      <input type="checkbox" checked={inThis} onChange={() => toggleGroupMember(u.id)}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{u.name}</span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">{u.email}</span>
                      </div>
                      {otherGrp && (
                        <span className="text-xs text-amber-500 dark:text-amber-400 flex-shrink-0 ml-2">in {otherGrp}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditingGroup(null)}>Cancel</Button>
          <Button isLoading={updateGroup.isPending || setMembersMut.isPending} disabled={!groupForm.name.trim()} onClick={() => void saveEditGroup()}>
            Save Role
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete group */}
      <Dialog open={!!deleteGroupTarget} onClose={() => setDeleteGroupTarget(null)} className="max-w-sm">
        <DialogHeader title="Delete Role" onClose={() => setDeleteGroupTarget(null)} />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Delete <span className="font-medium text-gray-800 dark:text-gray-100">{deleteGroupTarget?.name}</span>?
            {(deleteGroupTarget?.user_count ?? 0) > 0 && (
              <> <span className="text-amber-600 dark:text-amber-400">{deleteGroupTarget?.user_count} member(s) will lose this role's access.</span></>
            )}
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeleteGroupTarget(null)}>Cancel</Button>
            <Button variant="destructive" isLoading={deleteGroup.isPending}
              onClick={async () => { if (!deleteGroupTarget) return; await deleteGroup.mutateAsync(deleteGroupTarget.id); setDeleteGroupTarget(null); }}>
              Delete
            </Button>
          </div>
        </DialogBody>
      </Dialog>

      {/* Temp password — shown once after user creation */}
      <Dialog open={!!tempPwResult} onClose={() => { setTempPwResult(null); setTempPwCopied(false); }} className="max-w-md">
        <DialogHeader title="Temporary Password" onClose={() => { setTempPwResult(null); setTempPwCopied(false); }} />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            Share this password with <span className="font-medium text-gray-800 dark:text-gray-100">{tempPwResult?.email}</span>.
            It is shown <span className="font-semibold">only once</span> — the user must change it on first login.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 font-mono text-sm text-gray-900 dark:text-gray-100 tracking-wide select-all">
              {tempPwResult?.password || '—'}
            </code>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!tempPwResult?.password) return;
                void navigator.clipboard.writeText(tempPwResult.password).then(() => {
                  setTempPwCopied(true);
                  addToast({ title: 'Password copied', variant: 'success' });
                });
              }}
            >
              {tempPwCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              {tempPwCopied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={() => { setTempPwResult(null); setTempPwCopied(false); }}>Done</Button>
          </div>
        </DialogBody>
      </Dialog>

      {/* Create / Edit user */}
      <Dialog open={showUserForm || !!editingUser} onClose={() => { setShowUserForm(false); setEditingUser(null); }} className="max-w-lg">
        <DialogHeader title={editingUser ? 'Edit User' : 'Create User'} onClose={() => { setShowUserForm(false); setEditingUser(null); }} />
        <DialogBody>
          <form id="user-form" onSubmit={(e) => void handleUserSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label required>Full Name</Label>
              <Input value={userForm.name} onChange={(e) => setUserForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label required>Email</Label>
              <Input type="email" value={userForm.email} onChange={(e) => setUserForm((p) => ({ ...p, email: e.target.value }))} disabled={!!editingUser} />
            </div>
            {!editingUser && (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5">
                <KeyRound className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  A temporary password is generated automatically and shown once after the user is created.
                  The user must change it on first login.
                </p>
              </div>
            )}
            {editingUser?.is_protected ? (
              <div className="space-y-1.5">
                <Label>Permission</Label>
                <div className="flex items-center gap-2 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-500">
                  <Lock className="h-3.5 w-3.5 flex-shrink-0" />Protected admin
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {isAdmin && (
                  <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Administrator</p>
                      <p className="text-xs text-gray-400">Full access to everything, incl. user management.</p>
                    </div>
                    <Toggle
                      checked={userForm.role === 'admin'}
                      onChange={(v) => setUserForm((p) => ({ ...p, role: v ? 'admin' : 'viewer', role_ids: v ? [] : p.role_ids }))}
                      label=""
                    />
                  </div>
                )}
                {userForm.role !== 'admin' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label>Roles</Label>
                      <Badge variant={derivedPermission === 'Editor' ? 'green' : 'gray'}>
                        Permission: {derivedPermission}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-1.5 p-2 rounded border border-gray-200 dark:border-gray-700">
                      {roleOptions.length === 0 && <p className="text-xs text-gray-400">No roles defined</p>}
                      {roleOptions.map((g) => (
                        <label key={g.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={userForm.role_ids.includes(g.id)}
                            onChange={() => setUserForm((p) => ({
                              ...p,
                              role_ids: p.role_ids.includes(g.id)
                                ? p.role_ids.filter((x) => x !== g.id)
                                : [...p.role_ids, g.id],
                            }))}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
                          />
                          <span className="truncate">{g.name}</span>
                          {g.section && (
                            <Badge variant={g.section === 'sms' ? 'blue' : 'purple'}>{g.section.toUpperCase()}</Badge>
                          )}
                          {g.level && <span className="text-xs text-gray-400 capitalize">{g.level}</span>}
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400">
                      An Editor role grants everything in its section (SMS/Voice) and lets the user create alerts.
                      A Viewer role only sees the reports/datasets you grant below.
                    </p>
                  </div>
                )}
              </div>
            )}
            {userForm.role !== 'admin' && (
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  Individual Access <span className="font-normal normal-case text-gray-400">(adds on top of role access)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Datasets</p>
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto p-2 rounded border border-gray-200 dark:border-gray-700">
                      {grantableDatasets.length === 0 && <p className="text-xs text-gray-400">No datasets</p>}
                      {grantableDatasets.map((d) => (
                        <label key={d.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={userForm.dataset_access.includes(d.id)}
                            onChange={() => setUserForm((p) => ({ ...p, dataset_access: p.dataset_access.includes(d.id) ? p.dataset_access.filter((x) => x !== d.id) : [...p.dataset_access, d.id] }))}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600" />
                          <span className="truncate">{d.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">Reports</p>
                    <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto p-2 rounded border border-gray-200 dark:border-gray-700">
                      {grantableReports.length === 0 && <p className="text-xs text-gray-400">No reports</p>}
                      {grantableReports.map((r) => (
                        <label key={r.id} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
                          <input type="checkbox" checked={userForm.report_access.includes(r.id)}
                            onChange={() => setUserForm((p) => ({ ...p, report_access: p.report_access.includes(r.id) ? p.report_access.filter((x) => x !== r.id) : [...p.report_access, r.id] }))}
                            className="rounded border-gray-300 dark:border-gray-600 text-emerald-600" />
                          <span className="truncate">{r.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!editingUser && (
              <Toggle checked={!!userForm.send_welcome_email} onChange={(v) => setUserForm((p) => ({ ...p, send_welcome_email: v }))} label="Send welcome email" />
            )}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setShowUserForm(false); setEditingUser(null); }}>Cancel</Button>
          <Button type="submit" form="user-form" isLoading={createUserMut.isPending || updateUserMut.isPending}>
            {editingUser ? 'Save Changes' : 'Create User'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Deactivate user */}
      <Dialog open={!!deactivateTarget} onClose={() => setDeactivateTarget(null)} className="max-w-sm">
        <DialogHeader title="Deactivate User" onClose={() => setDeactivateTarget(null)} />
        <DialogBody>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Deactivate <span className="font-medium text-gray-800 dark:text-gray-100">{deactivateTarget?.name}</span>? They will no longer be able to log in.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="ghost" onClick={() => setDeactivateTarget(null)}>Cancel</Button>
            <Button variant="destructive" isLoading={deactivateMut.isPending}
              onClick={() => deactivateTarget && void deactivateMut.mutateAsync(deactivateTarget.id)}>
              Deactivate
            </Button>
          </div>
        </DialogBody>
      </Dialog>

      {/* Delete user */}
      <Dialog open={!!deleteUserTarget} onClose={() => { setDeleteUserTarget(null); setDeleteUserConfirm(''); }} className="max-w-sm">
        <DialogHeader title="Delete User Permanently" onClose={() => { setDeleteUserTarget(null); setDeleteUserConfirm(''); }} />
        <DialogBody>
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30">
              <Trash2 className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">
                Permanently deletes <span className="font-bold">{deleteUserTarget?.name}</span> and all their data. Cannot be undone.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Type <span className="font-mono font-bold text-gray-800 dark:text-gray-200">{deleteUserTarget?.name}</span> to confirm</Label>
              <Input value={deleteUserConfirm} onChange={(e) => setDeleteUserConfirm(e.target.value)} placeholder={deleteUserTarget?.name} autoComplete="off" />
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setDeleteUserTarget(null); setDeleteUserConfirm(''); }}>Cancel</Button>
              <Button variant="destructive" disabled={deleteUserConfirm !== deleteUserTarget?.name} isLoading={deleteUserMut.isPending}
                onClick={() => deleteUserTarget && void deleteUserMut.mutateAsync(deleteUserTarget.id)}>
                Delete Permanently
              </Button>
            </div>
          </div>
        </DialogBody>
      </Dialog>

      {/* Individual access drawer (no group needed) */}
      <Drawer open={!!accessUser} onClose={() => setAccessUser(null)} title={`Access — ${accessUser?.name ?? ''}`} description={accessUser?.email}>
        <div className="p-6 space-y-6">
          {accessUser && (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded p-2.5">
                These are <span className="font-medium">individual grants</span> — they stack on top of any role access. No role required.
              </p>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Datasets ({accessForm.dataset_access.length})</h3>
                <div className="space-y-2">
                  {(datasets ?? []).map((d) => {
                    const chk = accessForm.dataset_access.includes(d.id);
                    return (
                      <label key={d.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{d.name}</span>
                        <input type="checkbox" checked={chk} onChange={() => setAccessForm((p) => ({ ...p, dataset_access: chk ? p.dataset_access.filter((id) => id !== d.id) : [...p.dataset_access, d.id] }))} className="rounded border-gray-300 dark:border-gray-600 text-blue-600" />
                      </label>
                    );
                  })}
                  {(datasets ?? []).length === 0 && <p className="text-xs text-gray-400">No datasets configured.</p>}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Reports ({accessForm.report_access.length})</h3>
                <div className="space-y-2">
                  {reports.map((r) => {
                    const chk = accessForm.report_access.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <span className="text-sm text-gray-700 dark:text-gray-300">{r.name}</span>
                        <input type="checkbox" checked={chk} onChange={() => setAccessForm((p) => ({ ...p, report_access: chk ? p.report_access.filter((id) => id !== r.id) : [...p.report_access, r.id] }))} className="rounded border-gray-300 dark:border-gray-600 text-emerald-600" />
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="ghost" onClick={() => setAccessUser(null)}>Cancel</Button>
                <Button onClick={() => void saveAccess()} isLoading={accessSaving}>Save Access</Button>
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
                <div><p className="text-xs text-gray-400 mb-0.5">Permission</p><Badge variant={ROLE_BADGE[drawerUser.role] ?? 'default'}>{drawerUser.role}</Badge></div>
                <div><p className="text-xs text-gray-400 mb-0.5">Status</p><StatusBadge status={drawerUser.is_active ? 'active' : 'inactive'} /></div>
                {((drawerUser.role_ids ?? []).length > 0 || drawerUser.group_name) && (
                  <div><p className="text-xs text-gray-400 mb-0.5">Roles</p>
                    <div className="flex flex-wrap gap-1">
                      {(drawerUser.role_ids ?? []).map((rid) => <Badge key={rid} variant="blue">{roleNameById.get(rid) ?? 'role'}</Badge>)}
                      {drawerUser.group_name && <Badge variant="amber">{drawerUser.group_name}</Badge>}
                    </div>
                  </div>
                )}
                <div><p className="text-xs text-gray-400 mb-0.5">Created</p><p className="text-gray-700 dark:text-gray-300">{formatDatetime(drawerUser.created_at)}</p></div>
                <div><p className="text-xs text-gray-400 mb-0.5">Last Login</p><p className="text-gray-700 dark:text-gray-300">{drawerUser.last_login ? formatDatetime(drawerUser.last_login) : '—'}</p></div>
              </div>
              {drawerUser.role !== 'admin' && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Individual Access</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-400 uppercase tracking-wide mb-1.5">Datasets ({(drawerUser.dataset_access ?? []).length})</p>
                      {(drawerUser.dataset_access ?? []).length === 0 ? <p className="text-gray-400">None</p> : (
                        <div className="flex flex-wrap gap-1.5">
                          {(drawerUser.dataset_access ?? []).map((id) => { const ds = (datasets ?? []).find((d) => d.id === id); return ds ? <span key={id} className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{ds.name}</span> : null; })}
                        </div>
                      )}
                    </div>
                    <div className="rounded border border-gray-200 dark:border-gray-700 p-3">
                      <p className="font-medium text-gray-400 uppercase tracking-wide mb-1.5">Reports ({(drawerUser.report_access ?? []).length})</p>
                      {(drawerUser.report_access ?? []).length === 0 ? <p className="text-gray-400">None</p> : (
                        <div className="flex flex-wrap gap-1.5">
                          {(drawerUser.report_access ?? []).map((slug) => { const rpt = reports.find((r) => r.id === slug); return rpt ? <span key={slug} className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">{rpt.name}</span> : null; })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Active Sessions</h3>
                {sessionsLoading ? <p className="text-xs text-gray-400">Loading…</p> : sessions.length === 0 ? <p className="text-xs text-gray-400">No active sessions</p> : (
                  <div className="space-y-2">
                    {sessions.map((s) => (
                      <div key={s.id} className="flex items-start justify-between rounded border border-gray-200 dark:border-gray-700 p-3 text-xs">
                        <div><p className="font-medium text-gray-700 dark:text-gray-300">{s.device}</p><p className="text-gray-400">{s.ip}</p><p className="text-gray-400">{formatDatetime(s.login_time)}</p></div>
                        <Button variant="destructive" size="sm" onClick={() => void delSessionMut.mutateAsync({ userId: drawerUser.id, sessionId: s.id })}>Revoke</Button>
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
