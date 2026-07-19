import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import {
  ToastService,
  ToastVariant,
} from '../../shared/components/toast/toast.service';
import { formatDateOnlyUTC } from '../../shared/utils/date.util';
import type {
  Occupancy,
  MembershipOccupancyEvent,
} from '../../private/modules/store/memberships/access/interfaces';

/**
 * Payload emitted by `GET /store/memberships/access/stream`
 * (`membership-access` events). Mirrors the backend
 * `MembershipAccessSseEvent` shape — `customer_name`/`status` may be null.
 */
export interface MembershipAccessEvent {
  type: 'membership-access';
  granted: boolean;
  result: string;
  customer_name: string | null;
  status: string | null;
  days_remaining: number | null;
  period_end: string | null; // ISO
  membership_id: number;
  at: string; // ISO
  /**
   * True when access is GRANTED but it is a RE-ENTRY within the configured
   * window (`membership.re_entry_mode: 'warn'`). Optional — only present on
   * the warn-grant path.
   */
  warning?: boolean;
  /**
   * Minutes since the member's last granted entry. Present on the warn-grant
   * path (`warning: true`) and on the `denied_re_entry` result. Optional.
   */
  re_entry_minutes?: number;
}

/**
 * Payload emitted by the same stream when a biometric device pings the
 * enrollment endpoint (`POST /store/memberships/access/enrollment-ping`) and
 * the backend re-broadcasts it as an `enrollment` event. Used to capture a
 * freshly-scanned fingerprint reference during credential creation.
 *
 * IMPORTANT: `external_ref` is an opaque device reference — it is stored on the
 * hidden form control and sent to the API, but NEVER rendered to the operator.
 */
export interface MembershipEnrollmentEvent {
  type: 'enrollment';
  external_ref: string;
  device_id: string | null;
  at: string; // ISO
}

/**
 * Internal connection state for the ambient-access SSE stream. Exposed as a
 * signal so any consumer (and zoneless templates) can observe it without RxJS.
 */
export type AmbientAccessConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

/**
 * Ambient membership-access validation (W4).
 *
 * A root-provided service that, when the gym industry is active AND the store
 * setting `membership.ambient_access_enabled` is on, subscribes to the shared
 * SSE hub filtered to `membership-access` events and pops a TOAST for each
 * access decision — WITHOUT being mounted inside the accesses module.
 *
 * Design mirrors `KdsSseService` (see
 * `restaurant-ops/kds/services/kds-sse.service.ts`):
 *  - Wraps the browser `EventSource` with EXPLICIT reconnection and
 *    exponential backoff (1s → 2s → 4s → …, capped at 30s). We do NOT rely on
 *    the browser's fixed 3s auto-reconnect so behaviour is deterministic.
 *  - Reuses the SAME URL base (`environment.apiUrl`) and the SAME JWT token
 *    source as KDS: `localStorage['vendix_auth_state'].tokens.access_token`
 *    passed via `?token=` (EventSource cannot set the Authorization header).
 *  - State is exposed as SIGNALS; we never trigger manual change detection —
 *    zoneless reacts to the signal writes themselves.
 *
 * Divergence from KDS: the backend ambient feed is LIVE-ONLY (no `/snapshot`
 * endpoint), so there is NO manual polling fallback. We simply keep retrying
 * with capped backoff while the service stays active.
 */
@Injectable({ providedIn: 'root' })
export class MembershipAmbientAccessService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/memberships/access';
  private readonly toast = inject(ToastService);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  /** True between `connect()` and `disconnect()`; gates reconnection. */
  private active = false;
  private destroyed = false;

  readonly connectionState = signal<AmbientAccessConnectionState>('idle');
  readonly lastEvent = signal<MembershipAccessEvent | null>(null);
  readonly lastError = signal<string | null>(null);

  /**
   * Live occupancy (aforo) fed by `type: 'occupancy'` SSE events (C2).
   * `null` until the first occupancy event arrives. The decision flow
   * (`membership-access` events + toast) is unaffected by this signal.
   */
  private readonly _occupancy = signal<Occupancy | null>(null);
  /** Read-only view of the live occupancy for consumers (C3). */
  readonly occupancy = this._occupancy.asReadonly();

  /**
   * Last biometric `enrollment` event seen on the stream. Exposed as its OWN
   * signal (NOT merged into `lastEvent`) so existing consumers of `lastEvent()`
   * — e.g. the aforo check-in panel — keep their narrow `MembershipAccessEvent`
   * type intact. `null` until the first enrollment ping arrives.
   */
  private readonly _lastEnrollment = signal<MembershipEnrollmentEvent | null>(
    null,
  );
  /** Read-only view of the last enrollment event for consumers. */
  readonly lastEnrollment = this._lastEnrollment.asReadonly();

  /** Open the SSE stream. Idempotent — a no-op while already open/connecting. */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    this.active = true;
    this.reconnectAttempt = 0;
    this.openEventSource();
  }

  /** Close the SSE stream and cancel any pending reconnect. */
  disconnect(): void {
    this.active = false;
    this.clearReconnectTimer();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  /** Cleanup on service destroy (rare — service is root-provided). */
  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(): void {
    const token = this.readAccessToken();
    if (!token) {
      this.lastError.set('No hay token de autenticación');
      this.connectionState.set('error');
      this.scheduleReconnect();
      return;
    }

    const url =
      `${this.apiUrl}${this.basePath}/stream` +
      `?token=${encodeURIComponent(token)}`;

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      this.lastError.set((err as Error).message);
      this.connectionState.set('error');
      this.scheduleReconnect();
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionState.set('open');
      this.lastError.set(null);
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      // Close and manage reconnects ourselves so the backoff is deterministic
      // and visible to any consumer of `connectionState`.
      this.lastError.set('Reconectando con el servicio de accesos…');
      this.connectionState.set('error');
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.scheduleReconnect();
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // SSE comment lines (heartbeats) start with ":" — ignore them.
    if (event.data.startsWith(':')) return;
    let parsed:
      | MembershipAccessEvent
      | MembershipOccupancyEvent
      | MembershipEnrollmentEvent;
    try {
      parsed = JSON.parse(event.data) as
        | MembershipAccessEvent
        | MembershipOccupancyEvent
        | MembershipEnrollmentEvent;
    } catch {
      this.lastError.set('Payload SSE malformado');
      return;
    }
    // Branch by the discriminator. The stream now multiplexes access
    // DECISIONS (`membership-access`), occupancy TICKS (`occupancy`) and
    // biometric ENROLLMENT pings (`enrollment`). Any other/unknown payload is
    // ignored so it never disturbs any flow.
    switch (parsed?.type) {
      case 'membership-access':
        this.lastEvent.set(parsed);
        this.showToast(parsed);
        break;
      case 'occupancy':
        this.applyOccupancyEvent(parsed);
        break;
      case 'enrollment':
        // Live fingerprint reference. Do NOT toast or log — the value is
        // captured silently by whoever armed a scan. Never surface it.
        this._lastEnrollment.set(parsed);
        break;
      default:
        return;
    }
  }

  /**
   * Map a live `occupancy` SSE event onto the `Occupancy` signal.
   *
   * The SSE event does NOT carry `turnstile_mode` nor `business_date`. We
   * PRESERVE the last known values for those two fields (e.g. seeded by C3's
   * REST `getOccupancy()`) so a live tick never wipes them, and fall back to
   * safe defaults (`turnstile_mode: false`, `business_date: null`) before the
   * first authoritative value is known.
   */
  private applyOccupancyEvent(ev: MembershipOccupancyEvent): void {
    const prev = this._occupancy();
    this._occupancy.set({
      current_count: ev.current_count,
      max_capacity: ev.max_capacity,
      capacity_control_enabled: ev.capacity_control_enabled,
      turnstile_mode: prev?.turnstile_mode ?? false,
      business_date: prev?.business_date ?? null,
      updated_at: ev.updated_at,
    });
  }

  private showToast(ev: MembershipAccessEvent): void {
    const name = ev.customer_name?.trim() || 'Socio';

    // Re-entry states (third state). Both the warn-grant (granted + `warning`)
    // and the hard block (`denied_re_entry`) use the `warning` variant so the
    // reception operator notices the member is coming back in within the
    // configured window.
    if (ev.result === 'denied_re_entry') {
      this.toast.show({
        variant: 'warning',
        title: `${name} — reingreso bloqueado`,
        description: this.buildReEntryDescription(ev),
        duration: 5000,
      });
      return;
    }
    if (ev.warning === true) {
      this.toast.show({
        variant: 'warning',
        title: `${name} — reingreso`,
        description: this.buildReEntryDescription(ev),
        duration: 4500,
      });
      return;
    }

    const variant: ToastVariant = ev.granted ? 'success' : 'warning';
    const title = ev.granted ? `${name} ingresó` : `${name} — acceso denegado`;
    this.toast.show({
      variant,
      title,
      description: this.buildDescription(ev),
      duration: ev.granted ? 3000 : 4500,
    });
  }

  /**
   * Re-entry toast body: "Ya ingresó hace N min". Falls back to a generic line
   * when the backend did not carry `re_entry_minutes`.
   */
  private buildReEntryDescription(ev: MembershipAccessEvent): string {
    const mins = ev.re_entry_minutes;
    if (mins == null) return 'Ya había ingresado recientemente';
    return `Ya ingresó hace ${mins} min`;
  }

  /**
   * Membership status + validity line for the toast body:
   *  - `days_remaining != null` → "N días para vencer" (+ fecha si hay).
   *  - `days_remaining == null` → "Sin vigencia activa".
   */
  private buildDescription(ev: MembershipAccessEvent): string {
    const statusLabel = this.statusLabel(ev.status);
    let validity: string;
    if (ev.days_remaining != null) {
      const dayWord = Math.abs(ev.days_remaining) === 1 ? 'día' : 'días';
      validity = `${ev.days_remaining} ${dayWord} para vencer`;
      if (ev.period_end) {
        validity += ` (vence ${formatDateOnlyUTC(ev.period_end)})`;
      }
    } else {
      validity = 'Sin vigencia activa';
    }
    return statusLabel ? `${statusLabel} · ${validity}` : validity;
  }

  private statusLabel(status: string | null): string {
    if (!status) return '';
    const map: Record<string, string> = {
      active: 'Membresía activa',
      expired: 'Membresía vencida',
      suspended: 'Membresía suspendida',
      cancelled: 'Membresía cancelada',
      canceled: 'Membresía cancelada',
      pending: 'Membresía pendiente',
      frozen: 'Membresía congelada',
      paused: 'Membresía pausada',
      trial: 'Membresía en prueba',
    };
    return map[status] ?? status;
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.active) return;
    this.reconnectAttempt += 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.connectionState.set('reconnecting');
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.active && !this.destroyed) {
        this.openEventSource();
      }
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
