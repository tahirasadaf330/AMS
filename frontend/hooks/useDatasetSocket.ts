'use client';

import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';
import { subscribeToDataset, unsubscribeFromDataset } from '@/lib/socket';

/**
 * Subscribes to real-time dataset refresh events via WebSocket.
 * Calls `onRefresh` whenever the backend emits `dataset:refreshed` for this dataset.
 */
export function useDatasetSocket(
  datasetId: string | null | undefined,
  onRefresh: () => void,
): void {
  const { socket } = useSocket();
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!socket || !datasetId) return;

    subscribeToDataset(datasetId);
    const handler = () => cbRef.current();
    socket.on('dataset:refreshed', handler);

    return () => {
      socket.off('dataset:refreshed', handler);
      unsubscribeFromDataset(datasetId);
    };
  }, [socket, datasetId]);
}
