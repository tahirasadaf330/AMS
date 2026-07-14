import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { configureApiAuth } from '@/lib/api';
import { canAccessPermission, hasRole } from '@/lib/auth';
import type { UserRole } from '@/types';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  dataset_access: string[];
  report_access: string[];
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  remember: boolean;
  setAuth: (user: AuthUser, token: string, remember?: boolean) => void;
  clearAuth: () => void;
  isRole: (role: UserRole | UserRole[]) => boolean;
  canAccess: (permission: string) => boolean;
  hasDatasetAccess: (datasetId: string) => boolean;
  hasReportAccess: (slug: string) => boolean;
}

// Persist to localStorage when "remember me" is on (survives browser restart),
// sessionStorage otherwise (survives refresh, cleared when the browser closes).
const dualStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(name) ?? sessionStorage.getItem(name);
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') return;
    let remember = true;
    try {
      remember = (JSON.parse(value) as { state?: { remember?: boolean } })?.state?.remember ?? true;
    } catch { /* default to localStorage */ }
    if (remember) {
      localStorage.setItem(name, value);
      sessionStorage.removeItem(name);
    } else {
      sessionStorage.setItem(name, value);
      localStorage.removeItem(name);
    }
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(name);
    sessionStorage.removeItem(name);
  },
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      remember: true,

      setAuth: (user: AuthUser, token: string, remember?: boolean) => {
        set({ user, token, remember: remember ?? get().remember });
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

      hasReportAccess: (slug: string) => {
        const user = get().user;
        if (!user) return false;
        if (user.role === 'admin') return true;
        return user.report_access.includes(slug);
      },
    }),
    {
      name: 'ams-auth',
      storage: createJSONStorage(() => dualStorage),
      partialize: (s) => ({ user: s.user, token: s.token, remember: s.remember }),
    },
  ),
);

// Wire API interceptors once on the client. The token getter always reads the
// live store state, so this works for both a fresh login and a rehydrated session.
if (typeof window !== 'undefined') {
  configureApiAuth(
    () => useAuthStore.getState().token,
    () => {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
    },
    // Keep the store token in sync with refreshes so the WebSocket reconnects
    // with a valid token (otherwise it stays on the expired one → "Invalid token").
    (newToken) => useAuthStore.setState({ token: newToken }),
  );
}
