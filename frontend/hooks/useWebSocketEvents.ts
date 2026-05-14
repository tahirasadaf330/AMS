'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket } from './useSocket';
import { useDatasetStore } from '@/store/dataset.store';
import { useUIStore } from '@/store/ui.store';
import { dashboardKeys } from './useDashboard';
import { notificationKeys } from './useNotifications';
import type {
  WSDatasetRefreshed,
  WSDatasetRefreshFailed,
  WSConditionMatched,
  WSNotificationSent,
  WSNotificationFailed,
  WSSystemHealth,
} from '@/types';

export interface SystemHealth {
  jerasoft_connected: boolean;
  graph_token_valid: boolean;
  teams_default_reachable: boolean;
  scheduler_running: boolean;
  last_refresh_at: string;
}

export function useWebSocketEvents(onHealthUpdate?: (health: SystemHealth) => void) {
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const updateRefresh = useDatasetStore((s) => s.updateRefresh);
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    if (!socket) return;

    const handleDatasetRefreshed = (data: WSDatasetRefreshed) => {
      // Update dataset store
      updateRefresh(data.dataset_id, {
        refreshed_at: data.refreshed_at,
        row_count: data.row_count,
        status: 'success',
        duration_ms: data.duration_ms,
      });

      // Invalidate TanStack Query cache for this dataset
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.datasets() });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.data(data.dataset_id, {}),
        exact: false,
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.matrix(data.dataset_id),
      });
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.history(data.dataset_id),
      });

      addToast({
        title: `${data.dataset_name} refreshed`,
        description: `${data.row_count.toLocaleString()} rows in ${data.duration_ms}ms`,
        variant: 'success',
        duration: 4000,
      });
    };

    const handleDatasetRefreshFailed = (data: WSDatasetRefreshFailed) => {
      addToast({
        title: `${data.dataset_name} refresh failed`,
        description: data.error,
        variant: 'destructive',
      });
    };

    const handleConditionMatched = (data: WSConditionMatched) => {
      addToast({
        title: `Condition matched: ${data.condition_name}`,
        description: `${data.matched_count} rows matched. Notifying via ${data.channels_dispatched.join(', ')}`,
        variant: 'warning',
        duration: 6000,
      });
    };

    const handleNotificationSent = (_data: WSNotificationSent) => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    };

    const handleNotificationFailed = (data: WSNotificationFailed) => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      addToast({
        title: 'Notification failed',
        description: data.error,
        variant: 'destructive',
      });
    };

    const handleSystemHealth = (data: WSSystemHealth) => {
      onHealthUpdate?.(data);
    };

    socket.on('dataset:refreshed', handleDatasetRefreshed);
    socket.on('dataset:refresh_failed', handleDatasetRefreshFailed);
    socket.on('condition:matched', handleConditionMatched);
    socket.on('notification:sent', handleNotificationSent);
    socket.on('notification:failed', handleNotificationFailed);
    socket.on('system:health', handleSystemHealth);

    return () => {
      socket.off('dataset:refreshed', handleDatasetRefreshed);
      socket.off('dataset:refresh_failed', handleDatasetRefreshFailed);
      socket.off('condition:matched', handleConditionMatched);
      socket.off('notification:sent', handleNotificationSent);
      socket.off('notification:failed', handleNotificationFailed);
      socket.off('system:health', handleSystemHealth);
    };
  }, [socket, queryClient, updateRefresh, addToast, onHealthUpdate]);
}
