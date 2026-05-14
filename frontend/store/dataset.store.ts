import { create } from 'zustand';
import type { Dataset } from '@/types';

interface RefreshInfo {
  refreshed_at: string;
  row_count: number;
  status?: string;
  duration_ms?: number;
}

interface DatasetStore {
  datasets: Dataset[];
  setDatasets: (datasets: Dataset[]) => void;
  updateDataset: (dataset: Dataset) => void;
  lastRefreshes: Record<string, RefreshInfo>;
  updateRefresh: (datasetId: string, info: RefreshInfo) => void;
  getDataset: (id: string) => Dataset | undefined;
}

export const useDatasetStore = create<DatasetStore>((set, get) => ({
  datasets: [],
  lastRefreshes: {},

  setDatasets: (datasets: Dataset[]) => {
    set({ datasets });
    // Initialize last refreshes from dataset data
    const refreshes: Record<string, RefreshInfo> = {};
    datasets.forEach((d) => {
      if (d.last_refresh) {
        refreshes[d.id] = {
          refreshed_at: d.last_refresh.refreshed_at,
          row_count: d.last_refresh.row_count,
          status: d.last_refresh.status,
          duration_ms: d.last_refresh.duration_ms,
        };
      }
    });
    set((state) => ({ lastRefreshes: { ...state.lastRefreshes, ...refreshes } }));
  },

  updateDataset: (dataset: Dataset) => {
    set((state) => ({
      datasets: state.datasets.map((d) => (d.id === dataset.id ? dataset : d)),
    }));
  },

  updateRefresh: (datasetId: string, info: RefreshInfo) => {
    set((state) => ({
      lastRefreshes: { ...state.lastRefreshes, [datasetId]: info },
      datasets: state.datasets.map((d) => {
        if (d.id !== datasetId) return d;
        return {
          ...d,
          last_refresh: {
            status: info.status ?? 'success',
            row_count: info.row_count,
            refreshed_at: info.refreshed_at,
            duration_ms: info.duration_ms ?? 0,
          },
        };
      }),
    }));
  },

  getDataset: (id: string) => {
    return get().datasets.find((d) => d.id === id);
  },
}));
