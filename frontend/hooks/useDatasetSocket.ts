'use client';

import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';
import { subscribeToDataset, unsubscribeFromDataset } from '@/lib/socket';

/**
 * Subscribes to real-time dataset refresh events via WebSocket.
 * Calls `onRefresh` whenever the backend emits `dataset:refreshed` for this dataset.
 *
 * `connected` is included in the deps so that on every reconnect the room
 * subscription is re-sent (Socket.IO drops room memberships on disconnect).
 */
export function useDatasetSocket(
  datasetId: string | null | undefined,
  onRefresh: () => void,
): void {
  const { socket, connected } = useSocket();
  const cbRef = useRef(onRefresh);
  cbRef.current = onRefresh;

  useEffect(() => {
    if (!socket || !connected || !datasetId) return;

    subscribeToDataset(datasetId);

    const handler = (event: { dataset_id: string }) => {
      if (event.dataset_id === datasetId) cbRef.current();
    };
    socket.on('dataset:refreshed', handler);

    return () => {
      socket.off('dataset:refreshed', handler);
      unsubscribeFromDataset(datasetId);
    };
  }, [socket, connected, datasetId]);
}
