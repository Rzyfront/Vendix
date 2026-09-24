import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, interval } from 'rxjs';
import {
  CardComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  IconComponent,
  ToggleComponent,
  ToastService,
  SpinnerComponent,
  DialogService,
  DropdownComponent,
  ModalComponent,
  ItemCancellationModalComponent,
  cancellationTypeForDestination,
} from '../../../../../../../shared/components/index';
import type { ItemCancellationSubmit } from '../../../../../../../shared/components/index';
import {
  TimelineStep,
  TimelineVariant,
} from '../../../../../../../shared/components/timeline/timeline.interfaces';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import {
  Table,
  TableSession,
  TableSessionOrderItem,
  TableSessionAddItem,
  TableStatus,
  KitchenTicketItemRefStatus,
  PaymentPendingView,
  TransferResult,
  SplitResult,
  TableOrderReassignmentEvidence,
} from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { AdminTablesSseService } from '../../services/admin-tables-sse.service';
import {
  KitchenTicketsService,
  KdsSseService,
  KitchenMutationError,
} from '../../../kds/services';
import type {
  FireConfirmPayload,
  FireItemExclusion,
  FirePreview,
} from '../../../kds/interfaces';
import { KitchenConfirmModalComponent } from '../../../kds/components/kitchen-confirm-modal/kitchen-confirm-modal.component';
import {
  parseApiError,
  withApiErrorReference,
  readApiErrorRequestId,
} from '../../../../../../../core/utils/parse-api-error';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { AddItemsModalComponent } from '../../components/add-items-modal/add-items-modal.component';
import { SplitAccountsPanelComponent } from '../../components/split-accounts-panel/split-accounts-panel.component';
import { SplitOrderModalComponent } from '../../components/split-order-modal/split-order-modal.component';
import {
  TablePaymentModalComponent,
  TablePaymentSubmit,
  TablePaymentConfirmSubmit,
} from '../../components/table-payment-modal/table-payment-modal.component';
import { AssignCustomerModalComponent } from '../../components/assign-customer-modal/assign-customer-modal.component';
import { QuickStatusModalComponent } from '../../components/quick-status-modal/quick-status-modal.component';
import { TransferTableModalComponent } from '../../components/transfer-table-modal/transfer-table-modal.component';

/** One entry of the `Opciones` overflow menu (desktop dropdown + mobile action sheet). */
interface SecondaryAction {
  id: 'pay' | 'split' | 'transfer' | 'reassign' | 'customer' | 'table-status' | 'history' | 'close';
  label: string;
  icon: string;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * Open-check / table administration page (zona A — administración de una mesa).
 *
 * The sticky header keeps ONLY the core flow: native back button, "Agregar
 * items", and (when `restaurant.enable_table_checkout` is ON) "Cobrar".
 * Everything else moved to context:
 *  - Resumen card → secondary actions (dividir, cambiar estado, asignar
 *    cliente, cerrar mesa) + the assigned customer + payment status.
 *  - Items card → per-dish actions: fire a single item, kitchen-state
 *    badge, "marcar entregado". Multi-select + "enviar seleccionados"
 *    stays as an optional shortcut.
 *
 * Real-time kitchen state: subscribes to the store-wide KDS SSE stream and
 * filters by this session's `order_id`, merging ticket events into a
 * Map<order_item_id, status>. Badges derive from that map (live) with a
 * fallback to the `kitchen_ticket_items` carried by the findOne contract.
 * Degrades gracefully if SSE fails (polling/manual mode handled by the
 * shared `KdsSseService`).
 */
@Component({
  selector: 'app-table-session-page',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    ButtonComponent,
    IconComponent,
    ToggleComponent,
    SpinnerComponent,
    DropdownComponent,
    ModalComponent,
    ItemCancellationModalComponent,
    CurrencyPipe,
    AddItemsModalComponent,
    SplitOrderModalComponent,
    SplitAccountsPanelComponent,
    TablePaymentModalComponent,
    AssignCustomerModalComponent,
    KitchenConfirmModalComponent,
    QuickStatusModalComponent,
    TransferTableModalComponent,
  ],
  templateUrl: './table-session-page.component.html',
  styleUrl: './table-session-page.component.scss',
})
export class TableSessionPageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
  private readonly kitchenService = inject(KitchenTicketsService);
  private readonly kdsSse = inject(KdsSseService);
  private readonly adminTablesSse = inject(AdminTablesSseService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  // C.7 (§5.3) — par del .html: la nota informativa necesita el gate fiscal.
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly session = signal<TableSession | null>(null);
  readonly waiterName = computed(() => {
    const waiter = this.session()?.table?.waiter;
    return waiter ? `${waiter.first_name} ${waiter.last_name}`.trim() : null;
  });
  private readonly paidFromSseSessionId = signal<number | null>(null);
  readonly isLoading = signal(false);
  readonly selectedItemIds = signal<Set<number>>(new Set());
  readonly isAddItemsOpen = signal(false);
  readonly isSplitOpen = signal(false);
  readonly hasFinancialSplit = signal(false);
  /** Null until the order detail proves the closed check has no financial blockers. */
  readonly reassignmentEvidence = signal<TableOrderReassignmentEvidence | null>(null);
  readonly reassignmentFloorLoaded = signal(false);
  readonly splitRefreshKey = signal(0);
  readonly isPayOpen = signal(false);
  readonly isAssignCustomerOpen = signal(false);
  readonly isAddingItems = signal(false);
  readonly isFiring = signal(false);
  readonly firingItemId = signal<number | null>(null);
  /**
   * QUI-652 — spinner de la línea que se está entregando por el seam de mesa.
   * La entrega se dirige al item, no al ticket compartido con otros platos.
   */
  readonly deliveringItemId = signal<number | null>(null);
  /**
   * QUI-655 — estado del modal de confirmacion de cocina. `pendingFireIds`
   * sobrevive al modal porque el confirm necesita los MISMOS ids que se
   * previsualizaron: recalcularlos desde la seleccion podria dar otro conjunto si
   * el operador toco algo mientras el modal estaba abierto.
   */
  readonly kitchenConfirmOpen = signal(false);
  readonly kitchenPreview = signal<FirePreview | null>(null);
  readonly kitchenPreviewLoading = signal(false);
  private readonly pendingFireIds = signal<number[]>([]);
  private readonly pendingFireSingleId = signal<number | null>(null);
  readonly isSplitting = signal(false);
  readonly isClosing = signal(false);
  readonly isPaying = signal(false);
  readonly isAssigningCustomer = signal(false);
  /** Order-item id currently being removed (drives the per-row spinner). */
  readonly removingItemId = signal<number | null>(null);
  /** Order-item id whose note is currently being updated. */
  readonly updatingNoteItemId = signal<number | null>(null);
  /**
   * D.4 — objetivo del modal compartido "Destino del plato" (solo preparados;
   * el resto conserva el flujo confirm+prompt). `null` = modal cerrado.
   */
  readonly cancellationTarget = signal<TableSessionOrderItem | null>(null);
  /** Error de red del último submit; se muestra dentro del modal sin cerrarlo. */
  readonly cancellationError = signal<string | null>(null);
  readonly cancellationModalOpen = computed(() => this.cancellationTarget() !== null);
  readonly cancellationPreparedFired = computed(
    () => this.cancellationTarget()?.inventory_consumed_at_fire === true,
  );
  /**
   * D.4 — mesa NO pasa preview: el GET de sesión no trae `order_item_taxes`
   * por línea ni `tip_*` de la orden, así que el espejo no puede correr
   * exacto y el modal muestra la nota de total actual. Mismo componente,
   * sin inventar el impuesto de la línea.
   */
  readonly mesaCancellationPreview = signal<null>(null);

  /**
   * Clock tick (ms), refreshed every 60s. Drives `elapsedSinceOpen` and
   * `firedMinutesFor` without a per-row `setInterval` — a single ticker for
   * the whole page, cleaned up via `takeUntilDestroyed` in the constructor.
   */
  private readonly now = signal(Date.now());

  /** `···` overflow menu — desktop dropdown / mobile action sheet. */
  readonly isActionsSheetOpen = signal(false);
  /** Quick-status modal (table status change + history). */
  readonly isQuickStatusOpen = signal(false);
  readonly statusModalShowsHistory = signal(false);
  /** Transfer modal (cambiar de mesa / swap de cuentas). */
  readonly isTransferOpen = signal(false);
  readonly tableMoveMode = signal<'transfer' | 'reassign'>('transfer');
  /** Mobile-only: collapses the account detail below the totals row. */
  readonly summaryExpanded = signal(false);

  // ── Pending payments (E2 — staff confirmation) ────────────────────
  /** Pending manual payments for the order backing this session. */
  readonly pendingPayments = signal<PaymentPendingView[]>([]);
  readonly isLoadingPendingPayments = signal(false);
  readonly isConfirmOpen = signal(false);
  readonly pendingConfirmPayment = signal<PaymentPendingView | null>(null);
  readonly isConfirmingPayment = signal(false);

  /**
   * Live kitchen state merged from SSE: order_item_id → kitchen status.
   * Seeded/refreshed from `kitchen_ticket_items` on every findOne, then
   * upserted by KDS ticket events that touch this order.
   */
  private readonly liveKitchenState = signal<
    Map<number, KitchenTicketItemRefStatus>
  >(new Map());

  // ── Derived state ─────────────────────────────────────────────────────

  readonly items = computed<TableSessionOrderItem[]>(
    () => this.session()?.order?.order_items ?? [],
  );

  readonly orderTotal = computed(() =>
    Number(this.session()?.order?.grand_total ?? 0),
  );

  readonly orderSubtotal = computed(() =>
    Number(this.session()?.order?.subtotal_amount ?? 0),
  );

  readonly orderTax = computed(() =>
    Number(this.session()?.order?.tax_amount ?? 0),
  );

  readonly orderDiscount = computed(() =>
    Number(this.session()?.order?.discount_amount ?? 0),
  );

  /** Average spend per guest (`orderTotal / guest_count`, floor 1 guest). */
  readonly perGuestAverage = computed(() => {
    const guests = Math.max(1, this.session()?.guest_count ?? 1);
    return this.orderTotal() / guests;
  });

  /**
   * Elapsed since the session opened, degrading by magnitude so a stale
   * table never reads as "482 h 26 min": `< 1h` → "X min", `< 48h` →
   * "X h Y min", `>= 48h` → "X d Y h". Re-evaluates every 60s off the
   * shared `now` ticker.
   */
  /**
   * ¿El desglose aporta algo? Sin impuesto ni descuento, `subtotal` es igual
   * a `total` y las filas de desglose sólo repiten la misma cifra tres veces.
   */
  readonly hasTotalsBreakdown = computed(
    () => this.orderTax() > 0 || this.orderDiscount() > 0,
  );

  /**
   * C.7 (§5.3, base gross) — nota informativa fuera de la aritmética, sólo
   * con desglose respaldado (fail-closed: sin respaldo no hay fila fiscal).
   */
  readonly showTableVatNote = computed(
    () => this.authFacade.printsVatBreakdown() && this.orderTax() > 0,
  );

  readonly elapsedSinceOpen = computed(() => {
    const openedAt = this.session()?.opened_at;
    if (!openedAt) return '—';
    const diffMs = this.now() - new Date(openedAt).getTime();
    return this.formatElapsedMinutes(Math.max(0, Math.floor(diffMs / 60000)));
  });

  private formatElapsedMinutes(totalMinutes: number): string {
    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 48) {
      return `${hours} h ${minutes} min`;
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days} d ${remHours} h`;
  }

  readonly customer = computed(() => this.session()?.order?.customer ?? null);

  /**
   * carril D / lina — D1: alias del cliente cuando la venta es anónima pero
   * etiquetada (ej. "Mesa 5", "Para llevar"). Persistido en
   * `orders.customer_alias` (schema.prisma:1445, XOR con `customer_id`).
   * Se renderiza SOLO (sin etiqueta "CF" adyacente) en lugar del nombre
   * del cliente cuando este último está ausente, exactamente como pidió
   * el dueño: el alias existe precisamente para que el mesero no vea una
   * fila anónima.
   */
  readonly customerAlias = computed(
    () => this.session()?.order?.customer_alias ?? null,
  );

  readonly customerName = computed(() => {
    const c = this.customer();
    if (c) {
      // Hay cliente formal: gana el nombre sobre cualquier alias.
      return `${c.first_name} ${c.last_name}`.trim();
    }
    const alias = this.customerAlias();
    if (alias && alias.trim()) {
      // Sin cliente formal pero con alias: alias solo, sin "CF".
      return alias.trim();
    }
    // Sin cliente ni alias: consumidor final explícito.
    return 'Consumidor Final';
  });

  readonly selectedItems = computed(() => {
    const ids = this.selectedItemIds();
    return this.items().filter((it) => ids.has(it.id));
  });

  /**
   * Is the given order item a `prepared` dish (eligible for the kitchen
   * flow)? Backed by the `item_type` snapshot exposed by the backend
   * in `TableSessionView.order_items[].item_type`. Items without the
   * snapshot (legacy payloads) are treated as non-dish — the kitchen
   * controls stay hidden, never the other way around.
   */
  isPrepared(item: TableSessionOrderItem): boolean {
    return item.item_type === 'prepared';
  }

  /** Pending items that are also `prepared` (visible kitchen targets). */
  private readonly pendingPreparedItems = computed<TableSessionOrderItem[]>(
    () => this.items().filter((it) => this.isPrepared(it) && !this.isItemFired(it)),
  );

  /** True when at least one prepared dish is still pending fire. */
  readonly hasUnfiredItems = computed(() => this.pendingPreparedItems().length > 0);

  readonly isClosed = computed(() => !!this.session()?.closed_at);

  /**
   * carril D / lina — D1: la mesa fue pagada en POS (cobrada) pero NO
   * cerrada todavía. La fuente de verdad es `table_sessions.paid_at`
   * (migration `20260901120000_table_session_paid_at`); se persiste
   * dentro del `$transaction` del pago para que un rollback no deje
   * un `paid_at` fantasma.
   *
   * La mesa sigue `occupied` hasta que el mesero ejecute `closeSession`
   * (canónico), pero el frontend de mesa y el floor-map pintan el badge
   * "Pagada" sin esperar al cierre explícito.
   */
  readonly isPaid = computed(() => {
    const session = this.session();
    return !!session?.paid_at || (session != null && this.paidFromSseSessionId() === session.id);
  });

  /** Conservative UI gate; the backend re-reads all evidence under lock. */
  readonly canReassignClosedOrder = computed(() => {
    const session = this.session();
    const evidence = this.reassignmentEvidence();
    if (!session?.closed_at || !session.order || !session.table || this.isPaid() || this.hasFinancialSplit()) return false;
    if (!evidence || evidence.id !== session.order_id || !this.reassignmentFloorLoaded()) return false;
    if (this.tablesService.floorTables().some((table) =>
      table.active_session?.order_id === session.order_id)) return false;
    // add-items on a table session accepts only draft orders. Other backend-
    // eligible states are intentionally hidden until that flow supports them.
    if (session.order.state !== 'draft' || evidence.state !== 'draft') return false;
    if (evidence.active_financial_split_id != null || Number(evidence.total_paid) !== 0) return false;
    if (!Array.isArray(evidence.payments) || !Array.isArray(evidence.invoices)) return false;
    // The orders detail returns only its latest invoice. Any invoice row is
    // treated as uncertain and hidden here; the backend remains authoritative.
    if (evidence.invoices.length > 0) return false;
    return !evidence.payments.some((payment) =>
      ['succeeded', 'captured', 'partially_refunded', 'refunded'].includes(payment.state));
  });

  /** Reads `restaurant.enable_table_checkout` (loose JSON slice). */
  readonly checkoutEnabled = computed(
    () => this.settingsFacade.settings()?.restaurant?.enable_table_checkout === true,
  );

  /** Normalized table name avoiding duplicate "Mesa Mesa X" */
  readonly tableName = computed(() => {
    const raw = this.session()?.table?.name;
    if (!raw) return null;
    const trimmed = raw.trim();
    if (/^mesa\b/i.test(trimmed)) {
      return trimmed;
    }
    return `Mesa ${trimmed}`;
  });

  /** Quick filter tabs for multi-item table orders */
  readonly activeFilter = signal<'all' | 'unfired' | 'in_kitchen' | 'delivered'>('all');

  readonly inKitchenCount = computed(() =>
    this.items().filter((it) => {
      const st = this.kitchenStatusFor(it);
      return st != null && st !== 'delivered' && st !== 'cancelled';
    }).length,
  );

  readonly deliveredCount = computed(() =>
    this.items().filter((it) => this.isDelivered(it)).length,
  );

  readonly filteredItems = computed<TableSessionOrderItem[]>(() => {
    const filter = this.activeFilter();
    const all = this.items();
    if (filter === 'unfired') {
      return all.filter((it) => this.isPrepared(it) && !this.isItemFired(it));
    }
    if (filter === 'in_kitchen') {
      return all.filter((it) => {
        const st = this.kitchenStatusFor(it);
        return st != null && st !== 'delivered' && st !== 'cancelled';
      });
    }
    if (filter === 'delivered') {
      return all.filter((it) => this.isDelivered(it));
    }
    return all;
  });

  setFilter(filter: 'all' | 'unfired' | 'in_kitchen' | 'delivered'): void {
    this.activeFilter.set(filter);
  }

  /** Count of currently selected (pending) items for the batch toolbar. */
  readonly selectedCount = computed(() => this.selectedItemIds().size);

  /**
   * Number of `prepared` items still pending fire-to-kitchen. Non-dish
   * items (bottled water, retail add-ons) are intentionally excluded —
   * they do not go through the kitchen flow.
   */
  readonly pendingCount = computed(() => this.pendingPreparedItems().length);

  /**
   * Mesa actual como origen del transfer, en `Table` mínimo: la sesión
   * solo trae la proyección `{ id, name, zone, status }`, así que el
   * resto viaja en nulos (el modal solo lee `id`/`name`/estado).
   */
  readonly transferSourceTable = computed<Table | null>(() => {
    const s = this.session();
    const t = s?.table;
    if (!s || !t) return null;
    return {
      id: t.id,
      store_id: s.store_id,
      name: t.name,
      zone: t.zone,
      capacity: null,
      status: (t.status as TableStatus) ?? 'occupied',
      pos_x: null,
      pos_y: null,
      created_at: s.opened_at,
      updated_at: s.opened_at,
    };
  });

  /** Current table status (drives the collapsed status timeline). */
  readonly tableStatus = computed<TableStatus | null>(
    () => (this.session()?.table?.status as TableStatus) ?? null,
  );

  /** Table status as a Spanish label — feeds the sticky header's `badgeText`. */
  readonly tableStatusLabel = computed(() => {
    const status = this.tableStatus();
    return status ? TablesService.statusLabel(status) : '';
  });

  /** Maps the table status to the sticky header's fixed badge color palette. */
  readonly tableStatusBadgeColor = computed<StickyHeaderBadgeColor>(() => {
    switch (this.tableStatus()) {
      case 'occupied':
        return 'yellow';
      case 'available':
        return 'green';
      case 'reserved':
        return 'blue';
      case 'cleaning':
        return 'gray';
      default:
        return 'gray';
    }
  });

  /**
   * Table status as a collapsed-timeline (reuses the shared `app-timeline`,
   * same component the order-details page uses). The lifecycle is presented
   * in the natural order available → reserved → occupied → cleaning; the
   * current status is `current`, prior ones `completed`, later ones
   * `upcoming`. `cleaning` is flagged as a `terminal/warning` step so it
   * reads as the closing/turnover stage.
   */
  readonly tableStatusSteps = computed<TimelineStep[]>(() => {
    const current = this.tableStatus();
    const order: TableStatus[] = [
      'available',
      'reserved',
      'occupied',
      'cleaning',
    ];
    const currentIdx = current ? order.indexOf(current) : -1;
    return order.map((status, i) => {
      let stepStatus: TimelineStep['status'];
      if (currentIdx === -1) {
        stepStatus = 'upcoming';
      } else if (i < currentIdx) {
        stepStatus = 'completed';
      } else if (i === currentIdx) {
        stepStatus = status === 'cleaning' ? 'terminal' : 'current';
      } else {
        stepStatus = 'upcoming';
      }
      const variant: TimelineVariant =
        status === 'cleaning' && i === currentIdx ? 'warning' : 'default';
      return {
        key: status,
        label: TablesService.statusLabel(status),
        status: stepStatus,
        variant,
      };
    });
  });

  /**
   * Primary action in the sticky header: `Cerrar mesa`.
   * Secondary / contextual actions (Cobrar, Dividir cuenta, Asignar cliente, etc.)
   * live inside `secondaryActions()`'s dropdown menu.
   */
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    return [
      {
        id: 'close',
        label: 'Cerrar mesa',
        icon: 'lock',
        variant: 'danger',
        disabled: this.isClosed(),
        title: this.isClosed()
          ? 'La mesa ya está cerrada'
          : 'Cerrar la mesa y finalizar la sesión',
      },
    ];
  });

  /**
   * Advanced actions grouped in the `Opciones` dropdown menu — a single source
   * of truth consumed by BOTH the desktop `app-dropdown` (projected into
   * the sticky header's `[actions-extra]` slot) and the mobile action
   * sheet (`app-modal`). A closed, eligible check keeps only reassignment.
   */
  readonly secondaryActions = computed<SecondaryAction[]>(() => {
    if (this.isClosed()) {
      return this.canReassignClosedOrder()
        ? [{ id: 'reassign', label: 'Volver a asignar mesa', icon: 'arrow-right-left' }]
        : [];
    }
    const actions: SecondaryAction[] = [];

    if (this.checkoutEnabled()) {
      actions.push({
        id: 'pay',
        label: 'Cobrar',
        icon: 'credit-card',
        disabled: this.items().length === 0,
      });
    }

    actions.push(
      {
        id: 'split',
        label: 'Dividir cuenta',
        icon: 'split',
        disabled: this.items().length === 0,
      },
      {
        id: 'transfer',
        label: 'Cambiar de mesa',
        icon: 'arrow-right-left',
      },
      {
        id: 'customer',
        label: this.customerName() ? 'Cambiar cliente' : 'Asignar cliente',
        icon: 'user-plus',
      },
      { id: 'table-status', label: 'Cambiar estado de mesa', icon: 'table' },
      { id: 'history', label: 'Historial de estados', icon: 'clock' },
      { id: 'close', label: 'Cerrar mesa', icon: 'lock', danger: true },
    );

    return actions;
  });

  constructor() {
    // Single page-wide clock tick driving `elapsedSinceOpen` + `firedMinutesFor`.
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));

    // Merge KDS SSE ticket events into the live kitchen-state map, scoped
    // to THIS session's order. The stream is store-wide; we filter by
    // order_id. Graceful: if the stream falls to manual/polling, the
    // shared service keeps `tickets()` fresh and this effect still reacts.
    effect(() => {
      const orderId = this.session()?.order?.id;
      const tickets = this.kdsSse.tickets();
      if (!orderId) return;
      untracked(() => this.mergeTicketsForOrder(orderId, tickets));
    });

    // The staff event carries the session identity, not its persisted paid_at.
    // Keep an optimistic flag while a silent detail read fetches the exact value.
    effect(() => {
      const event = this.adminTablesSse.lastEvent();
      if (event?.type !== 'session_paid') return;
      const sessionId = Number(this.route.snapshot.paramMap.get('id'));
      if (event.data.table_session_id !== sessionId) return;
      untracked(() => {
        this.paidFromSseSessionId.set(sessionId);
        this.loadSession(sessionId, { silent: true });
      });
    });
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id') ?? NaN);
    if (!Number.isFinite(id) || id <= 0) {
      this.toastService.error('ID de sesión inválido');
      this.router.navigate(['/admin/restaurant-ops/tables']);
      return;
    }
    // Warm up the KDS SSE stream so badges update live. Idempotent.
    this.kdsSse.connect();
    this.adminTablesSse.connect();
    this.destroyRef.onDestroy(() => this.adminTablesSse.disconnect());
    this.loadSession(id);
    this.loadPendingPayments(id);
  }

  /**
   * Fetch the session by id and merge it into local state.
   *
   * `opts.silent = true` is used by post-action refetches (mark-delivered,
   * fire-to-kitchen) so the body does NOT re-enter the loading state — the
   * template wraps everything in `@if (!isLoading())` showing the
   * "Cargando sesión…" placeholder. Flipping that flag mid-action blanks
   * the page until getSession resolves; with silent refetch, the optimistic
   * local merge stays visible while the server snapshot lands in the
   * background. Initial load (ngOnInit) intentionally keeps the loading
   * state on for the first paint.
   */
  loadSession(id: number, opts: { silent?: boolean } = {}): void {
    if (!opts.silent) this.isLoading.set(true);
    this.tablesService
      .getSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.seedKitchenStateFromOrder(s);
          if (s.closed_at) this.loadReassignmentEvidence(s.order_id);
          else {
            this.reassignmentEvidence.set(null);
            this.reassignmentFloorLoaded.set(false);
          }
          if (!opts.silent) this.isLoading.set(false);
        },
        error: (err: unknown) => {
          if (!opts.silent) this.isLoading.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cargar la sesión',
          );
        },
      });
  }

  private loadReassignmentEvidence(orderId: number): void {
    this.reassignmentEvidence.set(null);
    this.reassignmentFloorLoaded.set(false);
    forkJoin({
      evidence: this.tablesService.getOrderReassignmentEvidence(orderId),
      floor: this.tablesService.getFloorMap(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ evidence }) => {
          if (this.session()?.order_id === orderId) {
            this.reassignmentEvidence.set(evidence);
            this.reassignmentFloorLoaded.set(true);
          }
        },
        error: () => {
          if (this.session()?.order_id === orderId) {
            this.toastService.error('No se pudo verificar esta orden para reasignarla. Recarga la página.');
          }
        },
      });
  }

  // ── Kitchen state (SSE + findOne seam) ─────────────────────────────────

  /**
   * Derive the active kitchen status for an item from the
   * `kitchen_ticket_items` carried by the findOne contract: prefer a
   * non-terminal row (in_preparation/ready/pending) over the most recent
   * terminal one. Returns null when never fired.
   */
  private deriveStaticKitchenStatus(
    item: TableSessionOrderItem,
  ): KitchenTicketItemRefStatus | null {
    const rows = item.kitchen_ticket_items ?? [];
    if (rows.length === 0) return null;
    // Rows arrive DESC by id; rows[0] is the MOST RECENT ticket item and is
    // therefore the authoritative current state. The previous code preferred
    // any non-terminal row (pending/in_preparation/ready), which masked a
    // `delivered`/`cancelled` most-recent row behind an older `pending` one —
    // a delivered dish kept reading as "pendiente". Most-recent-wins also
    // handles re-fires correctly: a fresh `pending` ticket created after a
    // delivered one has the higher id, so it is rows[0].
    return rows[0].status as KitchenTicketItemRefStatus;
  }

  /** Seed the live map from the order's findOne `kitchen_ticket_items`. */
  private seedKitchenStateFromOrder(s: TableSession | null): void {
    const next = new Map<number, KitchenTicketItemRefStatus>();
    for (const item of s?.order?.order_items ?? []) {
      const status = this.deriveStaticKitchenStatus(item);
      if (status) next.set(item.id, status);
    }
    this.liveKitchenState.set(next);
  }

  /**
   * Merge store-wide KDS tickets that belong to this order into the live
   * kitchen-state map (order_item_id → status). Non-matching tickets are
   * ignored.
   */
  private mergeTicketsForOrder(
    orderId: number,
    tickets: { order_id: number; items: { order_item_id: number; status: string }[] }[],
  ): void {
    const relevant = tickets.filter((t) => t.order_id === orderId);
    if (relevant.length === 0) return;
    this.liveKitchenState.update((prev) => {
      const next = new Map(prev);
      for (const ticket of relevant) {
        for (const ti of ticket.items ?? []) {
          next.set(ti.order_item_id, ti.status as KitchenTicketItemRefStatus);
        }
      }
      return next;
    });
  }

  /** The order delivery fact outranks a stale KDS/SSE ready projection. */
  kitchenStatusFor(
    item: TableSessionOrderItem,
  ): KitchenTicketItemRefStatus | null {
    if (item.delivered_at != null) return 'delivered';
    return (
      this.liveKitchenState().get(item.id) ??
      this.deriveStaticKitchenStatus(item)
    );
  }

  /** True when the item has been fired to the kitchen (any ticket state). */
  isItemFired(item: TableSessionOrderItem): boolean {
    return item.inventory_consumed_at_fire || this.kitchenStatusFor(item) != null;
  }

  /**
   * Can the operator remove this line from the open check? (Frente 2)
   *
   * Rules mirror the backend gate:
   *   - not closed, and
   *   - the item was NEVER fired  → deletable outright, or
   *   - the item was fired but its ticket is still `pending` → deletable
   *     (backend cancels the KDS ticket + returns the fire-consumed stock).
   *
   * Hidden for `in_preparation` / `ready` / `delivered` / `cancelled`
   * (terminal or in-progress kitchen states the backend rejects with 409).
   */
  canRemoveItem(item: TableSessionOrderItem): boolean {
    if (this.isClosed() || this.hasFinancialSplit()) return false;
    // Paso 6 plan 1060 — espejo del bloqueo en mesa: un ítem entregado
    // (`delivered_at`, hecho de servicio) ya no se puede cancelar. Solo
    // presentación: el enforcement real lo pone el backend (paso 1).
    if (this.isDelivered(item)) return false;
    return !this.isItemFired(item) || this.kitchenStatusFor(item) === 'pending';
  }

  /**
   * Paso 6 plan 1060 — motivo del botón eliminar cuando está bloqueado por
   * entrega, patrón `deliverDisabledReason` del KDS: el botón queda VISIBLE
   * pero deshabilitado con tooltip. Solo cubre `delivered_at`/entregado;
   * el resto de estados bloqueados siguen ocultos (comportamiento actual).
   * Retorna null cuando no hay bloqueo por entrega que señalizar.
   */
  removeDisabledReason(item: TableSessionOrderItem): string | null {
    if (this.isClosed()) return null;
    if (item.cancelled_at) return null;
    if (this.isDelivered(item))
      return 'Ya fue entregado al cliente. No se puede cancelar.';
    return null;
  }

  kitchenBadgeVariant(status: KitchenTicketItemRefStatus): BadgeVariant {
    switch (status) {
      case 'pending':
        return 'neutral';
      case 'in_preparation':
        return 'warning';
      case 'ready':
        return 'success';
      case 'delivered':
        return 'info';
      case 'cancelled':
        return 'error';
    }
  }

  kitchenStatusLabel(status: KitchenTicketItemRefStatus): string {
    return KitchenTicketsService.statusLabel(status);
  }

  /** `kitchen_ticket.daily_number` of the item's most recent ticket row. */
  ticketNumberFor(item: TableSessionOrderItem): number | null {
    return (
      item.kitchen_ticket_items?.[0]?.kitchen_ticket?.daily_number ?? null
    );
  }

  /** Whole minutes elapsed since the item's most recent ticket was fired. */
  firedMinutesFor(item: TableSessionOrderItem): number | null {
    const firedAt = item.kitchen_ticket_items?.[0]?.kitchen_ticket?.fired_at;
    if (!firedAt) return null;
    const diffMs = this.now() - new Date(firedAt).getTime();
    return Math.max(0, Math.floor(diffMs / 60000));
  }

  /**
   * El seam de orden admite preparados solo en `ready`, sean para llevar o
   * para mesa. Los items sin cocina se pueden entregar directamente; los ya
   * entregados o cancelados no ofrecen de nuevo la acción.
   */
  canDeliver(item: TableSessionOrderItem): boolean {
    // QUI-652 — la entrega es un hecho de SERVICIO y ya está registrada.
    if (this.isDelivered(item) || item.cancelled_at != null) return false;

    // Lo que no se cocina se entrega directo desde la fila: no pasa por cocina,
    // así que no hay estado de cocina que esperar. Antes esto devolvía false
    // porque `kitchenStatusFor` es null para siempre en un no-preparado, y la
    // cerveza en botella se quedaba sin ningún estado de entrega alcanzable.
    if (!this.needsKitchen(item)) return true;

    return this.kitchenStatusFor(item) === 'ready';
  }

  /**
   * ¿Este item pasa por cocina? Solo los platos preparados: el fire excluye
   * explícitamente todo lo demás (`kitchen-fire.service.ts`), así que para el
   * resto no existe ni existirá un `kitchen_ticket_item`.
   */
  needsKitchen(item: TableSessionOrderItem): boolean {
    return item.item_type === 'prepared';
  }

  /**
   * QUI-653 — ¿la cuenta mezcla consumo en la mesa con items para llevar?
   *
   * `computed` sobre la señal de sesión: el backend ya envía `is_mixed_order`
   * derivado, pero se recalcula localmente como respaldo para que el badge
   * responda al instante cuando la sesión se reemplaza tras agregar items, sin
   * depender de que ese campo viaje en cada respuesta.
   */
  readonly isMixedOrder = computed(() => {
    const items = this.session()?.order?.order_items ?? [];
    if (this.session()?.order?.is_mixed_order != null) {
      return this.session()!.order!.is_mixed_order === true;
    }
    return (
      items.some((it) => it.is_takeaway) && items.some((it) => !it.is_takeaway)
    );
  });

  /**
   * ¿Ya se le entregó al cliente? Lee el hecho de servicio en la línea de
   * pedido. Se acepta además el `delivered` del ticket como respaldo, porque el
   * reconciliador SSE puede adelantar el estado de cocina en vivo antes de que
   * la sesión se recargue y traiga `delivered_at`.
   */
  isDelivered(item: TableSessionOrderItem): boolean {
    return (
      item.delivered_at != null || this.kitchenStatusFor(item) === 'delivered'
    );
  }

  /** Operator-friendly hint explaining why `canDeliver` is/isn't true. */
  deliverHint(item: TableSessionOrderItem): string {
    const status = this.kitchenStatusFor(item);
    switch (status) {
      case 'pending':
        return 'Aún pendiente en cocina. Espera a que el KDS lo marque como listo.';
      case 'in_preparation':
        return 'Aún en preparación en cocina.';
      case 'ready':
        return 'Listo para entregar al cliente.';
      case 'delivered':
        return 'Ya fue entregado.';
      case 'cancelled':
        return 'Fue cancelado en cocina.';
      default:
        return 'Aún no se ha enviado a cocina.';
    }
  }

  // ── Selection helpers (batch fire mode) ────────────────────────────────

  /**
   * Batch-selection mode. Per-dish fire (point 1) covers the common case;
   * the batch mode is a discreet secondary affordance, only enabled while
   * there are pending items. Toggling off clears the selection.
   */
  readonly selectionMode = signal(false);

  /** True when all `prepared` pending items are currently selected. */
  readonly allPendingSelected = computed(() => {
    const pending = this.pendingCount();
    return pending > 0 && this.selectedItemIds().size === pending;
  });

  toggleSelectionMode(): void {
    this.selectionMode.update((on) => {
      if (on) this.selectedItemIds.set(new Set());
      return !on;
    });
  }

  exitSelectionMode(): void {
    this.selectionMode.set(false);
    this.selectedItemIds.set(new Set());
  }

  toggleItemSelection(itemId: number): void {
    const item = this.items().find((it) => it.id === itemId);
    if (item && (this.isItemFired(item) || !this.isPrepared(item))) return;
    this.selectedItemIds.update((s) => {
      const next = new Set(s);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  isSelected(itemId: number): boolean {
    return this.selectedItemIds().has(itemId);
  }

  /**
   * Toggle "select all pending": selects all `prepared` pending items
   * if not all are selected, else clears. Non-dish items are skipped
   * — they do not belong to the kitchen flow.
   */
  toggleSelectAllPending(): void {
    if (this.allPendingSelected()) {
      this.selectedItemIds.set(new Set());
      return;
    }
    const pending = this.pendingPreparedItems().map((it) => it.id);
    this.selectedItemIds.set(new Set(pending));
  }

  clearSelection(): void {
    this.selectedItemIds.set(new Set());
  }

  // ── Add items ──────────────────────────────────────────────────────────

  openAddItems(): void {
    if (this.hasFinancialSplit()) {
      this.toastService.warning('La cuenta está dividida. Los importes están fijados; registra consumos nuevos en otra cuenta.');
      return;
    }
    if (this.isClosed()) {
      this.toastService.error('La mesa está cerrada');
      return;
    }
    this.isAddItemsOpen.set(true);
  }

  onAddItems(items: TableSessionAddItem[]): void {
    if (this.hasFinancialSplit()) return;
    const id = this.session()?.id;
    if (!id) return;
    this.isAddingItems.set(true);
    this.tablesService
      .addItems(id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.isAddingItems.set(false);
          this.isAddItemsOpen.set(false);
          this.session.set(s);
          this.seedKitchenStateFromOrder(s);
          this.toastService.success(`${items.length} línea(s) agregada(s)`);
        },
        error: (err: unknown) => {
          this.isAddingItems.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al agregar items',
          );
        },
      });
  }

  // ── Remove item (Frente 2) ───────────────────────────────────────────

  /**
   * Cancel a single line from the open check (soft cancel).
   *
   * carril D / lina — D2: flujo nuevo. Antes era un hard delete
   * (`removeItem` DELETE legacy) que rompía la orden cuando el plato
   * ya estaba disparado a cocina o la orden salía de `draft`. Ahora:
   *  - Motivo obligatorio siempre (mín 3 chars). Se persiste en
   *    `order_items.cancellation_reason` para auditoría y para que el
   *    KDS y el listado de ordenes puedan mostrarlo.
   *  - El ítem NO se borra: queda VISIBLE marcado como cancelado pero
   *    EXCLUIDO del subtotal/tax/grand_total (filtro `cancelled_at IS
   *    NULL` en el recálculo del backend).
   *  - Stock: `before_fire` revierte; `after_fire_waste` queda como
   *    merma sin reversión (backend decide según
   *    `inventory_consumed_at_fire`).
   *  - KDS: si el ticket está en `pending`, se cancela in-tx y se emite
   *    `ticket.cancelled` SSE post-commit. Si ya avanzó de `pending`,
   *    no se toca el ticket del cocinero.
   *
   * UX: el motivo se pide con `DialogService.prompt` (PromptModalComponent
   * del design system) tras un `confirm` previo. Distinto copy entre
   * `firedPending` (merma) y resto (exclusión del total).
   *
   * D.4: los preparados (`item_type === 'prepared'`) NO pasan por aquí —
   * usan el modal compartido "Destino del plato" (motivo + destino) vía
   * `openItemCancellationModal`. Este flujo confirm+prompt queda solo para
   * ítems que nunca pasan por cocina.
   */
  onRemoveItem(item: TableSessionOrderItem): void {
    const sessionId = this.session()?.id;
    if (!sessionId || this.isClosed()) return;
    if (!this.canRemoveItem(item)) return;
    if (this.isPrepared(item)) {
      this.openItemCancellationModal(item);
      return;
    }
    const firedPending =
      this.isItemFired(item) && this.kitchenStatusFor(item) === 'pending';
    this.dialogService
      .confirm({
        title: 'Cancelar plato',
        message: firedPending
          ? `¿Cancelar "${item.product_name}" de la cuenta? Se cancelará su ticket de cocina. Si el ticket ya pasó a preparación, queda como merma sin reversión de stock.`
          : `¿Cancelar "${item.product_name}" de la cuenta? El plato queda visible marcado como cancelado, pero se excluye del total.`,
        confirmText: 'Continuar',
        cancelText: 'Atrás',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        // Motivo obligatorio vía `DialogService.prompt` (PromptModalComponent
        // del design system). Resuelve `undefined` si el usuario cancela el
        // modal; el string con trim si confirma. Sustituye a `window.prompt`
        // nativo — mismo dato, modal compartido del design system.
        this.dialogService
          .prompt({
            title: 'Motivo de cancelación',
            message: firedPending
              ? 'Quedará registrado como merma.'
              : 'Quedará registrado en el pedido.',
            placeholder: 'Describe el motivo (mínimo 3 caracteres)',
            confirmText: 'Cancelar plato',
            cancelText: 'Atrás',
          })
          .then((reasonInput) => {
            if (reasonInput === undefined) {
              this.toastService.error('Cancelación abortada');
              return;
            }
            const reason = reasonInput.trim();
            if (reason.length < 3) {
              this.toastService.error(
                'El motivo debe tener al menos 3 caracteres',
              );
              return;
            }
            this.removingItemId.set(item.id);
            this.tablesService
              .cancelOrderItem(sessionId, item.id, { reason })
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: (s) => {
                  this.removingItemId.set(null);
                  this.session.set(s);
                  this.seedKitchenStateFromOrder(s);
                  this.toastService.success(
                    firedPending
                      ? 'Plato cancelado como merma'
                      : 'Plato cancelado de la cuenta',
                  );
                },
                error: (err: unknown) => {
                  this.removingItemId.set(null);
                  this.toastService.error(
                    typeof err === 'string'
                      ? err
                      : 'Error al cancelar el plato',
                  );
                },
              });
          });
      });
  }

  /**
   * Abre un prompt modal para agregar o editar la nota de preparación del plato.
   * Si el texto se vacía, la nota se limpia (`null`).
   */
  openEditItemNote(item: TableSessionOrderItem): void {
    const sessionId = this.session()?.id;
    if (!sessionId || this.isClosed() || item.cancelled_at) return;

    this.dialogService
      .prompt({
        title: item.notes ? 'Editar nota del plato' : 'Agregar nota al plato',
        message: `Especificación o indicación para "${item.product_name}":`,
        defaultValue: item.notes ?? '',
        placeholder: 'Ej: Sin cebolla, término medio, etc.',
        confirmText: 'Guardar',
        cancelText: 'Cancelar',
      })
      .then((newNote) => {
        if (newNote === undefined) return;
        const trimmed = newNote.trim();
        if (trimmed === (item.notes ?? '').trim()) return;

        this.updatingNoteItemId.set(item.id);
        this.tablesService
          .updateItemNotes(sessionId, item.id, trimmed || null)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (s) => {
              this.updatingNoteItemId.set(null);
              this.session.set(s);
              this.seedKitchenStateFromOrder(s);
              this.toastService.success(
                trimmed ? 'Nota actualizada' : 'Nota eliminada',
              );
            },
            error: (err: unknown) => {
              this.updatingNoteItemId.set(null);
              this.toastService.error(
                typeof err === 'string' ? err : 'Error al actualizar la nota',
              );
            },
          });
  }

  /**
   * D.4 — abre el modal compartido "Destino del plato" para un preparado de
   * la cuenta. El destino elegido viaja como `cancellation_type` canónico
   * (`after_fire_waste` / `after_fire_reused`); sin disparo a cocina se omite
   * y el backend resuelve `before_fire` por `inventory_consumed_at_fire`.
   */
  openItemCancellationModal(item: TableSessionOrderItem): void {
    if (!this.session()?.id || this.cancellationTarget()) return;
    this.cancellationError.set(null);
    this.cancellationTarget.set(item);
  }

  closeItemCancellationModal(): void {
    if (this.removingItemId() !== null) return;
    this.cancellationTarget.set(null);
    this.cancellationError.set(null);
  }

  /** D.4 — submit del modal compartido: motivo + destino → seam de mesa. */
  onCancellationConfirmed(result: ItemCancellationSubmit): void {
    const item = this.cancellationTarget();
    const sessionId = this.session()?.id;
    if (!item || !sessionId || this.removingItemId() !== null) return;
    const reason = result.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      this.cancellationError.set('El motivo debe tener entre 3 y 500 caracteres.');
      return;
    }
    const preparedFired = item.inventory_consumed_at_fire === true;
    const cancellation_type = cancellationTypeForDestination(result.destination, preparedFired);
    this.removingItemId.set(item.id);
    this.cancellationError.set(null);
    this.tablesService
      .cancelOrderItem(
        sessionId,
        item.id,
        cancellation_type ? { reason, cancellation_type } : { reason },
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.removingItemId.set(null);
          this.cancellationTarget.set(null);
          this.session.set(s);
          this.seedKitchenStateFromOrder(s);
          this.toastService.success(
            preparedFired ? 'Plato cancelado como merma' : 'Plato cancelado de la cuenta',
          );
        },
        error: (err: unknown) => {
          this.removingItemId.set(null);
          this.cancellationError.set(
            typeof err === 'string' ? err : 'Error al cancelar el plato',
          );
        },
      });
  }

  // ── Split bill ─────────────────────────────────────────────────────────

  openSplit(): void {
    if (this.isClosed()) {
      this.toastService.error('La mesa está cerrada');
      return;
    }
    if (this.items().length === 0) {
      this.toastService.error('Agrega al menos un ítem antes de dividir');
      return;
    }
    this.isSplitOpen.set(true);
  }

  onFinancialSplitLoaded(result: SplitResult | null): void {
    this.hasFinancialSplit.set(!!result?.split_group_id);
  }

  onFinancialSplitChanged(result: SplitResult | null): void {
    this.onFinancialSplitLoaded(result);
    const id = this.session()?.id;
    if (id) this.loadSession(id, { silent: true });
  }

  onSplitCompleted(result: SplitResult): void {
    this.onFinancialSplitChanged(result);
    this.splitRefreshKey.update((value) => value + 1);
  }

  // ── Fire to kitchen ────────────────────────────────────────────────────

  /** Fire a single dish from its row. */
  fireItem(item: TableSessionOrderItem): void {
    if (this.isClosed()) return;
    this.fire([item.id], item.id);
  }

  /** Fire the current multi-selection (optional shortcut). */
  fireSelected(): void {
    const ids = this.selectedItemIds().size
      ? Array.from(this.selectedItemIds())
      : this.pendingPreparedItems().map((it) => it.id);
    if (ids.length === 0) {
      this.toastService.error('Selecciona al menos un item para enviar');
      return;
    }
    this.fire(ids, null);
  }

  /**
   * QUI-655 — enviar a cocina pasa SIEMPRE por el modal de confirmacion.
   *
   * Este es el embudo unico de los dos disparadores (fireItem por fila y
   * fireSelected por seleccion multiple), asi que interceptar aca cubre ambos. No
   * se escribe NADA antes de confirmar: primero se previsualiza el arbol de receta,
   * y el consumo de inventario ocurre solo tras el confirm.
   */
  private fire(orderItemIds: number[], singleItemId: number | null): void {
    const order = this.session()?.order;
    if (!order) return;

    this.pendingFireIds.set(orderItemIds);
    this.pendingFireSingleId.set(singleItemId);
    this.kitchenPreviewLoading.set(true);
    this.kitchenConfirmOpen.set(true);

    this.kitchenService
      .previewFire({ order_id: order.id, order_item_ids: orderItemIds })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.kitchenPreview.set(preview);
          this.kitchenPreviewLoading.set(false);
        },
        error: (err: unknown) => {
          this.kitchenPreviewLoading.set(false);
          this.kitchenConfirmOpen.set(false);
          this.onKitchenMutationError(err);
        },
      });
  }

  /** Confirma el envio con las exclusiones y notas que dejo el modal. */
  onKitchenConfirmed(event: FireConfirmPayload | FireItemExclusion[]): void {
    const ids = this.pendingFireIds();
    if (ids.length === 0) return;
    this.kitchenConfirmOpen.set(false);
    const exclusions = Array.isArray(event) ? event : (event?.exclusions ?? []);
    const itemNotes = Array.isArray(event) ? undefined : event?.item_notes;
    this.executeFire(ids, this.pendingFireSingleId(), exclusions, itemNotes);
  }

  /** Cancelar no consume inventario ni crea tickets: el modal abre ANTES de escribir. */
  onKitchenCancelled(): void {
    this.kitchenConfirmOpen.set(false);
    this.kitchenPreview.set(null);
    this.pendingFireIds.set([]);
    this.pendingFireSingleId.set(null);
  }

  private executeFire(
    orderItemIds: number[],
    singleItemId: number | null,
    exclusions: FireItemExclusion[],
    itemNotes?: Array<{ order_item_id: number; notes: string }>,
  ): void {
    const order = this.session()?.order;
    if (!order) return;
    this.isFiring.set(true);
    this.firingItemId.set(singleItemId);
    this.kitchenService
      .fireOrderItems({
        order_id: order.id,
        order_item_ids: orderItemIds,
        // Solo se manda cuando hay algo excluido: el backend trata la ausencia
        // como "todos los componentes marcados", que es el camino rapido.
        ...(exclusions.length > 0 && { exclusions }),
        ...(itemNotes && itemNotes.length > 0 && { item_notes: itemNotes }),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isFiring.set(false);
          this.firingItemId.set(null);
          this.exitSelectionMode();
          // Only toast success when the backend CONFIRMS a ticket id —
          // otherwise the call silently no-oped (e.g. all items skipped)
          // and the operator would think the fire happened.
          if (res?.kitchen_ticket_id) {
            this.toastService.success(
              `Enviado a cocina — ticket #${res.kitchen_ticket_id}`,
            );
          } else {
            this.toastService.warning(
              'No se enviaron platos a cocina (puede que ya estuvieran enviados).',
            );
          }
          // Refetch by SESSION id (the route param drives getSession → /store/table-sessions/:id).
          // Using order.id here previously triggered a 404 that — even with `silent: true` —
          // raced with the optimistic SSE merge and blanked the page.
          this.loadSession(this.session()?.id ?? order.id, { silent: true });
        },
        error: (err: unknown) => {
          this.isFiring.set(false);
          this.firingItemId.set(null);
          this.onKitchenMutationError(err);
        },
      });
  }

  // ── Mark delivered ─────────────────────────────────────────────────────

  /**
   * La entrega desde la mesa siempre se dirige a una línea de pedido, incluso
   * si el plato es para llevar. El seam de mesa sincroniza su estado de cocina
   * sin entregar por accidente las demás líneas del mismo ticket. El endpoint
   * de entrega de cocina queda reservado al tablero KDS.
   */
  markDelivered(item: TableSessionOrderItem): void {
    this.deliverTableSessionItem(item);
  }

  /**
   * Entrega por el seam de mesa (`PATCH .../items/:id/deliver`): escribe el
   * hecho de servicio contra la línea de pedido y sincroniza el ticket.
   *
   * Cubre items sin cocina y preparados en `ready`, tanto dine-in como
   * takeaway. El endpoint de cocina es takeaway-only y actúa por ticket;
   * el mesero siempre entrega una sola línea por clic.
   *
   * Usa `deliveringItemId` porque el spinner debe seguir la línea seleccionada,
   * no el ticket compartido.
   */
  private deliverTableSessionItem(item: TableSessionOrderItem): void {
    const sessionId = this.session()?.id;
    if (sessionId == null) return;

    this.deliveringItemId.set(item.id);
    this.tablesService
      .markItemDelivered(sessionId, item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (session) => {
          this.deliveringItemId.set(null);
          // El backend devuelve la sesión completa ya recalculada, así que se
          // reemplaza en vez de recargar: una llamada menos y sin ventana en la
          // que la fila muestre el estado viejo.
          this.session.set(session);
          this.toastService.success('Item marcado como entregado');
        },
        error: (err: unknown) => {
          this.deliveringItemId.set(null);
          this.onKitchenMutationError(err);
        },
      });
  }

  /**
   * Shared error mapper for kitchen-fire mutations invoked from the table
   * session page (markDelivered, fireOrderItems). Mirrors the KDS board's
   * `onMutationError` so the operator gets a SPECIFIC message instead of
   * a generic "Error al …":
   *   - `KitchenMutationError.code` → looked up in `ERROR_MESSAGES`
   *     (parseApiError handles the fallback to DEFAULT_ERROR_MESSAGE).
   *   - Plain string error       → shown as-is (network/auth path).
   *   - Anything else             → generic fallback.
   *
   * The success toast belongs only to the HTTP success callback in
   * `deliverTableSessionItem`; rejected writes arrive here. `canDeliver`
   * also hides the action for pending kitchen items.
   */
  private onKitchenMutationError(err: unknown): void {
    if (typeof err === 'string') {
      this.toastService.error(err);
      return;
    }
    const structured =
      typeof err === 'object' && err !== null
        ? (err as Partial<KitchenMutationError>)
        : null;
    // Best-effort request correlation for support. The backend wraps
    // `request_id` in every error body, but the services normalize the error
    // at the catchError boundary, so it only survives in whichever shape kept
    // the raw body. Quote it back when present; never invent one.
    const requestId = readApiErrorRequestId(err);
    if (structured?.code) {
      // parseApiError pulls userMessage from ERROR_MESSAGES using the code,
      // and falls back to DEFAULT_ERROR_MESSAGE if the code isn't mapped.
      const parsed = parseApiError({ error: { error_code: structured.code } });
      this.toastService.error(
        withApiErrorReference(parsed.userMessage, requestId),
      );
      return;
    }
    this.toastService.error(
      withApiErrorReference(
        structured?.message ?? 'Error al actualizar el estado en cocina',
        requestId,
      ),
    );
  }

  // ── `···` overflow menu (desktop dropdown + mobile action sheet) ───────

  /**
   * Single dispatch point for every `secondaryActions()` entry, invoked from
   * both the desktop `app-dropdown` items and the mobile action sheet.
   */
  onSecondaryAction(id: SecondaryAction['id']): void {
    this.isActionsSheetOpen.set(false);
    switch (id) {
      case 'pay':
        this.openPay();
        return;
      case 'split':
        this.openSplit();
        return;
      case 'transfer':
        if (this.isClosed()) return;
        this.tableMoveMode.set('transfer');
        this.isTransferOpen.set(true);
        return;
      case 'reassign':
        if (this.canReassignClosedOrder()) {
          this.tableMoveMode.set('reassign');
          this.isTransferOpen.set(true);
        }
        return;
      case 'customer':
        this.openAssignCustomer();
        return;
      case 'table-status':
        this.openQuickStatusModal(false);
        return;
      case 'history':
        this.openQuickStatusModal(true);
        return;
      case 'close':
        this.closeSession();
        return;
    }
  }

  /**
   * Opens the shared `app-quick-status-modal` (already used by the floor
   * map) with the history timeline collapsed or expanded depending on which
   * menu entry triggered it.
   */
  openQuickStatusModal(showHistory: boolean): void {
    this.statusModalShowsHistory.set(showHistory);
    this.isQuickStatusOpen.set(true);
  }

  /**
   * The modal already calls `TablesService.update` itself (Frente 3 reuse);
   * this just refreshes the session snapshot so `table.status` — and every
   * computed derived from it — reflects the change.
   */
  onTableStatusChanged(_status: TableStatus): void {
    const id = this.session()?.id;
    if (id) this.loadSession(id, { silent: true });
  }

  /**
   * Transfer confirmado: el modal ya hizo el POST y toasteó sus propios
   * errores, así que aquí solo va el toast de éxito + refetch silencioso
   * (mismo `id` de sesión, sin blankeo) + cierre.
   */
  onTransferConfirmed(result: TransferResult): void {
    this.toastService.success(
      result.mode === 'swap'
        ? 'Cuentas intercambiadas entre mesas'
        : 'Cuenta trasladada a la mesa de destino',
    );
    const id = this.session()?.id;
    if (id) this.loadSession(id, { silent: true });
    this.isTransferOpen.set(false);
  }

  onReassignmentConfirmed(newSession: TableSession): void {
    this.isTransferOpen.set(false);
    this.reassignmentEvidence.set(null);
    this.reassignmentFloorLoaded.set(false);
    this.session.set(newSession);
    this.seedKitchenStateFromOrder(newSession);
    this.toastService.success('Orden devuelta a una mesa con una sesión nueva');
    this.loadSession(newSession.id, { silent: true });
    void this.kdsSse.refreshSnapshot().catch(() => {
      this.toastService.error('La mesa se reasignó, pero no se pudo refrescar cocina. Actualiza el tablero KDS.');
    });
    void this.router.navigate(['/admin/restaurant-ops/tables/session', newSession.id]);
  }

  // ── Assign / change customer ───────────────────────────────────────────

  openAssignCustomer(): void {
    if (this.isClosed()) {
      this.toastService.error('La mesa está cerrada');
      return;
    }
    this.isAssignCustomerOpen.set(true);
  }

  onAssignCustomer(customerId: number | null): void {
    const id = this.session()?.id;
    if (!id) return;
    this.isAssigningCustomer.set(true);
    this.tablesService
      .assignCustomer(id, customerId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.isAssigningCustomer.set(false);
          this.isAssignCustomerOpen.set(false);
          this.session.set(s);
          this.seedKitchenStateFromOrder(s);
          this.toastService.success(
            customerId == null
              ? 'Cliente removido de la cuenta'
              : 'Cliente asignado a la cuenta',
          );
        },
        error: (err: unknown) => {
          this.isAssigningCustomer.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al asignar el cliente',
          );
        },
      });
  }

  // ── Checkout (cobro) ───────────────────────────────────────────────────

  openPay(): void {
    if (this.hasFinancialSplit()) {
      this.isSplitOpen.set(true);
      return;
    }
    if (this.isClosed()) {
      this.toastService.error('La mesa ya está cerrada');
      return;
    }
    if (this.items().length === 0) {
      this.toastService.error('No hay items para cobrar');
      return;
    }
    this.isPayOpen.set(true);
  }

  onPay(payload: TablePaymentSubmit): void {
    if (this.hasFinancialSplit()) { this.isSplitOpen.set(true); return; }
    const sessionId = this.session()?.id;
    if (!sessionId || this.isClosed()) return;
    this.isPaying.set(true);
    this.tablesService
      .payTableSession({
        table_session_id: sessionId,
        store_payment_method_id: payload.store_payment_method_id,
        subtotal: this.orderSubtotal(),
        total_amount: this.orderTotal(),
        amount_received: payload.amount_received,
        payment_reference: payload.payment_reference,
        tip_amount: payload.tip_amount,
        // QUI-728 (E.1) — el cobro de mesa va a POST /store/payments/pos
        // (CreatePosPaymentDto); el bank_account_id viaja con él.
        bank_account_id: payload.bank_account_id,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isPaying.set(false);
          this.isPayOpen.set(false);
          // QUI-704: the table is no longer auto-closed by the POS sale
          // confirmation — it stays `occupied` until staff explicitly
          // calls "Cerrar mesa". The toast reflects that the session
          // is still open after a successful charge.
          this.toastService.success(
            'Cobro realizado. La mesa sigue ocupada — ciérrala desde "Cerrar mesa".',
          );
          this.router.navigate(['/admin/restaurant-ops/tables']);
        },
        error: (err: unknown) => {
          this.isPaying.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al procesar el cobro',
          );
        },
      });
  }

  // ── Pending payments (E2 — staff confirmation) ────────────────────

  /**
   * Fetch pending manual payments for the order backing this session.
   * Renders the "Pagos por confirmar" list + per-row "Confirmar" CTA.
   * Silent: post-action refetches don't trigger the global loading state.
   */
  loadPendingPayments(sessionId: number, opts: { silent?: boolean } = {}): void {
    if (!opts.silent) this.isLoadingPendingPayments.set(true);
    this.tablesService
      .listPendingPayments(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.pendingPayments.set(rows ?? []);
          if (!opts.silent) this.isLoadingPendingPayments.set(false);
        },
        error: () => {
          // Don't toast on refetch failures — they are usually background
          // and the next interaction will retry. Initial load still gets
          // a clear empty state.
          this.pendingPayments.set([]);
          if (!opts.silent) this.isLoadingPendingPayments.set(false);
        },
      });
  }

  /** Open the modal in 'confirm' mode for a single pending row. */
  openConfirmPayment(payment: PaymentPendingView): void {
    this.pendingConfirmPayment.set(payment);
    this.isConfirmOpen.set(true);
  }

  /**
   * Staff confirms a pending payment. Transitions the row to `succeeded`
   * on the backend, refreshes the pending list, and refreshes the session
   * so order balance + summary reflect the new state. The session
   * REMAINS OPEN — staff can chain confirms until the order is fully paid.
   */
  onConfirmPayment(payload: TablePaymentConfirmSubmit): void {
    const sessionId = this.session()?.id;
    if (!sessionId || this.isConfirmingPayment()) return;
    this.isConfirmingPayment.set(true);
    this.tablesService
      .confirmPayment(sessionId, payload.payment_id, {
        ...(payload.tip_amount != null && payload.tip_amount > 0
          ? { tip_amount: payload.tip_amount }
          : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isConfirmingPayment.set(false);
          this.isConfirmOpen.set(false);
          this.pendingConfirmPayment.set(null);
          this.toastService.success('Pago confirmado por staff');
          // Silent refetch: keeps the page body intact while the
          // pending row disappears and the order balance updates.
          this.loadPendingPayments(sessionId, { silent: true });
          this.loadSession(sessionId, { silent: true });
        },
        error: (err: unknown) => {
          this.isConfirmingPayment.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al confirmar el pago',
          );
        },
      });
  }

  /** Operator-friendly label for a payment method. */
  paymentMethodLabel(p: PaymentPendingView): string {
    return p.method?.display_name || p.method?.type || '—';
  }

  /** TrackBy for the pending list (avoid DOM thrash on row swaps). */
  trackByPaymentId(_i: number, p: PaymentPendingView): number {
    return p.id;
  }

  // ── Close session ──────────────────────────────────────────────────────

  closeSession(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.dialogService
      .confirm({
        title: 'Cerrar mesa',
        message:
          '¿Cerrar la mesa? La cuenta seguirá activa para ser cobrada después.',
        confirmText: 'Cerrar mesa',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.isClosing.set(true);
        this.tablesService
          .closeSession(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (s) => {
              this.isClosing.set(false);
              this.session.set(s);
              this.seedKitchenStateFromOrder(s);
              this.loadReassignmentEvidence(s.order_id);
              this.toastService.success('Mesa cerrada correctamente');
            },
            error: (err: unknown) => {
              this.isClosing.set(false);
              this.toastService.error(
                typeof err === 'string' ? err : 'Error al cerrar la mesa',
              );
            },
          });
      });
  }

  // ── UI helpers ─────────────────────────────────────────────────────────

  trackById(_i: number, item: TableSessionOrderItem): number {
    return item.id;
  }

  onHeaderAction(actionId: string): void {
    switch (actionId) {
      case 'close':
        this.closeSession();
        return;
      case 'pay':
        this.openPay();
        return;
      case 'add-items':
        this.openAddItems();
        return;
    }
  }
}
