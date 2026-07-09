'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Sun, Moon } from 'lucide-react';
import { NavSidebar } from '@/components/nav-sidebar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuthStore } from '@/store/auth.store';
import { useDatasetStore } from '@/store/dataset.store';
import { useUIStore } from '@/store/ui.store';
import { useWebSocketEvents } from '@/hooks/useWebSocketEvents';
import { useDatasets } from '@/hooks/useDashboard';
import { authApi } from '@/lib/api';
import type { BadgeProps } from '@/components/ui/badge';

const ROLE_BADGE_VARIANT: Record<string, BadgeProps['variant']> = {
  admin: 'purple',
  full_rights: 'blue',
  editor: 'green',
  viewer: 'gray',
};

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, token, clearAuth } = useAuthStore();
  const setDatasets = useDatasetStore((s) => s.setDatasets);
  const { theme, toggleTheme } = useUIStore();

  // Sync theme store with localStorage on first mount
  React.useEffect(() => {
    const saved = localStorage.getItem('ams-theme') as 'dark' | 'light' | null;
    if (saved && saved !== theme) {
      toggleTheme();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register WebSocket events
  useWebSocketEvents();

  // Fetch datasets on mount
  const { data: datasets } = useDatasets();
  React.useEffect(() => {
    if (datasets) setDatasets(datasets);
  }, [datasets, setDatasets]);

  // Auth guard
  React.useEffect(() => {
    if (!token) {
      router.push('/login');
    }
  }, [token, router]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // best effort
    }
    clearAuth();
    router.push('/login');
  };

  if (!user) return null;

  const roleLabel =
    user.role === 'full_rights' ? 'Full Rights' : user.role.charAt(0).toUpperCase() + user.role.slice(1);

  return (
    <div className="flex min-h-screen bg-white dark:bg-gray-900">
      <NavSidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top header */}
        <header className="flex items-center justify-between h-14 px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
          <div />
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">{user.name}</span>
              <Badge variant={ROLE_BADGE_VARIANT[user.role] ?? 'default'}>
                {roleLabel}
              </Badge>
            </div>

            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark'
                ? <Sun className="h-4 w-4 text-gray-400 hover:text-yellow-400 transition-colors" />
                : <Moon className="h-4 w-4 text-gray-500 hover:text-blue-500 transition-colors" />
              }
            </Button>

            <Button variant="ghost" size="icon-sm" onClick={() => void handleLogout()} title="Logout">
              <LogOut className="h-4 w-4 text-gray-400 dark:text-gray-400" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6 bg-[#ecf0f1] dark:bg-[#1b2733]">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayoutInner>{children}</DashboardLayoutInner>;
}
