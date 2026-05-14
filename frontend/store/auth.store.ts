import { create } from 'zustand';
import { configureApiAuth } from '@/lib/api';
import { canAccessPermission, hasRole } from '@/lib/auth';
import type { UserRole } from '@/types';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  dataset_access: string[];
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
  isRole: (role: UserRole | UserRole[]) => boolean;
  canAccess: (permission: string) => boolean;
  hasDatasetAccess: (datasetId: string) => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: null,

  setAuth: (user: AuthUser, token: string) => {
    set({ user, token });
    // Wire up api interceptors
    configureApiAuth(
      () => get().token,
      () => {
        get().clearAuth();
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
      }
    );
  },

  clearAuth: () => {
    set({ user: null, token: null });
  },

  isRole: (role: UserRole | UserRole[]) => {
    const user = get().user;
    if (!user) return false;
    if (Array.isArray(role)) {
      return role.some((r) => hasRole(user.role, r));
    }
    return hasRole(user.role, role);
  },

  canAccess: (permission: string) => {
    const user = get().user;
    if (!user) return false;
    return canAccessPermission(user.role, permission);
  },

  hasDatasetAccess: (datasetId: string) => {
    const user = get().user;
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.dataset_access.includes(datasetId);
  },
}));
