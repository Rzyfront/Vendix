import EventSource from 'react-native-sse';

import { API_BASE_URL } from '@/core/api/endpoints';
import { apiClient, Endpoints } from '@/core/api';
import { getToken } from '@/core/auth/token.storage';

export type OrderSseEvent = {
  type: 'order.created' | 'order.status_changed';
  data: { order_id: number; kind: 'order.created' | 'order.status_changed' };
};

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

function parseOrderEvent(raw: string): OrderSseEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const event = value as Partial<OrderSseEvent>;
    if (
      (event.type !== 'order.created' && event.type !== 'order.status_changed') ||
      !event.data ||
      typeof event.data.order_id !== 'number' ||
      !Number.isFinite(event.data.order_id) ||
      event.data.order_id <= 0 ||
      event.data.kind !== event.type
    ) {
      return null;
    }
    return event as OrderSseEvent;
  } catch {
    return null;
  }
}

/** Store-scoped order SSE. REST remains the source of truth after every connect. */
export function subscribeToOrderEvents(
  onEvent: (event: OrderSseEvent) => void,
  onOpen?: () => void,
): () => void {
  let closed = false;
  let source: EventSource<'message'> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInProgress = false;
  let retryDelay = INITIAL_RETRY_MS;

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const closeSource = () => {
    if (!source) return;
    source.removeAllEventListeners();
    source.close();
    source = null;
  };

  const scheduleReconnect = (delay: number) => {
    if (closed || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const renewSession = async () => {
    if (refreshInProgress || closed) return;
    refreshInProgress = true;
    closeSource();
    try {
      // apiClient's 401 interceptor refreshes the JWT and logs out on failure.
      await apiClient.get(Endpoints.AUTH.ME);
      if (!closed) {
        retryDelay = INITIAL_RETRY_MS;
        scheduleReconnect(0);
      }
    } catch {
      // The API interceptor clears the invalid session; don't loop on stale JWT.
    } finally {
      refreshInProgress = false;
    }
  };

  const connect = async () => {
    if (closed || source) return;
    const token = await getToken();
    if (closed) return;
    if (!token) return;

    const url = `${API_BASE_URL.replace(/\/$/, '')}${Endpoints.STORE.ORDERS.STREAM}?token=${encodeURIComponent(token)}`;
    const current = new EventSource<'message'>(url, { pollingInterval: 0 });
    source = current;
    current.addEventListener('open', () => {
      if (source === current) {
        retryDelay = INITIAL_RETRY_MS;
        onOpen?.();
      }
    });
    current.addEventListener('message', (message) => {
      if (closed || source !== current || !('data' in message) || !message.data) return;
      const event = parseOrderEvent(message.data);
      if (event) onEvent(event);
    });
    current.addEventListener('error', (error) => {
      if (closed || source !== current) return;
      const status = Number(
        (error as { status?: number; xhrStatus?: number }).status ??
          (error as { xhrStatus?: number }).xhrStatus,
      );
      closeSource();
      if (status === 401) {
        void renewSession();
        return;
      }
      const delay = retryDelay;
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      scheduleReconnect(delay);
    });
  };

  void connect();
  return () => {
    closed = true;
    clearRetry();
    closeSource();
  };
}
