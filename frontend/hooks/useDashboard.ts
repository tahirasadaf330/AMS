'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dashboardApi, schedulesApi, adminGroupsApi } from '@/lib/api';
import type { DashboardDataParams, AdminGroup } from '@/types';
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
        void queryClient.invalidateQueries({ queryKey: [...dashboardKeys.all, 'data', datasetId] });
        void queryClient.invalidateQueries({ queryKey: dashboardKeys.matrix(datasetId) });
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

// ── useAdminGroups ────────────────────────────────────────────
export function useAdminGroups() {
  return useQuery({
    queryKey: ['admin', 'groups'],
    queryFn: async () => {
      const { data } = await adminGroupsApi.list();
      return data as AdminGroup[];
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      adminGroupsApi.create(data).then((r) => r.data as AdminGroup),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      addToast({ title: 'Group created', variant: 'success' });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      addToast({ title: msg ?? 'Failed to create group', variant: 'destructive' });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; description?: string; dataset_access?: string[]; report_access?: string[] } }) =>
      adminGroupsApi.update(id, data).then((r) => r.data as AdminGroup),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'Group updated', variant: 'success' });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      addToast({ title: msg ?? 'Failed to update group', variant: 'destructive' });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  return useMutation({
    mutationFn: (id: string) => adminGroupsApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      addToast({ title: 'Group deleted', variant: 'success' });
    },
    onError: () => addToast({ title: 'Failed to delete group', variant: 'destructive' }),
  });
}

export function useSetGroupMembers() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);
  return useMutation({
    mutationFn: ({ id, userIds }: { id: string; userIds: string[] }) =>
      adminGroupsApi.setMembers(id, userIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => addToast({ title: 'Failed to update members', variant: 'destructive' }),
  });
}

// ── useCancelRefresh ──────────────────────────────────────────
export function useCancelRefresh() {
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (datasetId: string) => {
      const { data } = await schedulesApi.cancel(datasetId);
      return data;
    },
    onSuccess: () => {
      addToast({ title: 'Refresh cancelled', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Could not cancel refresh', variant: 'destructive' });
    },
  });
}
