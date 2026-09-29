import {Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  computed, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  HeaderPinConfig,
  ButtonComponent,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { StoreOrdersService } from '../../services/store-orders.service';
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
import { OrdersListSseService } from '../../services/orders-list-sse.service';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { ERROR_MESSAGES } from '../../../../../../core/utils/error-messages';
import { environment } from '../../../../../../../environments/environment';

interface OrderPaymentMethodOption {
  id: number;
  display_name: string | null;
  system_payment_method: { display_name: string };
}

/**
 * Paso 4 del plan dashboard-sales-filters-pin-multiselect-sse: pin "Fijar" en
 * el header del dropdown de filtros. Misma semántica que `fix_period` del
 * dashboard (QUI-847): escribe su key en `FilterValues` (`'true'` | `null`),
 * NO cuenta como filtro activo, y persiste el set completo de filtros por
 * tienda en localStorage. Debe coincidir con el `key` del `[headerPin]` del
 * template.
 */
const SALES_FILTERS_PIN_KEY = 'pin_filters';

/** Prefijo de la key de localStorage donde se recuerda el set fijado. */
const SALES_FILTERS_STORAGE_PREFIX = 'vendix_sales_filters_';

/**
 * Forma serializada en localStorage del set de filtros fijado. Solo filtros
 * (sin page/limit/sort): al restaurar se arranca en página 1.
 */
interface PinnedSalesFilters {
  search?: string;
  status?: string[];
  channel?: string[];
  payment_status?: string[];
  payment_method_id?: number;
  date_range?: string;
  table_id?: number;
  dispatchable?: boolean;
}

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
  private http = inject(HttpClient);
  private tablesService = inject(TablesService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  // QUI-777: SSE push para refrescar `state` en la lista sin F5 cuando el
  // KDS marca todos los tickets de una orden como delivered (o revierte).
  // El servicio es root-provided; lo abrimos en el constructor y lo
  // cerramos en `destroyRef.onDestroy` para que el ciclo de vida siga al
  // del componente (no del injector root).
  private ordersListSse = inject(OrdersListSseService);
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
  // Paso 4: multi-select — `[]` = sin filtro (nunca se guarda `[]` en
  // `_filters`; vacío viaja como `undefined` al backend y a la URL).
  readonly selectedStatus = signal<string[]>([]);
  readonly selectedChannel = signal<string[]>([]);
  readonly selectedPaymentStatus = signal<string[]>([]);
  readonly selectedPaymentMethod = signal('');
  readonly paymentMethods = signal<OrderPaymentMethodOption[]>([]);
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
   * CP-orders-sales-sse-realtime: se emite tras insertar una orden creada en
   * vivo para que el padre refresque SOLO los stats (`loadOrderStats`),
   * sin recargar la lista. No se reutiliza `refresh` porque ese tickea
   * `reloadTrigger` y recargaria toda la tabla (flicker + GET redundante).
   */
  readonly statsChanged = output<void>();

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
    payment_method_id: undefined,
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
    payment_method_id: undefined,
    date_range: undefined,
    dispatchable: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

  // Pin de header del dropdown de filtros. Referencia ESTABLE (no un literal
  // en el template): un objeto fresco por ciclo ensucia el input signal en
  // cada pasada y encadena ticks infinitos en Zoneless.
  readonly salesHeaderPin: HeaderPinConfig = { key: SALES_FILTERS_PIN_KEY, label: 'Fijar' };

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
      type: 'multi-select',
      options: [
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
      type: 'multi-select',
      // El backend acepta más canales (whatsapp, agent, marketplace — ver
      // channelMap en formatChannel / colorMap en columns), pero el filtro
      // solo exponía pos + ecommerce. Tienda con ventas por WhatsApp
      // (ej. TCM01-260728-0001) no podía filtrar por ese canal. Se agrega
      // whatsapp que es el único que el usuario quiere exponer; agent y
      // marketplace siguen llegando en la lista pero no se pueden filtrar.
      options: [
        { value: 'pos', label: 'Punto de Venta' },
        { value: 'ecommerce', label: 'Tienda Online' },
        { value: 'whatsapp', label: 'WhatsApp' },
      ],
    },
    {
      key: 'payment_status',
      label: 'Estado de Pago',
      type: 'multi-select',
      options: [
        { value: 'pending', label: 'Pendiente' },
        { value: 'authorized', label: 'Autorizado' },
        { value: 'captured', label: 'Capturado' },
        { value: 'succeeded', label: 'Completado' },
        { value: 'failed', label: 'Fallido' },
        { value: 'partially_refunded', label: 'Reembolso parcial' },
        { value: 'refunded', label: 'Reembolsado' },
        { value: 'cancelled', label: 'Cancelado' },
      ],
    },
    {
      key: 'payment_method_id',
      label: 'Forma de pago',
      type: 'select',
      options: [
        { value: '', label: 'Todas las formas de pago' },
        ...this.paymentMethods().map((method) => ({
          value: String(method.id),
          label: method.display_name || method.system_payment_method.display_name,
        })),
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
        key: 'list_state',
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
            partially_refunded: '#f97316',
            finished: '#8b5cf6',
          },
        },
        transform: (value: any) => this.formatStatus(value),
      },
      {
        key: 'net_total',
        label: 'Neto actual',
        sortable: false,
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
      action: (order: Order) =>
        this.printService.printOrder(order).catch(() => {
          this.toastService.error(
            'No se pudo imprimir la orden: reintenta; si persiste, revisa el Hub de formatos de impresión.',
          );
        }),
      variant: 'info',
      show: (order: Order) => !['cancelled', 'refunded'].includes(order.state),
    },
    {
      label: 'Cancel Order',
      icon: 'x-circle',
      action: (order: Order) => this.cancelOrder(order),
      variant: 'danger',
      show: (order: Order) =>
        order.cancellation_policy?.can_cancel === true,
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
      badgeKey: 'list_state',
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
          partially_refunded: '#f97316',
          finished: '#8b5cf6',
        },
      },
      badgeTransform: (value: any) => this.formatStatus(value),
      footerKey: 'net_total',
      footerLabel: 'Neto actual',
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
          status: this.parseMultiParam<OrderState>(qp, 'status'),
          channel: this.parseMultiParam<OrderChannel>(qp, 'channel'),
          payment_status: this.parseMultiParam<PaymentStatus>(
            qp,
            'payment_status',
          ),
          payment_method_id: qp.get('payment_method_id')
            ? Number(qp.get('payment_method_id'))
            : undefined,
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

        // Paso 4: en el primer emit, si la URL no trae filtros y hay un set
        // fijado para la tienda, se restaura ANTES del primer fetch (la URL
        // manda cuando trae filtros).
        let pinRestored = false;
        if (!initialQueryHandled) {
          pinRestored = this.applyPinRestoreIfUrlEmpty(qp, incoming);
        }

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
        this.selectedStatus.set(this.asArray(this._filters.status));
        this.selectedChannel.set(this.asArray(this._filters.channel));
        this.selectedPaymentStatus.set(
          this.asArray(this._filters.payment_status),
        );
        this.selectedPaymentMethod.set(
          this._filters.payment_method_id != null
            ? String(this._filters.payment_method_id)
            : '',
        );
        this.selectedDateRange.set(this._filters.date_range ?? '');
        this.selectedTable.set(
          this._filters.table_id != null
            ? String(this._filters.table_id)
            : '',
        );
        this.dispatchableFilter.set(!!this._filters.dispatchable);
        this.filterValues.set(this.filtersToFilterValues(this._filters));
        if (pinRestored) {
          // El pin restaurado se marca en el round-trip (QUI-744: la key
          // viaja junto al resto de la forma) y se refleja en la URL para
          // mantener el invariante "URL = filtros visibles". El emit que
          // genera `updateQuery` lo absorbe el guard `filtersEqual` (mismo
          // contenido), así que no hay doble fetch.
          this.filterValues.update((v) => ({
            ...v,
            [SALES_FILTERS_PIN_KEY]: 'true',
          }));
          this.updateQuery({
            search: this._filters.search || null,
            status: this._filters.status,
            channel: this._filters.channel,
            payment_status: this._filters.payment_status,
            payment_method_id: this._filters.payment_method_id,
            date_range: this._filters.date_range,
            table_id: this._filters.table_id,
            dispatchable: this._filters.dispatchable ?? null,
            page: null,
          });
        } else if (this.isPinned()) {
          // Navegación por URL (back/forward/deep-link) con pin activo: el
          // set visible cambió, así que el snapshot fijado se actualiza para
          // no restaurar un set obsoleto en la próxima entrada.
          this.persistPinnedFilters(true);
        }

        this.loadOrders();
      });

    // Bug 2 (Fase K): react to parent-triggered reload requests.
    effect(() => {
      const tick = this.reloadTrigger();
      if (tick > 0) {
        this.loadOrders();
      }
    });

    // QUI-777: reconciliación SSE — actualizar UNA fila por id sin re-fetch.
    // El patrón effect+clear garantiza que el effect corra una vez por
    // cambio externo del signal, sin riesgo de loop infinito. Si la orden
    // NO está en la página actual (filtro de status la excluye, o el
    // id es de otra tienda por error), el `.map` la deja igual y el
    // upsert es idempotente.
    effect(() => {
      const evt = this.ordersListSse.lastRelevantEvent();
      if (!evt) return;
      const { order_id, new_state } = evt.data;
      // `new_state` ya viene tipado como `OrderState` desde el servicio SSE
      // (validación runtime en `OrdersListSseService.handleMessage`). Si el
      // backend pushea un estado desconocido, el servicio descarta el
      // evento silencioso y este effect nunca lo ve.
      // Paso 5: con filtro de estado activo y la orden fuera de él, la fila
      // se retira (y el total decrementa) en vez de actualizarse — un
      // re-fetch completo perdería scroll/paginación.
      const statusFilter = this.asArray(this._filters.status);
      if (statusFilter.length > 0 && !statusFilter.includes(new_state)) {
        if (this.orders().some((o) => o.id === order_id)) {
          this.orders.update((prev) => prev.filter((o) => o.id !== order_id));
          this.totalItems.update((t) => Math.max(0, t - 1));
        }
        this.ordersListSse.lastRelevantEvent.set(null);
        return;
      }
      this.orders.update((prev) =>
        prev.map((o) =>
          o.id === order_id
            ? {
                ...o,
                state: new_state,
                list_state: o.is_partially_refunded && new_state !== 'refunded'
                  ? 'partially_refunded'
                  : new_state,
              }
            : o,
        ),
      );
      // Limpiar el signal para que el próximo evento vuelva a disparar el effect.
      this.ordersListSse.lastRelevantEvent.set(null);
    });

    // CP-orders-sales-sse-realtime: inserción en vivo de órdenes nuevas.
    // El servicio ya validó el shape; acá hidratamos por REST para aplicar
    // la misma normalización de `loadOrders` (mesa, customer_name, números)
    // y respetar filtros/paginación. Mismo patrón effect+clear del effect
    // de `status_changed`: sin riesgo de loop infinito.
    effect(() => {
      const evt = this.ordersListSse.lastCreatedEvent();
      if (!evt) return;
      const orderId = evt.data.order_id;
      const orderNumber = evt.data.order_number ?? `#${orderId}`;
      // Limpiar primero: el fetch es async y un segundo evento no debe
      // perderse mientras el anterior vuela.
      this.ordersListSse.lastCreatedEvent.set(null);
      // Idempotencia: doble evento por reconexión SSE con la fila ya
      // insertada es no-op.
      if (this.orders().some((o) => o.id === orderId)) return;
      // Paso 5: siempre se hidrata por REST; la decisión insertar-vs-toast
      // se toma SOBRE la fila hidratada dentro de `fetchAndPrependLiveOrder`
      // (el match necesita `state`/`channel` reales, que el evento no trae).
      this.fetchAndPrependLiveOrder(orderId, orderNumber);
    });

    // QUI-777: abrir/cerrar el stream al ciclo de vida del componente.
    // root-provided + connect/disconnect manual: si el usuario navega a
    // otra ruta, la suscripción se cierra limpiamente (el subject
    // compartido por tienda decrementa su refcount vía `req.close`).
    this.ordersListSse.connect();
    this.destroyRef.onDestroy(() => this.ordersListSse.disconnect());

    this.loadSeen();
    this.http
      .get<{ data: OrderPaymentMethodOption[] }>(
        `${environment.apiUrl}/store/orders/payment-methods`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.paymentMethods.set(response.data ?? []),
        error: (error) => this.toastService.error(
          extractApiErrorMessage(error) || 'No se pudieron cargar las formas de pago.',
        ),
      });
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
   * Normaliza un valor single-o-array a un array nuevo (nunca muta el
   * original). Puente entre `FilterValues` multi, la unión
   * `X | X[]` de `OrderQuery` y los signals `string[]`.
   */
  private asArray<T>(value: T | T[] | null | undefined): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? [...value] : [value];
  }

  /**
   * Parsea un param multi-valor desde la URL. Acepta params repetidos
   * (`?channel=whatsapp&channel=ecommerce`, vía `getAll`) y coma
   * (`?channel=whatsapp,ecommerce`, como la serializa `updateQuery`), con
   * split+trim, sin vacíos y con dedupe preservando orden. Vacío → `undefined`.
   */
  private parseMultiParam<T extends string>(
    qp: ParamMap,
    key: string,
  ): T[] | undefined {
    const parts = qp
      .getAll(key)
      .flatMap((v) => v.split(','))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return undefined;
    return [...new Set(parts)] as T[];
  }

  /**
   * Mapea un `OrderQuery` (estado del backend) a un `FilterValues` (lo que
   * entiende el `<app-options-dropdown>`). Usado en la rehidratación desde URL
   * para que el dropdown muestre los filtros activos al re-entrar. Los
   * multi-select viajan como arrays (`null` = sin filtro); la key del pin se
   * preserva para que el sync effect del dropdown (QUI-744) no la pierda.
   */
  private filtersToFilterValues(f: OrderQuery): FilterValues {
    const toFilterArray = <T>(v: T | T[] | undefined): T[] | null => {
      if (v == null) return null;
      return Array.isArray(v) ? [...v] : [v];
    };
    return {
      status: toFilterArray(f.status),
      channel: toFilterArray(f.channel),
      payment_status: toFilterArray(f.payment_status),
      payment_method_id: f.payment_method_id != null ? String(f.payment_method_id) : null,
      date_range: f.date_range ?? null,
      table_id: f.table_id != null ? String(f.table_id) : null,
      [SALES_FILTERS_PIN_KEY]: this.isPinned() ? 'true' : null,
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
   * siguen presentes en el objeto, no ausentes). Los arrays se comparan por
   * contenido sin importar el orden (`?status=b,a` ≡ `['a','b']`), para que
   * un reordenamiento no dispare un fetch redundante.
   */
  private filtersEqual(current: OrderQuery, incoming: OrderQuery): boolean {
    const keys = new Set([
      ...Object.keys(current),
      ...Object.keys(incoming),
    ]);
    for (const k of keys) {
      const a = (current as Record<string, unknown>)[k];
      const b = (incoming as Record<string, unknown>)[k];
      if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        const sortedA = [...a].sort();
        const sortedB = [...b].sort();
        if (!sortedA.every((v, i) => v === sortedB[i])) return false;
        continue;
      }
      if (a !== b) {
        return false;
      }
    }
    return true;
  }

  /**
   * Escribe en la URL los params del patch. Convención `null = unset`:
   * pasar `null`, `''` o un array vacío ELIMINA la clave de la URL (Angular
   * la quita); pasar un valor lo serializa a string y un array no vacío con
   * coma (`?channel=whatsapp,ecommerce`). `replaceUrl: true` evita acumular
   * entradas de history por cada cambio de filtro. `queryParamsHandling:
   * 'merge'` preserva otros params que no estemos tocando.
   */
  private updateQuery(patch: Partial<Record<keyof OrderQuery, unknown>>): void {
    const next: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') {
        next[k] = null;
      } else if (Array.isArray(v)) {
        next[k] = v.length > 0 ? v.join(',') : null;
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
      this.selectedStatus().length > 0 ||
      this.selectedChannel().length > 0 ||
      this.selectedPaymentStatus().length > 0 ||
      this.selectedPaymentMethod() ||
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
  // Paso 4: el template escucha `(searchChange)` (debounce 1000ms +
  // distinctUntilChanged del inputsearch), NO `(ngModelChange)` inmediato —
  // cada ráfaga de tecleo emite UN `?search=` y UN GET.
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this._filters.search = term;
    this._filters.page = 1;
    this.loadOrders();
    // Persistir en URL para que sobreviva a back/forward y deep-link.
    this.updateQuery({ search: term || null });
    // Con pin activo, el snapshot fijado sigue al set visible.
    if (this.isPinned()) this.persistPinnedFilters(true);
  }

  onFilterChange(values: FilterValues): void {
    // QUI-744: round-trip EXACTO — se devuelve la forma emitida tal cual
    // (incluida la key del pin) para que el sync effect del dropdown no pise
    // el estado local. Solo se DERIVA de ella; nunca se normaliza aquí.
    this.filterValues.set(values);
    // Multi-select: array vacío = sin filtro (viaja `undefined` a `_filters`
    // para no mandar `[]` al backend ni a la URL).
    const status = this.asArray<string>(values['status']).filter(
      (v) => v !== '',
    );
    const channel = this.asArray<string>(values['channel']).filter(
      (v) => v !== '',
    );
    const paymentStatus = this.asArray<string>(values['payment_status']).filter(
      (v) => v !== '',
    );
    this.selectedStatus.set(status);
    this.selectedChannel.set(channel);
    this.selectedPaymentStatus.set(paymentStatus);
    this.selectedPaymentMethod.set((values['payment_method_id'] as string) || '');
    this.selectedDateRange.set((values['date_range'] as string) || '');
    // Carril B - B2: '' = sin filtro (viaja undefined al backend para no
    // romper el @IsInt() @Min(1) del DTO). Cualquier otro valor es el id
    // de la mesa como string.
    this.selectedTable.set((values['table_id'] as string) || '');

    this._filters.status =
      status.length > 0 ? ([...status] as OrderState[]) : undefined;
    this._filters.channel =
      channel.length > 0 ? ([...channel] as OrderChannel[]) : undefined;
    this._filters.payment_status =
      paymentStatus.length > 0
        ? ([...paymentStatus] as PaymentStatus[])
        : undefined;
    this._filters.payment_method_id = this.selectedPaymentMethod()
      ? Number(this.selectedPaymentMethod())
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
      payment_method_id: this._filters.payment_method_id,
      date_range: this._filters.date_range,
      table_id: this._filters.table_id,
    });
    // El pin viaja en las MISMAS FilterValues: al marcarlo se persiste el
    // set actual, al desmarcarlo se borra; con pin activo, cada cambio
    // re-persiste (igual que `persistFixedPeriod` del dashboard).
    this.persistPinnedFilters(values[SALES_FILTERS_PIN_KEY] === 'true');
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set([]);
    this.selectedChannel.set([]);
    this.selectedPaymentStatus.set([]);
    this.selectedPaymentMethod.set('');
    this.selectedDateRange.set('');
    this.dispatchableFilter.set(false);
    this.selectedTable.set('');
    // Reset total: `{}` también suelta el pin (el sync effect del dropdown
    // lo desmarca al copiar la forma vacía).
    this.filterValues.set({});
    this.persistPinnedFilters(false);

    this._filters.search = '';
    this._filters.status = undefined;
    this._filters.channel = undefined;
    this._filters.payment_status = undefined;
    this._filters.payment_method_id = undefined;
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
      payment_method_id: null,
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
      this.selectedStatus.set([]);
      this._filters.status = undefined;
      this.filterValues.update((v) => ({ ...v, status: null }));
    }
    this._filters.page = 1;
    this.loadOrders();
    // Persistir dispatchable y el status (que se limpia al activar el toggle).
    this.updateQuery({
      dispatchable: next || null,
      status: this._filters.status,
    });
    // Con pin activo, el snapshot fijado sigue al set visible.
    if (this.isPinned()) this.persistPinnedFilters(true);
  }

  // ── Pin "Fijar" (paso 4, patrón QUI-847 del dashboard) ─────────────

  /** El pin vive en `filterValues` bajo su propia key (`'true'` | ausente). */
  private isPinned(): boolean {
    return this.filterValues()[SALES_FILTERS_PIN_KEY] === 'true';
  }

  /**
   * Store actual vía el signal canónico del facade (ya resuelto en memoria;
   * lectura síncrona, sin suscripción). `null` si la sesión aún no cargó.
   */
  private currentStoreId(): string | null {
    const id = this.authFacade.userStore()?.id;
    return id == null ? null : String(id);
  }

  /** Lee el set fijado para la tienda; `null` si no hay o está corrupto. */
  private readPinnedFilters(): PinnedSalesFilters | null {
    if (typeof localStorage === 'undefined') return null;
    const storeId = this.currentStoreId();
    if (!storeId) return null;
    try {
      const raw = localStorage.getItem(
        `${SALES_FILTERS_STORAGE_PREFIX}${storeId}`,
      );
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PinnedSalesFilters;
      if (!parsed || typeof parsed !== 'object') return null;
      return parsed;
    } catch {
      // Valor corrupto o storage no disponible: se ignora y se sigue con
      // los filtros de la URL (vacío = sin filtros).
      return null;
    }
  }

  /**
   * Persiste el set COMPLETO de filtros visibles solo si el pin está
   * marcado. Al desmarcarlo se borra la key: la próxima entrada arranca sin
   * filtros (salvo que la URL traiga). Best-effort: si el storage falla, el
   * filtrado sigue funcionando.
   */
  private persistPinnedFilters(fixed: boolean): void {
    if (typeof localStorage === 'undefined') return;
    const storeId = this.currentStoreId();
    if (!storeId) return;
    const key = `${SALES_FILTERS_STORAGE_PREFIX}${storeId}`;
    try {
      if (!fixed) {
        localStorage.removeItem(key);
        return;
      }
      const f = this._filters;
      const state: PinnedSalesFilters = {};
      if (f.search) state.search = f.search;
      const status = this.asArray(f.status);
      if (status.length > 0) state.status = [...status];
      const channel = this.asArray(f.channel);
      if (channel.length > 0) state.channel = [...channel];
      const paymentStatus = this.asArray(f.payment_status);
      if (paymentStatus.length > 0) state.payment_status = [...paymentStatus];
      if (f.payment_method_id != null)
        state.payment_method_id = f.payment_method_id;
      if (f.date_range) state.date_range = f.date_range;
      if (f.table_id != null) state.table_id = f.table_id;
      if (f.dispatchable) state.dispatchable = true;
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage lleno o no disponible: fijar es best-effort, no rompe el filtro.
    }
  }

  /** `true` cuando ningún param de filtro trae contenido no-blanco. */
  private urlHasNoFilters(qp: ParamMap): boolean {
    const has = (k: string): boolean =>
      qp.getAll(k).some((v) => v.trim().length > 0);
    return !(
      has('search') ||
      has('status') ||
      has('channel') ||
      has('payment_status') ||
      has('payment_method_id') ||
      has('date_range') ||
      has('table_id') ||
      has('dispatchable')
    );
  }

  /**
   * Restaura el set fijado sobre `incoming` (mutación in-place) cuando la URL
   * no trae filtros y hay pin guardado. Valida y coerciona cada campo para
   * no inyectar basura del storage en `_filters`. Retorna si restauró.
   */
  private applyPinRestoreIfUrlEmpty(
    qp: ParamMap,
    incoming: OrderQuery,
  ): boolean {
    if (!this.urlHasNoFilters(qp)) return false;
    const pinned = this.readPinnedFilters();
    if (!pinned) return false;
    const cleanArray = (v: unknown): string[] | undefined => {
      if (!Array.isArray(v)) return undefined;
      const clean = [
        ...new Set(
          v.filter(
            (x): x is string => typeof x === 'string' && x.length > 0,
          ),
        ),
      ];
      return clean.length > 0 ? clean : undefined;
    };
    const cleanId = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
    const cleanText = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;
    Object.assign(incoming, {
      search: cleanText(pinned.search) ?? '',
      status: cleanArray(pinned.status) as OrderState[] | undefined,
      channel: cleanArray(pinned.channel) as OrderChannel[] | undefined,
      payment_status: cleanArray(pinned.payment_status) as
        | PaymentStatus[]
        | undefined,
      payment_method_id: cleanId(pinned.payment_method_id),
      date_range: cleanText(pinned.date_range),
      table_id: cleanId(pinned.table_id),
      dispatchable: pinned.dispatchable === true ? true : undefined,
      page: 1,
    });
    return true;
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
            net_total: Number(order.net_total ?? order.grand_total) || 0,
            list_state: order.is_partially_refunded
              ? 'partially_refunded'
              : order.state,
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

          // Paso 3: el nombre sale de `order.users` del propio findAll
          // (alias > legal_name > first+last > CF) — sin N+1 por cliente.
          // F-210 sigue cubierto: `customer_id` con `users` ausente degrada
          // solo su fila a 'N/A' dentro de `resolveCustomerName`.
          this.orders.set(
            normalizedOrders.map((order: any) => ({
              ...order,
              customer_name: this.resolveCustomerName(order),
            })),
          );
          this.loading.set(false);
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading.set(false);
        },
      });
  }

  /**
   * Paso 5: el prepend en vivo solo es honesto cuando la fila hidratada
   * matchea los filtros VERIFICABLES (status contra `row.state` y channel
   * contra `row.channel`, ambos conscientes de array), la lista está en
   * página 1 con el orden default, y NO hay filtros no-verificables activos
   * (search, payment_status, payment_method, date_range, table,
   * dispatchable — no se pueden decidir sin re-fetch). En cualquier otro
   * caso se conserva el toast informativo en vez de insertar.
   */
  private matchesLiveOrderFilters(
    row: Pick<Order, 'state' | 'channel'>,
  ): boolean {
    const f = this._filters;
    if ((f.page ?? 1) !== 1) return false;
    if (
      (f.sort_by ?? 'created_at') !== 'created_at' ||
      (f.sort_order ?? 'desc') !== 'desc'
    ) {
      return false;
    }
    if (
      f.search ||
      this.asArray(f.payment_status).length > 0 ||
      f.payment_method_id != null ||
      f.date_range ||
      f.table_id != null ||
      f.dispatchable
    ) {
      return false;
    }
    const statusFilter = this.asArray(f.status);
    if (
      statusFilter.length > 0 &&
      !statusFilter.includes(row.state as OrderState)
    ) {
      return false;
    }
    const channelFilter = this.asArray(f.channel);
    if (
      channelFilter.length > 0 &&
      !channelFilter.includes(row.channel as OrderChannel)
    ) {
      return false;
    }
    return true;
  }

  /** Ventana de ráfaga para colapsar toasts cuando llegan >10 creadas/min. */
  private recentCreatedAt: number[] = [];

  /**
   * Hidrata la orden creada por REST y, solo si matchea los filtros
   * verificables (`matchesLiveOrderFilters`), la inserta arriba sin recargar
   * la lista. Aplica la misma normalización de `loadOrders` (mesa plana,
   * números, customer_name) para que la fila viva sea idéntica a una fila
   * cargada por REST. Emite `statsChanged` para que el padre refresque
   * solo los stats. Si no matchea, toast informativo (sin mutar). Un GET 404
   * (orden borrada entre evento y fetch) se descarta en silencio sin mutar
   * lista ni totalItems (ERR-03).
   */
  private fetchAndPrependLiveOrder(orderId: number, orderNumber: string): void {
    this.ordersService
      .getOrderById(String(orderId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order: any) => {
          if (!order || typeof order !== 'object' || order.id == null) return;
          // Dedup tardío: la fila pudo llegar por REST mientras el GET volaba.
          if (this.orders().some((o) => o.id === order.id)) return;
          const row = this.normalizeLiveOrderRow(order);
          if (!this.matchesLiveOrderFilters(row)) {
            this.toastService.info(
              `Nueva orden ${orderNumber} recibida. Quita los filtros o vuelve a la página 1 para verla.`,
            );
            return;
          }
          const limit = this._filters.limit || 10;
          this.orders.update((prev) => [row, ...prev].slice(0, limit));
          this.totalItems.update((t) => t + 1);
          this.announceLiveOrder(orderNumber);
          this.statsChanged.emit();
        },
        error: () => {
          // ERR-03: descartar sin mutar.
        },
      });
  }

  /**
   * Paso 3 — nombre visible del cliente con la misma precedencia que el
   * detalle y el tiquete: alias > legal_name > first+last > CF. Lee `users`
   * del propio findAll (sin fetch por fila). `customer_id` con `users`
   * ausente = titular huérfano → 'N/A' (no miente con CF fiscal).
   */
  private resolveCustomerName(order: {
    customer_alias?: string | null;
    customer_id?: number | null;
    users?: {
      legal_name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    } | null;
  }): string {
    const alias = order.customer_alias?.trim();
    if (alias) return alias;
    const legal = order.users?.legal_name?.trim();
    if (legal) return legal;
    const full =
      `${order.users?.first_name ?? ''} ${order.users?.last_name ?? ''}`.trim();
    if (full) return full;
    return order.customer_id ? 'N/A' : 'Consumidor Final';
  }

  /**
   * Normaliza una fila hidratada en vivo con las mismas reglas de
   * `loadOrders` (mesa plana, números, `resolveCustomerName` sobre el
   * `users` que trae el GET por id — sin fetch extra de cliente).
   */
  private normalizeLiveOrderRow(order: any): any {
    const ts = order?.table_sessions?.[0];
    const mesa = ts?.table?.name
      ? ts.table.zone
        ? `${ts.table.name} (${ts.table.zone})`
        : ts.table.name
      : null;
    const toNum = (v: unknown): number =>
      typeof v === 'string' ? parseFloat(v) : (v as number);
    const row: any = {
      ...order,
      mesa,
      customer_id:
        typeof order.customer_id === 'string'
          ? parseInt(order.customer_id)
          : order.customer_id,
      grand_total: toNum(order.grand_total),
      net_total: toNum(order.net_total ?? order.grand_total),
      list_state: order.is_partially_refunded ? 'partially_refunded' : order.state,
      subtotal_amount: toNum(order.subtotal_amount),
      tax_amount: toNum(order.tax_amount),
      shipping_cost: toNum(order.shipping_cost),
      discount_amount: toNum(order.discount_amount),
      customer_name: this.resolveCustomerName(order),
    };
    // La fila nueva no está en `seenOrderIds` y su `created_at` es reciente,
    // así que `isNewOrder`/`rowClassFn` la resaltan sin más wiring.
    return row;
  }

  /**
   * Anuncia la orden nueva. En ráfaga (>10 creadas en 60s) colapsa en un
   * único toast resumen para no spamear al vendedor (tormenta de toasts).
   */
  private announceLiveOrder(orderNumber: string): void {
    const now = Date.now();
    this.recentCreatedAt = this.recentCreatedAt.filter(
      (t) => now - t < 60_000,
    );
    this.recentCreatedAt.push(now);
    if (this.recentCreatedAt.length > 10) {
      this.toastService.info(
        `${this.recentCreatedAt.length} órdenes nuevas en el último minuto.`,
        'Órdenes en vivo',
      );
    } else {
      this.toastService.success(`Nueva orden ${orderNumber} recibida`);
    }
  }

  /**
   * Snapshot of the list's pagination for the parent's Vexi host (G3).
   *
   * Read-only: the host reports it in `readScreen`, and every change still
   * goes through this component's own handlers (`onSearchChange`,
   * `onFilterChange`, `onPageChange`, `onSort`).
   */
  vexiPaginationState(): {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    sort: string;
  } {
    const limit = this._filters.limit || 10;
    const total = this.totalItems();
    return {
      page: this._filters.page || 1,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      sort: `${this._filters.sort_by || 'created_at'}:${this._filters.sort_order || 'desc'}`,
    };
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
      this._filters.sort_by = event.column === 'list_state' ? 'state' : event.column;
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
    if (order.cancellation_policy?.can_cancel !== true) {
      const code = order.cancellation_policy?.reason_code;
      this.toastService.warning(
        code
          ? ERROR_MESSAGES[code]
          : 'No se puede anular esta orden. Abre el detalle para consultar las acciones disponibles.',
      );
      return;
    }
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
            this.toastService.error(extractApiErrorMessage(error));
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
      partially_refunded: 'Reembolso parcial',
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
