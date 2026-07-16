import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  DateRangePickerComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  TableAction,
  TableColumn,
} from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

import { OrdersService } from '../../../orders/services/orders.service';
import { Order } from '../../../orders/interfaces/order.interface';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';

/**
 * Fila enriquecida para tabla/cards. Extiende Order con campos PLANOS
 * precomputados (customer_name, *_label, *_display). Todos son planos a
 * propósito: app-table gatea el `transform` de una columna tras la existencia
 * de row[key] y el cliente vive en row.users (no row.customer) → un transform
 * sobre key:'customer' nunca corría. Precomputar campos planos evita ese gateo
 * y hace que la moneda sea reactiva zoneless (ver displayRows()).
 */
interface OrderRow extends Order {
  customer_name: string;
  state_label: string;
  channel_label: string;
  delivery_label: string;
  created_display: string;
  items_count: number;
  total_display: string;
  subtotal_display: string;
  tax_display: string;
  discount_display: string;
  shipping_display: string;
}

/**
 * Order step (ref 2026-06-25, plan wizard remisión order-first;
 * rediseño R4b 2026-07-15).
 *
 * Lista las órdenes despachables (state ∈ {processing, pending_payment} +
 * delivery_type ∉ {direct_delivery, dine_in} — consumo en mesa y entrega en
 * mostrador no generan remisión; el backend lo resuelve con dispatchable:true)
 * y deja al operador elegir una.
 *
 * Mejoras del rediseño:
 *  - Más información por orden: #orden, cliente, estado, fecha, total, #ítems,
 *    tipo de entrega y canal.
 *  - Filtros server-side (combinan sin conflicto con dispatchable en el where
 *    del backend): búsqueda con debounce (#orden/cliente), canal y rango de
 *    fechas de creación. Paginación server-side.
 *  - Vista previa: acción "ojo" que despliega un resumen (ítems + desglose)
 *    ANTES de avanzar. El click sobre la fila conserva selecciona→avanza.
 *  - Responsive: tabla en desktop, cards en móvil (ResponsiveDataView).
 *
 * Al seleccionar, el wizard service siembra selectedOrder / customer / items y
 * avanza al paso 1.
 */
@Component({
  selector: 'app-dispatch-wizard-order-step',
  standalone: true,
  imports: [
    DateRangePickerComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  template: `
    <div class="space-y-3">
      <!-- Búsqueda -->
      <app-inputsearch
        placeholder="Buscar por #orden o cliente..."
        [debounceTime]="300"
        (search)="onSearch($event)"
      ></app-inputsearch>

      <!-- Filtros -->
      <div class="flex flex-col md:flex-row md:items-end gap-2 md:gap-3">
        <div class="w-full md:w-52">
          <app-selector
            label="Canal"
            size="sm"
            [options]="channelOptions"
            (valueChange)="onChannelChange($event)"
          ></app-selector>
        </div>

        <app-date-range-picker
          (dateRangeChange)="onDateRangeChange($event)"
        ></app-date-range-picker>

        @if (hasActiveFilters()) {
          <button
            type="button"
            (click)="onClearFilters()"
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-button border border-border text-[var(--color-text-secondary)] hover:bg-[var(--color-muted)]/30 transition-colors self-start md:self-auto"
          >
            <app-icon name="x" [size]="14"></app-icon>
            Limpiar filtros
          </button>
        }
      </div>

      <!-- Feedback de carga -->
      @if (loading()) {
        <div
          class="flex items-center gap-2 py-2 px-1 text-sm text-[var(--color-text-secondary)]"
        >
          <div
            class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
          ></div>
          Buscando órdenes...
        </div>
      }

      @if (!loading() && picking()) {
        <div
          class="flex items-center gap-2 py-2 px-1 text-sm text-[var(--color-text-secondary)]"
        >
          <div
            class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
          ></div>
          Cargando orden...
        </div>
      }

      <!-- Vacío -->
      @if (!loading() && rows().length === 0) {
        <app-empty-state
          icon="inbox"
          [title]="searchPerformed() || hasActiveFilters() ? 'Sin resultados' : 'Sin órdenes despachables'"
          [description]="
            searchPerformed() || hasActiveFilters()
              ? 'Ajusta la búsqueda o los filtros e inténtalo de nuevo.'
              : 'No hay órdenes pendientes de despacho. Se excluyen las de consumo en mesa y entrega directa (no requieren remisión).'
          "
        ></app-empty-state>
      }

      <!-- Listado -->
      @if (rows().length > 0) {
        <app-responsive-data-view
          [data]="rows()"
          [columns]="tableColumns()"
          [cardConfig]="cardConfig()"
          [actions]="actions"
          [loading]="loading()"
          [sortable]="false"
          (rowClick)="onPick($event)"
        ></app-responsive-data-view>

        <app-pagination
          [currentPage]="page()"
          [totalPages]="totalPages()"
          [total]="totalItems()"
          [limit]="limit"
          infoStyle="range"
          (pageChange)="onPageChange($event)"
        ></app-pagination>
      }

      <!-- Vista previa de la orden enfocada -->
      @if (previewOrder(); as p) {
        <div
          class="rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-surface)] shadow-sm overflow-hidden"
        >
          <div
            class="flex items-center justify-between gap-2 px-4 py-3 bg-[var(--color-primary)]/5 border-b border-border"
          >
            <div class="flex items-center gap-2 min-w-0">
              <app-icon
                name="file-text"
                [size]="16"
                class="text-[var(--color-primary)] shrink-0"
              ></app-icon>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                  {{ p.order_number }}
                </p>
                <p class="text-xs text-[var(--color-text-secondary)] truncate">
                  {{ p.customer_name || 'Cliente no registrado' }}
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="closePreview()"
              class="p-1.5 rounded-button text-[var(--color-text-secondary)] hover:bg-[var(--color-muted)]/40 transition-colors shrink-0"
              aria-label="Cerrar vista previa"
            >
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          </div>

          <div class="p-4 space-y-4">
            <!-- Metadatos -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p class="text-xs text-[var(--color-text-secondary)]">Estado</p>
                <p class="font-medium text-[var(--color-text-primary)]">{{ p.state_label }}</p>
              </div>
              <div>
                <p class="text-xs text-[var(--color-text-secondary)]">Fecha</p>
                <p class="font-medium text-[var(--color-text-primary)]">{{ p.created_display }}</p>
              </div>
              <div>
                <p class="text-xs text-[var(--color-text-secondary)]">Entrega</p>
                <p class="font-medium text-[var(--color-text-primary)]">{{ p.delivery_label }}</p>
              </div>
              <div>
                <p class="text-xs text-[var(--color-text-secondary)]">Canal</p>
                <p class="font-medium text-[var(--color-text-primary)]">{{ p.channel_label }}</p>
              </div>
            </div>

            <!-- Ítems -->
            <div>
              <p class="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                Ítems ({{ p.items_count }})
              </p>
              @if (p.order_items && p.order_items.length > 0) {
                <ul class="space-y-1">
                  @for (it of p.order_items; track it.id) {
                    <li
                      class="flex items-center gap-2 text-sm text-[var(--color-text-primary)]"
                    >
                      <span
                        class="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md bg-[var(--color-muted)]/40 text-xs font-semibold"
                      >{{ it.quantity }}×</span>
                      <span class="truncate">{{ it.product_name }}</span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="text-sm text-[var(--color-text-secondary)]">
                  Sin detalle de ítems disponible.
                </p>
              }
            </div>

            <!-- Desglose -->
            <div class="border-t border-border pt-3 space-y-1 text-sm">
              <div class="flex justify-between text-[var(--color-text-secondary)]">
                <span>Subtotal</span><span>{{ p.subtotal_display }}</span>
              </div>
              @if (asNumber(p.discount_amount) > 0) {
                <div class="flex justify-between text-[var(--color-text-secondary)]">
                  <span>Descuento</span><span>- {{ p.discount_display }}</span>
                </div>
              }
              <div class="flex justify-between text-[var(--color-text-secondary)]">
                <span>Impuestos</span><span>{{ p.tax_display }}</span>
              </div>
              @if (asNumber(p.shipping_cost) > 0) {
                <div class="flex justify-between text-[var(--color-text-secondary)]">
                  <span>Envío</span><span>{{ p.shipping_display }}</span>
                </div>
              }
              <div
                class="flex justify-between font-semibold text-[var(--color-text-primary)] pt-1"
              >
                <span>Total</span><span>{{ p.total_display }}</span>
              </div>
            </div>

            <button
              type="button"
              (click)="onPick(p)"
              class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-button bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
              [disabled]="picking()"
            >
              <app-icon name="arrow-right" [size]="16"></app-icon>
              Seleccionar y continuar
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly ordersService = inject(OrdersService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Tamaño de página server-side. */
  readonly limit = 10;

  // --- Estado ---
  readonly loading = signal(false);
  readonly picking = signal(false);
  readonly searchPerformed = signal(false);
  readonly orders = signal<Order[]>([]);
  readonly totalItems = signal(0);
  readonly previewOrderId = signal<number | null>(null);

  // --- Filtros ---
  private readonly search = signal('');
  private readonly channel = signal<string | null>(null);
  private readonly dateFrom = signal<string | null>(null);
  private readonly dateTo = signal<string | null>(null);
  readonly page = signal(1);

  readonly channelOptions: SelectorOption[] = [
    { value: '', label: 'Todos los canales' },
    { value: 'pos', label: 'POS' },
    { value: 'ecommerce', label: 'Tienda online' },
    { value: 'whatsapp', label: 'WhatsApp' },
    { value: 'agent', label: 'Agente IA' },
    { value: 'marketplace', label: 'Marketplace' },
  ];

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit)),
  );

  readonly hasActiveFilters = computed(
    () =>
      !!this.search().trim() ||
      !!this.channel() ||
      (!!this.dateFrom() && !!this.dateTo()),
  );

  /**
   * Filas enriquecidas. Lee currentCurrency() para ser REACTIVO zoneless: al
   * cargar la moneda (async) el computed recorre de nuevo, cambia la referencia
   * del array y ResponsiveDataView re-renderiza los montos ya formateados.
   * Sin esta dependencia explícita los precios quedarían con el fallback "$".
   */
  readonly rows = computed<OrderRow[]>(() => {
    // Dependencia reactiva: no borrar aunque parezca sin uso.
    this.currencyService.currentCurrency();

    return this.orders().map((o: any) => {
      const items = Array.isArray(o?.order_items) ? o.order_items : [];
      const u = o?.users;
      const name = u
        ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()
        : '';

      return {
        ...o,
        customer_name:
          name || (o?.customer_id ? `Cliente #${o.customer_id}` : ''),
        state_label: this.stateLabel(o?.state),
        channel_label: this.channelLabel(o?.channel),
        delivery_label: this.deliveryLabel(o?.delivery_type),
        created_display: o?.created_at ? formatDateOnlyUTC(o.created_at) : '—',
        items_count: items.length,
        total_display: this.currencyService.format(o?.grand_total),
        subtotal_display: this.currencyService.format(o?.subtotal_amount),
        tax_display: this.currencyService.format(o?.tax_amount),
        discount_display: this.currencyService.format(o?.discount_amount),
        shipping_display: this.currencyService.format(o?.shipping_cost),
      } as OrderRow;
    });
  });

  readonly previewOrder = computed<OrderRow | null>(() => {
    const id = this.previewOrderId();
    if (id == null) return null;
    return this.rows().find((r) => r.id === id) ?? null;
  });

  readonly tableColumns = computed<TableColumn[]>(() => [
    { key: 'order_number', label: '#Orden', sortable: false, priority: 1 },
    {
      // Campo PLANO precomputado (ver OrderRow): evita el gateo del transform
      // sobre row.users y sirve al card (subtitleKey) sin transform.
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
      badge: true,
      badgeConfig: { type: 'custom', colorMap: this.stateColorMap, size: 'sm' },
      badgeTransform: (v: string) => this.stateLabel(v),
    },
    {
      key: 'created_display',
      label: 'Fecha',
      sortable: false,
      priority: 3,
    },
    {
      key: 'items_count',
      label: 'Ítems',
      sortable: false,
      priority: 3,
      align: 'center',
    },
    {
      key: 'delivery_label',
      label: 'Entrega',
      sortable: false,
      priority: 3,
    },
    {
      key: 'total_display',
      label: 'Total',
      sortable: false,
      priority: 2,
      align: 'right',
    },
  ]);

  readonly cardConfig = computed<ItemListCardConfig>(() => ({
    titleKey: 'order_number',
    subtitleKey: 'customer_name',
    badgeKey: 'state',
    badgeConfig: { type: 'custom', colorMap: this.stateColorMap, size: 'sm' },
    badgeTransform: (v: string) => this.stateLabel(v),
    detailKeys: [
      { key: 'items_count', label: 'Ítems', icon: 'package' },
      { key: 'delivery_label', label: 'Entrega', icon: 'truck' },
      { key: 'created_display', label: 'Fecha', icon: 'calendar' },
      { key: 'channel_label', label: 'Canal', icon: 'store' },
    ],
    footerKey: 'total_display',
    footerLabel: 'Total',
    footerStyle: 'prominent',
  }));

  /** Acción de vista previa. stopPropagation en tabla/cards evita que también
   * dispare rowClick (verificado en table/item-list), así el ojo NO avanza. */
  readonly actions: TableAction[] = [
    {
      label: 'Vista previa',
      icon: 'eye',
      variant: 'ghost',
      tooltip: 'Ver resumen de la orden',
      action: (item: OrderRow) => this.togglePreview(item),
    },
  ];

  /**
   * colorMap requiere hex de 7 chars (las clases Tailwind no componen inline
   * en el badge custom — ref reference_data_display_badge_colormap).
   */
  private readonly stateColorMap: Record<string, string> = {
    processing: '#3b82f6',
    pending_payment: '#f59e0b',
    shipped: '#6366f1',
    delivered: '#22c55e',
  };

  constructor() {
    // Precarga la moneda del tenant (mismo patrón que CurrencyPipe) para que
    // rows() disponga del formato correcto lo antes posible.
    this.currencyService.loadCurrency();
    // Carga la primera página de despachables al montar.
    this.fetch();
  }

  onSearch(query: string): void {
    this.searchPerformed.set(!!query && !!query.trim());
    this.search.set(query ?? '');
    this.page.set(1);
    this.closePreview();
    this.fetch();
  }

  onChannelChange(value: string | number | null): void {
    const v = value != null && value !== '' ? String(value) : null;
    this.channel.set(v);
    this.page.set(1);
    this.closePreview();
    this.fetch();
  }

  onDateRangeChange(range: { from: string | null; to: string | null }): void {
    this.dateFrom.set(range.from);
    this.dateTo.set(range.to);
    this.page.set(1);
    this.closePreview();
    // El backend exige AMBOS extremos (date_from && date_to). Si solo hay uno,
    // esperamos al segundo: refrescamos sin filtro de fecha (o ninguno).
    const partial =
      (!!range.from && !range.to) || (!range.from && !!range.to);
    if (partial) return;
    this.fetch();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.closePreview();
    this.fetch();
  }

  onClearFilters(): void {
    this.search.set('');
    this.channel.set(null);
    this.dateFrom.set(null);
    this.dateTo.set(null);
    this.searchPerformed.set(false);
    this.page.set(1);
    this.closePreview();
    this.fetch();
  }

  togglePreview(order: Order): void {
    if (!order?.id) return;
    this.previewOrderId.set(
      this.previewOrderId() === order.id ? null : order.id,
    );
  }

  closePreview(): void {
    this.previewOrderId.set(null);
  }

  onPick(order: Order): void {
    if (!order?.id) return;
    this.picking.set(true);
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
          const resolved = (full as any)?.data ?? full;
          this.wizardService.setSelectedOrder(resolved);
          this.wizardService.nextStep();
          this.picking.set(false);
        },
        error: () => {
          this.picking.set(false);
        },
      });
  }

  /** Cast defensivo: los montos pueden llegar como Decimal-string del backend. */
  asNumber(value: unknown): number {
    return Number(value) || 0;
  }

  private fetch(): void {
    this.loading.set(true);
    const bothDates = !!this.dateFrom() && !!this.dateTo();
    this.ordersService
      .getOrders({
        dispatchable: true,
        search: this.search().trim() || undefined,
        channel: (this.channel() as any) || undefined,
        // Backend: created_at BETWEEN date_from AND date_to (ambos requeridos).
        // date_to se extiende a fin de día para que el rango sea inclusivo.
        date_from: bothDates ? this.dateFrom()! : undefined,
        date_to: bothDates ? `${this.dateTo()}T23:59:59.999` : undefined,
        page: this.page(),
        limit: this.limit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          // OrdersService.getOrders ya desenvuelve el envelope
          // { success, data: { data: Order[], pagination } } → { data: Order[],
          // pagination }. Aquí sólo necesitamos proyección segura.
          const list = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res)
            ? res
            : [];
          const total = Number(res?.pagination?.total ?? list.length);
          this.orders.set(list);
          this.totalItems.set(total || 0);
          this.loading.set(false);
        },
        error: () => {
          this.orders.set([]);
          this.totalItems.set(0);
          this.loading.set(false);
        },
      });
  }

  private stateLabel(state?: string): string {
    const map: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pago pendiente',
      processing: 'En proceso',
      shipped: 'Enviada',
      delivered: 'Entregada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
      finished: 'Finalizada',
    };
    return (state && map[state]) || state || '—';
  }

  private channelLabel(channel?: string): string {
    const map: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'Tienda online',
      agent: 'Agente IA',
      whatsapp: 'WhatsApp',
      marketplace: 'Marketplace',
    };
    return (channel && map[channel]) || channel || '—';
  }

  private deliveryLabel(type?: string): string {
    const map: Record<string, string> = {
      pickup: 'Recoge en tienda',
      home_delivery: 'Envío a domicilio',
      direct_delivery: 'Entrega directa',
      other: 'Otro',
    };
    return (type && map[type]) || type || '—';
  }
}
