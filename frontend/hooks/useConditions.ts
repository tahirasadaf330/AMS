'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { conditionsApi } from '@/lib/api';
import type { Condition } from '@/types';
import { useUIStore } from '@/store/ui.store';

export const conditionKeys = {
  all: ['conditions'] as const,
  list: () => [...conditionKeys.all, 'list'] as const,
};

export function useConditions() {
  return useQuery({
    queryKey: conditionKeys.list(),
    queryFn: async () => {
      const { data } = await conditionsApi.list();
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function useCreateCondition() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await conditionsApi.create(data);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conditionKeys.list() });
      addToast({ title: 'Condition created', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Failed to create condition', variant: 'destructive' });
    },
  });
}

export function useUpdateCondition() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<Condition, 'id' | 'created_at' | 'updated_at'>>;
    }) => {
      const res = await conditionsApi.update(id, data);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conditionKeys.list() });
      addToast({ title: 'Condition saved', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Failed to save condition', variant: 'destructive' });
    },
  });
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (id: string) => {
      await conditionsApi.delete(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conditionKeys.list() });
      addToast({ title: 'Condition deleted', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Failed to delete condition', variant: 'destructive' });
    },
  });
}

export function usePreviewCondition() {
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await conditionsApi.preview(id);
      return res.data;
    },
  });
}

export function useTestNotify() {
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await conditionsApi.testNotify(id);
      return res.data;
    },
    onSuccess: () => {
      addToast({ title: 'Test notification sent', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Test notification failed', variant: 'destructive' });
    },
  });
}

export function useTriggerNow() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await conditionsApi.triggerNow(id);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: conditionKeys.list() });
      addToast({ title: 'Condition triggered', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Trigger failed', variant: 'destructive' });
    },
  });
}

export function useTestNotifyPreview() {
  const addToast = useUIStore((s) => s.addToast);

  return useMutation({
    mutationFn: async (data: Omit<Condition, 'id' | 'created_at' | 'updated_at'>) => {
      const res = await conditionsApi.testNotifyPreview(data);
      return res.data;
    },
    onSuccess: () => {
      addToast({ title: 'Test notification sent', variant: 'success' });
    },
    onError: () => {
      addToast({ title: 'Test notification failed', variant: 'destructive' });
    },
  });
}
