import {Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';

import {
  TableColumn,
  TableAction,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  ButtonComponent,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { StoreOrdersService } from '../../services/store-orders.service';
import { CustomersService } from '../../../../store/customers/services/customers.service';
// Carril B - B2: el dropdown del filtro por mesa se llena con
// GET /store/tables via TablesService. Si la tienda no tiene mesas,
// el filtro no se pinta (mayoria de tiendas de Vendix no son restaurante).
import { TablesService } from '../../../restaurant-ops/tables/services/tables.service';
import { Table } from '../../../restaurant-ops/tables/interfaces/table.interface';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  Order,
  OrderQuery,
  OrderState,
  OrderChannel,
  PaymentStatus,
} from '../../interfaces/order.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { OrderPrintService } from '../../services/order-print.service';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
    IconComponent,
    ButtonComponent,
    PaginationComponent,
    CardComponent,
  ],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent {
  private currencyService = inject(CurrencyFormatService);
  private printService = inject(OrderPrintService);
  private ordersService = inject(StoreOrdersService);
  private customersService = inject(CustomersService);
  private tablesService = inject(TablesService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  // T10 B3 — predicado único de industria (canónica: AuthFacade.isRestaurant).
  // Antes este componente era "presentacional: no consulta AuthFacade"; ese
  // límite se rompe porque la columna Mesa debe responder a la industria del
  // tenant, no solo a si hay datos. Si en el futuro hay que re-evaluar si
  // este componente debe seguir siendo presentacional, la respuesta sigue
  // siendo la misma: consultar la canónica, no escribir un duplic.
  private authFacade = inject(AuthFacade);
  /** T10 B3 — gate de industria reusado por `columns` y `cardConfig`. */
  readonly isRestaurant = computed<boolean>(() => this.authFacade.isRestaurant());

  /** Timestamp (epoch ms) del momento en que se cargó la lista actual. */
  private loadedAt = 0;
  /** IDs de órdenes ya abiertas por el usuario (no deben volver a parpadear). */
  private seenOrderIds: Set<string> = new Set();
  private readonly SEEN_KEY = 'vendix-orders-flash-seen';
  private readonly NEW_WINDOW_MS = 5 * 60 * 1000; // 5 minutos
  /** Signal puente para forzar reevaluación de rowClassFn cuando se marca una orden como vista. */
  private readonly seenVersion = signal(0);

  // State
  readonly orders = signal<Order[]>([]);
  readonly loading = signal(false);
  readonly totalItems = signal(0);
  readonly searchTerm = signal('');
  readonly selectedStatus = signal('');
  readonly selectedChannel = signal('');
  readonly selectedPaymentStatus = signal('');
  readonly selectedDateRange = signal('');
  readonly dispatchableFilter = signal(false);
  // Carril B - B2: mesa seleccionada (string para empatar con FilterValues;
  // '' = sin filtro, sino el id de la mesa). El numero viaja al backend
  // como table_id en _filters; '' NO viaja porque OrderQueryDto.table_id
  // valida con @IsInt() @Min(1) y un vacio da 400.
  readonly selectedTable = signal('');
  /** Mesas de la tienda; se cargan al init y solo si hay >=1 pintamos el filtro. */
  readonly tables = signal<Table[]>([]);

  // Outputs
  readonly create = output<void>();
  readonly viewOrder = output<string>();
  readonly refresh = output<void>();

  /**
   * QUI-599: afordancia del item "Operaciones masivas". El permiso lo lee el
   * componente de página (`orders.component.ts:canBulkOrderOperations`) y baja
   * como input, igual que `canBulkEdit` en `product-list.component.ts:80`.
   *
   * AuthFacade: este componente consume la canónica SOLO para el gate de
   * industria (`isRestaurant` reusado por `columns` y `cardConfig`, T10 B3);
   * no la consulta para permisos, roles ni scopes — esos siguen llegando
   * por inputs desde el componente de página. La excepción al límite
   * "presentacional" anterior está documentada en el comentario de la
   * inyección (:77-82).
   */
  readonly canBulkOperations = input(false);

  /** QUI-599: único punto de entrada a la vista de operaciones masivas. */
  navigateToBulkPage(): void {
    this.router.navigate(['/admin/orders/bulk']);
  }

  /**
   * Bug 2 (Fase K): when the parent increments this input, the list
   * re-fetches. The orders page binds it to a counter that ticks on
   * route re-entry so the POS-created order shows up without an F5.
   */
  readonly reloadTrigger = input<number>(0);

  readonly filters = input<OrderQuery>({
    search: '',
    status: undefined,
    channel: undefined,
    payment_status: undefined,
    date_range: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  });

  // Internal mutable filters (for pagination/sorting driven from inside the component)
  protected _filters: OrderQuery = {
    search: '',
    status: undefined,
    channel: undefined,
    payment_status: undefined,
    date_range: undefined,
    dispatchable: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

  // Filter configuration for the options dropdown
  // Carril B - B2: filterConfigs es computed (no campo plano) porque la
  // entrada "table_id" solo aparece si la tienda tiene mesas. Si la lista
  // de mesas carga vacia (mayoria de tiendas de Vendix no son restaurantes)
  // el filtro no se pinta — mismo criterio que la columna Mesa, que deja
  // la celda vacia en vez de guion/N/A.
  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'created', label: 'Creada' },
        { value: 'pending_payment', label: 'Pago Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'shipped', label: 'Enviada' },
        { value: 'delivered', label: 'Entregada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'refunded', label: 'Reembolsada' },
        { value: 'finished', label: 'Finalizada' },
      ],
    },
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      // El backend acepta más canales (whatsapp, agent, marketplace — ver
      // channelMap en formatChannel / colorMap en columns), pero el filtro
      // solo exponía pos + ecommerce. Tienda con ventas por WhatsApp
      // (ej. TCM01-260728-0001) no podía filtrar por ese canal. Se agregan
      // los tres que faltaban para empatar con las órdenes reales.
      options: [
        { value: '', label: 'Todos los Canales' },
        { value: 'pos', label: 'Punto de Venta' },
        { value: 'ecommerce', label: 'Tienda Online' },
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'agent', label: 'Agente IA' },
        { value: 'marketplace', label: 'Marketplace' },
      ],
    },
    {
      key: 'payment_status',
      label: 'Estado de Pago',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados de Pago' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'completed', label: 'Completado' },
        { value: 'failed', label: 'Fallido' },
        { value: 'refunded', label: 'Reembolsado' },
        { value: 'cancelled', label: 'Cancelado' },
      ],
    },
    {
      key: 'date_range',
      label: 'Período',
      type: 'select',
      options: [
        { value: '', label: 'Todo el Período' },
        { value: 'today', label: 'Hoy' },
        { value: 'yesterday', label: 'Ayer' },
        { value: 'thisWeek', label: 'Esta Semana' },
        { value: 'lastWeek', label: 'Semana Pasada' },
        { value: 'thisMonth', label: 'Este Mes' },
        { value: 'lastMonth', label: 'Mes Pasado' },
        { value: 'thisYear', label: 'Este Año' },
        { value: 'lastYear', label: 'Año Pasado' },
      ],
    },
    ];
    const ts = this.tables();
    if (ts.length > 0) {
      configs.push({
        key: 'table_id',
        label: 'Mesa',
        type: 'select',
        options: [
          { value: '', label: 'Todas las Mesas' },
          ...ts
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((t) => ({
              value: String(t.id),
              label: t.zone ? `${t.name} (${t.zone})` : t.name,
            })),
        ],
      });
    }
    return configs;
  });

  // Current filter values
  readonly filterValues = signal<FilterValues>({});

  // Dropdown actions
  //
  // QUI-599: 'bulk-operations' es la ÚNICA puerta de entrada a la vista
  // dedicada /admin/orders/bulk (no hay entrada en el sidebar). Se inserta
  // aquí dentro del dropdown de opciones, igual que 'Edición masiva' en
  // products (`product-list.component.ts:174`).
  //
  // Es un `computed` (no un campo plano) precisamente para que el filtro por
  // permiso sea reactivo: `canBulkOperations` es un signal input y un array
  // literal no se volvería a evaluar cuando el snapshot de permisos llegue.
  // Se filtra POR ACCIÓN, nunca escondiendo el dropdown completo — mismo
  // criterio que `product-list.component.ts:181-185`. El backend
  // `PermissionsGuard` sigue siendo el límite real de autorización.
  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const canBulk = this.canBulkOperations();
    const all: DropdownAction[] = [
      {
        label: 'Nueva Orden',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      },
      { label: 'Exportar', icon: 'download', action: 'export' },
      {
        label: 'Operaciones masivas',
        icon: 'list-checks',
        action: 'bulk-operations',
      },
    ];
    return all.filter((a) =>
      a.action === 'bulk-operations' ? canBulk : true,
    );
  });

  // Table configuration
  // T10 B3 — columns ahora es computed. La entrada Mesa solo aparece cuando:
  //   - la tienda es restaurante (gate de industria: AuthFacade.isRestaurant,
  //     arranca en false durante la carga de settings — aceptamos el parpadeo
  //     porque es una superficie informativa, no operativa), Y
  //   - la tienda tiene mesas cargadas (gate de datos: tables().length > 0).
  // Tienda no-restaurante con mesas creadas por error o importación: NO
  // muestra la columna. Restaurante sin mesas configuradas: NO muestra
  // la columna (caso real que no queremos romper). ZONELESS: el template
  // debe invocar columns() — la columna se re-evalúa cuando isRestaurant()
  // o tables() cambia.
  readonly columns = computed<TableColumn[]>(() => {
    const hasTables = this.isRestaurant() && this.tables().length > 0;
    const base: TableColumn[] = [
      { key: 'order_number', label: 'Order ID', sortable: true, priority: 1 },
      {
        key: 'customer_name',
        label: 'Customer',
        sortable: true,
        priority: 2,
      },
      {
        key: 'channel',
        label: 'Canal',
        sortable: true,
        badge: true,
        priority: 2,
        badgeConfig: {
          type: 'custom',
          size: 'sm',
          colorMap: {
            pos: '#6366f1',
            ecommerce: '#10b981',
            agent: '#8b5cf6',
            whatsapp: '#22c55e',
            marketplace: '#f59e0b',
          },
        },
        transform: (value: any) => this.formatChannel(value),
      },
      {
        key: 'state',
        label: 'Status',
        sortable: true,
        badge: true,
        priority: 1,
        badgeConfig: {
          type: 'custom',
          size: 'sm',
          colorMap: {
            draft: '#9ca3af',
            created: '#6b7280',
            pending_payment: '#f59e0b',
            processing: '#3b82f6',
            shipped: '#06b6d4',
            delivered: '#10b981',
            cancelled: '#ef4444',
            refunded: '#f97316',
            finished: '#8b5cf6',
          },
        },
        transform: (value: any) => this.formatStatus(value),
      },
      {
        key: 'grand_total',
        label: 'Total',
        sortable: true,
        priority: 1,
        transform: (value: any) => this.currencyService.format(value || 0),
      },
      {
        key: 'created_at',
        label: 'Date',
        sortable: true,
        priority: 3,
        transform: (value: any) => {
          if (!value) return 'N/A';
          const date = new Date(value);
          return isNaN(date.getTime())
            ? 'Invalid Date'
            : date.toLocaleDateString();
        },
      },
    ];
    if (hasTables) {
      // Mesa: lee el campo plano precomputado en loadOrders() (mesa string
      // o null). defaultValue cubre la celda vacía → '—' en lugar de
      // confundir null/'' con dato.
      base.push({
        key: 'mesa',
        label: 'Mesa',
        sortable: false,
        priority: 2,
        defaultValue: '—',
      });
    }
    return base;
  });

  actions: TableAction[] = [
    {
      label: 'View Details',
      icon: 'eye',
      action: (order: Order) => this.viewOrderDetails(order),
      variant: 'secondary',
    },
    {
      label: 'Imprimir',
      icon: 'printer',
      action: (order: Order) => this.printService.printOrder(order),
      variant: 'info',
      show: (order: Order) => !['cancelled', 'refunded'].includes(order.state),
    },
    {
      label: 'Cancel Order',
      icon: 'x-circle',
      action: (order: Order) => this.cancelOrder(order),
      variant: 'danger',
      show: (order: Order) =>
        ['created', 'pending_payment', 'processing'].includes(order.state),
    },
  ];

  // Card configuration for mobile
  // T10 B3 — cardConfig ahora es computed. detailKeys incluye Mesa solo
  // cuando la tienda es restaurante Y tiene mesas (mismo gate que `columns`
  // arriba). Sin esto la tarjeta móvil pinta "Mesa: —" en tiendas que no
  // son restaurante — residuo visible que miente sobre una capacidad que
  // la tienda no tiene. ZONELESS: el template debe invocar cardConfig().
  readonly cardConfig = computed<ItemListCardConfig>(() => {
    const hasTables = this.isRestaurant() && this.tables().length > 0;
    const detailKeys: ItemListCardConfig['detailKeys'] = [
      {
        key: 'channel',
        label: 'Canal',
        transform: (value: any) => this.formatChannel(value),
        infoIconTransform: (value: any) => this.getChannelIcon(value),
        infoIconVariantTransform: (value: any) => this.getChannelVariant(value),
      },
    ];
    if (hasTables) {
      // Mesa: lee el campo plano precomputado en loadOrders() (mesa string
      // o null). infoIcon coherente con el texto: icono ⇔ mesa presente.
      detailKeys.push({
        key: 'mesa',
        label: 'Mesa',
        transform: (value: unknown) =>
          value == null || value === '' ? '—' : (value as string),
        infoIconTransform: (value: unknown) =>
          value == null || value === '' ? undefined : 'utensils',
        infoIconVariant: 'warning',
      });
    }
    detailKeys.push({
      key: 'created_at',
      label: 'Fecha',
      transform: (value: any) => {
        if (!value) return 'N/A';
        const date = new Date(value);
        return isNaN(date.getTime())
          ? 'Invalid Date'
          : date.toLocaleDateString();
      },
    });
    return {
      titleKey: 'order_number',
      titleTransform: (item) => `#${item.order_number}`,
      subtitleKey: 'customer_name',
      avatarFallbackIcon: 'shopping-bag',
      avatarShape: 'circle',
      badgeKey: 'state',
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          draft: '#9ca3af',
          created: '#6b7280',
          pending_payment: '#f59e0b',
          processing: '#3b82f6',
          shipped: '#06b6d4',
          delivered: '#10b981',
          cancelled: '#ef4444',
          refunded: '#f97316',
          finished: '#8b5cf6',
        },
      },
      badgeTransform: (value: any) => this.formatStatus(value),
      footerKey: 'grand_total',
      footerLabel: 'Total',
      footerStyle: 'prominent',
      footerTransform: (value: any) =>
        this.currencyService.format(Number(value) || 0),
      detailKeys,
    };
  });

  constructor() {
    // Persistencia de filtros vía URL query params (QUI-778 admin-orders-filters).
    // Patrón canónico: `org-invoice-list.component.ts:373-390`.
    //
    // Antes leíamos `route.snapshot.queryParamMap` una sola vez: si el usuario
    // llegaba a `/admin/orders/sales` desde el sidebar (sin params) los filtros
    // no se aplicaban aunque vinieran del back/forward del navegador. Ahora
    // suscribimos REACTIVAMENTE: cada cambio de URL rehidrata signals + _filters
    // y recarga.
    //
    // El guard `filtersEqual` es OBLIGATORIO: cuando nosotros mismos escribimos
    // la URL con `updateQuery`, `queryParamMap` re-emite. Sin el guard caeríamos
    // en loop (onFilterChange → updateQuery → queryParamMap emite → handler
    // re-sincroniza signals → microtask extra de Angular).
    // `initialQueryHandled` distingue el primer emit del subscribe (mount) de
    // los siguientes (cambios de URL por back/forward o por `updateQuery`).
    // Sin esta marca, el guard `filtersEqual` SALTARÍA la carga inicial cuando
    // la URL está limpia y `_filters` arranca vacío — ambos objetos son iguales
    // y nunca se llamaría a `loadOrders()`.
    let initialQueryHandled = false;

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((qp) => {
        const incoming: OrderQuery = {
          search: qp.get('search') ?? '',
          status: (qp.get('status') as OrderState) || undefined,
          channel: (qp.get('channel') as OrderChannel) || undefined,
          payment_status:
            (qp.get('payment_status') as PaymentStatus) || undefined,
          date_range: qp.get('date_range') || undefined,
          table_id: qp.get('table_id')
            ? Number(qp.get('table_id'))
            : undefined,
          dispatchable:
            qp.get('dispatchable') === 'true' ? true : undefined,
          page: qp.get('page') ? Number(qp.get('page')) : 1,
          limit: this._filters.limit ?? 10,
          sort_by: this._filters.sort_by ?? 'created_at',
          sort_order: this._filters.sort_order ?? 'desc',
        };

        // Guard contra loop + bypass para el primer emit (carga inicial):
        //   - Primer emit: `_filters` puede ser igual a `incoming` (URL limpia
        //     sin params), pero todavía necesitamos sincronizar signals y
        //     ejecutar la carga inicial.
        //   - Emits siguientes (deep-link, back/forward, updateQuery): si
        //     incoming === _filters, saltamos para no duplicar el fetch.
        if (initialQueryHandled && this.filtersEqual(this._filters, incoming)) {
          return;
        }
        initialQueryHandled = true;

        // Sincronizar signals + _filters
        this._filters = { ...this._filters, ...incoming };
        this.searchTerm.set(this._filters.search ?? '');
        this.selectedStatus.set(this._filters.status ?? '');
        this.selectedChannel.set(this._filters.channel ?? '');
        this.selectedPaymentStatus.set(this._filters.payment_status ?? '');
        this.selectedDateRange.set(this._filters.date_range ?? '');
        this.selectedTable.set(
          this._filters.table_id != null
            ? String(this._filters.table_id)
            : '',
        );
        this.dispatchableFilter.set(!!this._filters.dispatchable);
        this.filterValues.set(this.filtersToFilterValues(this._filters));

        this.loadOrders();
      });

    // Bug 2 (Fase K): react to parent-triggered reload requests.
    effect(() => {
      const tick = this.reloadTrigger();
      if (tick > 0) {
        this.loadOrders();
      }
    });

    this.loadSeen();
    // Carril B - B2: carga mesas de la tienda. Si falla, el filtro no se
    // pinta (computed filterConfigs arriba depende de tables().length > 0).
    // Fire-and-forget con takeUntilDestroyed. TablesService.getFloorMap()
    // devuelve Observable<Table[]> (el plano completo, sin paginar) - lo
    // que necesita un dropdown de filtro. listPaginated() obligaria a
    // paginar un desplegable, sin sentido para un restaurante con decenas
    // de mesas.
    this.tablesService
      .getFloorMap()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tables: Table[]) => this.tables.set(tables ?? []),
        error: () => this.tables.set([]),
      });
  }

  private loadSeen(): void {
    try {
      const raw = sessionStorage.getItem(this.SEEN_KEY);
      if (raw) this.seenOrderIds = new Set(JSON.parse(raw) as string[]);
    } catch {
      this.seenOrderIds = new Set();
    }
  }

  private saveSeen(): void {
    try {
      sessionStorage.setItem(this.SEEN_KEY, JSON.stringify([...this.seenOrderIds]));
    } catch {
      /* ignore */
    }
  }

  /**
   * Mapea un `OrderQuery` (estado del backend) a un `FilterValues` (lo que
   * entiende el `<app-options-dropdown>`). Usado en la rehidratación desde URL
   * para que el dropdown muestre los filtros activos al re-entrar.
   */
  private filtersToFilterValues(f: OrderQuery): FilterValues {
    return {
      status: f.status ?? null,
      channel: f.channel ?? null,
      payment_status: f.payment_status ?? null,
      date_range: f.date_range ?? null,
      table_id: f.table_id != null ? String(f.table_id) : null,
    };
  }

  /**
   * Guarda contra loop de `updateQuery → queryParamMap emite → handler re-sincroniza`.
   * Compara dos `OrderQuery` shallow para saber si la URL que llega de la
   * suscripción reactiva es la misma que acabamos de escribir nosotros mismos.
   *
   * Approach C: unión de keys + comparación estricta. Robusto ante keys que
   * faltan en uno de los dos lados, y `undefined === undefined` cuenta como
   * igual (consistente con cómo `incoming` se construye — keys con `|| undefined`
   * siguen presentes en el objeto, no ausentes).
   */
  private filtersEqual(current: OrderQuery, incoming: OrderQuery): boolean {
    const keys = new Set([
      ...Object.keys(current),
      ...Object.keys(incoming),
    ]);
    for (const k of keys) {
      if ((current as Record<string, unknown>)[k] !== (incoming as Record<string, unknown>)[k]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Escribe en la URL los params del patch. Convención `null = unset`:
   * pasar `null` o `''` ELIMINA la clave de la URL (Angular la quita); pasar
   * un valor lo serializa a string. `replaceUrl: true` evita acumular entradas
   * de history por cada cambio de filtro. `queryParamsHandling: 'merge'`
   * preserva otros params que no estemos tocando.
   */
  private updateQuery(patch: Partial<Record<keyof OrderQuery, unknown>>): void {
    const next: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') {
        next[k] = null;
      } else {
        next[k] = String(v);
      }
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: next,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // Computed property for hasFilters
  readonly hasFilters = computed(() =>
    !!(
      this.searchTerm() ||
      this.selectedStatus() ||
      this.selectedChannel() ||
      this.selectedPaymentStatus() ||
      this.selectedDateRange() ||
      this.dispatchableFilter() ||
      this.selectedTable()
    ),
  );

  getEmptyStateTitle(): string {
    return this.hasFilters()
      ? 'Ninguna orden coincide con sus filtros'
      : 'No se encontraron órdenes';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters()
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primera orden.';
  }

  // Event handlers
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this._filters.search = term;
    this._filters.page = 1;
    this.loadOrders();
    // Persistir en URL para que sobreviva a back/forward y deep-link.
    this.updateQuery({ search: term || null });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.selectedStatus.set((values['status'] as string) || '');
    this.selectedChannel.set((values['channel'] as string) || '');
    this.selectedPaymentStatus.set((values['payment_status'] as string) || '');
    this.selectedDateRange.set((values['date_range'] as string) || '');
    // Carril B - B2: '' = sin filtro (viaja undefined al backend para no
    // romper el @IsInt() @Min(1) del DTO). Cualquier otro valor es el id
    // de la mesa como string.
    this.selectedTable.set((values['table_id'] as string) || '');

    this._filters.status = this.selectedStatus()
      ? (this.selectedStatus() as OrderState)
      : undefined;
    this._filters.channel = this.selectedChannel()
      ? (this.selectedChannel() as OrderChannel)
      : undefined;
    this._filters.payment_status = this.selectedPaymentStatus()
      ? (this.selectedPaymentStatus() as PaymentStatus)
      : undefined;
    this._filters.date_range = this.selectedDateRange() || undefined;
    this._filters.table_id = this.selectedTable()
      ? Number(this.selectedTable())
      : undefined;
    this._filters.page = 1;

    this.loadOrders();
    // Persistir TODOS los filtros del dropdown en URL — si el usuario cambia
    // uno y otro ya estaba puesto, la URL refleja el estado completo (no
    // pisamos los anteriores porque updateQuery hace merge).
    this.updateQuery({
      status: this._filters.status,
      channel: this._filters.channel,
      payment_status: this._filters.payment_status,
      date_range: this._filters.date_range,
      table_id: this._filters.table_id,
    });
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('');
    this.selectedChannel.set('');
    this.selectedPaymentStatus.set('');
    this.selectedDateRange.set('');
    this.dispatchableFilter.set(false);
    this.selectedTable.set('');
    this.filterValues.set({});

    this._filters.search = '';
    this._filters.status = undefined;
    this._filters.channel = undefined;
    this._filters.payment_status = undefined;
    this._filters.date_range = undefined;
    this._filters.dispatchable = undefined;
    this._filters.table_id = undefined;
    this._filters.page = 1;

    this.loadOrders();
    // Limpiar TODOS los params de filtro de la URL. `null` los elimina.
    this.updateQuery({
      search: null,
      status: null,
      channel: null,
      payment_status: null,
      date_range: null,
      table_id: null,
      dispatchable: null,
      page: null,
    });
  }

  toggleDispatchable(): void {
    const next = !this.dispatchableFilter();
    this.dispatchableFilter.set(next);
    this._filters.dispatchable = next || undefined;
    // Al activar el quick filter, limpia status del dropdown para evitar
    // colisión en el where de Prisma (state: 'processing' ya lo cubre
    // dispatchable; selectedStatus vacío evita un AND contradictorio).
    if (next) {
      this.selectedStatus.set('');
      this._filters.status = undefined;
      this.filterValues.update(v => ({ ...v, status: '' }));
    }
    this._filters.page = 1;
    this.loadOrders();
    // Persistir dispatchable y el status (que se limpia al activar el toggle).
    this.updateQuery({
      dispatchable: next || null,
      status: this._filters.status,
    });
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'export':
        this.exportOrders();
        break;
      case 'bulk-operations':
        this.navigateToBulkPage();
        break;
    }
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading.set(true);

    this.ordersService
      .getOrders(this._filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          this.loadedAt = Date.now();
          // Unwrap ResponseService wrapper if present
          const paginatedData = response.data || response;

          const rawOrders = paginatedData.data || paginatedData || [];

          // Normalize numeric strings to numbers
          const normalizedOrders = rawOrders.map((order: any) => {
            // Carril B - B2: precomputar mesa plana para que la columna/celda
            // lean el string y el template pinte '—' cuando falta (null),
            // no '' (cadena vacía) que el gate del shared confunde con dato.
            const ts = order?.table_sessions?.[0];
            const mesa = ts?.table?.name
              ? ts.table.zone
                ? `${ts.table.name} (${ts.table.zone})`
                : ts.table.name
              : null;
            return {
              ...order,
              mesa,
              customer_id:
              typeof order.customer_id === 'string'
                ? parseInt(order.customer_id)
                : order.customer_id,
            grand_total:
              typeof order.grand_total === 'string'
                ? parseFloat(order.grand_total)
                : order.grand_total,
            subtotal_amount:
              typeof order.subtotal_amount === 'string'
                ? parseFloat(order.subtotal_amount)
                : order.subtotal_amount,
            tax_amount:
              typeof order.tax_amount === 'string'
                ? parseFloat(order.tax_amount)
                : order.tax_amount,
            shipping_cost:
              typeof order.shipping_cost === 'string'
                ? parseFloat(order.shipping_cost)
                : order.shipping_cost,
            discount_amount:
              typeof order.discount_amount === 'string'
                ? parseFloat(order.discount_amount)
                : order.discount_amount,
            };
          });

          // Get pagination info safely
          const paginationInfo = paginatedData.pagination || {
            total: rawOrders.length,
          };
          this.totalItems.set(paginationInfo.total || 0);

          // Fetch customer details
          const customerIds: number[] = [
            ...new Set<number>(
              normalizedOrders
                .map((o: any) => o.customer_id)
                .filter((id: number) => id),
            ),
          ];
          if (customerIds.length > 0) {
            forkJoin(
              customerIds.map((id) => this.customersService.getCustomer(id)),
            )
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (customers) => {
                  const customerMap = new Map(customers.map((c) => [c.id, c]));
                  this.orders.set(normalizedOrders.map((order: any) => ({
                    ...order,
                    // Carril B - B1: prioridad alias > customer.first+last > 'Consumidor Final'.
                    // Mismo orden que el detalle y el ticket de despacho.
                    customer_name: order.customer_alias?.trim()
                      || (order.customer_id
                        ? `${customerMap.get(order.customer_id)?.first_name || ''} ${customerMap.get(order.customer_id)?.last_name || ''}`.trim() ||
                          'N/A'
                        : 'Consumidor Final'),
                  })));
                  this.loading.set(false);
                },
                error: (error) => {
                  console.error('Error loading customers:', error);
                  this.orders.set(normalizedOrders.map((order: any) => ({
                    ...order,
                    customer_name: order.customer_alias?.trim()
                      || (order.customer_id ? 'N/A' : 'Consumidor Final'),
                  })));
                  this.loading.set(false);
                },
              });
          } else {
            // Carril B - B1: sin customers a fetchear, la unica fuente es alias.
            this.orders.set(normalizedOrders.map((order: any) => ({
              ...order,
              customer_name: order.customer_alias?.trim() || 'Consumidor Final',
            })));
            this.loading.set(false);
          }
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading.set(false);
        },
      });
  }

  // Pagination and sorting
  onPageChange(page: number): void {
    this._filters.page = page;
    this.loadOrders();
    // Persistir la página actual en URL (deep-linkable, back/forward friendly).
    this.updateQuery({ page });
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (event.direction) {
      this._filters.sort_by = event.column as any;
      this._filters.sort_order = event.direction;
      this.loadOrders();
    }
  }

  // Actions
  handleViewOrder(orderId: string): void {
    const sid = String(orderId);
    if (!this.seenOrderIds.has(sid)) {
      this.seenOrderIds.add(sid);
      this.saveSeen();
      this.seenVersion.update((v) => v + 1);
    }
    this.viewOrder.emit(orderId);
  }

  /** Determina si una orden debe parpadear como "nueva" (creada hace < 5 min y aún no abierta). */
  isNewOrder(item: any): boolean {
    this.seenVersion(); // touch para reevaluación reactiva
    if (!item?.id || !item?.created_at) return false;
    if (this.seenOrderIds.has(String(item.id))) return false;
    const createdAt = new Date(item.created_at).getTime();
    if (isNaN(createdAt) || !this.loadedAt) return false;
    return this.loadedAt - createdAt < this.NEW_WINDOW_MS;
  }

  /** Función de clase por fila que consume app-table / app-item-list via responsive-data-view. */
  rowClassFn = (item: any, index: number): string | undefined => {
    return this.isNewOrder(item) ? 'order-row--new' : undefined;
  };

  viewOrderDetails(order: Order): void {
    this.viewOrder.emit(order.id.toString());
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar Orden',
      message: `¿Estás seguro de que deseas cancelar la orden ${order.order_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar Orden',
      cancelText: 'Volver',
    });

    if (confirmed) {
      this.ordersService
        .updateOrderStatus(order.id.toString(), 'cancelled')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Orden cancelada exitosamente');
            this.loadOrders();
            this.refresh.emit();
          },
          error: (error: any) => {
            console.error('Error cancelling order:', error);
            this.toastService.error(
              'Error al cancelar la orden. Por favor intenta nuevamente.',
            );
          },
        });
    }
  }

  exportOrders(): void {
    this.ordersService
      .exportOrders(this._filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          // Handle file download
          const blob = new Blob([response], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error: any) => {
          console.error('Error exporting orders:', error);
          this.toastService.error('Failed to export orders. Please try again.');
        },
      });
  }

  // Helper methods for formatting
  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    const statusMap: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pago Pendiente',
      processing: 'Procesando',
      shipped: 'Enviada',
      delivered: 'Entregada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
      finished: 'Finalizada',
    };
    return (
      statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1)
    );
  }

  formatChannel(channel: string | undefined): string {
    if (!channel) return 'N/A';
    const channelMap: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'Online',
      agent: 'IA',
      whatsapp: 'WhatsApp',
      marketplace: 'Marketplace',
    };
    return (
      channelMap[channel] || channel.charAt(0).toUpperCase() + channel.slice(1)
    );
  }

  getChannelIcon(channel: string | undefined): string | undefined {
    if (!channel) return undefined;
    const iconMap: Record<string, string> = {
      pos: 'monitor',
      ecommerce: 'shopping-cart',
      agent: 'cpu',
      whatsapp: 'message-circle',
      marketplace: 'shopping-bag',
    };
    return iconMap[channel] || 'globe';
  }

  getChannelVariant(
    channel: string | undefined,
  ): 'primary' | 'warning' | 'danger' | 'success' | 'default' | undefined {
    if (!channel) return undefined;
    const variantMap: Record<
      string,
      'primary' | 'warning' | 'danger' | 'success' | 'default'
    > = {
      pos: 'primary',
      ecommerce: 'success',
      agent: 'warning',
      whatsapp: 'success',
      marketplace: 'warning',
    };
    return variantMap[channel] || 'default';
  }

  // Math utility for template
  readonly totalPages = computed(() =>
    Math.ceil(this.totalItems() / (this._filters.limit || 10)),
  );
}
