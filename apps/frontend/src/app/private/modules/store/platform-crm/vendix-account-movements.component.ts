import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
} from '../../../../shared/components';
import type { BadgeVariant } from '../../../../shared/components/badge/badge.component';
import { PlatformCrmService } from './platform-crm.service';
import {
  CoveredStore,
  SubscriptionMetrics,
  SubscriptionMovement,
  SubscriptionMovementType,
  SubscriptionMovementsView,
  eventTypeLabel,
  formatMoneyAmount,
  formatMoneyList,
  invoiceStateLabel,
  paymentStateLabel,
  subscriptionStateLabel,
} from './platform-crm.interface';

const PAGE_SIZE = 20;

type LoadState = 'loading' | 'ready' | 'error';

function formatDay(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

const TYPE_OPTIONS: SelectorOption[] = [
  { value: '', label: 'Todos los movimientos' },
  { value: 'invoice', label: 'Facturas' },
  { value: 'payment', label: 'Pagos' },
  { value: 'event', label: 'Cambios de plan y estado' },
];

const TYPE_ICONS: Record<SubscriptionMovementType, string> = {
  invoice: 'file-text',
  payment: 'credit-card',
  event: 'refresh-cw',
};

const STATE_VARIANTS: Record<string, BadgeVariant> = {
  paid: 'success',
  succeeded: 'success',
  issued: 'info',
  pending: 'warning',
  overdue: 'error',
  failed: 'error',
  refunded_chargeback: 'error',
  void: 'neutral',
  refunded: 'neutral',
  partial_refund: 'warning',
};

/**
 * Cuenta Vendix · «Movimientos de la suscripción» de las cuentas enlazadas
 * (D1, D3): métricas arriba y la lista de facturas, pagos y cambios de plan o
 * estado, con filtro por comercio y por tipo y «Ver más».
 *
 * Solo lectura: son movimientos de la plataforma y no tocan la contabilidad de
 * la tienda Vendix Platform. `reloadKey` cambia cuando se enlaza o desenlaza
 * una cuenta: la lista vuelve a empezar.
 */
@Component({
  selector: 'app-vendix-account-movements',
  standalone: true,
  imports: [BadgeComponent, ButtonComponent, IconComponent, SelectorComponent, SpinnerComponent],
  template: `
    <section class="flex flex-col gap-3" data-testid="vendix-account-movements">
      <div class="flex flex-col gap-0.5">
        <h4 class="text-sm font-semibold text-text-primary">Movimientos de la suscripción</h4>
        <p class="text-xs text-text-secondary">
          Movimientos de la plataforma. No afectan la contabilidad de esta tienda.
        </p>
      </div>

      @if (state() === 'loading' && !view()) {
        <div class="flex justify-center py-4"><app-spinner size="sm"></app-spinner></div>
      } @else if (state() === 'error' && !view()) {
        <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
          <span>No pudimos cargar los movimientos.</span>
          <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
        </div>
      } @else if (view(); as current) {
        @if (metrics(); as m) {
          <div class="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="vendix-account-metrics">
            <div class="rounded-lg border border-border bg-surface px-3 py-2">
              <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Total pagado (12 meses)
              </span>
              <span class="block text-sm font-semibold text-text-primary">{{ moneyList(m.total_paid) }}</span>
            </div>
            <div class="rounded-lg border border-border bg-surface px-3 py-2">
              <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Último pago
              </span>
              <span class="block text-sm font-semibold text-text-primary">
                @if (m.last_payment; as last) {
                  {{ money(last.amount, last.currency) }} · {{ day(last.date) }}
                } @else {
                  —
                }
              </span>
            </div>
            <div class="rounded-lg border border-border bg-surface px-3 py-2">
              <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                Próxima renovación
              </span>
              <span class="block text-sm font-semibold text-text-primary">
                {{ m.next_renewal_at ? day(m.next_renewal_at) : '—' }}
              </span>
            </div>
            <div class="rounded-lg border border-border bg-surface px-3 py-2">
              <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                En mora
              </span>
              <span
                class="block text-sm font-semibold"
                [class.text-error]="m.overdue_count > 0"
                [class.text-text-primary]="m.overdue_count === 0"
              >
                @if (m.overdue_count > 0) {
                  {{ m.overdue_count }} {{ m.overdue_count === 1 ? 'factura' : 'facturas' }} ·
                  {{ moneyList(m.overdue_balance) }}
                } @else {
                  Al día
                }
              </span>
            </div>
          </div>
          <p class="text-xs text-text-secondary">
            Valor mensual actual: <span class="font-medium text-text-primary">{{ moneyList(m.monthly_value) }}</span>
          </p>
        }

        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <app-selector
            size="sm"
            [options]="storeOptions()"
            [value]="storeFilter()"
            (valueChange)="onStoreChange($event)"
          ></app-selector>
          <app-selector
            size="sm"
            [options]="typeOptions"
            [value]="typeFilter()"
            (valueChange)="onTypeChange($event)"
          ></app-selector>
        </div>

        @if (state() === 'loading') {
          <div class="flex justify-center py-3"><app-spinner size="sm"></app-spinner></div>
        } @else {
          <ul class="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            @for (item of items(); track item.key) {
              <li class="flex items-start gap-3 px-3 py-2 text-sm" data-testid="vendix-account-movement">
                <span class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <app-icon [name]="icon(item)" [size]="14"></app-icon>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-text-primary">{{ title(item) }}</span>
                  <span class="block truncate text-xs text-text-secondary">
                    {{ day(item.date) }} · {{ item.store_name }}{{ detail(item) }}
                  </span>
                </span>
                <span class="flex shrink-0 flex-col items-end gap-1">
                  @if (amountText(item); as amount) {
                    <span class="font-semibold text-text-primary">{{ amount }}</span>
                  }
                  @if (stateText(item); as label) {
                    <app-badge [variant]="stateVariant(item)" size="xs">{{ label }}</app-badge>
                  }
                </span>
              </li>
            } @empty {
              <li class="px-3 py-4 text-center text-sm text-text-secondary">
                Sin movimientos en los últimos 12 meses.
              </li>
            }
          </ul>
          @if (current.pagination.has_more) {
            <div class="flex justify-center">
              <app-button variant="outline" size="sm" [loading]="loadingMore()" (clicked)="loadMore()">
                Ver más
              </app-button>
            </div>
          }
        }
      }
    </section>
  `,
})
export class VendixAccountMovementsComponent {
  private readonly service = inject(PlatformCrmService);

  readonly customerId = input.required<number>();
  /** Cambia al enlazar o desenlazar una cuenta: recarga desde la primera página. */
  readonly reloadKey = input<string>('');
  /** Comercios cubiertos (para el selector de la sección Actividad). */
  readonly storesLoaded = output<CoveredStore[]>();

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly state = signal<LoadState>('loading');
  protected readonly view = signal<SubscriptionMovementsView | null>(null);
  protected readonly items = signal<SubscriptionMovement[]>([]);
  protected readonly loadingMore = signal(false);
  /** `''` = todos. */
  protected readonly storeFilter = signal<number | ''>('');
  protected readonly typeFilter = signal<SubscriptionMovementType | ''>('');

  protected readonly storeOptions = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todos los comercios' },
    ...(this.view()?.stores ?? []).map((store) => {
      const state = subscriptionStateLabel(store.subscription_state);
      return {
        value: store.store_id,
        label: store.store_name,
        description: [store.organization_name, store.plan_name, state].filter(Boolean).join(' · '),
      };
    }),
  ]);

  /** Métricas del comercio elegido o el total. */
  protected readonly metrics = computed<SubscriptionMetrics | null>(() => {
    const current = this.view();
    if (!current) return null;
    const storeId = this.storeFilter();
    if (storeId === '') return current.summary.total;
    return current.summary.by_store.find((s) => s.store_id === storeId) ?? current.summary.total;
  });

  /** Solo la respuesta de la última petición pinta. */
  private seq = 0;

  constructor() {
    effect(() => {
      const id = this.customerId();
      this.reloadKey();
      untracked(() => {
        this.storeFilter.set('');
        this.typeFilter.set('');
        void this.load(id, 1, false);
      });
    });
  }

  protected reload(): void {
    void this.load(this.customerId(), 1, false);
  }

  protected loadMore(): void {
    const current = this.view();
    if (!current?.pagination.has_more || this.loadingMore()) return;
    void this.load(this.customerId(), current.pagination.page + 1, true);
  }

  protected onStoreChange(value: string | number | null): void {
    this.storeFilter.set(value === '' || value === null ? '' : Number(value));
    this.reload();
  }

  protected onTypeChange(value: string | number | null): void {
    this.typeFilter.set(value ? (value as SubscriptionMovementType) : '');
    this.reload();
  }

  private async load(customerId: number, page: number, append: boolean): Promise<void> {
    const seq = ++this.seq;
    if (append) this.loadingMore.set(true);
    else this.state.set('loading');
    const store = this.storeFilter();
    const type = this.typeFilter();
    try {
      const view = await firstValueFrom(
        this.service.getSubscriptionMovements(customerId, {
          page,
          limit: PAGE_SIZE,
          ...(store !== '' ? { store_id: store } : {}),
          ...(type ? { type } : {}),
        }),
      );
      if (seq !== this.seq) return;
      this.view.set(view);
      this.items.set(append ? [...this.items(), ...view.items] : view.items);
      if (!append) this.storesLoaded.emit(view.stores);
      this.state.set('ready');
    } catch {
      if (seq !== this.seq) return;
      if (!append) this.items.set([]);
      this.state.set(append ? 'ready' : 'error');
    } finally {
      if (seq === this.seq) this.loadingMore.set(false);
    }
  }

  protected icon(item: SubscriptionMovement): string {
    return TYPE_ICONS[item.type];
  }

  protected title(item: SubscriptionMovement): string {
    if (item.type === 'invoice') return `Factura ${item.invoice_number ?? ''}`.trim();
    if (item.type === 'payment') return item.state === 'failed' ? 'Pago fallido' : 'Pago';
    if (item.event_type === 'plan_changed' && (item.from_plan_name || item.to_plan_name)) {
      return `Cambio de plan: ${item.from_plan_name ?? '—'} → ${item.to_plan_name ?? '—'}`;
    }
    if (item.from_state || item.to_state) {
      return `${eventTypeLabel(item.event_type)}: ${subscriptionStateLabel(item.from_state) || '—'} → ${subscriptionStateLabel(item.to_state) || '—'}`;
    }
    return eventTypeLabel(item.event_type);
  }

  protected detail(item: SubscriptionMovement): string {
    if (item.type === 'invoice' && item.due_at && item.state !== 'paid') {
      return ` · vence ${formatDay(item.due_at)}`;
    }
    if (item.type === 'payment' && item.failure_reason) return ` · ${item.failure_reason}`;
    if (item.type === 'payment' && item.payment_method) return ` · ${item.payment_method}`;
    return '';
  }

  protected amountText(item: SubscriptionMovement): string {
    if (item.type === 'invoice') return formatMoneyAmount(item.total, item.currency);
    if (item.type === 'payment') return formatMoneyAmount(item.amount, item.currency);
    return '';
  }

  protected stateText(item: SubscriptionMovement): string {
    if (item.type === 'invoice') return invoiceStateLabel(item.state);
    if (item.type === 'payment') return paymentStateLabel(item.state);
    return '';
  }

  protected stateVariant(item: SubscriptionMovement): BadgeVariant {
    return (item.state && STATE_VARIANTS[item.state]) || 'neutral';
  }

  protected money(amount: number, currency: string): string {
    return formatMoneyAmount(amount, currency);
  }

  protected moneyList = formatMoneyList;

  protected day(iso: string | null | undefined): string {
    return formatDay(iso);
  }
}
