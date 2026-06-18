import {
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  KdsEvent,
  KitchenTicket,
  KitchenTicketStatus,
} from '../interfaces';
import { KitchenTicketsService } from './kitchen-tickets.service';

/**
 * Internal connection state for the KDS SSE stream. Exposed via signal
 * so zoneless templates can render the "Reconectando…" / "Conectado"
 * status without needing RxJS.
 */
export type KdsConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

export interface KdsReconnectAttempt {
  attempt: number;
  nextDelayMs: number;
  reason: string;
}

/**
 * Modo operativo del KDS.
 *  - `live`: conectado a SSE, recibiendo eventos en tiempo real.
 *  - `manual`: el stream se cayó reiteradamente y caímos a polling
 *    contra `/kitchen-fire/snapshot` cada `pollingIntervalMs`.
 */
export type KdsMode = 'live' | 'manual';

/** Configuración del fallback polling. Exportada para que el board pueda leerla. */
export const KDS_POLLING_INTERVAL_MS = 10_000;
export const KDS_MAX_RECONNECT_ATTEMPTS = 5;

/**
 * KDS SSE service — wraps the browser's EventSource with explicit
 * reconnection, exponential backoff (1s → 2s → 4s → …, max 30s) and
 * snapshot reconciliation.
 *
 * Si los reintentos consecutivos superan `KDS_MAX_RECONNECT_ATTEMPTS`
 * sin volver a `open`, el servicio transiciona a `mode='manual'` y
 * arranca un `setInterval` contra `KitchenTicketsService.getSnapshot`
 * para mantener los tickets frescos sin SSE.
 *
 * Design notes (see `vendix-zoneless-signals`):
 *  - State is exposed as SIGNALS (not RxJS subjects). The KDS page
 *    consumes them directly. We never trigger manual change
 *    detection — zoneless reacts to the signal write itself.
 *  - We do NOT use the global `EventSource` auto-reconnect: the
 *    browser reconnects on TCP errors but at a fixed 3s delay and
 *    without any visibility. Instead we re-create the source ourselves
 *    with explicit backoff so the UI can show a counter.
 *  - The "snapshot" event from the server REPLACES the local tickets
 *    array; "ticket.*" events UPSERT or REMOVE by id.
 */
@Injectable({ providedIn: 'root' })
export class KdsSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/kitchen-fire';
  private readonly ticketsService = inject(KitchenTicketsService);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;

  /** All tickets the KDS currently knows about, keyed by id. */
  readonly tickets = signal<KitchenTicket[]>([]);
  readonly connectionState = signal<KdsConnectionState>('idle');
  readonly lastEvent = signal<KdsEvent | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly lastReconnect = signal<KdsReconnectAttempt | null>(null);
  /** Modo operativo (live o manual fallback). */
  readonly mode = signal<KdsMode>('live');
  /** Número de fallos consecutivos del SSE — se resetea al recibir 'open'. */
  readonly consecutiveFailures = signal<number>(0);
  /** True cuando tenemos tickets en cache local (snapshot ya cargado). */
  readonly hasSnapshot = signal<boolean>(false);

  constructor() {
    // Reaccionar al cambio de modo arrancando/detiendo el polling.
    // El effect solo re-ejecuta cuando `mode()` cambia; la mutación
    // de `pollingTimer` no se trackea (untracked).
    effect(() => {
      const current = this.mode();
      untracked(() => {
        if (current === 'manual') {
          this.startPollingInternal();
        } else {
          this.stopPollingInternal();
        }
      });
    });
  }

  /** Open the SSE stream. Idempotent — calling twice is a no-op while open. */
  connect(windowMinutes: number = 120): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    // Volvemos a modo live por si veníamos de manual.
    if (this.mode() !== 'live') {
      this.mode.set('live');
    }
    this.openEventSource(windowMinutes);
  }

  /** Close the SSE stream and cancel any pending reconnect. */
  disconnect(): void {
    this.clearReconnectTimer();
    this.stopPollingInternal();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  /**
   * Hard reset — closes the stream, clears the backoff counter and
   * tickets cache. Useful when the user clicks "Refrescar" in the KDS.
   */
  reset(): void {
    this.disconnect();
    this.reconnectAttempt = 0;
    this.consecutiveFailures.set(0);
    this.tickets.set([]);
    this.lastError.set(null);
    this.lastReconnect.set(null);
    this.hasSnapshot.set(false);
    this.connectionState.set('idle');
    this.mode.set('live');
  }

  /**
   * Reconcilia un snapshot completo (mismo shape que el evento
   * `snapshot` del SSE). Útil para que el botón "Refrescar" del board
   * fuerce la sincronización sin tocar la conexión SSE.
   */
  applySnapshot(tickets: KitchenTicket[]): void {
    this.tickets.set(tickets ?? []);
    this.hasSnapshot.set(true);
  }

  /**
   * Fetch manual contra /snapshot. Devuelve la lista nueva y la aplica.
   * Usado por el botón "Refrescar" del board. Usamos `firstValueFrom`
   * (en vez de `.subscribe`) porque es un flujo async one-shot dentro de
   * una Promise — el observable HTTP completa solo y no necesita
   * gestión de suscripción manual.
   */
  async refreshSnapshot(windowMinutes: number = 120): Promise<KitchenTicket[]> {
    const resp = await firstValueFrom(
      this.ticketsService.getSnapshot(windowMinutes),
    );
    this.applySnapshot(resp.tickets);
    return resp.tickets;
  }

  /** Cleanup on service destroy (rare — service is root-provided). */
  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(windowMinutes: number): void {
    const token = this.readAccessToken();
    if (!token) {
      this.lastError.set('No hay token de autenticación');
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      this.scheduleReconnect('no_token', windowMinutes);
      return;
    }

    const url =
      `${this.apiUrl}${this.basePath}/stream` +
      `?token=${encodeURIComponent(token)}` +
      `&windowMinutes=${windowMinutes}`;

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      this.lastError.set((err as Error).message);
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      this.scheduleReconnect('construct_failed', windowMinutes);
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.consecutiveFailures.set(0);
      this.connectionState.set('open');
      this.lastError.set(null);
      // Volvemos a modo live si veníamos de manual.
      if (this.mode() !== 'live') {
        this.mode.set('live');
      }
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      // EventSource will internally try to reconnect on its own, but we
      // close it and manage reconnects ourselves so the backoff is
      // visible to the UI.
      this.lastError.set('Stream connection error');
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.scheduleReconnect('onerror', windowMinutes);
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // SSE comment lines (heartbeats) start with ":" — ignore them.
    if (event.data.startsWith(':')) return;
    let parsed: KdsEvent;
    try {
      parsed = JSON.parse(event.data) as KdsEvent;
    } catch {
      this.lastError.set('Malformed SSE payload');
      return;
    }
    this.lastEvent.set(parsed);
    this.applyEvent(parsed);
  }

  /**
   * Reconcile a single KDS event against the current tickets cache.
   *  - snapshot       → replace whole array
   *  - ticket.*       → upsert by id; if status is `delivered` or
   *                     `cancelled` we still keep it (the "Delivered"
   *                     column needs recent history).
   */
  private applyEvent(event: KdsEvent): void {
    if (event.type === 'snapshot') {
      this.applySnapshot(event.tickets);
      return;
    }
    // Todos los `ticket.*` (created/started/ready/delivered/cancelled/
    // reverted) traen el ticket completo en `event.ticket` con el mismo
    // shape, por lo que `ticket.reverted` se reconcilia con el MISMO
    // upsert por id que `ticket.delivered` — sin lógica especial.
    if (!('ticket' in event) || !event.ticket) return;
    const incoming = event.ticket as KitchenTicket;
    const id = incoming?.id;
    if (typeof id !== 'number') return;

    this.tickets.update((list) => {
      const idx = list.findIndex((t) => t.id === id);
      if (idx === -1) {
        return [...list, incoming];
      }
      const next = [...list];
      next[idx] = incoming;
      return next;
    });
  }

  private scheduleReconnect(reason: string, windowMinutes: number): void {
    if (this.destroyed) return;
    this.reconnectAttempt += 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.lastReconnect.set({
      attempt: this.reconnectAttempt,
      nextDelayMs: delay,
      reason,
    });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource(windowMinutes);
    }, delay);
    // Si superamos el máximo de reintentos, transicionamos a manual.
    if (this.reconnectAttempt >= KDS_MAX_RECONNECT_ATTEMPTS) {
      this.transitionToManual();
    }
  }

  private transitionToManual(): void {
    if (this.mode() === 'manual') return;
    this.lastError.set(
      `Stream no disponible tras ${this.reconnectAttempt} reintentos. Cambiando a modo manual.`,
    );
    this.mode.set('manual');
    // Limpiamos cualquier intento pendiente de reconnect.
    this.clearReconnectTimer();
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  /**
   * Llamado por el constructor (effect) o por transición manual. No
   * debe llamarse directamente desde fuera — usar `mode.set('manual')`
   * y dejar que el effect dispare `startPollingInternal`.
   */
  private startPollingInternal(
    intervalMs: number = KDS_POLLING_INTERVAL_MS,
  ): void {
    if (this.pollingTimer) return;
    // Primer fetch inmediato para no esperar el primer tick.
    void this.pollOnce();
    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  private stopPollingInternal(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const tickets = await this.refreshSnapshot(120);
      // Si durante el polling volvió el SSE, el modo será 'live' y el
      // effect ya detuvo el timer — no pasa nada por haberlo disparado.
      if (tickets && this.mode() === 'manual') {
        // noop: el signal ya quedó actualizado.
      }
    } catch {
      // Silencioso: el siguiente tick reintentará.
    }
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
