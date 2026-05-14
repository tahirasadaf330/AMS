'use client';

import { useState } from 'react';
import { exportApi } from '@/lib/api';
import { downloadBlob } from '@/lib/utils';
import { useUIStore } from '@/store/ui.store';

interface ExportState {
  isLoading: boolean;
  error: string | null;
}

export function useExportCsv(datasetId: string, params?: Record<string, string>) {
  const [state, setState] = useState<ExportState>({ isLoading: false, error: null });
  const addToast = useUIStore((s) => s.addToast);

  const download = async () => {
    setState({ isLoading: true, error: null });
    try {
      const blob = await exportApi.getCsv(datasetId, params);
      downloadBlob(blob, `dataset-${datasetId}.csv`);
      addToast({ title: 'CSV exported successfully', variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed — please try again';
      setState((s) => ({ ...s, error: msg }));
      addToast({ title: 'Export failed — please try again', variant: 'destructive' });
    } finally {
      setState((s) => ({ ...s, isLoading: false }));
    }
  };

  return { download, ...state };
}

export function useExportExcel(datasetId: string, params?: Record<string, string>) {
  const [state, setState] = useState<ExportState>({ isLoading: false, error: null });
  const addToast = useUIStore((s) => s.addToast);

  const download = async () => {
    setState({ isLoading: true, error: null });
    try {
      const blob = await exportApi.getExcel(datasetId, params);
      downloadBlob(blob, `dataset-${datasetId}.xlsx`);
      addToast({ title: 'Excel exported successfully', variant: 'success' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed — please try again';
      setState((s) => ({ ...s, error: msg }));
      addToast({ title: 'Export failed — please try again', variant: 'destructive' });
    } finally {
      setState((s) => ({ ...s, isLoading: false }));
    }
  };

  return { download, ...state };
}
