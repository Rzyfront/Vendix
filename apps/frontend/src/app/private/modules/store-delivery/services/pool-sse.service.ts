import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../../environments/environment';

/** Estado de conexión del stream SSE del pool (para UI opcional). */
export type PoolSseConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/**
 * Ventana máxima de reconexión: reintentamos con backoff durante 5 minutos; si
 * se agota sin volver a `open`, dejamos de reintentar en silencio (el pool
 * sigue usable con recarga manual / pull-to-refresh).
 */
const POOL_RECONNECT_WINDOW_MS = 5 * 60_000;

/**
 * SSE dedicado del pool de reparto (`GET /store/carrier/pool/stream`).
 *
 * Calco enfocado de `KdsSseService`: envuelve el `EventSource` del navegador con
 * reconexión explícita y backoff exponencial (1s → 2s → 4s → …, tope 30s). NO
 * mantiene estado de dominio — cada evento (`{ type: 'pool_changed' }`, o
 * cualquier ping) solo INCREMENTA el contador-signal `poolChanged`, y la página
 * del pool reacciona haciendo un **refetch** de `GET /store/carrier/pool`
 * (respetando `page`/`search` actuales) en vez de parchear la lista — así la
 * paginación/filtros y las desapariciones (órdenes reclamadas por otros) quedan
 * consistentes.
 *
 * Auth por `?token=` porque `EventSource` no envía cabeceras; el `JwtAuthGuard`
 * global del backend lo extrae del query. El stream vive bajo `/store/carrier/*`,
 * el único prefijo que `DomainScopeGuard` abre al app_type `STORE_DELIVERY`.
 *
 * Zoneless-safe (ver `vendix-zoneless-signals`): el estado observado por la
 * plantilla vive en signals; los callbacks del `EventSource` escriben signals
 * directamente (sin `NgZone.run()` — la escritura del signal dispara el CD).
 */
@Injectable({ providedIn: 'root' })
export class PoolSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly streamPath = '/store/carrier/pool/stream';

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectStartedAt: number | null = null;
  private destroyed = false;

  /**
   * Contador monotónico de pings recibidos. Arranca en 0; cada evento del
   * stream lo incrementa. La página lo lee en un `effect` (ignorando el 0
   * inicial) para disparar el refetch.
   */
  readonly poolChanged = signal(0);
  readonly connectionState = signal<PoolSseConnectionState>('idle');

  /** Abre el stream. Idempotente: no-op si ya está abierto/conectando. */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    // Un connect deliberado (init de la página) arranca ventana de reconexión.
    this.reconnectStartedAt = null;
    this.reconnectAttempt = 0;
    this.openEventSource();
  }

  /** Cierra el stream y cancela cualquier reconexión pendiente. */
  disconnect(): void {
    this.clearReconnectTimer();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(): void {
    const token = this.readAccessToken();
    if (!token) {
      this.connectionState.set('closed');
      this.scheduleReconnect();
      return;
    }

    const url =
      `${this.apiUrl}${this.streamPath}` +
      `?token=${encodeURIComponent(token)}`;

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      this.connectionState.set('closed');
      this.scheduleReconnect();
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.reconnectStartedAt = null;
      this.connectionState.set('open');
    };

    es.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      // Líneas de comentario SSE (heartbeats) empiezan con ":" — ignorar.
      if (event.data.startsWith(':')) return;
      // Cualquier evento del stream es un "nudge": la página hace refetch.
      // No parseamos el payload — el tipo (`pool_changed`) es informativo.
      this.poolChanged.update((n) => n + 1);
    };

    es.onerror = () => {
      // Gestionamos la reconexión nosotros (backoff visible), cerrando el
      // source para no dejar que el EventSource reintente a ciegas.
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.connectionState.set('reconnecting');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectStartedAt === null) {
      this.reconnectStartedAt = Date.now();
    }
    // Límite por TIEMPO: reintentamos con backoff hasta agotar la ventana de
    // 5 min; si se agota sin volver a `open`, dejamos de reintentar en silencio.
    if (Date.now() - this.reconnectStartedAt >= POOL_RECONNECT_WINDOW_MS) {
      this.connectionState.set('closed');
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private readAccessToken(): string | null {
    try {
      const raw = localStorage.getItem('vendix_auth_state');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.tokens?.access_token ?? null;
    } catch {
      return null;
    }
  }
}
