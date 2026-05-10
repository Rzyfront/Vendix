import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import {
  SubscriptionEventType,
  SubscriptionTimelineEvent,
} from '../../interfaces/store-subscription.interface';

interface EventTypeOption {
  value: SubscriptionEventType | '';
  label: string;
}

interface EventTypeMeta {
  icon: string;
  color: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'gray';
}

/**
 * S3.3 — Customer-facing subscription events timeline.
 *
 * Activity-feed vertical layout with:
 *  - icon contextual por tipo
 *  - título humano + descripción contextual
 *  - timestamp absoluto (UTC-safe via DatePipe) + relativo
 *  - filtro por tipo (single-select)
 *  - paginación cursor-based ("Cargar más")
 *
 * El backend NO expone `triggered_by_user_id`. Sólo recibimos
 * `triggered_by: 'user'|'system'|'cron'`.
 */
@Component({
  selector: 'app-subscription-timeline',
  standalone: true,
  imports: [
    DatePipe,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full min-h-full">
      <app-sticky-header
        title="Historial de mi suscripción"
        subtitle="Eventos importantes (pagos, cambios de plan, renovaciones)"
        icon="history"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/subscription"
      ></app-sticky-header>

      <div class="max-w-4xl mx-auto px-4 py-6 lg:py-8 space-y-5">
        <!-- Filtro por tipo -->
        <app-card>
          <div class="p-4 flex items-center gap-3 flex-wrap">
            <label
              for="type-filter"
              class="text-sm font-semibold text-text-primary shrink-0"
            >
              Filtrar:
            </label>
            <select
              id="type-filter"
              class="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              [value]="typeFilter()"
              (change)="onTypeFilterChange($any($event.target).value)"
            >
              @for (opt of typeOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
            @if (typeFilter()) {
              <button
                type="button"
                class="text-xs text-primary-600 font-semibold hover:underline shrink-0"
                (click)="onTypeFilterChange('')"
              >
                Limpiar
              </button>
            }
          </div>
        </app-card>

        <!-- Loading inicial -->
        @if (loading() && events().length === 0) {
          <div class="space-y-3 animate-pulse" aria-busy="true">
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <div class="h-24 bg-gray-200 rounded-xl"></div>
            }
          </div>
        }

        <!-- Empty state -->
        @if (!loading() && events().length === 0) {
          <app-empty-state
            icon="history"
            iconColor="primary"
            title="Sin eventos todavía"
            [description]="
              typeFilter()
                ? 'No hay eventos de este tipo. Prueba quitando el filtro.'
                : 'Aún no se han registrado eventos en tu suscripción.'
            "
          ></app-empty-state>
        }

        <!-- Timeline (activity feed vertical) -->
        @if (events().length > 0) {
          <ol class="relative border-s-2 border-gray-200 ms-4 space-y-4">
            @for (e of events(); track e.id) {
              <li class="ms-6">
                <span
                  class="absolute -start-3.5 flex items-center justify-center w-7 h-7 rounded-full ring-4 ring-white"
                  [class]="iconBgClass(e.type)"
                >
                  <app-icon
                    [name]="iconFor(e.type)"
                    [size]="14"
                    [class]="iconFgClass(e.type)"
                  ></app-icon>
                </span>

                <app-card>
                  <div class="p-4 space-y-2">
                    <div class="flex items-start justify-between gap-3 flex-wrap">
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-bold text-text-primary leading-snug">
                          {{ titleFor(e) }}
                        </p>
                        @if (descriptionFor(e); as desc) {
                          <p class="text-xs text-text-secondary mt-1 leading-relaxed">
                            {{ desc }}
                          </p>
                        }
                      </div>
                      <span
                        class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0"
                        [class]="badgeClass(e.triggered_by)"
                      >
                        {{ triggeredByLabel(e.triggered_by) }}
                      </span>
                    </div>
                    <div class="flex items-center gap-2 text-[11px] text-text-secondary pt-1 border-t border-gray-100">
                      <app-icon name="clock" [size]="12"></app-icon>
                      <span>{{ relativeTime(e.created_at) }}</span>
                      <span class="text-gray-300">•</span>
                      <span>{{ e.created_at | date: 'medium' }}</span>
                    </div>
                  </div>
                </app-card>
              </li>
            }
          </ol>

          <!-- Cargar más -->
          @if (nextCursor()) {
            <div class="flex justify-center pt-2">
              <button
                type="button"
                class="px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                [disabled]="loading()"
                (click)="loadMore()"
              >
                @if (loading()) {
                  Cargando...
                } @else {
                  Cargar más
                }
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class SubscriptionTimelineComponent implements OnInit {
  private service = inject(StoreSubscriptionService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  readonly events = signal<SubscriptionTimelineEvent[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal(false);
  readonly typeFilter = signal<SubscriptionEventType | ''>('');

  readonly typeOptions: EventTypeOption[] = [
    { value: '', label: 'Todos los eventos' },
    { value: 'created', label: 'Creación' },
    { value: 'activated', label: 'Activaciones' },
    { value: 'renewed', label: 'Renovaciones' },
    { value: 'trial_started', label: 'Inicio de prueba' },
    { value: 'trial_ended', label: 'Fin de prueba' },
    { value: 'payment_succeeded', label: 'Pagos confirmados' },
    { value: 'payment_failed', label: 'Pagos rechazados' },
    { value: 'state_transition', label: 'Cambios de estado' },
    { value: 'plan_changed', label: 'Cambios de plan' },
    { value: 'cancelled', label: 'Cancelaciones' },
    { value: 'reactivated', label: 'Reactivaciones' },
    { value: 'promotional_applied', label: 'Cupones aplicados' },
    { value: 'partner_override_applied', label: 'Configuración partner' },
    { value: 'partner_commission_accrued', label: 'Comisión acumulada' },
    { value: 'partner_commission_paid', label: 'Comisión pagada' },
    { value: 'scheduled_cancel', label: 'Cancelación programada' },
  ];

  private readonly typeMeta: Record<SubscriptionEventType, EventTypeMeta> = {
    created: { icon: 'sparkles', color: 'blue' },
    activated: { icon: 'check-circle', color: 'green' },
    renewed: { icon: 'refresh-cw', color: 'green' },
    trial_started: { icon: 'clock', color: 'amber' },
    trial_ended: { icon: 'clock', color: 'amber' },
    payment_succeeded: { icon: 'credit-card', color: 'green' },
    payment_failed: { icon: 'alert-triangle', color: 'red' },
    state_transition: { icon: 'repeat', color: 'blue' },
    plan_changed: { icon: 'arrow-right', color: 'purple' },
    cancelled: { icon: 'x-circle', color: 'red' },
    reactivated: { icon: 'rotate-ccw', color: 'green' },
    promotional_applied: { icon: 'gift', color: 'purple' },
    partner_override_applied: { icon: 'briefcase', color: 'blue' },
    partner_commission_accrued: { icon: 'piggy-bank', color: 'gray' },
    partner_commission_paid: { icon: 'dollar-sign', color: 'gray' },
    scheduled_cancel: { icon: 'calendar-x', color: 'amber' },
  };

  ngOnInit(): void {
    this.fetchFirstPage();
  }

  // ─── Pagination ───────────────────────────────────────────────────────

  fetchFirstPage(): void {
    this.events.set([]);
    this.nextCursor.set(null);
    this.fetch(undefined);
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loading()) return;
    this.fetch(cursor);
  }

  private fetch(cursor: string | undefined): void {
    this.loading.set(true);
    const type = this.typeFilter() || undefined;
    this.service
      .getEventsTimeline({ limit: 50, cursor, type })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resp) => {
          const payload = resp?.data;
          if (payload) {
            this.events.update((curr) => [...curr, ...payload.data]);
            this.nextCursor.set(payload.next_cursor ?? null);
          }
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('No se pudo cargar el historial');
          this.loading.set(false);
        },
      });
  }

  onTypeFilterChange(value: string): void {
    this.typeFilter.set((value as SubscriptionEventType) || '');
    this.fetchFirstPage();
  }

  // ─── Mappers ──────────────────────────────────────────────────────────

  iconFor(type: SubscriptionEventType): string {
    return this.typeMeta[type]?.icon ?? 'circle';
  }

  iconBgClass(type: SubscriptionEventType): string {
    const c = this.typeMeta[type]?.color ?? 'gray';
    const map: Record<EventTypeMeta['color'], string> = {
      green: 'bg-green-100',
      amber: 'bg-amber-100',
      red: 'bg-red-100',
      blue: 'bg-blue-100',
      purple: 'bg-purple-100',
      gray: 'bg-gray-100',
    };
    return map[c];
  }

  iconFgClass(type: SubscriptionEventType): string {
    const c = this.typeMeta[type]?.color ?? 'gray';
    const map: Record<EventTypeMeta['color'], string> = {
      green: 'text-green-600',
      amber: 'text-amber-600',
      red: 'text-red-600',
      blue: 'text-blue-600',
      purple: 'text-purple-600',
      gray: 'text-gray-600',
    };
    return map[c];
  }

  badgeClass(triggered: 'user' | 'system' | 'cron'): string {
    if (triggered === 'user') return 'bg-blue-100 text-blue-700';
    if (triggered === 'cron') return 'bg-purple-100 text-purple-700';
    return 'bg-gray-100 text-gray-700';
  }

  triggeredByLabel(triggered: 'user' | 'system' | 'cron'): string {
    if (triggered === 'user') return 'Manual';
    if (triggered === 'cron') return 'Automático';
    return 'Sistema';
  }

  /**
   * Spanish human title — uses payload bits when available.
   * NOTE: payload may be `null`, an arbitrary object, or arrays. Defensive.
   */
  titleFor(e: SubscriptionTimelineEvent): string {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'created':
        return 'Suscripción creada';
      case 'activated':
        return 'Suscripción activada';
      case 'renewed': {
        const start = this.shortDate(p['period_start'] as string | undefined);
        const end = this.shortDate(p['period_end'] as string | undefined);
        if (start && end) return `Renovación período ${start}–${end}`;
        return 'Renovación de período';
      }
      case 'trial_started':
        return 'Periodo de prueba iniciado';
      case 'trial_ended':
        return 'Fin del periodo de prueba';
      case 'payment_succeeded': {
        const inv = p['invoice_number'] as string | undefined;
        return inv ? `Pago confirmado: factura ${inv}` : 'Pago confirmado';
      }
      case 'payment_failed': {
        const reason = (p['reason'] as string | undefined) ?? 'sin detalle';
        return `Pago rechazado: ${reason}`;
      }
      case 'state_transition': {
        const reason = p['reason'] as string | undefined;
        if (reason === 'consecutive_failures_threshold') {
          const brand = p['brand'] as string | undefined;
          const last4 = p['last_four'] as string | undefined;
          const card = brand && last4 ? `${brand} •••• ${last4}` : 'tu tarjeta';
          return `Tarjeta desactivada por fallos repetidos: ${card}`;
        }
        const from = this.stateLabel(e.from_state);
        const to = this.stateLabel(e.to_state);
        return `Estado cambió de ${from} a ${to}`;
      }
      case 'plan_changed': {
        const oldPlan =
          (p['old_plan'] as string | undefined) ??
          (p['old_plan_code'] as string | undefined) ??
          '—';
        const newPlan =
          (p['new_plan'] as string | undefined) ??
          (p['new_plan_code'] as string | undefined) ??
          '—';
        return `Cambio de plan: ${oldPlan} → ${newPlan}`;
      }
      case 'cancelled':
        return 'Suscripción cancelada';
      case 'reactivated':
        return 'Suscripción reactivada';
      case 'promotional_applied': {
        const code = p['redemption_code'] as string | undefined;
        const dur = p['duration_days'] as number | string | undefined;
        if (code && dur !== undefined) {
          return `Cupón aplicado: ${code} (${dur} días)`;
        }
        return code ? `Cupón aplicado: ${code}` : 'Cupón aplicado';
      }
      case 'partner_override_applied':
        return 'Configuración partner aplicada';
      case 'partner_commission_accrued':
        return 'Comisión partner acumulada';
      case 'partner_commission_paid':
        return 'Comisión partner pagada';
      case 'scheduled_cancel': {
        const at = this.shortDate(p['scheduled_at'] as string | undefined);
        return at
          ? `Cancelación programada para ${at}`
          : 'Cancelación programada';
      }
      default:
        return e.type;
    }
  }

  /**
   * Optional context line. Pulls a `reason` or fallback bits from payload.
   */
  descriptionFor(e: SubscriptionTimelineEvent): string | null {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const reason = p['reason'] as string | undefined;
    if (reason && e.type !== 'payment_failed') {
      return `Motivo: ${reason}`;
    }
    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private stateLabel(state: string | null): string {
    if (!state) return '—';
    const map: Record<string, string> = {
      draft: 'Borrador',
      trial: 'Prueba',
      active: 'Activa',
      past_due: 'Vencida',
      pending_payment: 'Pago pendiente',
      grace_soft: 'En gracia',
      grace_hard: 'Gracia final',
      suspended: 'Suspendida',
      blocked: 'Bloqueada',
      cancelled: 'Cancelada',
      expired: 'Expirada',
    };
    return map[state] ?? state;
  }

  private shortDate(iso: string | undefined): string | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // UTC-safe short date display (skill vendix-date-timezone).
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Lightweight relative time formatter (no external deps).
   */
  relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const diffMs = Date.now() - then;
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return 'hace unos segundos';
    const min = Math.floor(sec / 60);
    if (min < 60) return `hace ${min} ${min === 1 ? 'minuto' : 'minutos'}`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `hace ${hr} ${hr === 1 ? 'hora' : 'horas'}`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `hace ${day} ${day === 1 ? 'día' : 'días'}`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `hace ${mo} ${mo === 1 ? 'mes' : 'meses'}`;
    const yr = Math.floor(mo / 12);
    return `hace ${yr} ${yr === 1 ? 'año' : 'años'}`;
  }
}
