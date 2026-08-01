/**
 * Vista dedicada de operaciones masivas de órdenes (QUI-599).
 *
 * ## Layout
 *
 * Dos paneles: a la izquierda buscar/filtrar/seleccionar, a la derecha el
 * stack de seleccionados y la barra de acciones. Arriba, `app-sticky-header`
 * con "Volver" y "Imprimir" (la acción de impresión es la única que abre
 * el diálogo de impresión del navegador; las demás piden confirmación).
 *
 * ## Quién es dueño de qué
 *
 * - **`selectedIds`** — el `Set` vive aquí, no en el panel de resultados.
 *   Es lo que hace que la selección sobreviva a cambiar de página, de
 *   filtro y de breakpoint: el panel se repinta con otra página de
 *   órdenes y el `Set` no se entera. Si viviera en el panel, cada recarga
 *   lo vaciaría.
 * - **`orderCache`** — mapa `id → Order` que solo crece. Alimenta el
 *   stack con `order_number` y `customer_name` de órdenes que ya no
 *   están en la página cargada.
 *
 * ## Acciones y permisos
 *
 * Las acciones requieren `store:orders:bulk_update` (transición / asignar
 * ruta) o `store:orders:bulk_print` (impresión). Son affordances de UI;
 * la autorización real la impone el backend por nombre en el controller.
 *
 * ## Impresión
 *
 * El backend devuelve DATOS (órdenes hidratadas + formato + copias de la DB) y
 * el documento lo dibuja `PosTicketService.printTicketsBatch` — el MISMO
 * renderer del tiquete post-venta del POS y de la previsualización de
 * Ajustes → Recibos, así que la paridad de formato está garantizada por
 * construcción. La composición vive en `OrdersBulkPrintService`; esta vista solo
 * dispara, avisa del gasto de papel y reporta el desenlace.
 *
 * El diálogo del navegador es BLOQUEANTE: `printSelection` resuelve cuando el
 * operador lo cierra, no cuando el documento está armado. Por eso `running()`
 * sigue en `true` durante el diálogo (el botón del header queda en loading) y la
 * barra distingue "dibujando" de "esperando el diálogo".
 */

import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  ButtonComponent,
  IconComponent,
  StickyHeaderComponent,
  ToastService,
  type SelectorOption,
  type StickyHeaderActionButton,
} from '../../../../../shared/components/index';
import {
  OrdersBulkConfirmModalComponent,
  type BulkOrdersConfirmRequest,
} from './orders-bulk-confirm-modal.component';
import { CustomersService } from '../../customers/services/customers.service';
import {
  Order,
  OrderQuery,
  OrderState,
  OrderChannel,
  PaymentStatus,
} from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';
import { OrdersBulkService } from './orders-bulk.service';
import { OrdersBulkPrintService } from './orders-bulk-print.service';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import {
  MAX_BULK_ORDERS_IDS,
  type BulkOrderTransitionTarget,
  type BulkOrdersResult,
  type BulkPrintOutcome,
} from './orders-bulk.interface';
import { PlanillasRutasService } from '../../planillas-rutas/services/planillas-rutas.service';
import type { DispatchRoute } from '../../planillas-rutas/interfaces/planilla.interface';

/**
 * `Order` enriquecido con `customer_name`, el campo que `orders-list` y esta
 * vista calculan en runtime a partir de `customersService.getCustomer`. La
 * interfaz `Order` no lo declara porque no es persistido — se agrega aquí
 * para que el template y el stack tipen sin `any`. Es opcional: las órdenes
 * hidratadas vía `getOrderById` pueden no traerlo y el stack degrada a 'N/A'.
 */
type OrderWithCustomer = Order & { customer_name?: string };

/** Tamaño de página del panel de resultados. */
const PAGE_SIZE = 20;

/**
 * Acción de la barra. El `id` viaja al handler del header; los demás
 * campos son affordance de UI. Cada acción mapea a un endpoint distinto
 * del carril masivo.
 */
type BulkActionId =
  | 'finished'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'assign-route'
  | 'print';

/**
 * Grupo al que pertenece una acción. Gobierna en qué `<section>` del panel se
 * pinta, calcando la distribución de `bulk-changes-panel` en productos: un
 * panel a lo ancho, con secciones tituladas y una fila por operación.
 * `danger` recibe tratamiento aparte y va SIEMPRE al final.
 */
type BulkActionGroupKey = 'state' | 'dispatch' | 'documents' | 'danger';

interface BulkActionDef {
  id: BulkActionId;
  group: BulkActionGroupKey;
  /** Título de la fila. */
  label: string;
  /** Qué hace realmente, en una línea. Es lo que evita el botón mudo. */
  description: string;
  /** Texto del botón. Corto: la fila ya explica. */
  cta: string;
  icon: string;
  variant: 'primary' | 'outline' | 'danger';
  /** Permiso requerido (affordance; el backend refuerza por nombre). */
  permission: 'store:orders:bulk_update' | 'store:orders:bulk_print';
  /** Confirmación reforzada antes de disparar. */
  confirm: boolean;
  confirmTitle: string;
  confirmMessage: string;
}

interface BulkActionGroup {
  key: BulkActionGroupKey;
  label: string;
  icon: string;
  hint: string;
  actions: BulkActionDef[];
}

/**
 * Catálogo plano de operaciones. Se agrupa en runtime por `group` para que
 * agregar una operación nueva sea una entrada aquí y nada más — no hay que
 * tocar el template ni recordar en qué sección insertarla.
 */
const BULK_ACTIONS: BulkActionDef[] = [
  {
    id: 'finished',
    group: 'state',
    label: 'Finalizar órdenes',
    description:
      'Cierra las órdenes: hace commit del inventario reservado y emite los eventos de cierre por cada una.',
    cta: 'Finalizar',
    icon: 'check-circle',
    variant: 'primary',
    permission: 'store:orders:bulk_update',
    confirm: true,
    confirmTitle: 'Finalizar órdenes',
    confirmMessage:
      '¿Marcar las órdenes seleccionadas como finalizadas? Se ejecutarán los efectos de cierre (commit de inventario, emisión de eventos) por cada orden.',
  },
  {
    id: 'shipped',
    group: 'state',
    label: 'Marcar como enviadas',
    description:
      'Pasa las órdenes a enviada y emite los eventos de envío. No crea remisiones.',
    cta: 'Marcar enviadas',
    icon: 'truck',
    variant: 'outline',
    permission: 'store:orders:bulk_update',
    confirm: true,
    confirmTitle: 'Marcar órdenes como enviadas',
    confirmMessage:
      '¿Marcar las órdenes seleccionadas como enviadas? Se emitirán los eventos de envío y se actualizará el estado de cada orden.',
  },
  {
    id: 'delivered',
    group: 'state',
    label: 'Marcar como entregadas',
    description:
      'Ejecuta el flujo de entrega por orden. Úsalo cuando el reparto ya se confirmó fuera del sistema.',
    cta: 'Marcar entregadas',
    icon: 'package-check',
    variant: 'outline',
    permission: 'store:orders:bulk_update',
    confirm: true,
    confirmTitle: 'Marcar órdenes como entregadas',
    confirmMessage:
      '¿Marcar las órdenes seleccionadas como entregadas? Se ejecutará el flujo de entrega por cada orden.',
  },
  {
    id: 'assign-route',
    group: 'dispatch',
    label: 'Crear remisiones y asignar a ruta',
    description:
      'Genera la remisión de cada orden y la agrega como parada a la planilla que elijas. Las órdenes que ya tengan remisión se omiten.',
    cta: 'Elegir planilla',
    icon: 'navigation',
    variant: 'outline',
    permission: 'store:orders:bulk_update',
    confirm: true,
    confirmTitle: 'Crear remisiones y asignar a ruta',
    confirmMessage:
      '¿Crear remisiones para las órdenes seleccionadas y asignarlas como stops a la planilla elegida? Las órdenes que ya tengan remisión se omitirán.',
  },
  {
    id: 'print',
    group: 'documents',
    label: 'Imprimir tiquetes POS',
    description:
      'Imprime el tiquete POS de cada orden seleccionada en una sola tanda, con el mismo formato de papel y número de copias configurados en Ajustes → Recibos.',
    cta: 'Imprimir',
    icon: 'printer',
    variant: 'primary',
    permission: 'store:orders:bulk_print',
    confirm: false,
    confirmTitle: '',
    confirmMessage: '',
  },
  {
    id: 'cancelled',
    group: 'danger',
    label: 'Cancelar órdenes',
    description:
      'Libera las reservas de stock y cancela los pagos asociados de cada orden. No se puede deshacer.',
    cta: 'Cancelar órdenes',
    icon: 'x-circle',
    variant: 'danger',
    permission: 'store:orders:bulk_update',
    confirm: true,
    confirmTitle: 'Cancelar órdenes',
    confirmMessage:
      '¿Cancelar las órdenes seleccionadas? Esta acción liberará reservas de stock y cancelará pagos asociados. No se puede deshacer.',
  },
];

/** Título del modal para la asignación a ruta (no viene de un `BulkActionDef`). */
const ASSIGN_ROUTE_TITLE = 'Crear remisiones y asignar a planilla';

/** Metadatos de presentación por grupo. El orden aquí es el orden en pantalla. */
const GROUP_META: Array<Omit<BulkActionGroup, 'actions'>> = [
  {
    key: 'state',
    label: 'Estado de la orden',
    icon: 'check-circle',
    hint: 'Cada orden ejecuta su cadena completa de efectos, igual que si la transicionaras una por una.',
  },
  {
    key: 'dispatch',
    label: 'Despacho',
    icon: 'truck',
    hint: 'Convierte la selección en documentos de despacho y paradas de ruta.',
  },
  {
    key: 'documents',
    label: 'Documentos',
    icon: 'printer',
    hint: 'Imprime los documentos de la selección en una sola tanda, con un único diálogo de impresión.',
  },
];

@Component({
  selector: 'app-orders-bulk-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    ButtonComponent,
    StickyHeaderComponent,
    OrdersBulkConfirmModalComponent,
  ],
  templateUrl: './orders-bulk-page.component.html',
  styleUrl: './orders-bulk-page.component.scss',
})
export class OrdersBulkPageComponent {
  private readonly ordersService = inject(StoreOrdersService);
  private readonly bulkService = inject(OrdersBulkService);
  private readonly bulkPrintService = inject(OrdersBulkPrintService);
  private readonly customersService = inject(CustomersService);
  private readonly routesService = inject(PlanillasRutasService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // ───────────────────────────────────────────────────────────────────────────
  // Resultados y paginación (servidor)
  // ───────────────────────────────────────────────────────────────────────────

  readonly orders = signal<OrderWithCustomer[]>([]);
  readonly fetching = signal<boolean>(false);
  readonly page = signal<number>(1);
  readonly limit = PAGE_SIZE;
  readonly totalItems = signal<number>(0);
  readonly totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.totalItems() / this.limit)),
  );

  readonly searchTerm = signal<string>('');
  readonly selectedStatus = signal<string>('');
  readonly selectedChannel = signal<string>('');
  readonly selectedPaymentStatus = signal<string>('');

  // ───────────────────────────────────────────────────────────────────────────
  // Selección
  // ───────────────────────────────────────────────────────────────────────────

  readonly selectedIds = signal<Set<number>>(new Set<number>());
  readonly running = signal<boolean>(false);
  readonly maxIds = MAX_BULK_ORDERS_IDS;

  /** `id → OrderWithCustomer`. Solo crece: es lo que hace que el stack no pierda fichas. */
  private readonly orderCache = signal<Map<number, OrderWithCustomer>>(
    new Map<number, OrderWithCustomer>(),
  );

  readonly selectedIdList = computed<number[]>(() =>
    [...this.selectedIds()].sort((a, b) => a - b),
  );

  readonly selectedCount = computed<number>(() => this.selectedIds().size);

  /**
   * Cuántas órdenes más caben en la selección. La UI corta en `maxIds`, así que
   * esto nunca es negativo: es el presupuesto restante, no un exceso.
   */
  readonly remainingSlots = computed<number>(() =>
    Math.max(0, this.maxIds - this.selectedCount()),
  );

  /**
   * La selección tocó el techo. No es un estado de error: la operación es
   * perfectamente válida con 300, solo que no admite una más.
   */
  readonly atLimit = computed<boolean>(
    () => this.selectedCount() >= this.maxIds,
  );

  /**
   * Zona de aviso: el operador se está acercando al tope y conviene que lo vea
   * ANTES de chocar contra él. 90% del cupo — con 300, avisa a partir de 270.
   */
  readonly nearLimit = computed<boolean>(
    () => !this.atLimit() && this.selectedCount() >= this.maxIds * 0.9,
  );

  /**
   * Color del contador. Tres estados, no dos: `neutral` mientras sobra sitio,
   * `warning` en la recta final, `danger` al tope. Que el aviso aparezca antes
   * del bloqueo es lo que evita que el operador descubra el límite justo cuando
   * ya no puede hacer nada.
   */
  readonly limitTone = computed<'neutral' | 'warning' | 'danger'>(() =>
    this.atLimit() ? 'danger' : this.nearLimit() ? 'warning' : 'neutral',
  );

  /**
   * Gate residual por si la selección llegara por encima del tope sin pasar por
   * `toggleRow` / `toggleAllVisible` (p. ej. un estado restaurado). Con la
   * selección ya acotada en origen no debería dispararse nunca.
   */
  readonly overLimit = computed<boolean>(
    () => this.selectedCount() > this.maxIds,
  );

  /** Filas del stack. Sin ficha todavía → se pinta el id, nunca un hueco. */
  readonly selectedEntries = computed<
    Array<{ id: number; order_number: string; customer_name: string; state: string; hydrated: boolean }>
  >(() => {
    const cache = this.orderCache();
    return this.selectedIdList().map((id) => {
      const order = cache.get(id);
      if (!order) {
        return {
          id,
          order_number: `#${id}`,
          customer_name: 'N/A',
          state: '',
          hydrated: false,
        };
      }
      return {
        id,
        order_number: order.order_number,
        customer_name: order.customer_name ?? 'N/A',
        state: order.state,
        hydrated: true,
      };
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Rutas (para el selector de asignar a ruta)
  // ───────────────────────────────────────────────────────────────────────────

  readonly routes = signal<DispatchRoute[]>([]);
  readonly routeOptions = computed<SelectorOption[]>(() =>
    this.routes().map((r) => ({
      value: r.id,
      label: `${r.route_number}${r.route_code ? ` (${r.route_code})` : ''}`,
      description: `${r.status} · ${new Date(r.planned_date).toLocaleDateString()}`,
    })),
  );
  readonly selectedRouteId = signal<number | null>(null);
  readonly routeSelectorOpen = signal<boolean>(false);

  // ───────────────────────────────────────────────────────────────────────────
  // Pre-confirmación
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Operación pendiente de confirmar. Se setea ANTES de abrir el modal para que
   * su `effect` de apertura ya encuentre el request y pueda disparar el dry-run
   * en el mismo ciclo — al revés, el modal abriría sin saber qué previsualizar.
   */
  readonly confirmRequest = signal<BulkOrdersConfirmRequest | null>(null);
  readonly confirmOpen = signal<boolean>(false);

  // ───────────────────────────────────────────────────────────────────────────
  // Permisos (affordance; el backend refuerza por nombre)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Misma mecánica que `canBulkEditProducts` en `products.component.ts:168-170`
   * (QUI-567): `AuthFacade.hasPermission` lee el signal `userPermissions`, así
   * que el `computed` es reactivo. Es afordancia de UI; el backend impone la
   * autorización y además la refuerza por nombre en el controller.
   *
   * SIN fallback a `isAdmin()` a propósito. `selectIsAdmin` solo matchea
   * `admin` / `super_admin` (`auth.selectors.ts:117-124`), así que para un
   * `owner` — el rol de la cuenta con la que se opera la tienda — era `false`
   * y no rescataba nada; y para un `admin` habría sido un bypass silencioso
   * del permiso, justo lo que la separación `bulk_update` / `bulk_print`
   * busca evitar. El rol `owner` recibe estos permisos por el filtro
   * `startsWith('store:')` del seed, no por ser owner en el frontend.
   */
  readonly canBulkUpdate = computed<boolean>(() =>
    this.authFacade.hasPermission('store:orders:bulk_update'),
  );
  readonly canBulkPrint = computed<boolean>(() =>
    this.authFacade.hasPermission('store:orders:bulk_print'),
  );

  /**
   * Operaciones que este usuario puede ver, ya filtradas por permiso. Es la
   * base de la que se derivan las secciones y la zona peligrosa.
   */
  readonly allowedActions = computed<BulkActionDef[]>(() =>
    BULK_ACTIONS.filter((a) =>
      a.permission === 'store:orders:bulk_print'
        ? this.canBulkPrint()
        : this.canBulkUpdate(),
    ),
  );

  /**
   * Secciones no destructivas, en el orden de `GROUP_META`. Los grupos que
   * quedan sin acciones (porque el permiso las filtró todas) se descartan: una
   * sección con título y cero filas solo confunde.
   */
  readonly actionGroups = computed<BulkActionGroup[]>(() => {
    const allowed = this.allowedActions();
    return GROUP_META.map((meta) => ({
      ...meta,
      actions: allowed.filter((a) => a.group === meta.key),
    })).filter((g) => g.actions.length > 0);
  });

  /** Zona peligrosa. Va aparte y SIEMPRE al final, como en productos. */
  readonly dangerActions = computed<BulkActionDef[]>(() =>
    this.allowedActions().filter((a) => a.group === 'danger'),
  );

  readonly hasAnyAction = computed<boolean>(
    () => this.allowedActions().length > 0,
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Header
  // ───────────────────────────────────────────────────────────────────────────

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'back', label: 'Volver', variant: 'outline', icon: 'arrow-left' },
    {
      id: 'print',
      label: 'Imprimir selección',
      variant: 'primary',
      icon: 'printer',
      disabled:
        this.selectedCount() === 0 || !this.canBulkPrint() || this.overLimit(),
      loading: this.running() && this.bulkService.progress().phase === 'print',
      visible: this.canBulkPrint(),
    },
  ]);

  readonly headerMetadata = computed<string>(() => {
    const selected = this.selectedCount();
    return `${selected} ${selected === 1 ? 'seleccionada' : 'seleccionadas'}`;
  });

  readonly progress = this.bulkService.progress;

  /**
   * Avance del render de tiquetes. Es OTRA señal que `progress`: esa cuenta
   * lotes HTTP pedidos y llega a 100% en cuanto los datos están; esta cuenta
   * tiquetes dibujados, que es la parte larga con 300 órdenes.
   */
  readonly renderProgress = this.bulkPrintService.renderProgress;

  /**
   * Aviso de gasto de papel ANTES de pulsar.
   *
   * Con 300 órdenes y `pos_ticket_copies: 2` salen 600 hojas, y hasta ahora no
   * había ninguna señal previa: el operador lo descubría en el diálogo de
   * impresión, o en la bandeja. El conteo se pinta inline en la sección
   * Documentos — no hay modal nuevo, porque el dato debe estar visible mientras
   * se construye la selección, no solo al confirmar.
   *
   * Las copias vienen del snapshot local (`configuredCopies`), que es lo único
   * disponible antes de pedir nada. Al imprimir manda el valor canónico de la DB
   * (`payload.pos_ticket_copies`), así que si el comerciante cambió las copias
   * sin re-loguear el aviso puede quedarse corto: es el snapshot rancio de
   * `vendix_auth_state`, no un error de cuenta. Reactivo porque
   * `StoreSettingsFacade.receipts` es un `computed`.
   */
  readonly printVolumeNotice = computed<string>(() => {
    const tickets = this.selectedCount();
    if (tickets === 0) return '';

    const copies = this.bulkPrintService.configuredCopies();
    const pages = tickets * copies;

    const ticketLabel = tickets === 1 ? 'tiquete' : 'tiquetes';
    const pageLabel = pages === 1 ? 'página' : 'páginas';
    // En carta y media carta la hoja tiene alto FIJO, así que un tiquete largo
    // se fragmenta en dos y `tiquetes × copias` queda por debajo del papel real
    // (medido: una orden de 16 líneas mide 209 mm contra los 140 mm de la media
    // carta). Prometer un número exacto ahí sería justo la sorpresa que este
    // aviso existe para evitar.
    const exact = this.bulkPrintService.pageCountIsExact();
    const base = `${tickets} ${ticketLabel} · ${exact ? '' : 'al menos '}${pages} ${pageLabel}`;

    // La coletilla solo aparece cuando multiplica: con 1 copia, "300 tiquetes ·
    // 300 páginas (1 copia por tiquete)" es ruido.
    return copies > 1 ? `${base} (${copies} copias por tiquete)` : base;
  });

  readonly blockedReason = computed<string>(() => {
    if (this.selectedCount() === 0) {
      return 'Selecciona al menos una orden para ejecutar una operación masiva';
    }
    if (this.overLimit()) {
      return `Máximo ${this.maxIds} órdenes por operación. Tienes ${this.selectedCount()} seleccionadas.`;
    }
    return '';
  });

  constructor() {
    this.fetchPage();
    this.loadRoutes();

    // Hidratación del stack. Se dispara SOLO cuando cambia la selección.
    effect(() => {
      const ids = this.selectedIdList();
      untracked(() => this.hydrateMissing(ids));
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Carga de datos
  // ───────────────────────────────────────────────────────────────────────────

  private buildQuery(): OrderQuery {
    const query: OrderQuery = {
      page: this.page(),
      limit: this.limit,
      sort_by: 'created_at',
      sort_order: 'desc',
    };
    if (this.searchTerm()) query.search = this.searchTerm();
    if (this.selectedStatus()) query.status = this.selectedStatus() as OrderState;
    if (this.selectedChannel()) query.channel = this.selectedChannel() as OrderChannel;
    if (this.selectedPaymentStatus())
      query.payment_status = this.selectedPaymentStatus() as PaymentStatus;
    return query;
  }

  private fetchPage(): void {
    this.fetching.set(true);
    this.ordersService
      .getOrders(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const paginatedData = response.data || response;
          const rawOrders = paginatedData.data || paginatedData || [];
          const normalizedOrders = rawOrders.map((order: any) => ({
            ...order,
            grand_total:
              typeof order.grand_total === 'string'
                ? parseFloat(order.grand_total)
                : order.grand_total,
          }));
          const paginationInfo = paginatedData.pagination || {
            total: rawOrders.length,
          };
          this.totalItems.set(paginationInfo.total || 0);

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
                  this.orders.set(
                    normalizedOrders.map((order: any) => ({
                      ...order,
                      customer_name: order.customer_id
                        ? `${customerMap.get(order.customer_id)?.first_name || ''} ${customerMap.get(order.customer_id)?.last_name || ''}`.trim() ||
                          'N/A'
                        : 'Consumidor Final',
                    })),
                  );
                  this.mergeIntoCache(this.orders());
                  this.fetching.set(false);
                },
                error: () => {
                  this.orders.set(
                    normalizedOrders.map((order: any) => ({
                      ...order,
                      customer_name: order.customer_id ? 'N/A' : 'Consumidor Final',
                    })),
                  );
                  this.mergeIntoCache(this.orders());
                  this.fetching.set(false);
                },
              });
          } else {
            this.orders.set(
              normalizedOrders.map((order: any) => ({
                ...order,
                customer_name: order.customer_id ? 'N/A' : 'Consumidor Final',
              })),
            );
            this.mergeIntoCache(this.orders());
            this.fetching.set(false);
          }
        },
        error: (err: unknown) => {
          this.toastService.error(extractApiErrorMessage(err));
          this.fetching.set(false);
        },
      });
  }

  private loadRoutes(): void {
    this.routesService
      .listRoutes({ status: 'draft,dispatched' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (routes) => this.routes.set(routes),
        error: () => this.routes.set([]),
      });
  }

  private hydrateMissing(ids: readonly number[]): void {
    const cache = this.orderCache();
    const missing = ids.filter((id) => !cache.has(id));
    if (missing.length === 0) return;

    // Hidratación ligera: pide las órdenes que faltan vía getOrderById.
    // Para N órdenes esto son N requests chicas; una sola query `?ids=`
    // no existe en el endpoint de órdenes (a diferencia de productos).
    forkJoin(missing.map((id) => this.ordersService.getOrderById(String(id))))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (orders) => this.mergeIntoCache(orders),
        error: () => {
          /* La hidratación fallida degrada la ficha del stack, no la operación. */
        },
      });
  }

  /** Publica SIEMPRE un `Map` nuevo: mutarlo no notificaría a la señal. */
  private mergeIntoCache(orders: readonly OrderWithCustomer[]): void {
    if (orders.length === 0) return;
    this.orderCache.update((prev) => {
      const next = new Map(prev);
      for (const order of orders) {
        next.set(order.id, order);
      }
      return next;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Handlers de UI
  // ───────────────────────────────────────────────────────────────────────────

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.page.set(1);
    this.fetchPage();
  }

  onStatusChange(value: string): void {
    this.selectedStatus.set(value);
    this.page.set(1);
    this.fetchPage();
  }

  onChannelChange(value: string): void {
    this.selectedChannel.set(value);
    this.page.set(1);
    this.fetchPage();
  }

  onPageChanged(page: number): void {
    this.page.set(page);
    this.fetchPage();
  }

  onRefresh(): void {
    this.fetchPage();
  }

  /**
   * Marca o desmarca una orden, respetando el tope.
   *
   * El tope se aplica AQUÍ y no solo al ejecutar: dejar marcar 500 casillas
   * para después negarse a operar obliga al operador a deshacer a mano. Cortar
   * en la 301 y decir por qué es una interacción, no un castigo.
   *
   * Desmarcar nunca se bloquea, aunque la selección esté al tope: reducir
   * siempre debe ser posible.
   */
  toggleRow(id: number, checked: boolean): void {
    if (checked && !this.selectedIds().has(id) && this.atLimit()) {
      this.toastService.warning(
        `Llegaste al máximo de ${this.maxIds} órdenes. Quita alguna para seleccionar otra.`,
      );
      return;
    }
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Marca o desmarca todas las órdenes de la página visible.
   *
   * Cuando la página no cabe entera en el cupo restante se añade lo que quepa
   * —no se descarta la acción completa— y se dice exactamente cuántas quedaron
   * fuera. Un "no se pudo" a secas dejaría al operador sin saber si se agregó
   * algo ni cuánto le falta.
   */
  toggleAllVisible(checked: boolean): void {
    const visibleIds = this.orders().map((o) => o.id);

    if (!checked) {
      this.selectedIds.update((prev) => {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      });
      return;
    }

    const current = this.selectedIds();
    const toAdd = visibleIds.filter((id) => !current.has(id));
    const room = this.remainingSlots();

    if (toAdd.length > room) {
      this.toastService.warning(
        room === 0
          ? `Llegaste al máximo de ${this.maxIds} órdenes. Quita alguna para seguir agregando.`
          : `Se agregaron ${room} de ${toAdd.length} órdenes: el máximo por operación es ${this.maxIds}.`,
      );
    }

    if (room === 0) return;

    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      toAdd.slice(0, room).forEach((id) => next.add(id));
      return next;
    });
  }

  onRemoveFromStack(id: number): void {
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  onClearStack(): void {
    this.selectedIds.set(new Set<number>());
  }

  /**
   * Elegir la planilla NO ejecuta: encadena al modal de pre-confirmación con el
   * `route_id` ya resuelto. Antes de QUI-599 esto disparaba la escritura de
   * inmediato, que es justo lo que la pre-confirmación viene a evitar.
   */
  onRouteSelected(routeId: number): void {
    this.selectedRouteId.set(routeId);
    this.routeSelectorOpen.set(false);
    this.confirmRequest.set({
      kind: 'assign-route',
      route_id: routeId,
      title: ASSIGN_ROUTE_TITLE,
      subtitle:
        'Revisa qué órdenes van a producir remisión antes de crearlas',
      confirmVerb: 'Remitir',
      danger: false,
    });
    this.confirmOpen.set(true);
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'back') {
      void this.router.navigate(['/admin/orders/sales']);
      return;
    }
    if (actionId === 'print') {
      this.runPrint();
      return;
    }
  }

  /**
   * Punto único de entrada para las acciones de la barra. Cada acción
   * decide si pide confirmación, si necesita el selector de ruta, o si
   * dispara directamente.
   */
  onActionClick(action: BulkActionDef): void {
    if (this.selectedCount() === 0) {
      this.toastService.warning('Selecciona al menos una orden');
      return;
    }
    if (this.overLimit()) {
      this.toastService.warning(
        `Máximo ${this.maxIds} órdenes por operación`,
      );
      return;
    }
    if (this.running()) return;

    if (action.id === 'assign-route') {
      if (this.routes().length === 0) {
        this.toastService.warning(
          'No hay planillas disponibles. Crea una planilla primero.',
        );
        return;
      }
      this.routeSelectorOpen.set(true);
      return;
    }

    if (action.id === 'print') {
      this.runPrint();
      return;
    }

    // Transiciones: abren el modal de pre-confirmación, que dispara el dry-run
    // y solo entonces habilita la escritura. No se escribe nada desde aquí.
    this.confirmRequest.set({
      kind: 'transition',
      targetState: action.id as BulkOrderTransitionTarget,
      title: action.confirmTitle,
      subtitle: action.description,
      confirmVerb: action.cta,
      danger: action.variant === 'danger',
    });
    this.confirmOpen.set(true);
  }

  /**
   * El modal ya escribió y reportó. La página solo cierra, refresca y limpia:
   * dejar la selección intacta invitaría a re-disparar la misma operación sobre
   * órdenes que ya se movieron.
   */
  onBulkApplied(result: BulkOrdersResult): void {
    this.onOperationDone(result, this.confirmRequest()?.confirmVerb ?? 'operación');
    this.selectedIds.set(new Set<number>());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Ejecución de operaciones
  //
  // Solo queda la impresión. Transición y asignación a ruta las ejecuta el
  // modal de pre-confirmación después del dry-run — tenerlas también aquí
  // dejaría un camino que escribe sin pasar por la confirmación.
  //
  // La impresión NO pasa por el modal a propósito: es de solo lectura (dibuja
  // tiquetes, no muta ninguna orden), así que un dry-run no tendría nada que
  // advertir y solo añadiría un clic al quick win del ticket. El gasto de papel
  // se avisa inline con `printVolumeNotice`, sin robar un clic.
  // ───────────────────────────────────────────────────────────────────────────

  private runPrint(): void {
    if (this.selectedCount() === 0) {
      this.toastService.warning('Selecciona al menos una orden para imprimir');
      return;
    }
    if (!this.canBulkPrint()) {
      this.toastService.error('No tienes permiso para imprimir órdenes en lote');
      return;
    }
    if (this.overLimit()) {
      this.toastService.warning(
        `Máximo ${this.maxIds} órdenes por impresión. Tienes ${this.selectedCount()} seleccionadas.`,
      );
      return;
    }
    const requested = this.selectedCount();
    this.running.set(true);
    // `printSelection` resuelve DESPUÉS de que el operador cierre el diálogo del
    // navegador, no cuando el documento está armado: `window.print()` bloquea.
    // Por eso `running` no se apaga antes — el botón del header debe seguir en
    // loading mientras el diálogo está abierto.
    this.bulkPrintService
      .printSelection(this.selectedIdList())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (outcome) => {
          this.running.set(false);
          this.bulkService.resetProgress();
          this.reportPrintOutcome(outcome, requested);
        },
        error: (err) => this.onOperationError(err),
      });
  }

  /**
   * Traduce el resultado de la impresión a lo que ve el operador.
   *
   * Tres desenlaces, y ninguno puede quedar mudo:
   *
   * 1. **Nada impreso** (`rendered === 0`) — ningún tiquete llegó al papel: o el
   *    backend no encontró nada imprimible, o todos los lotes cayeron, o el
   *    render se rechazó. Se muestra el mensaje REAL (`failureMessage`), que con
   *    el contrato JSON ya es el del backend sin trucos de Blob. El texto
   *    anterior, "Revisa los permisos y la configuración de recibos", se
   *    disparaba ante cualquier fallo y mandaba al operador a revisar dos cosas
   *    que casi nunca eran la causa. El discriminante era `!outcome.blob`
   *    cuando el documento lo generaba el backend.
   * 2. **Parcial** — se imprimió, pero el backend omitió órdenes (canceladas,
   *    reembolsadas, inexistentes). Se imprime Y se advierte, porque un operador
   *    que pidió 20 y recibe 17 tiene que enterarse ahí, no contando hojas.
   * 3. **Completo** — se confirma con el conteo real de tiquetes y de hojas.
   */
  private reportPrintOutcome(
    outcome: BulkPrintOutcome,
    requested: number,
  ): void {
    if (outcome.rendered === 0) {
      this.toastService.error(
        outcome.failureMessage ??
          'No se pudo imprimir ninguna de las órdenes seleccionadas.',
      );
      return;
    }

    const omitted = outcome.skipped.length + outcome.failedIds.length;
    if (omitted === 0) {
      this.toastService.success(
        `${outcome.rendered} de ${requested} órdenes enviadas a la impresora ` +
          `(${outcome.pages} ${outcome.pages === 1 ? 'página' : 'páginas'})`,
      );
      return;
    }

    // Se nombran hasta 3 órdenes concretas: la lista completa puede ser de 80
    // y un toast no es un informe. El conteo sí es siempre el total real.
    const detail = outcome.skipped
      .slice(0, 3)
      .map((s) => s.order_number ?? `#${s.id}`)
      .join(', ');

    this.toastService.warning(
      `${outcome.rendered} de ${requested} órdenes impresas. ` +
        `${omitted} omitidas${detail ? ` (${detail}${omitted > 3 ? '…' : ''})` : ''}: ` +
        'canceladas, reembolsadas o no disponibles.',
    );
  }

  private onOperationDone(result: BulkOrdersResult, label: string): void {
    this.running.set(false);
    this.bulkService.resetProgress();

    if (result.failed === 0) {
      this.toastService.success(
        `${result.successful} órdenes procesadas (${label})`,
      );
    } else {
      this.toastService.warning(
        `${result.successful} ok y ${result.failed} con error (${label})`,
      );
    }

    // Refrescar la página para que el listado refleje el estado real.
    this.fetchPage();
  }

  private onOperationError(err: unknown): void {
    this.running.set(false);
    this.bulkService.resetProgress();
    // `printSelection` no emite error por diseño (traduce todo a un outcome),
    // pero si alguna vez lo hiciera el avance del render no puede quedarse
    // colgado pintando una barra de un lote que ya no existe.
    this.bulkPrintService.resetRenderProgress();
    this.toastService.error(extractApiErrorMessage(err));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers de plantilla
  // ───────────────────────────────────────────────────────────────────────────

  isRowSelected(id: number): boolean {
    return this.selectedIds().has(id);
  }

  areAllVisibleSelected(): boolean {
    const visible = this.orders();
    if (visible.length === 0) return false;
    return visible.every((o) => this.selectedIds().has(o.id));
  }

  areSomeVisibleSelected(): boolean {
    const visible = this.orders();
    if (visible.length === 0) return false;
    return (
      visible.some((o) => this.selectedIds().has(o.id)) &&
      !this.areAllVisibleSelected()
    );
  }

  progressPercent(): number {
    const p = this.progress();
    if (p.totalIds === 0) return 0;
    return Math.round((p.doneIds / p.totalIds) * 100);
  }

  formatStatus(state: string): string {
    const map: Record<string, string> = {
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
    return map[state] || state;
  }

  formatTotal(value: number | string): string {
    return this.currencyService.format(value);
  }
}
