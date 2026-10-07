import EventSource from 'react-native-sse';

import { API_BASE_URL } from '@/core/api/endpoints';
import { apiClient, Endpoints } from '@/core/api';
import { getToken } from '@/core/auth/token.storage';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';

export type OrderSseEvent = {
  type: 'order.created' | 'order.status_changed';
  data: { order_id: number; kind: 'order.created' | 'order.status_changed' };
};

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
// Backend sends a message heartbeat every 30s; tolerate two missed heartbeats.
const LIVENESS_TIMEOUT_MS = 90_000;

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
  let livenessTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshInProgress = false;
  let connecting = false;
  let sessionRenewalPending = false;
  let retryDelay = INITIAL_RETRY_MS;
  const userId = useAuthStore.getState().user?.id;
  const storeId = useTenantStore.getState().storeId;

  const isCurrentSession = () => {
    const auth = useAuthStore.getState();
    return (
      !closed &&
      auth.isAuthenticated &&
      userId !== undefined &&
      auth.user?.id === userId &&
      !!storeId &&
      useTenantStore.getState().storeId === storeId
    );
  };

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const clearLiveness = () => {
    if (livenessTimer !== null) clearTimeout(livenessTimer);
    livenessTimer = null;
  };

  const closeSource = () => {
    clearLiveness();
    if (!source) return;
    const current = source;
    source = null;
    current.removeAllEventListeners();
    current.close();
  };

  const stop = () => {
    closed = true;
    clearRetry();
    closeSource();
  };

  const scheduleReconnect = (delay: number) => {
    if (!isCurrentSession()) {
      stop();
      return;
    }
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void (sessionRenewalPending ? renewSession() : connect());
    }, delay);
  };

  const retryWithBackoff = () => {
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    scheduleReconnect(delay);
  };

  const armLiveness = (current: EventSource<'message'>) => {
    clearLiveness();
    const timer = setTimeout(() => {
      // A cancelled timer can already be queued, even for the same source.
      if (livenessTimer !== timer || source !== current) return;
      livenessTimer = null;
      if (!isCurrentSession()) {
        stop();
        return;
      }
      closeSource();
      retryWithBackoff();
    }, LIVENESS_TIMEOUT_MS);
    livenessTimer = timer;
  };

  const renewSession = async () => {
    if (refreshInProgress || !isCurrentSession()) return;
    refreshInProgress = true;
    closeSource();
    try {
      // apiClient's 401 interceptor refreshes the JWT and logs out on failure.
      await apiClient.get(Endpoints.AUTH.ME);
      if (isCurrentSession()) {
        sessionRenewalPending = false;
        scheduleReconnect(0);
      }
    } catch (error: unknown) {
      const status = Number(
        (error as { response?: { status?: number } } | null)?.response?.status,
      );
      if (status === 401 || status === 403 || !isCurrentSession()) {
        // Terminal auth is owned by the interceptor; never retry a logged-out session.
        stop();
      } else {
        // Network/5xx can fail before the interceptor renews the JWT. Retry ME,
        // not SSE with the token already rejected by the stream.
        retryWithBackoff();
      }
    } finally {
      refreshInProgress = false;
    }
  };

  const connect = async () => {
    if (!isCurrentSession() || source || connecting || refreshInProgress) return;
    connecting = true;
    try {
      const token = await getToken();
      if (!isCurrentSession()) return;
      if (!token) {
        retryWithBackoff();
        return;
      }

      const url = `${API_BASE_URL.replace(/\/$/, '')}${Endpoints.STORE.ORDERS.STREAM}?token=${encodeURIComponent(token)}`;
      const current = new EventSource<'message'>(url, { pollingInterval: 0 });
      source = current;
      armLiveness(current); // Covers transports that never reach open, too.
      current.addEventListener('open', () => {
        if (source !== current) return;
        if (!isCurrentSession()) {
          stop();
          return;
        }
        armLiveness(current);
        retryDelay = INITIAL_RETRY_MS;
        onOpen?.();
      });
      current.addEventListener('message', (message) => {
        if (source !== current) return;
        if (!isCurrentSession()) {
          stop();
          return;
        }
        // Heartbeats/non-domain messages still prove the transport is alive.
        armLiveness(current);
        if (!('data' in message) || !message.data) return;
        const event = parseOrderEvent(message.data);
        if (event) onEvent(event);
      });
      current.addEventListener('error', (error) => {
        if (source !== current) return;
        if (!isCurrentSession()) {
          stop();
          return;
        }
        const status = Number(
          (error as { status?: number; xhrStatus?: number }).status ??
            (error as { xhrStatus?: number }).xhrStatus,
        );
        closeSource();
        if (status === 401) {
          sessionRenewalPending = true;
          void renewSession();
          return;
        }
        if (status === 403) {
          stop();
          return;
        }
        retryWithBackoff();
      });
    } catch {
      // Secure storage and EventSource construction are optional transports.
      // Their rejection must not escape the fire-and-forget connect promise.
      closeSource();
      if (isCurrentSession()) retryWithBackoff();
    } finally {
      connecting = false;
    }
  };

  void connect();
  return stop;
}
