import axios, { type AxiosRequestConfig } from 'axios';
import type {
  AuthResponse,
  DataSource,
  Dataset,
  DashboardDataParams,
  DashboardDataResponse,
  DashboardMatrixResponse,
  RefreshHistoryEntry,
  Condition,
  ConditionPreviewResult,
  Schedule,
  NotificationLog,
  NotificationFilters,
  NotificationLogResponse,
  AdminUser,
  UserSession,
  SystemSettings,
  AuditLogFilters,
  AuditLogResponse,
} from '@/types';

// ── Axios instance ────────────────────────────────────────────
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  withCredentials: true, // for HttpOnly refresh-token cookie
  timeout: 30_000,
});

// Token injector — updated by the auth store
let _getToken: () => string | null = () => null;
let _onUnauthorized: () => void = () => {};

export function configureApiAuth(
  getToken: () => string | null,
  onUnauthorized: () => void
): void {
  _getToken = getToken;
  _onUnauthorized = onUnauthorized;
}

api.interceptors.request.use((config) => {
  const token = _getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

let _isRefreshing = false;
let _refreshQueue: Array<(token: string | null) => void> = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (_isRefreshing) {
        // Queue the request until refresh completes
        return new Promise((resolve, reject) => {
          _refreshQueue.push((newToken) => {
            if (newToken && originalRequest.headers) {
              (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
              resolve(api(originalRequest));
            } else {
              reject(error);
            }
          });
        });
      }

      originalRequest._retry = true;
      _isRefreshing = true;

      try {
        const { data } = await api.post<AuthResponse>('/auth/refresh');
        const newToken = data.token;
        _getToken = () => newToken;
        _refreshQueue.forEach((cb) => cb(newToken));
        _refreshQueue = [];
        if (originalRequest.headers) {
          (originalRequest.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
        }
        return api(originalRequest);
      } catch {
        _refreshQueue.forEach((cb) => cb(null));
        _refreshQueue = [];
        _onUnauthorized();
        return Promise.reject(error);
      } finally {
        _isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ── AUTH ──────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }),

  refresh: () => api.post<AuthResponse>('/auth/refresh'),

  logout: () => api.post('/auth/logout'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),
};

// ── DASHBOARD ─────────────────────────────────────────────────
export const dashboardApi = {
  getDatasets: () => api.get<Dataset[]>('/dashboard/datasets'),

  getData: (datasetId: string, params: DashboardDataParams) =>
    api.get<DashboardDataResponse>(`/dashboard/${datasetId}/data`, { params }),

  getMatrix: (datasetId: string) =>
    api.get<DashboardMatrixResponse>(`/dashboard/${datasetId}/matrix`),

  triggerRefresh: (datasetId: string) =>
    api.post<{ message: string }>(`/dashboard/${datasetId}/refresh`),

  getHistory: (datasetId: string) =>
    api.get<RefreshHistoryEntry[]>(`/dashboard/${datasetId}/history`),
};

// ── EXPORT ────────────────────────────────────────────────────
export const exportApi = {
  getCsv: async (datasetId: string, params?: Record<string, string>): Promise<Blob> => {
    const token = _getToken();
    const qs = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/export/${datasetId}/csv${qs}`,
      {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      }
    );
    if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
    return response.blob();
  },

  getExcel: async (datasetId: string, params?: Record<string, string>): Promise<Blob> => {
    const token = _getToken();
    const qs = params && Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/export/${datasetId}/excel${qs}`,
      {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      }
    );
    if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
    return response.blob();
  },
};

// ── CONDITIONS ────────────────────────────────────────────────
export const conditionsApi = {
  list: () => api.get<Condition[]>('/conditions'),

  create: (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<Condition>('/conditions', data),

  update: (id: string, data: Partial<Omit<Condition, 'id' | 'created_at' | 'updated_at'>>) =>
    api.put<Condition>(`/conditions/${id}`, data),

  delete: (id: string) => api.delete(`/conditions/${id}`),

  preview: (id: string) => api.post<ConditionPreviewResult>(`/conditions/${id}/preview`),

  testNotify: (id: string) => api.post(`/conditions/${id}/test-notify`),

  testNotifyPreview: (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) =>
    api.post('/conditions/test-notify-preview', data),

  triggerNow: (id: string) => api.post(`/conditions/${id}/trigger-now`),
};

// ── SCHEDULES ─────────────────────────────────────────────────
export const schedulesApi = {
  list: () => api.get<Schedule[]>('/schedules'),

  update: (datasetId: string, cron: string, startDate?: string | null, endDate?: string | null) =>
    api.put<Schedule>(`/schedules/${datasetId}`, { cron, startDate: startDate ?? undefined, endDate: endDate ?? undefined }),

  trigger: (datasetId: string) =>
    api.post<{ message: string }>(`/schedules/${datasetId}/trigger`),
};

// ── NOTIFICATIONS ─────────────────────────────────────────────
export const notificationsApi = {
  list: (filters: NotificationFilters) =>
    api.get<NotificationLogResponse>('/notifications', { params: filters }),

  retry: (id: string) => api.post<NotificationLog>(`/notifications/${id}/retry`),
};

// ── ADMIN — USERS ─────────────────────────────────────────────
export const adminUsersApi = {
  list: () => api.get<AdminUser[]>('/admin/users'),

  create: (data: {
    name: string;
    email: string;
    password: string;
    role: string;
    dataset_access: string[];
    report_access?: string[];
    send_welcome_email?: boolean;
  }) => api.post<AdminUser>('/admin/users', data),

  update: (id: string, data: Partial<AdminUser>) =>
    api.put<AdminUser>(`/admin/users/${id}`, data),

  deactivate: (id: string) => api.post(`/admin/users/${id}/deactivate`),

  delete: (id: string) => api.delete(`/admin/users/${id}`),

  getSessions: (id: string) => api.get<UserSession[]>(`/admin/users/${id}/sessions`),

  deleteSession: (userId: string, sessionId: string) =>
    api.delete(`/admin/users/${userId}/sessions/${sessionId}`),
};

// ── ADMIN — DATASETS ──────────────────────────────────────────
export const adminDatasetsApi = {
  list: () => api.get<Dataset[]>('/admin/datasets'),

  create: (data: Omit<Dataset, 'id' | 'created_at' | 'updated_at' | 'last_refresh'>) =>
    api.post<Dataset>('/admin/datasets', data),

  update: (id: string, data: Partial<Dataset>) =>
    api.put<Dataset>(`/admin/datasets/${id}`, data),

  delete: (id: string) => api.delete(`/admin/datasets/${id}`),

  validateSql: (query: string, data_source_id?: string) =>
    api.post<{ valid: boolean; error?: string; columns?: Array<{ key: string; label: string; type: string }> }>(
      '/admin/datasets/validate-sql',
      { query, data_source_id }
    ),
};

// ── ADMIN — DATA SOURCES ──────────────────────────────────────
export const adminDatasourcesApi = {
  list: () => api.get<DataSource[]>('/admin/datasources'),

  create: (data: Omit<DataSource, 'id' | 'created_at'>) =>
    api.post<DataSource>('/admin/datasources', data),

  update: (id: string, data: Partial<Omit<DataSource, 'id' | 'created_at'>>) =>
    api.put<DataSource>(`/admin/datasources/${id}`, data),

  delete: (id: string) => api.delete(`/admin/datasources/${id}`),

  testConnection: (data: {
    type: string;
    host: string;
    port: number;
    db: string;
    username: string;
    password: string;
    ssl_mode?: string;
  }) => api.post<{ success: boolean; message: string }>('/admin/datasources/test-connection', data),
};

// ── ADMIN — SETTINGS ──────────────────────────────────────────
export const adminSettingsApi = {
  get: () => api.get<SystemSettings>('/admin/settings'),

  update: (data: Partial<SystemSettings>) => api.put<SystemSettings>('/admin/settings', data),

  testJerasoft: () =>
    api.post<{ connected: boolean; latency_ms: number; pg_version: string }>(
      '/admin/settings/test-jerasoft'
    ),

  testGraph: () =>
    api.post<{ success: boolean; message: string }>('/admin/settings/test-graph'),

  testTeams: () =>
    api.post<{ success: boolean; message: string }>('/admin/settings/test-teams'),

  rotateKey: () => api.post<{ message: string }>('/admin/settings/rotate-key'),

  listPythonPackages: () =>
    api.get<Array<{ name: string; version: string }>>('/admin/settings/python-packages'),

  installPythonPackage: (packageSpec: string) =>
    api.post<{ success: boolean; output: string }>(
      '/admin/settings/python-packages/install',
      { packageSpec },
    ),

  uninstallPythonPackage: (name: string) =>
    api.post<{ success: boolean; output: string }>(
      '/admin/settings/python-packages/uninstall',
      { name },
    ),
};

// ── ADMIN — AUDIT LOG ─────────────────────────────────────────
export const auditLogApi = {
  list: (filters: AuditLogFilters) =>
    api.get<AuditLogResponse>('/admin/audit-log', { params: filters }),

  export: async (): Promise<Blob> => {
    const token = _getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/admin/audit-log/export`,
      {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      }
    );
    if (!response.ok) throw new Error('Audit log export failed');
    return response.blob();
  },
};

// ── ZAMANI REPORT ─────────────────────────────────────────────
export const zamaniApi = {
  getFilters: () => api.get('/reports/zamani/filters'),
  getYesterday: (params: Record<string, string>) => api.get('/reports/zamani/yesterday', { params }),
  getComparison: (params: Record<string, string>) => api.get('/reports/zamani/comparison', { params }),
  getMtd: (params: Record<string, string>) => api.get('/reports/zamani/mtd', { params }),
  getProjections: (params: Record<string, string>) => api.get('/reports/zamani/projections', { params }),
  upsertTarget: (data: { year: number; month: number; messages_target: number; revenue_target: number }) =>
    api.post('/reports/zamani/targets', data),
  getCostVsRevenue: () =>
    api.get<Array<{ month_label: string; year: number; month_num: number; revenue: number; cost: number }>>(
      '/reports/zamani/cost-vs-revenue',
    ),
};

// ── VCS BALANCE REPORT ────────────────────────────────────────
export const vcsBalanceApi = {
  getData: () => api.get('/reports/vcs-balance/data'),
};

// ── SYSTEM ────────────────────────────────────────────────────
export const systemApi = {
  health: () =>
    api.get<{
      jerasoft_connected: boolean;
      graph_token_valid: boolean;
      teams_default_reachable: boolean;
      scheduler_running: boolean;
      last_refresh_at: string;
    }>('/system/health'),
};

export default api;
