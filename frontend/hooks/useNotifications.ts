'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '@/lib/api';
import type { NotificationFilters } from '@/types';
import { useUIStore } from '@/store/ui.store';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filters: NotificationFilters) => [...notificationKeys.all, 'list', filters] as const,
};

export function useNotificationLog(filters: NotificationFilters = {}) {
  return useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: async () => {
      const { data } = await notificationsApi.list(filters);
      return data;
    },
    staleTime: 30 * 1000,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useRetryNotification() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await notificationsApi.retry(id);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      addToast({ title: 'Notification retried', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Retry failed', variant: 'destructive' });
    },
  });
}
