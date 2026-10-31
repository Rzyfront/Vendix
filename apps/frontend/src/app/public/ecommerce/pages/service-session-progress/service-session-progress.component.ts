import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../environments/environment';

interface ServiceProposal {
  version: number;
  snapshot_hash: string;
  lines: { items?: Array<{ name?: string; description?: string; quantity?: number; total?: number; unit_price?: number }> } | unknown;
  subtotal: number | string;
  tax: number | string;
  discount: number | string;
  total: number | string;
  currency: string;
  expires_at: string;
  status: string;
}

interface PublicProgress {
  store_id: number;
  status: string;
  store?: { id: number; name: string; logo_url: string | null } | null;
  order_number?: string | null;
  order_created_at?: string | null;
  /** Qué se atiende: estación, servicio, lo atendido, especialista y datos de recepción. */
  service?: {
    station_name: string | null;
    service_name: string | null;
    subject_label: string | null;
    provider_name?: string | null;
    customer_first_name?: string | null;
    intake?: Array<{ label: string; value: string }>;
    opened_at: string;
  } | null;
  account: {
    currency: string;
    items: Array<{ name: string; description?: string | null; quantity: number; unit_price: string; total: string; item_type: string }>;
    subtotal?: string;
    tax?: string;
    total: string;
    budget_spent: string;
    budget_amount: string | null;
    budget_remaining: string | null;
  };
  events: Array<{ type: string; text: string; created_at: string }>;
  proposal?: ServiceProposal | null;
}
import { ButtonComponent, IconComponent } from '../../../../shared/components';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { formatStoreDateTime } from '../../../../shared/utils/date.util';
import {
  GuestOrderSummary,
  GuestOrderSummaryComponent,
} from '../../../../private/modules/ecommerce/pages/guest-order-summary/guest-order-summary.component';
import {
  ServiceSessionDetailsComponent,
  ServiceSessionDetailsData,
} from '../../../../private/modules/ecommerce/components/service-session-details/service-session-details.component';

@Component({
  selector: 'app-service-session-progress',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent, GuestOrderSummaryComponent, ServiceSessionDetailsComponent],
  templateUrl: './service-session-progress.component.html',
  styleUrl: './service-session-progress.component.scss',
})
export class ServiceSessionProgressComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly meta = inject(Meta);
  private readonly currencyService = inject(CurrencyFormatService);
  private stream?: EventSource;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly MAX_BACKOFF_MS = 60000;
  private static readonly POLL_INTERVAL_MS = 30000;
  private readonly browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota';
  private readonly apiUrl = `${environment.apiUrl}/ecommerce`;

  readonly state = signal<'loading' | 'loaded' | 'unavailable' | 'error'>('loading');
  readonly progress = signal<PublicProgress | null>(null);
  readonly busy = signal(false);
  readonly decisionPrompt = signal<'approved' | 'rejected' | null>(null);
  readonly decisionMessage = signal<string | null>(null);
  readonly connected = signal(false);
  /** Hay un refresco en vuelo: evita solapar peticiones (botón Actualizar). */
  readonly refreshing = signal(false);
  /** Se conservan los últimos datos pero el refresco falló o el enlace dejó de responder. */
  readonly staleNotice = signal<string | null>(null);
  /** El enlace se cierra al finalizar la atención: se conserva la última cuenta vista. */
  readonly finished = signal(false);
  readonly proposalLines = computed(() => {
    const lines = this.progress()?.proposal?.lines as { items?: unknown[] } | null | undefined;
    return Array.isArray(lines?.items) ? (lines.items as Array<Record<string, unknown>>) : [];
  });

  /**
   * La cuenta en vivo con el mismo resumen de orden de la tienda (el de los
   * pedidos de productos): se ve dentro de la tienda, no como otra página.
   */
  readonly orderSummary = computed((): GuestOrderSummary | null => {
    const p = this.progress();
    if (!p) return null;
    const tax = Number(p.account.tax ?? 0);
    return {
      token: '',
      prints_vat_breakdown: tax > 0,
      store: p.store ? { id: p.store.id, name: p.store.name, logo_url: p.store.logo_url ?? undefined } : undefined,
      order: {
        order_number: p.order_number || 'Servicio',
        state: this.finished() ? 'finished' : 'draft',
        channel: 'pos',
        delivery_type: 'direct_delivery',
        created_at: p.order_created_at ?? p.service?.opened_at ?? null,
        currency: p.account.currency,
        items: p.account.items.map((item, index) => ({
          order_item_id: index + 1,
          product_name: item.name,
          notes: item.description ?? null,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          total_price: Number(item.total),
          product_type: item.item_type === 'service' ? 'service' : 'physical',
        })) as GuestOrderSummary['order']['items'],
        discount_amount: 0,
        subtotal_amount: Number(p.account.subtotal ?? p.account.total),
        tax_amount: tax,
        shipping_cost: 0,
        grand_total: Number(p.account.total),
        payments: [],
      },
    };
  });

  readonly serviceDetails = computed((): ServiceSessionDetailsData | null => {
    const p = this.progress();
    if (!p?.service) return null;
    return {
      status: p.status,
      station_name: p.service.station_name,
      service_name: p.service.service_name,
      subject_label: p.service.subject_label,
      provider_name: p.service.provider_name ?? null,
      customer_name: p.service.customer_first_name ?? null,
      opened_at: p.service.opened_at,
      intake: p.service.intake ?? [],
    };
  });

  private token = '';

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(this.token)) {
      this.state.set('unavailable');
      return;
    }
    this.meta.updateTag({ name: 'referrer', content: 'no-referrer' });
    this.refresh();
  }

  ngOnDestroy(): void {
    this.stopStream();
    this.stopPolling();
    this.clearReconnectTimer();
    this.connected.set(false);
    this.meta.removeTag("name='referrer'");
  }

  refresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.http
      .get<PublicProgress>(`${this.apiUrl}/service-sessions/${this.token}`, {
        headers: { 'Cache-Control': 'no-cache' },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (value) => {
          this.refreshing.set(false);
          this.staleNotice.set(null);
          this.progress.set(value);
          this.state.set('loaded');
          if (!this.stream || this.stream.readyState === EventSource.CLOSED) {
            if (!this.pollTimer) this.openStream(value.store_id);
          }
        },
        error: (error) => {
          this.refreshing.set(false);
          const gone = error?.status === 410 || error?.status === 404;
          if (this.progress()) {
            // Ya hay datos: se conserva la última vista y solo se avisa.
            this.staleNotice.set(
              gone
                ? 'Este enlace ya no responde. Mostramos la última información recibida.'
                : 'No pudimos actualizar. Mostramos la última información recibida.',
            );
            if (gone) {
              this.stopStream();
              this.stopPolling();
              this.clearReconnectTimer();
              this.connected.set(false);
            }
            return;
          }
          this.state.set(gone ? 'unavailable' : 'error');
        },
      });
  }

  askDecision(decision: 'approved' | 'rejected'): void {
    this.decisionMessage.set(null);
    this.decisionPrompt.set(decision);
  }

  cancelDecision(): void {
    this.decisionPrompt.set(null);
  }

  decide(): void {
    const proposal = this.progress()?.proposal;
    const decision = this.decisionPrompt();
    if (!proposal || !decision || this.busy()) return;
    this.busy.set(true);
    this.http
      .post(`${this.apiUrl}/service-proposals/${this.token}/decision`, {
        decision,
        proposal_version: proposal.version,
        snapshot_hash: proposal.snapshot_hash,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.decisionPrompt.set(null);
          this.decisionMessage.set(
            decision === 'approved' ? 'Tu aprobación quedó registrada con éxito.' : 'Tu rechazo quedó registrado.',
          );
          this.refresh();
        },
        error: (error) => {
          this.busy.set(false);
          if (error?.status === 410 || error?.status === 404) {
            this.state.set('unavailable');
            return;
          }
          this.decisionPrompt.set(null);
          this.decisionMessage.set(
            error?.status === 409
              ? 'La propuesta cambió o venció. Actualiza la página antes de decidir.'
              : 'No pudimos registrar tu decisión. Por favor intenta de nuevo.',
          );
          this.refresh();
        },
      });
  }

  /** Moneda de la tienda vía CurrencyFormatService (el código de la propuesta no la cambia). */
  money(value: unknown, _currency?: string): string {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) return '—';
    return this.currencyService.format(amount);
  }

  dateTime(value: string | null | undefined): string {
    return value ? formatStoreDateTime(value, this.browserTimezone, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  private stopStream(): void {
    if (this.stream) {
      this.stream.onopen = null;
      this.stream.onerror = null;
      this.stream.close();
      this.stream = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || this.finished()) return;
      this.refresh();
    }, ServiceSessionProgressComponent.POLL_INTERVAL_MS);
  }

  private scheduleReconnect(storeId: number): void {
    if (this.reconnectTimer || this.pollTimer) return;
    if (this.reconnectAttempts >= ServiceSessionProgressComponent.MAX_RECONNECT_ATTEMPTS) {
      this.startPolling();
      return;
    }
    const delay = Math.min(
      2000 * 2 ** this.reconnectAttempts,
      ServiceSessionProgressComponent.MAX_BACKOFF_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openStream(storeId);
    }, delay);
  }

  proposalStatusLabel(status: string): string {
    return (
      ({
        pending: 'Pendiente de tu decisión',
        approved: 'Aprobada',
        rejected: 'Rechazada',
        expired: 'Vencida',
        stale: 'Actualizada',
      } as Record<string, string>)[status] ?? status
    );
  }

  private openStream(storeId: number): void {
    this.stopStream();
    this.stream = new EventSource(`${this.apiUrl}/service-sessions/${this.token}/stream?store_id=${encodeURIComponent(storeId)}`, {
      withCredentials: true,
    });
    const stream = this.stream;
    stream.onopen = () => {
      this.reconnectAttempts = 0;
      this.connected.set(true);
    };
    stream.onerror = () => {
      this.connected.set(false);
      if (stream.readyState === EventSource.CLOSED) {
        this.scheduleReconnect(storeId);
      }
    };
    for (const eventName of ['snapshot', 'progress']) {
      this.stream.addEventListener(eventName, (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          if (eventName === 'snapshot') this.progress.set(payload);
          else if (payload?.text) {
            const current = this.progress();
            if (current) {
              this.progress.set({
                ...current,
                status: payload.status ?? current.status,
                events: [
                  ...current.events,
                  {
                    type: payload.type,
                    text: payload.text,
                    created_at: payload.created_at ?? new Date().toISOString(),
                  },
                ].slice(-100),
              });
            }
            // Una propuesta nueva o resuelta cambia la tarjeta de aprobación: se vuelve a leer.
            if (typeof payload?.type === 'string' && payload.type.startsWith('proposal_')) {
              this.refresh();
            }
          }
          this.state.set('loaded');
        } catch {
          /* Ignore malformed frames and keep the last safe snapshot. */
        }
      });
    }
    this.stream.addEventListener('link_expired', () => {
      this.stopStream();
      this.stopPolling();
      this.clearReconnectTimer();
      this.connected.set(false);
      // Con una cuenta ya mostrada, el cierre del enlace es el fin del servicio.
      if (this.progress()) this.finished.set(true);
      else this.state.set('unavailable');
    });
  }
}
