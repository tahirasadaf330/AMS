import type { UserRole } from '@/types';

// ── JWT helpers (client-side, no verification) ────────────────
interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  exp: number;
  iat: number;
}

export function getTokenPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    // Base64url decode
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = atob(padded);
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = getTokenPayload(token);
  if (!payload) return true;
  // Add 30s buffer
  return Date.now() / 1000 > payload.exp - 30;
}

// ── Role hierarchy ────────────────────────────────────────────
const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  full_rights: 3,
  admin: 4,
};

/**
 * Returns true if userRole meets or exceeds requiredRole.
 */
export function hasRole(userRole: UserRole | string, requiredRole: UserRole | string): boolean {
  const userLevel = ROLE_HIERARCHY[userRole as UserRole] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole as UserRole] ?? 99;
  return userLevel >= requiredLevel;
}

// ── Permission map ────────────────────────────────────────────
const PERMISSION_ROLE_MAP: Record<string, UserRole> = {
  export: 'viewer',
  create_condition: 'editor',
  edit_condition: 'editor',
  delete_condition: 'full_rights',
  manage_schedule: 'full_rights',
  trigger_refresh: 'full_rights',
  retry_notification: 'full_rights',
  configure_notifications: 'full_rights',
  admin: 'admin',
  manage_users: 'admin',
  manage_datasets: 'admin',
  view_audit_log: 'admin',
  system_settings: 'admin',
};

export function canAccessPermission(userRole: UserRole | string, permission: string): boolean {
  const requiredRole = PERMISSION_ROLE_MAP[permission];
  if (!requiredRole) return false;
  return hasRole(userRole, requiredRole);
}
