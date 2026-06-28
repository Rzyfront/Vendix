import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  EmptyStateComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableColumn,
} from '../../../../../../shared/components';

import { OrdersService } from '../../../orders/services/orders.service';
import { Order } from '../../../orders/interfaces/order.interface';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';

/**
 * Order step (ref 2026-06-25, plan wizard remisión order-first).
 *
 * Lists the orders that are dispatchable (state=processing +
 * delivery_type ∈ {home_delivery, pickup}) and lets the operator pick one.
 * On selection the wizard service seeds:
 *   - `selectedOrder`
 *   - `customer` (from order.users)
 *   - `items` (one WizardItem per order_item)
 * and advances the wizard to step 1.
 */
@Component({
  selector: 'app-dispatch-wizard-order-step',
  standalone: true,
  imports: [
    EmptyStateComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="space-y-2">
      <app-inputsearch
        placeholder="Buscar por #orden o cliente..."
        [debounceTime]="300"
        (search)="onSearch($event)"
      ></app-inputsearch>

      @if (loading()) {
        <div class="flex items-center gap-2 py-2 px-1 text-sm text-[var(--color-text-secondary)]">
          <div
            class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
          ></div>
          Buscando órdenes...
        </div>
      }

      @if (!loading() && orders().length === 0) {
        <app-empty-state
          icon="inbox"
          [title]="searchPerformed() ? 'Sin resultados' : 'Sin órdenes despachables'"
          [description]="
            searchPerformed()
              ? 'Intenta con otro término de búsqueda.'
              : 'No hay órdenes en estado processing con delivery_type home_delivery o pickup.'
          "
        ></app-empty-state>
      }

      @if (orders().length > 0) {
        <app-responsive-data-view
          [data]="orders()"
          [columns]="tableColumns()"
          [cardConfig]="cardConfig()"
          [loading]="loading()"
          [sortable]="false"
          (rowClick)="onPick($event)"
        ></app-responsive-data-view>
      }
    </div>
  `,
})
export class OrderStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly ordersService = inject(OrdersService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly searchPerformed = signal(false);
  readonly orders = signal<Order[]>([]);

  readonly tableColumns = computed<TableColumn[]>(() => [
    { key: 'order_number', label: '#Orden', sortable: false, priority: 1 },
    {
      // Campo PLANO precomputado en fetch(): app-table gatea el transform tras
      // la existencia de row[key], y el cliente vive en row.users (no row.customer)
      // → un transform sobre key:'customer' nunca corría. customer_name evita el
      // gateo y sirve también al card (subtitleKey) sin transform.
      key: 'customer_name',
      label: 'Cliente',
      sortable: false,
      priority: 1,
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: false,
      priority: 2,
      transform: (v: string) => v ?? '—',
    },
    {
      key: 'grand_total',
      label: 'Total',
      sortable: false,
      priority: 2,
      align: 'right',
      transform: (v: any) => this.formatCurrency(v),
    },
    {
      key: 'delivery_type',
      label: 'Entrega',
      sortable: false,
      priority: 3,
      transform: (v: string) => v ?? '—',
    },
  ]);

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'order_number',
    subtitleKey: 'customer_name',
    badgeKey: 'state',
    // No actions — clicking the card picks the order.
    actions: [],
  }));

  constructor() {
    // Load the latest dispatchable orders on mount.
    this.fetch('');
  }

  onSearch(query: string): void {
    this.searchPerformed.set(!!query && !!query.trim());
    this.fetch(query);
  }

  onPick(order: Order): void {
    if (!order?.id) return;
    this.loading.set(true);
    this.ordersService
      .getOrderById(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (full) => {
          // getOrderById está tipado Observable<Order> pero en runtime emite
          // el envelope { success, message, data: Order } (mismo patrón que la
          // lista). Sin desenvolver, setSelectedOrder guardaría el sobre y
          // selectedOrder.order_items quedaría undefined → el paso Items se
          // rompe y el wizard no avanza. Igual que order-details-page:1104.
          const order = (full as any)?.data ?? full;
          this.wizardService.setSelectedOrder(order);
          this.wizardService.nextStep();
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  private fetch(query: string): void {
    this.loading.set(true);
    this.ordersService
      .getOrders({
        dispatchable: true,
        search: query?.trim() || undefined,
        limit: 20,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          // El envelope real es { success, message, data: { data: Order[],
          // pagination } } (curl-verified; PaginatedOrdersResponse miente: no
          // hay interceptor que desenvuelva el sobre). El array vive en
          // res.data.data; fallback a res.data por si algún día se aplana.
          const list = res?.data?.data ?? res?.data ?? [];
          // Aplana el nombre del cliente a un campo plano (customer_name) que
          // tabla y card consumen directo. La relación users solo viene si el
          // backend la incluye (findAll la trae con select ligero); guests
          // (customer_id null) quedan con cadena vacía → la celda muestra vacío.
          const orders = (Array.isArray(list) ? list : []).map((o: any) => {
            const u = o?.users;
            const name = u
              ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()
              : '';
            return {
              ...o,
              customer_name: name || (o?.customer_id ? `Cliente #${o.customer_id}` : ''),
            };
          });
          this.orders.set(orders);
          this.loading.set(false);
        },
        error: () => {
          this.orders.set([]);
          this.loading.set(false);
        },
      });
  }

  private formatCurrency(value: any): string {
    const n = typeof value === 'string' ? parseFloat(value) : value ?? 0;
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(n);
  }
}
