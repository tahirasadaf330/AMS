'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import type { DashboardDataParams } from '@/types';
import { useUIStore } from '@/store/ui.store';

// ── Query keys ────────────────────────────────────────────────
export const dashboardKeys = {
  all: ['dashboard'] as const,
  datasets: () => [...dashboardKeys.all, 'datasets'] as const,
  data: (datasetId: string, params: DashboardDataParams) =>
    [...dashboardKeys.all, 'data', datasetId, params] as const,
  matrix: (datasetId: string) => [...dashboardKeys.all, 'matrix', datasetId] as const,
  history: (datasetId: string) => [...dashboardKeys.all, 'history', datasetId] as const,
};

// ── useDatasets ───────────────────────────────────────────────
export function useDatasets() {
  return useQuery({
    queryKey: dashboardKeys.datasets(),
    queryFn: async () => {
      const { data } = await dashboardApi.getDatasets();
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
}

// ── useDashboardData ──────────────────────────────────────────
export function useDashboardData(datasetId: string, params: DashboardDataParams = {}) {
  return useQuery({
    queryKey: dashboardKeys.data(datasetId, params),
    queryFn: async () => {
      const { data } = await dashboardApi.getData(datasetId, params);
      return data;
    },
    staleTime: 30 * 1000, // 30 seconds
    enabled: !!datasetId,
    placeholderData: (prev) => prev,
  });
}

// ── useDashboardMatrix ────────────────────────────────────────
export function useDashboardMatrix(datasetId: string) {
  return useQuery({
    queryKey: dashboardKeys.matrix(datasetId),
    queryFn: async () => {
      const { data } = await dashboardApi.getMatrix(datasetId);
      return data;
    },
    staleTime: 30 * 1000,
    enabled: !!datasetId,
  });
}

// ── useRefreshHistory ─────────────────────────────────────────
export function useRefreshHistory(datasetId: string) {
  return useQuery({
    queryKey: dashboardKeys.history(datasetId),
    queryFn: async () => {
      const { data } = await dashboardApi.getHistory(datasetId);
      return data;
    },
    staleTime: 30 * 1000,
    enabled: !!datasetId,
  });
}

// ── useTriggerRefresh ─────────────────────────────────────────
export function useTriggerRefresh() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (datasetId: string) => {
      const { data } = await dashboardApi.triggerRefresh(datasetId);
      return data;
    },
    onSuccess: (_, datasetId) => {
      addToast({
        title: 'Refresh triggered',
        description: 'The dataset refresh has been queued.',
        variant: 'success',
      });
      // Invalidate after a short delay to allow processing
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.datasets() });
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.history(datasetId) });
      }, 2000);
    },
    onError: () => {
      addToast({
        title: 'Refresh failed',
        description: 'Could not trigger dataset refresh.',
        variant: 'destructive',
      });
    },
  });
}
