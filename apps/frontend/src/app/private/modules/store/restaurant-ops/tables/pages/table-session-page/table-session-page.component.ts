import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
  StickyHeaderComponent,
  BadgeComponent,
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
} from '../../interfaces';
import { TablesService } from '../../services/tables.service';
import { KitchenTicketsService } from '../../../kds/services';
import { AddItemsModalComponent } from '../../components/add-items-modal/add-items-modal.component';
import { SplitOrderModalComponent } from '../../components/split-order-modal/split-order-modal.component';

/**
 * Open-check page.
 *
 * Shows the items already on the table's draft order, exposes
 * - "Agregar" (add items),
 * - "Enviar a cocina" (fire selected items to KDS, triggers inventory
 *   consume + COGS posting — Phase D),
 * - "Dividir cuenta" (financial split, propagates fire flag — Phase E),
 * - "Cerrar mesa" (mark session closed, leaves the order to be paid
 *   via the normal payments flow).
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
  ],
  templateUrl: './table-session-page.component.html',
  styleUrl: './table-session-page.component.scss',
})
export class TableSessionPageComponent implements OnInit {
  private readonly tablesService = inject(TablesService);
  private readonly kitchenService = inject(KitchenTicketsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly sessionId = input<number | null>(null);

  readonly session = signal<TableSession | null>(null);
  readonly isLoading = signal(false);
  readonly selectedItemIds = signal<Set<number>>(new Set());
  readonly isAddItemsOpen = signal(false);
  readonly isSplitOpen = signal(false);
  readonly isAddingItems = signal(false);
  readonly isFiring = signal(false);
  readonly isSplitting = signal(false);
  readonly isClosing = signal(false);

  readonly items = computed<TableSessionOrderItem[]>(
    () => this.session()?.order?.order_items ?? [],
  );

  readonly orderTotal = computed(() =>
    Number(this.session()?.order?.grand_total ?? 0),
  );

  readonly selectedItems = computed(() => {
    const ids = this.selectedItemIds();
    return this.items().filter((it) => ids.has(it.id));
  });

  readonly hasUnfiredItems = computed(() =>
    this.items().some((it) => !it.inventory_consumed_at_fire),
  );

  readonly isClosed = computed(() => !!this.session()?.closed_at);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id') ?? NaN);
    if (!Number.isFinite(id) || id <= 0) {
      this.toastService.error('ID de sesión inválido');
      this.router.navigate(['/admin/restaurant-ops/tables']);
      return;
    }
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

  toggleItemSelection(itemId: number): void {
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
      .filter((it) => !it.inventory_consumed_at_fire)
      .map((it) => it.id);
    this.selectedItemIds.set(new Set(unfired));
  }

  clearSelection(): void {
    this.selectedItemIds.set(new Set());
  }

  // ── Modals ─────────────────────────────────────────────────────────

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

  openSplit(): void {
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
          // Plan KDS fire-flows (F4): if the backend auto-fired
          // prepared items as part of the split, surface the
          // fired count so the operator knows the kitchen is on
          // it.
          const fire = (result as any)?.kitchen_fire;
          if (fire && Number(fire.fired_count) > 0) {
            this.toastService.success(
              `${fire.fired_count} plato(s) enviados a cocina (ticket #${fire.kitchen_ticket_id})`,
            );
          }
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
          // Plan KDS fire-flows (F4): see onSplitByItems above.
          const fire = (result as any)?.kitchen_fire;
          if (fire && Number(fire.fired_count) > 0) {
            this.toastService.success(
              `${fire.fired_count} plato(s) enviados a cocina (ticket #${fire.kitchen_ticket_id})`,
            );
          }
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

  // ── Fire to kitchen ────────────────────────────────────────────────

  fireSelected(): void {
    const order = this.session()?.order;
    if (!order) return;
    const ids = this.selectedItemIds().size
      ? Array.from(this.selectedItemIds())
      : this.items()
          .filter((it) => !it.inventory_consumed_at_fire)
          .map((it) => it.id);
    if (ids.length === 0) {
      this.toastService.error('Selecciona al menos un item para enviar');
      return;
    }
    this.isFiring.set(true);
    this.kitchenService
      .fireOrderItems({ order_id: order.id, order_item_ids: ids })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.isFiring.set(false);
          this.clearSelection();
          this.toastService.success(
            `Enviado a cocina — ticket #${res.kitchen_ticket_id}`,
          );
          this.loadSession(order.id);
        },
        error: (err: unknown) => {
          this.isFiring.set(false);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al enviar a cocina',
          );
        },
      });
  }

  // ── Close session ──────────────────────────────────────────────────

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

  // ── UI helpers ─────────────────────────────────────────────────────

  trackById(_i: number, item: TableSessionOrderItem): number {
    return item.id;
  }

  onHeaderAction(actionId: string): void {
    switch (actionId) {
      case 'back':
        this.router.navigate(['/admin/restaurant-ops/tables']);
        return;
      case 'add':
        this.openAddItems();
        return;
      case 'fire':
        this.fireSelected();
        return;
      case 'split':
        this.openSplit();
        return;
      case 'close':
        this.closeSession();
        return;
    }
  }
}
