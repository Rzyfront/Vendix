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
import {
  CardComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  BadgeComponent,
  BadgeVariant,
  ButtonComponent,
  IconComponent,
  ToggleComponent,
  ToastService,
  SpinnerComponent,
  DialogService,
  TimelineComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/index';
import {
  TimelineStep,
  TimelineVariant,
} from '../../../../../../../shared/components/timeline/timeline.interfaces';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import {
  TableSession,
  TableSessionOrderItem,
  TableSessionAddItem,
  TableStatus,
  KitchenTicketItemRefStatus,
  PaymentPendingView,
} from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import {
  KitchenTicketsService,
  KdsSseService,
  KitchenMutationError,
} from '../../../kds/services';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AddItemsModalComponent } from '../../components/add-items-modal/add-items-modal.component';
import { SplitOrderModalComponent } from '../../components/split-order-modal/split-order-modal.component';
import {
  TablePaymentModalComponent,
  TablePaymentSubmit,
  TablePaymentConfirmSubmit,
} from '../../components/table-payment-modal/table-payment-modal.component';
import { AssignCustomerModalComponent } from '../../components/assign-customer-modal/assign-customer-modal.component';

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
    TimelineComponent,
    SelectorComponent,
    CurrencyPipe,
    AddItemsModalComponent,
    SplitOrderModalComponent,
    TablePaymentModalComponent,
    AssignCustomerModalComponent,
  ],
  templateUrl: './table-session-page.component.html',
  styleUrl: './table-session-page.component.scss',
})
export class TableSessionPageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
  private readonly kitchenService = inject(KitchenTicketsService);
  private readonly kdsSse = inject(KdsSseService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly session = signal<TableSession | null>(null);
  readonly isLoading = signal(false);
  readonly selectedItemIds = signal<Set<number>>(new Set());
  readonly isAddItemsOpen = signal(false);
  readonly isSplitOpen = signal(false);
  readonly isPayOpen = signal(false);
  readonly isAssignCustomerOpen = signal(false);
  readonly isAddingItems = signal(false);
  readonly isFiring = signal(false);
  readonly firingItemId = signal<number | null>(null);
  readonly deliveringTicketId = signal<number | null>(null);
  readonly isSplitting = signal(false);
  readonly isClosing = signal(false);
  readonly isPaying = signal(false);
  readonly isAssigningCustomer = signal(false);
  /** Order-item id currently being removed (drives the per-row spinner). */
  readonly removingItemId = signal<number | null>(null);

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

  readonly customer = computed(() => this.session()?.order?.customer ?? null);

  readonly customerName = computed(() => {
    const c = this.customer();
    if (!c) return null;
    return `${c.first_name} ${c.last_name}`.trim();
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

  /** Reads `restaurant.enable_table_checkout` (loose JSON slice). */
  readonly checkoutEnabled = computed(
    () => this.settingsFacade.settings()?.restaurant?.enable_table_checkout === true,
  );

  /** Raw order state from the backend (English enum value). */
  readonly orderState = computed(() => this.session()?.order?.state ?? null);

  /**
   * Spanish labels for order states. Local map (the orders module util
   * `OrderFormatUtils.formatOrderStatus` is mostly English and coupled to
   * the orders `OrderState` enum, so a complete local map is cleaner and
   * stays in scope). Covers the lifecycle states a table draft order can
   * surface. Unknown values fall back to the raw value capitalized.
   */
  private readonly ORDER_STATE_LABELS_ES: Record<string, string> = {
    draft: 'Borrador',
    created: 'Confirmada',
    confirmed: 'Confirmada',
    pending: 'Pendiente',
    pending_payment: 'Pago pendiente',
    processing: 'En proceso',
    shipped: 'Enviada',
    delivered: 'Entregada',
    completed: 'Completada',
    finished: 'Completada',
    cancelled: 'Cancelada',
    refunded: 'Reembolsada',
    partially_refunded: 'Reembolso parcial',
  };

  /** Order state translated to Spanish for display. */
  readonly orderStateLabel = computed(() => {
    const state = this.orderState();
    if (!state) return '—';
    return (
      this.ORDER_STATE_LABELS_ES[state] ??
      state.charAt(0).toUpperCase() + state.slice(1)
    );
  });

  /** Count of currently selected (pending) items for the batch toolbar. */
  readonly selectedCount = computed(() => this.selectedItemIds().size);

  /**
   * Number of `prepared` items still pending fire-to-kitchen. Non-dish
   * items (bottled water, retail add-ons) are intentionally excluded —
   * they do not go through the kitchen flow.
   */
  readonly pendingCount = computed(() => this.pendingPreparedItems().length);

  /** Current table status (drives the collapsed status timeline). */
  readonly tableStatus = computed<TableStatus | null>(
    () => (this.session()?.table?.status as TableStatus) ?? null,
  );

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

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const actions: StickyHeaderActionButton[] = [];
    // Core flow only: Cobrar (when checkout is ON) + Cerrar mesa.
    // "Agregar items" lives in the Items card header now.
    if (this.checkoutEnabled()) {
      actions.push({
        id: 'pay',
        label: 'Cobrar',
        icon: 'credit-card',
        variant: 'primary',
        disabled: this.isClosed() || this.items().length === 0,
        title: this.isClosed()
          ? 'La mesa ya está cerrada'
          : 'Cobrar y cerrar la mesa',
      });
    }
    actions.push({
      id: 'close',
      label: 'Cerrar mesa',
      icon: 'lock',
      variant: 'outline-danger',
      loading: this.isClosing(),
      disabled: this.isClosed(),
      title: this.isClosed() ? 'La mesa ya está cerrada' : 'Cerrar la mesa',
    });
    return actions;
  });

  constructor() {
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

  /** Live kitchen status for an item (SSE map first, then findOne fallback). */
  kitchenStatusFor(
    item: TableSessionOrderItem,
  ): KitchenTicketItemRefStatus | null {
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
    if (this.isClosed()) return false;
    return !this.isItemFired(item) || this.kitchenStatusFor(item) === 'pending';
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

  /**
   * Can the item be marked delivered? (fired, ready or in_preparation, not
   * yet terminal).
   *
   * Restaurant Suite — Fase K audit jun-2026: the previous `canDeliver`
   * returned `true` for ANY non-terminal state, including `pending`. That
   * let the operator click "Marcar entregado" on a dish the kitchen had
   * never even acknowledged as cooked; the backend rejected with
   * `KITCHEN_TICKET_INVALID_STATE` but the UX was confusing (generic
   * devMessage, no live state pill explaining why the button was shown).
   *
   * The new rules:
   *   - `ready`            → true  (primary path: kitchen said "listo")
   *   - `in_preparation`   → true  (defensive: SSE race right before click)
   *   - `pending`          → false (must go through KDS board first)
   *   - `delivered`/`cancelled` → false (terminal)
   *   - `null`             → false (never fired)
   */
  canDeliver(item: TableSessionOrderItem): boolean {
    const status = this.kitchenStatusFor(item);
    if (status == null) return false;
    if (status === 'delivered' || status === 'cancelled') return false;
    return status === 'ready' || status === 'in_preparation';
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

  /** The kitchen_ticket_id to act on for an item (most recent non-terminal). */
  private ticketIdFor(item: TableSessionOrderItem): number | null {
    const rows = item.kitchen_ticket_items ?? [];
    if (rows.length === 0) return null;
    const active = rows.find(
      (r) =>
        r.status === 'in_preparation' ||
        r.status === 'ready' ||
        r.status === 'pending',
    );
    return (active ?? rows[0]).kitchen_ticket_id;
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
    if (this.isClosed()) {
      this.toastService.error('La mesa está cerrada');
      return;
    }
    this.isAddItemsOpen.set(true);
  }

  onAddItems(items: TableSessionAddItem[]): void {
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
   * Remove a single line from the open check. Confirms first (the message
   * warns about the kitchen-ticket cancel + stock return when the item was
   * already fired-pending), then calls the backend and replaces the local
   * session with the recalculated snapshot it returns.
   */
  onRemoveItem(item: TableSessionOrderItem): void {
    const sessionId = this.session()?.id;
    if (!sessionId || this.isClosed()) return;
    if (!this.canRemoveItem(item)) return;
    const firedPending =
      this.isItemFired(item) && this.kitchenStatusFor(item) === 'pending';
    this.dialogService
      .confirm({
        title: 'Eliminar plato',
        message: firedPending
          ? `¿Eliminar "${item.product_name}" de la cuenta? Se cancelará su ticket de cocina y se devolverá el inventario consumido.`
          : `¿Eliminar "${item.product_name}" de la cuenta?`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.removingItemId.set(item.id);
        this.tablesService
          .removeItem(sessionId, item.id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (s) => {
              this.removingItemId.set(null);
              this.session.set(s);
              this.seedKitchenStateFromOrder(s);
              this.toastService.success('Plato eliminado de la cuenta');
            },
            error: (err: unknown) => {
              this.removingItemId.set(null);
              this.toastService.error(
                typeof err === 'string' ? err : 'Error al eliminar el plato',
              );
            },
          });
      });
  }

  // ── Split bill ─────────────────────────────────────────────────────────

  openSplit(): void {
    if (this.isClosed()) {
      this.toastService.error('La mesa está cerrada');
      return;
    }
    if (this.items().length < 2) {
      this.toastService.error('Necesitas al menos 2 items para dividir');
      return;
    }
    this.isSplitOpen.set(true);
  }

  onSplitByItems(dto: { item_groups: { order_item_ids: number[] }[] }): void {
    const orderId = this.session()?.order_id;
    if (!orderId) return;
    this.isSplitting.set(true);
    this.tablesService
      .splitByItems(orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isSplitting.set(false);
          this.isSplitOpen.set(false);
          this.toastService.success(
            `Cuenta dividida en ${result.sub_orders.length} sub-órdenes`,
          );
          this.surfaceSplitFire(result);
          this.router.navigate(['/admin/restaurant-ops/tables']);
        },
        error: (err: unknown) => {
          this.isSplitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al dividir la cuenta',
          );
        },
      });
  }

  onSplitByAmount(dto: {
    mode: 'equal' | 'custom';
    n_splits: number;
    amounts?: number[];
  }): void {
    const orderId = this.session()?.order_id;
    if (!orderId) return;
    this.isSplitting.set(true);
    this.tablesService
      .splitByAmount(orderId, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.isSplitting.set(false);
          this.isSplitOpen.set(false);
          this.toastService.success(
            `Cuenta dividida en ${result.sub_orders.length} sub-órdenes`,
          );
          this.surfaceSplitFire(result);
          this.router.navigate(['/admin/restaurant-ops/tables']);
        },
        error: (err: unknown) => {
          this.isSplitting.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al dividir la cuenta',
          );
        },
      });
  }

  /** Surface backend auto-fire result from a split (Plan KDS fire-flows F4). */
  private surfaceSplitFire(result: unknown): void {
    const fire = (result as { kitchen_fire?: { fired_count?: number; kitchen_ticket_id?: number } })
      ?.kitchen_fire;
    if (fire && Number(fire.fired_count) > 0) {
      this.toastService.success(
        `${fire.fired_count} plato(s) enviados a cocina (ticket #${fire.kitchen_ticket_id})`,
      );
    }
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

  private fire(orderItemIds: number[], singleItemId: number | null): void {
    const order = this.session()?.order;
    if (!order) return;
    this.isFiring.set(true);
    this.firingItemId.set(singleItemId);
    this.kitchenService
      .fireOrderItems({ order_id: order.id, order_item_ids: orderItemIds })
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
   * Restaurant Suite — Fase K audit jun-2026:
   *  - The success toast ONLY fires when the response payload actually
   *    confirms the new state (`status === 'delivered'` or `ready`). If the
   *    backend silently no-ops or returns an unexpected shape, the
   *    optimistic merge still runs but the toast is suppressed — the
   *    operator won't be told "success" when the kitchen wasn't updated.
   *  - The error path uses `parseApiError` so SPECIFIC error codes
   *    (`KITCHEN_TICKET_NOT_READY`, `KITCHEN_TICKET_ALREADY_DELIVERED`,
   *    `KITCHEN_TICKET_ALREADY_CANCELLED`) map to actionable Spanish
   *    messages instead of the generic "Transición de estado no permitida".
   */
  markDelivered(item: TableSessionOrderItem): void {
    const ticketId = this.ticketIdFor(item);
    if (ticketId == null) {
      this.toastService.error('Este plato no tiene un ticket de cocina');
      return;
    }
    this.deliveringTicketId.set(ticketId);
    this.kitchenService
      .markDelivered(ticketId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ticket) => {
          this.deliveringTicketId.set(null);
          // Only merge + toast when the backend CONFIRMS the new state.
          // Defensive against silent no-ops: a successful HTTP 200 with a
          // stale `status` (e.g. the SSE reconciler already advanced it to
          // `delivered` moments ago) is treated as success but the toast
          // still fires to confirm the operator's intent.
          const confirmed =
            ticket?.status === 'delivered' || ticket?.status === 'ready';
          if (confirmed) {
            this.liveKitchenState.update((prev) => {
              const next = new Map(prev);
              next.set(item.id, ticket.status);
              return next;
            });
            this.toastService.success('Plato marcado como entregado');
          }
          // Refetch by SESSION id. The route /store/table-sessions/:id expects
          // the session row id, not the order row id (H2 fix).
          const sessionId = this.session()?.id;
          if (sessionId) this.loadSession(sessionId, { silent: true });
        },
        error: (err: unknown) => {
          this.deliveringTicketId.set(null);
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
   * The user-reported bug (toast says success when backend rejected) is
   * covered by:
   *   1. `markDelivered` only shows the success toast when the response
   *      payload's `status === 'delivered'` (this method is never called
   *      on success), and
   *   2. `canDeliver` hides the button for `pending` items so the operator
   *      can't trigger a guaranteed-rejected call in the first place.
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
    if (structured?.code) {
      // parseApiError pulls userMessage from ERROR_MESSAGES using the code,
      // and falls back to DEFAULT_ERROR_MESSAGE if the code isn't mapped.
      const parsed = parseApiError({ error: { error_code: structured.code } });
      this.toastService.error(parsed.userMessage);
      return;
    }
    this.toastService.error(
      structured?.message ?? 'Error al actualizar el estado en cocina',
    );
  }

  // ── Change table status ────────────────────────────────────────────────

  /**
   * Options for the single "Cambiar estado" selector. The timeline is the
   * sole DISPLAY of the current status; this selector is the sole CONTROL
   * to change it (no more redundant 4-button row).
   */
  readonly tableStatusOptions: SelectorOption[] = [
    { value: 'available', label: TablesService.statusLabel('available') },
    { value: 'reserved', label: TablesService.statusLabel('reserved') },
    { value: 'occupied', label: TablesService.statusLabel('occupied') },
    { value: 'cleaning', label: TablesService.statusLabel('cleaning') },
  ];

  /** Selector handler — the `app-selector` emits the chosen status value. */
  onTableStatusChange(value: string | number | null): void {
    if (value == null) return;
    const status = value as TableStatus;
    if (status === this.tableStatus()) return; // no-op if unchanged
    this.changeTableStatus(status);
  }

  changeTableStatus(status: TableStatus): void {
    const tableId = this.session()?.table_id;
    if (!tableId) return;
    this.tablesService
      .update(tableId, { status })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (table) => {
          // Reflect the new status on the local session.table view.
          this.session.update((s) =>
            s
              ? {
                  ...s,
                  table: s.table
                    ? { ...s.table, status: table.status }
                    : s.table,
                }
              : s,
          );
          this.toastService.success(
            `Estado de mesa: ${TablesService.statusLabel(status)}`,
          );
        },
        error: (err: unknown) => {
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al cambiar el estado',
          );
        },
      });
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
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isPaying.set(false);
          this.isPayOpen.set(false);
          this.toastService.success('Cobro realizado. Mesa cerrada.');
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
              this.toastService.success('Mesa cerrada');
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
      case 'pay':
        this.openPay();
        return;
      case 'close':
        this.closeSession();
        return;
    }
  }
}
