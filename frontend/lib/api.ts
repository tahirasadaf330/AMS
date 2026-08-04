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
  timeout: 300_000,
});

// Token injector — updated by the auth store
let _getToken: () => string | null = () => null;
let _onUnauthorized: () => void = () => {};
let _setToken: (token: string) => void = () => {};

export function configureApiAuth(
  getToken: () => string | null,
  onUnauthorized: () => void,
  setToken: (token: string) => void
): void {
  _getToken = getToken;
  _onUnauthorized = onUnauthorized;
  _setToken = setToken;
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
    const reqUrl = originalRequest?.url ?? '';
    // Never attempt a token refresh for the auth endpoints themselves. A 401 from
    // /auth/refresh (expired/invalid refresh token) must reject cleanly so the outer
    // handler can log the user out. Otherwise it re-enters this interceptor, queues
    // against its own in-flight refresh, and deadlocks — leaving the app stuck after
    // a session expires (no data loads, logout hangs). Same for login/logout.
    const isAuthEndpoint = /\/auth\/(refresh|login|logout)/.test(reqUrl);

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
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
        // Persist the refreshed token into the auth store (and thus storage) so a
        // reload never starts from a stale/expired token, and the WebSocket (which
        // reads its token from the store) reconnects with a valid token instead of
        // the now-expired one. The request interceptor reads the live store token,
        // so it picks this up automatically.
        //
        // ⚠️ WEBSOCKET TOKEN SYNC — DO NOT DROP ON MERGE/DEPLOY.
        // Without this line, on production a dataset refresh completes on the
        // backend but the UI stays stuck on "Running" until a manual page reload
        // (the socket keeps its expired token → "Invalid token" → no live events).
        _setToken(newToken);
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

  // Current user + access arrays (same shape as login's `user`) — used by the SSO
  // callback page; `token` lets it authenticate before the store is hydrated.
  me: (token?: string) =>
    api.get<AuthResponse['user']>('/auth/me', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),

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

  // Distinct values for one column across the whole table (for filter dropdowns).
  getDistinctValues: (datasetId: string, column: string) =>
    api.get<{ column: string; values: string[] }>(
      `/dashboard/${datasetId}/distinct-values`,
      { params: { column } },
    ),

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

  cancel: (datasetId: string) =>
    api.post<{ message: string }>(`/schedules/${datasetId}/cancel`),
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
    role: string;
    dataset_access: string[];
    report_access?: string[];
    role_ids?: string[];
    send_welcome_email?: boolean;
  }) =>
    // temp_password is generated server-side and returned exactly once
    api.post<AdminUser & { temp_password: string }>('/admin/users', data),

  update: (id: string, data: Partial<AdminUser>) =>
    api.put<AdminUser>(`/admin/users/${id}`, data),

  deactivate: (id: string) => api.post(`/admin/users/${id}/deactivate`),

  delete: (id: string) => api.delete(`/admin/users/${id}`),

  getSessions: (id: string) => api.get<UserSession[]>(`/admin/users/${id}/sessions`),

  deleteSession: (userId: string, sessionId: string) =>
    api.delete(`/admin/users/${userId}/sessions/${sessionId}`),
};

// ── ADMIN — GROUPS ────────────────────────────────────────────
export const adminGroupsApi = {
  list: () => api.get('/admin/groups'),

  create: (data: { name: string; description?: string }) =>
    api.post('/admin/groups', data),

  update: (id: string, data: {
    name?: string;
    description?: string;
    dataset_access?: string[];
    report_access?: string[];
  }) => api.patch(`/admin/groups/${id}`, data),

  setMembers: (id: string, userIds: string[]) =>
    api.put(`/admin/groups/${id}/members`, { userIds }),

  delete: (id: string) => api.delete(`/admin/groups/${id}`),
};

// ── ADMIN — REPORTS REGISTRY ──────────────────────────────────
// Auto-discovered list of grantable reports (from backend @ReportAccess decorators)
export interface ReportInfo {
  slug: string;
  name: string;
}
export const adminReportsApi = {
  list: () => api.get<ReportInfo[]>('/admin/reports'),
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

  export: async (filters: Omit<AuditLogFilters, 'page' | 'limit'> = {}): Promise<Blob> => {
    const token = _getToken();
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    const qs = params.toString();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/admin/audit-log/export${qs ? `?${qs}` : ''}`,
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
  getInvestmentRecovery: (trailingDays = 7) =>
    api.get('/reports/zamani/investment-recovery', { params: { trailingDays } }),
};

// ── ZAMANI SENDER ID (near-real-time destination monitoring) ──
export const zamaniSenderIdApi = {
  getData: (params?: { from?: string; to?: string }) =>
    api.get('/reports/zamani-sender-id/data', { params }),
  getTimeseries: (params: { from?: string; to?: string; dimension: 'customer' | 'sender'; granularity: 'hour' | 'day' | 'week' | 'month'; keys: string[]; filter?: string }) =>
    api.get('/reports/zamani-sender-id/timeseries', {
      params: { from: params.from, to: params.to, dimension: params.dimension, granularity: params.granularity, keys: JSON.stringify(params.keys), filter: params.filter || undefined },
    }),
};

// ── GOOGLE MO TRAFFIC REPORT ──────────────────────────────────
export const googleMoApi = {
  getFilters: () => api.get('/reports/google-mo/filters'),
  getData: (params: Record<string, string>) => api.get('/reports/google-mo/data', { params }),
  getComparison: (params: Record<string, string>) => api.get('/reports/google-mo/comparison', { params }),
  getProfitLoss: (params: Record<string, string>) => api.get('/reports/google-mo/profit-loss', { params }),
  getPlYears: () => api.get('/reports/google-mo/pl-years'),
  getPlMonths: (params: Record<string, string>) => api.get('/reports/google-mo/pl-months', { params }),
  getYesterday: (params: Record<string, string>) => api.get('/reports/google-mo/yesterday', { params }),
  getYesterdayIristelFilters: () => api.get('/reports/google-mo/yesterday-iristel-filters'),
  getYesterdayIristel: (params: Record<string, string>) => api.get('/reports/google-mo/yesterday-iristel', { params }),
  getEstimates: (params?: Record<string, string>) => api.get('/reports/google-mo/estimates', { params }),
};

// ── GOOGLE MO IMPORT (admin) ──────────────────────────────────
export const googleMoImportApi = {
  importCosts: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ upserted: number; vendor_rows: number; skipped: number }>(
      '/admin/google-mo/import/costs',
      fd,
    );
  },
  importEstimates: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ upserted: number; skipped: number }>(
      '/admin/google-mo/import/estimates',
      fd,
    );
  },
  // SharePoint-backed sources (pull the latest .xlsx from SharePoint and import)
  sharePointStatus: () =>
    api.get<SharePointSyncStatus[]>('/admin/google-mo/import/sharepoint'),
  syncFromSharePoint: (target: 'costs' | 'estimates') =>
    api.post<SharePointSyncStatus>(`/admin/google-mo/import/sharepoint/${target}`),
};

export interface SharePointSyncStatus {
  target: 'costs' | 'estimates';
  label: string;
  fileName: string;
  sitePath: string;
  lastSyncedAt: string | null;
  lastStatus: 'success' | 'error' | 'never';
  lastMessage: string | null;
  lastResult: { upserted: number; vendor_rows?: number; skipped: number } | null;
}

// ── VCS BALANCE REPORT ────────────────────────────────────────
export const vcsBalanceApi = {
  getData: () => api.get('/reports/vcs-balance/data'),
};

// ── DEALS AUTOMATION REPORT ────────────────────────────────────
export const dealsAutomationApi = {
  getData: () => api.get('/reports/deals-automation/data'),
};

// ── APPLE TRAFFIC REPORT ──────────────────────────────────────
export const appleTrafficApi = {
  getData: () => api.get('/reports/apple-traffic/data'),
};

// ── SMS CREDIT LIMIT REPORT ───────────────────────────────────
export const smsCreditLimitApi = {
  getData: () => api.get('/reports/sms-credit-limit/data'),
};

// ── VOICE LIVE TRAFFIC REPORT ─────────────────────────────────
export const voiceLiveTrafficApi = {
  getData: () => api.get('/reports/voice-live-traffic/data'),
};

// ── SRC/DST NUMBER MONITORING REPORT ──────────────────────────
export const srcDstNumberApi = {
  // Instant read from the hourly rollup. kind = 'src'|'dst'; window = thishr|prevhr|4h|12h|1d|2d|3d|7d
  // (5G semantics: last N hourly buckets incl current partial hour) OR from/to dates ('YYYY-MM-DD');
  // limit = display rows (10…10000).
  getData: (params: { kind: string; window?: string; from?: string; to?: string; limit?: number }) =>
    api.get('/reports/src-dst-number-monitoring/data', { params }),
};

// ── MT EDR MONITORING REPORT ──────────────────────────────────
export const mtEdrApi = {
  // from/to are ISO-8601 UTC instants; omitted → the whole retained window (today+yesterday).
  getData: (params?: { from?: string; to?: string }) => api.get('/reports/mt-edr/data', { params }),
};

// ── NEGATIVE MARGIN REPORT ────────────────────────────────────
export const negativeMarginApi = {
  getData: () => api.get('/reports/negative-margin/data'),
};

// ── PRE-PAYMENT CL REPORT ─────────────────────────────────────
export const prepaymentClApi = {
  getData: () => api.get('/reports/prepayment-cl/data'),
};

// ── SMS TRAFFIC REPORT ────────────────────────────────────────
export const smsReportApi = {
  getData: (params?: { startDate?: string; endDate?: string; accountManager?: string; company?: string }) =>
    api.get('/reports/sms-report/data', { params }),
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
