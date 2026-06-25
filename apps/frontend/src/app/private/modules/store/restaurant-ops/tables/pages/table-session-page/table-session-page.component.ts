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
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import {
  TableSession,
  TableSessionOrderItem,
  TableSessionAddItem,
  TableStatus,
  KitchenTicketItemRefStatus,
} from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { KitchenTicketsService, KdsSseService } from '../../../kds/services';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { AddItemsModalComponent } from '../../components/add-items-modal/add-items-modal.component';
import { SplitOrderModalComponent } from '../../components/split-order-modal/split-order-modal.component';
import {
  TablePaymentModalComponent,
  TablePaymentSubmit,
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

  readonly hasUnfiredItems = computed(() =>
    this.items().some((it) => !this.isItemFired(it)),
  );

  readonly isClosed = computed(() => !!this.session()?.closed_at);

  /** Reads `restaurant.enable_table_checkout` (loose JSON slice). */
  readonly checkoutEnabled = computed(
    () => this.settingsFacade.settings()?.restaurant?.enable_table_checkout === true,
  );

  /** Order state is a payment-status proxy (draft = unpaid, etc.). */
  readonly orderState = computed(() => this.session()?.order?.state ?? '—');

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const checkout = this.checkoutEnabled();
    const actions: StickyHeaderActionButton[] = [
      {
        id: 'add',
        label: 'Agregar items',
        icon: 'plus',
        // When checkout is on, "Cobrar" is the terminal primary action, so
        // "Agregar items" steps down to secondary to keep one clear primary.
        variant: checkout ? 'secondary' : 'primary',
        disabled: this.isClosed(),
      },
    ];
    if (checkout) {
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
  }

  loadSession(id: number): void {
    this.isLoading.set(true);
    this.tablesService
      .getSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => {
          this.session.set(s);
          this.seedKitchenStateFromOrder(s);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          this.isLoading.set(false);
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
    const active = rows.find(
      (r) =>
        r.status === 'in_preparation' ||
        r.status === 'ready' ||
        r.status === 'pending',
    );
    // Rows arrive DESC by id, so rows[0] is the most recent terminal one.
    return (active?.status ?? rows[0].status) as KitchenTicketItemRefStatus;
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

  /** Can the item be marked delivered? (fired, not yet delivered/cancelled). */
  canDeliver(item: TableSessionOrderItem): boolean {
    const status = this.kitchenStatusFor(item);
    return status != null && status !== 'delivered' && status !== 'cancelled';
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

  // ── Selection helpers ──────────────────────────────────────────────────

  toggleItemSelection(itemId: number): void {
    const item = this.items().find((it) => it.id === itemId);
    if (item && this.isItemFired(item)) return; // fired items are not selectable
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

  selectAllUnfired(): void {
    const unfired = this.items()
      .filter((it) => !this.isItemFired(it))
      .map((it) => it.id);
    this.selectedItemIds.set(new Set(unfired));
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
      : this.items()
          .filter((it) => !this.isItemFired(it))
          .map((it) => it.id);
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
          this.clearSelection();
          this.toastService.success(
            `Enviado a cocina — ticket #${res.kitchen_ticket_id}`,
          );
          this.loadSession(order.id);
        },
        error: (err: unknown) => {
          this.isFiring.set(false);
          this.firingItemId.set(null);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al enviar a cocina',
          );
        },
      });
  }

  // ── Mark delivered ─────────────────────────────────────────────────────

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
        next: () => {
          this.deliveringTicketId.set(null);
          // Optimistic merge — SSE will also push the ticket.delivered.
          this.liveKitchenState.update((prev) => {
            const next = new Map(prev);
            next.set(item.id, 'delivered');
            return next;
          });
          this.toastService.success('Plato marcado como entregado');
          const orderId = this.session()?.order?.id;
          if (orderId) this.loadSession(orderId);
        },
        error: (err: unknown) => {
          this.deliveringTicketId.set(null);
          const message =
            typeof err === 'string'
              ? err
              : (err as { message?: string })?.message ||
                'Error al marcar como entregado';
          this.toastService.error(message);
        },
      });
  }

  // ── Change table status ────────────────────────────────────────────────

  readonly tableStatusOptions: { value: TableStatus; label: string }[] = [
    { value: 'available', label: TablesService.statusLabel('available') },
    { value: 'occupied', label: TablesService.statusLabel('occupied') },
    { value: 'reserved', label: TablesService.statusLabel('reserved') },
    { value: 'cleaning', label: TablesService.statusLabel('cleaning') },
  ];

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
      case 'add':
        this.openAddItems();
        return;
      case 'pay':
        this.openPay();
        return;
    }
  }
}
