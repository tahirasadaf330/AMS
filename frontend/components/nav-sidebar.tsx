'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Database,
  ServerCog,
  GitBranch,
  Clock,
  Bell,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  ChevronDown,
  ChevronUp,
  BarChart2,
  FileBarChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useUIStore } from '@/store/ui.store';
import { useDatasetStore } from '@/store/dataset.store';
import { useSocket } from '@/hooks/useSocket';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  minRole?: string;
  children?: NavItem[];
}

export function NavSidebar() {
  const pathname = usePathname();
  const { user, canAccess, hasReportAccess } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const datasets = useDatasetStore((s) => s.datasets);
  const { connected } = useSocket();

  const [datasetsOpen, setDatasetsOpen] = React.useState(true);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const [reportsOpen, setReportsOpen] = React.useState(true);

  const navItems: NavItem[] = [
    { label: 'Overview', href: '/', icon: LayoutDashboard },
    { label: 'Alerts', href: '/conditions', icon: GitBranch, minRole: 'editor' },
    { label: 'Schedules', href: '/schedules', icon: Clock, minRole: 'full_rights' },
    { label: 'Notifications', href: '/notifications', icon: Bell },
  ];

  const adminItems: NavItem[] = [
    { label: 'Users', href: '/admin/users', icon: Users, minRole: 'admin' },
    { label: 'Data Sources', href: '/admin/datasources', icon: ServerCog, minRole: 'admin' },
    { label: 'Datasets', href: '/admin/datasets', icon: Database, minRole: 'admin' },
    { label: 'Settings', href: '/admin/settings', icon: Settings, minRole: 'admin' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const linkClass = (href: string) =>
    cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
      isActive(href)
        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-600/30'
        : 'text-gray-500 dark:text-gray-400'
    );

  if (sidebarCollapsed) {
    return (
      <aside className="flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 w-14">
        <div className="flex items-center justify-center h-14 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={toggleSidebar}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            title="Expand sidebar"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 py-4 flex flex-col gap-1 items-center">
          <Link href="/" className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/') ? 'text-blue-400' : 'text-gray-400')} title="Overview">
            <LayoutDashboard className="h-5 w-5" />
          </Link>
          <Link href="/notifications" className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/notifications') ? 'text-blue-400' : 'text-gray-400')} title="Notifications">
            <Bell className="h-5 w-5" />
          </Link>
          {canAccess('create_condition') && (
            <Link href="/conditions" className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/conditions') ? 'text-blue-400' : 'text-gray-400')} title="Alerts">
              <GitBranch className="h-5 w-5" />
            </Link>
          )}
          {canAccess('manage_schedule') && (
            <Link href="/schedules" className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/schedules') ? 'text-blue-400' : 'text-gray-400')} title="Schedules">
              <Clock className="h-5 w-5" />
            </Link>
          )}
          {(hasReportAccess('zamani') || hasReportAccess('vcs-balance') || hasReportAccess('sms-credit-limit')) && (
            <Link href={hasReportAccess('zamani') ? '/reports/zamani-traffic' : hasReportAccess('vcs-balance') ? '/reports/vcs-balance' : '/reports/sms-credit-limit'} className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/reports') ? 'text-blue-400' : 'text-gray-400')} title="Reports">
              <BarChart2 className="h-5 w-5" />
            </Link>
          )}
          {canAccess('admin') && (
            <Link href="/admin/settings" className={cn('p-2 rounded-lg hover:bg-gray-700', isActive('/admin') ? 'text-blue-400' : 'text-gray-400')} title="Admin">
              <Settings className="h-5 w-5" />
            </Link>
          )}
        </nav>
        {/* WS status */}
        <div className="p-2 border-t border-gray-700 flex justify-center">
          <div
            className={cn('h-2 w-2 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 w-60 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-blue-500 dark:text-blue-400" />
          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm tracking-wide">AMS</span>
        </div>
        <button
          onClick={toggleSidebar}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
          title="Collapse sidebar"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          if (item.minRole && !canAccess(
            item.minRole === 'editor' ? 'create_condition' :
            item.minRole === 'full_rights' ? 'manage_schedule' : item.minRole
          )) {
            return null;
          }

          return (
            <Link key={item.href} href={item.href} className={linkClass(item.href)}>
              <item.icon className="h-4 w-4 flex-shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Datasets section */}
        <div>
          <button
            onClick={() => setDatasetsOpen((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300"
          >
            <span>Datasets</span>
            {datasetsOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>

          {datasetsOpen && (
            <div className="space-y-0.5 mt-1">
              {datasets.map((dataset) => (
                <Link
                  key={dataset.id}
                  href={`/dashboard/${dataset.id}`}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ml-2',
                    'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
                    isActive(`/dashboard/${dataset.id}`)
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <Database className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{dataset.name}</span>
                </Link>
              ))}
              {datasets.length === 0 && (
                <p className="px-5 py-2 text-xs text-gray-400 dark:text-gray-600">No dashboards</p>
              )}
            </div>
          )}
        </div>

        {/* Reports section */}
        <div>
          <button
            onClick={() => setReportsOpen((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300"
          >
            <span>Reports</span>
            {reportsOpen ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>

          {reportsOpen && (
            <div className="space-y-0.5 mt-1">
              {hasReportAccess('zamani') && (
                <Link
                  href="/reports/zamani-traffic"
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ml-2',
                    'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
                    isActive('/reports/zamani-traffic')
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <FileBarChart className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Zamani Traffic</span>
                </Link>
              )}
              {hasReportAccess('vcs-balance') && (
                <Link
                  href="/reports/vcs-balance"
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ml-2',
                    'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
                    isActive('/reports/vcs-balance')
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <FileBarChart className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>Voice Credit Limit</span>
                </Link>
              )}
              {hasReportAccess('sms-credit-limit') && (
                <Link
                  href="/reports/sms-credit-limit"
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ml-2',
                    'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
                    isActive('/reports/sms-credit-limit')
                      ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400'
                  )}
                >
                  <FileBarChart className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>SMS Credit Limit</span>
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Admin section */}
        {canAccess('admin') && (
          <div>
            <button
              onClick={() => setAdminOpen((v) => !v)}
              className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-700 dark:hover:text-gray-300"
            >
              <span>Admin</span>
              {adminOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>

            {adminOpen && (
              <div className="space-y-0.5 mt-1">
                {adminItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ml-2',
                      'hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-100',
                      isActive(item.href)
                        ? 'bg-blue-50 dark:bg-blue-600/20 text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 dark:text-gray-400'
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer: WS status + user */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-2">
        <div className="flex items-center gap-2 px-1">
          <div
            className={cn(
              'h-2 w-2 rounded-full flex-shrink-0',
              connected ? 'bg-green-500' : 'bg-red-500 animate-pulse'
            )}
          />
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {connected ? 'Live' : 'Reconnecting...'}
          </span>
        </div>

        {user && (
          <div className="flex items-center gap-2 px-1">
            <div className="h-6 w-6 rounded-full bg-blue-700 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-white uppercase">
                {user.name[0] ?? 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{user.name}</p>
              <p className="text-xs text-gray-400 dark:text-gray-600 truncate capitalize">{user.role}</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
