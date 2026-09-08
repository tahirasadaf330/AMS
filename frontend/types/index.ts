// ============================================================
// AMS — Shared TypeScript types
// ============================================================

// ── Auth ────────────────────────────────────────────────────
// Permission (user-facing label): Viewer < Editor < Admin. Legacy 'full_rights' folded into 'editor'.
export type UserRole = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  is_protected?: boolean;
  dataset_access: string[];
  report_access: string[];
  must_change_password?: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
  group_id?: string | null;
  group_name?: string | null;
  /** Role (user_groups) ids the user holds — permission is derived from these. */
  role_ids?: string[];
  /** Sections (sms/voice) where this user holds an Editor role. */
  editor_sections?: string[];
  /** Resolved access counts (role-derived ∪ individual) — what the user can actually reach. */
  effective_dataset_count?: number;
  effective_report_count?: number;
  /** Who created this user — editors may delete only viewer users they created. */
  created_by?: string | null;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  /** Section (sms|voice) and level (viewer|editor) mark a group as one of the seeded Roles. */
  section?: string | null;
  level?: string | null;
  created_at: string;
  user_count: number;
  dataset_access: string[];
  report_access: string[];
}

export interface AuthResponse {
  token: string;
  user: User;
  must_change_password?: boolean;
}

// ── Data Sources ─────────────────────────────────────────────
export type DataSourceType = 'postgresql' | 'mssql';

export interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  host: string;
  port: number;
  db: string;
  username: string;
  password: string;
  ssl_mode: string;
  is_active: boolean;
  is_builtin?: boolean;
  created_at: string;
}

// ── Dataset ─────────────────────────────────────────────────
export interface ColumnMeta {
  key: string;
  label: string;
  type: 'text' | 'numeric' | 'date';
  visible: boolean;
  // One-line meaning of the column (unit/currency, whether precomputed) for AI consumers (Atlas).
  description?: string;
}

export interface DatasetLastRefresh {
  status: string;
  row_count: number;
  refreshed_at: string;
  duration_ms: number;
}

export interface Dataset {
  id: string;
  name: string;
  description?: string;
  source_db: string;
  data_source_id?: string | null;
  sql_query: string;
  stage_table_name: string;
  column_metadata: ColumnMeta[];
  schedule_cron: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_refresh?: DatasetLastRefresh;
  /** Traffic window (minutes) for datasets whose SQL uses {{WINDOW_MINUTES}}. */
  window_minutes?: number | null;
}

// ── Dashboard Data ───────────────────────────────────────────
export interface DashboardRow {
  [key: string]: string | number | null;
}

export interface DashboardDataResponse {
  rows: DashboardRow[];
  total: number;
  page: number;
  limit: number;
  dataset: Dataset;
  // Call-weighted totals over the full filtered set (Voice Live Traffic only).
  totals?: {
    attempts: number;
    answered_calls: number;
    failed_calls: number;
    volume: number;
    acd: number | null;
    asr: number | null;
  };
}

export interface DashboardMatrixResponse {
  rows: DashboardRow[];
  columns: ColumnMeta[];
  dataset: Dataset;
}

export interface RefreshHistoryEntry {
  id: string;
  dataset_id: string;
  status: 'success' | 'failed' | 'running';
  row_count?: number;
  duration_ms?: number;
  error?: string;
  started_at: string;
  finished_at?: string;
}

// ── Conditions ───────────────────────────────────────────────
export type ConditionOperator =
  | '>'
  | '<'
  | '>='
  | '<='
  | '=='
  | '!='
  | 'contains'
  | 'starts_with'
  | 'ends_with';

export interface ConditionRow {
  column: string;
  operator: ConditionOperator;
  value: string | number;
  /** Condition-group index; groups are OR'd, rows inside a group use the alert's logic. */
  group?: number;
}

export interface ConditionChannels {
  email?: {
    enabled: boolean;
    recipients: string[];
    text?: string;
    columns?: string[];
  };
  teams?: { enabled: boolean; webhook_url: string; severity?: 'critical' | 'warning' | 'info' };
}

export interface Condition {
  id: string;
  name: string;
  type?: 'dataset' | 'python';
  python_script?: string | null;
  dataset_id?: string | null;
  logic: 'AND' | 'OR';
  condition_rows: ConditionRow[];
  channels: ConditionChannels;
  trigger_cron?: string | null;
  is_active: boolean;
  created_by?: string;
  created_by_user?: { id: string; fullname: string } | null;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConditionPreviewResult {
  matched_rows: DashboardRow[];
  matched_count: number;
}

// ── Schedules ────────────────────────────────────────────────
export interface Schedule {
  dataset_id: string;
  dataset_name: string;
  cron: string;
  last_run?: string;
  last_status?: 'success' | 'failed';
  next_run?: string;
  row_count?: number;
  schedule_start_date?: string | null;
  schedule_end_date?: string | null;
}

// ── Notifications ────────────────────────────────────────────
export type NotificationChannel = 'email' | 'teams';
export type NotificationStatus = 'sent' | 'failed' | 'skipped' | 'retrying' | 'permanently_failed';

export interface NotificationLog {
  id: string;
  condition_id: string;
  condition_name: string;
  dataset_id: string;
  dataset_name: string;
  channel: NotificationChannel;
  recipients?: string[];
  webhook_url?: string;
  matched_rows: number;
  status: NotificationStatus;
  error?: string;
  retry_count: number;
  triggered_at: string;
  message_preview?: string;
  matched_rows_snapshot?: DashboardRow[];
}

export interface NotificationFilters {
  from?: string;
  to?: string;
  channel?: string;
  dataset?: string;
  condition?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export interface NotificationLogResponse {
  logs: NotificationLog[];
  total: number;
  page: number;
  limit: number;
  summary: {
    total: number;
    email_count: number;
    teams_count: number;
    script_count: number;
    failed_count: number;
    skipped_count: number;
  };
}

// ── Admin ────────────────────────────────────────────────────
export interface AdminUser extends User {
  sessions?: UserSession[];
}

export interface UserSession {
  id: string;
  ip: string;
  device: string;
  login_time: string;
  expires_at: string;
}

export interface SystemSettings {
  jerasoft: {
    host: string;
    port: number;
    db: string;
    user: string;
    password: string;
  };
  graph: {
    tenant_id: string;
    client_id: string;
    client_secret: string;
    sender_email: string;
  };
  teams: {
    default_webhook_url: string;
  };
  security: {
    session_timeout_hours: number;
    max_failed_logins: number;
    lockout_duration_minutes: number;
  };
}

export interface AuditLogEntry {
  id: string;
  user_id: string | null;
  /** Safe subset of the acting user (null for system/anonymous entries). */
  user?: { id: string; email: string; name: string } | null;
  action: string;
  resource: string | null;
  detail?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
}

export interface AuditLogFilters {
  user?: string;
  action?: string;
  /** Free-text: matches action, resource, and the acting user's name/email. */
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
}

// ── WebSocket Events ─────────────────────────────────────────
export interface WSDatasetRefreshed {
  dataset_id: string;
  dataset_name: string;
  refreshed_at: string;
  row_count: number;
  duration_ms: number;
}

export interface WSDatasetRefreshFailed {
  dataset_id: string;
  dataset_name: string;
  error: string;
  failed_at: string;
}

export interface WSConditionMatched {
  condition_id: string;
  condition_name: string;
  dataset_id: string;
  matched_count: number;
  channels_dispatched: string[];
  triggered_at: string;
}

export interface WSNotificationSent {
  notification_log_id: string;
  channel: string;
  status: string;
  triggered_at: string;
}

export interface WSNotificationFailed {
  notification_log_id: string;
  channel: string;
  error: string;
  triggered_at: string;
}

export interface WSSystemHealth {
  jerasoft_connected: boolean;
  graph_token_valid: boolean;
  teams_default_reachable: boolean;
  scheduler_running: boolean;
  last_refresh_at: string;
}

// ── UI Types ─────────────────────────────────────────────────
export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'warning' | 'destructive';
  duration?: number;
}

// ── API Pagination ───────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ── Dashboard Query Params ────────────────────────────────────
export interface DashboardDataParams {
  page?: number;
  limit?: number;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  search?: string;
  [key: string]: string | number | undefined;
}
