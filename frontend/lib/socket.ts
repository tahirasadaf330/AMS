import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;
let _currentToken: string | null = null;

const WS_RAW = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:3001';

// Split the configured URL into ORIGIN + base path. Socket.io must receive the origin as its URL —
// any path in the io() URL is treated as a NAMESPACE (the backend gateway is '/', so '/api' would
// fail) — and the base path must be passed via {path} instead. This makes the handshake hit the
// right route in every environment:
//   prod  'https://host/api'    → io('https://host',  { path: '/api/socket.io' })  (nginx /api/ → backend)
//   local 'http://localhost:3001' → io('http://localhost:3001', { path: '/socket.io' }) (direct)
function wsTarget(): { origin: string; path: string } {
  try {
    const u = new URL(WS_RAW);
    const base = u.pathname.replace(/\/+$/, '');
    return { origin: u.origin, path: `${base}/socket.io` };
  } catch {
    return { origin: WS_RAW, path: '/socket.io' };
  }
}

/**
 * Returns the existing socket or creates a new one with the given token.
 * If the token has changed, the existing socket is disconnected and a new one is created.
 */
export function getSocket(token: string): Socket {
  // Re-use the existing socket if it belongs to the same token — even while
  // reconnecting. Disconnecting and recreating during a reconnect attempt
  // prevents the built-in backoff from ever settling.
  if (_socket && _currentToken === token) {
    return _socket;
  }

  // Token changed — tear down the old connection first.
  if (_socket) {
    _socket.disconnect();
    _socket = null;
    _currentToken = null;
  }

  _currentToken = token;
  const { origin, path } = wsTarget();
  _socket = io(origin, {
    path,
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
    transports: ['websocket', 'polling'],
    timeout: 20_000,
  });

  _socket.on('connect', () => {
    console.log('[Socket] Connected:', _socket?.id);
  });

  _socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason);
  });

  _socket.on('connect_error', (err) => {
    // Only log after a delay to avoid spamming the console on transient failures
    console.warn('[Socket] Connection error:', err.message);
  });

  return _socket;
}

/**
 * Get the current socket without creating one.
 */
export function getCurrentSocket(): Socket | null {
  return _socket;
}

/**
 * Disconnect and clean up the socket.
 */
export function disconnectSocket(): void {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
    _currentToken = null;
    console.log('[Socket] Disconnected and cleaned up');
  }
}

/**
 * Subscribe to a dataset for real-time updates.
 */
export function subscribeToDataset(datasetId: string): void {
  _socket?.emit('subscribe:dataset', { dataset_id: datasetId });
}

/**
 * Unsubscribe from a dataset.
 */
export function unsubscribeFromDataset(datasetId: string): void {
  _socket?.emit('unsubscribe:dataset', { dataset_id: datasetId });
}
