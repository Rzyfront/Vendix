import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { PosCartService, CartState, CartItem } from '../services/pos-cart.service';
import { PosPaymentService } from '../services/pos-payment.service';
import { PosCustomer } from '../services/pos-customer.service';
import {
  PosFulfillmentSelectorComponent,
  FulfillmentType,
} from './pos-fulfillment-selector.component';
import { PosOpenTableModalComponent } from './pos-open-table-modal.component';

export interface PosOrderCreateResult {
  order: any;
  fulfillment: FulfillmentType | null;
  tableId: number | null;
  firedToKitchen: boolean;
}

/**
 * Modal-resumen "Crear" (formerly "Guardar").
 *
 * Replaces the noisy `saveDraft` action on the cart / mobile footer with a
 * confirmation modal that:
 *  - Mirrors the order summary (subtotal, taxes, total, item count).
 *  - For restaurant stores with at least one `prepared` line item, shows
 *    the `PosFulfillmentSelector` so the operator picks Consumo / Entrega.
 *  - For `consumo` without an open table, blocks the action and surfaces
 *    a CTA to open a table via the existing `PosOpenTableModalComponent`.
 *  - On confirm, creates a draft order and, when relevant, fires the KDS
 *    through `PosRestaurantIntegrationService.maybeFireKitchen` (idempotent
 *    via the backend `inventory_consumed_at_fire` flag).
 *
 * Retail stores (no `restaurant` industry, or no `prepared` items) skip
 * the selector entirely and just persist a draft order.
 */
@Component({
  selector: 'app-pos-order-create-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    ModalComponent,
    IconComponent,
    PosFulfillmentSelectorComponent,
    PosOpenTableModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [showCloseButton]="true"
      title="Crear orden"
      subtitle="Confirma los datos antes de generar el borrador"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon
          name="clipboard-list"
          [size]="20"
          class="text-primary"
        ></app-icon>
      </div>

      <div class="space-y-5">
        <!-- Order summary -->
        <section class="summary-card">
          <div class="summary-row">
            <span class="summary-label">Ítems</span>
            <span class="summary-value">{{ itemCount() }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Subtotal</span>
            <span class="summary-value">{{ formatCurrency(subtotal()) }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">Impuestos</span>
            <span class="summary-value">{{ formatCurrency(taxAmount()) }}</span>
          </div>
          <div class="summary-row total">
            <span class="summary-label">Total</span>
            <span class="summary-value">{{ formatCurrency(total()) }}</span>
          </div>
        </section>

        @if (showFulfillmentSelector()) {
          <section>
            <h3 class="section-title">Tipo de servicio</h3>
            <app-pos-fulfillment-selector
              [value]="fulfillment()"
              [consumoBlocked]="isConsumoBlocked()"
              (selectionChange)="fulfillment.set($event)"
            ></app-pos-fulfillment-selector>

            @if (isConsumoBlocked() && fulfillment() === 'consumo') {
              <div class="consumo-blocked-hint">
                <app-icon name="info" [size]="14"></app-icon>
                <span>
                  Debes abrir una mesa antes de marcar la orden como consumo.
                </span>
              </div>
            }
          </section>
        }

        @if (showTablePicker()) {
          <section>
            <h3 class="section-title">Mesa</h3>
            @if (tableSession()) {
              <div class="table-pill">
                <app-icon name="layout-grid" [size]="14"></app-icon>
                <span>{{ tableLabel() }}</span>
              </div>
            } @else {
              <button
                type="button"
                class="open-table-cta"
                (click)="openTablePicker.set(true)"
              >
                <app-icon name="layout-grid" [size]="16"></app-icon>
                <span>Abrir mesa</span>
              </button>
            }
          </section>
        }
      </div>

      <div slot="footer" class="flex justify-end gap-2 w-full">
        <app-button variant="ghost" (click)="onCancel()" [disabled]="submitting()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (click)="onConfirm()"
          [disabled]="!canConfirm()"
          [loading]="submitting()"
          loadingText="Creando…"
        >
          <app-icon name="check" [size]="16"></app-icon>
          <span>Crear orden</span>
        </app-button>
      </div>
    </app-modal>

    @if (openTablePicker()) {
      <app-pos-open-table-modal
        [isOpen]="openTablePicker()"
        (isOpenChange)="openTablePicker.set($event)"
        (sessionOpened)="onTableSessionPicked($event)"
      ></app-pos-open-table-modal>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .summary-card {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 14px 16px;
        border-radius: 12px;
        background: rgba(var(--color-muted-rgb, 245, 245, 245), 0.6);
        border: 1px solid var(--color-border);
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        color: var(--color-text-secondary);
      }

      .summary-row.total {
        margin-top: 4px;
        padding-top: 8px;
        border-top: 1px dashed var(--color-border);
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .summary-label {
        font-weight: 500;
      }

      .summary-value {
        font-variant-numeric: tabular-nums;
      }

      .section-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-primary);
        margin-bottom: 8px;
      }

      .consumo-blocked-hint {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 12px;
        color: rgb(194, 65, 12);
      }

      .table-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(var(--color-primary-rgb), 0.08);
        border: 1px solid rgba(var(--color-primary-rgb), 0.3);
        color: var(--color-primary);
        font-size: 13px;
        font-weight: 600;
      }

      .open-table-cta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.18s ease;
      }

      .open-table-cta:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }
    `,
  ],
})
export class PosOrderCreateModalComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cartService = inject(PosCartService);
  private readonly paymentService = inject(PosPaymentService);
  private readonly integration = inject(PosRestaurantIntegrationService);
  private readonly toastService = inject(ToastService);
  private readonly store = inject(Store);
  private readonly router = inject(Router);

  // ─── Inputs / Outputs (Zoneless, model-based) ─────────────────────
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();

  /**
   * When `true` the modal is the "Crear" summary and at the end of the
   * flow it must clear the cart. When `false` (used as a "review before
   * Cobrar" mirror in Fase 6) the cart is preserved so the parent can
   * continue to the payment step.
   */
  readonly clearCartOnSuccess = input<boolean>(true);

  /** Emitted when a draft order has been persisted (and KDS fired if applicable). */
  readonly created = output<PosOrderCreateResult>();

  /** Emitted when the operator aborts the modal. */
  readonly cancelled = output<void>();

  // ─── Local state (signals) ─────────────────────────────────────────
  readonly fulfillment = signal<FulfillmentType>('entrega');
  readonly submitting = signal(false);
  readonly openTablePicker = signal(false);

  constructor() {
    // Reset the local state every time the modal is reopened.
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.submitting.set(false);
          this.openTablePicker.set(false);
          this.fulfillment.set(this.hasOpenTableSession() ? 'consumo' : 'entrega');
          this.integration.resetPreparedFired();
        });
      }
    });
  }

  // ─── Derived state ────────────────────────────────────────────────
  readonly cartState = this.cartService.cartState;
  readonly hasUnfiredPreparedItems = computed(() => {
    if (!this.integration.isRestaurantMode()) return false;
    return (this.cartState()?.items ?? []).some(
      (it: CartItem) =>
        it.itemType !== 'custom' &&
        (it.product as any)?.product_type === 'prepared',
    );
  });
  readonly showFulfillmentSelector = computed(
    () => this.integration.isRestaurantMode() && this.hasUnfiredPreparedItems(),
  );
  readonly tableSession = this.integration.currentTableSession;
  readonly hasOpenTableSession = this.integration.hasOpenTableSession;
  readonly showTablePicker = computed(
    () =>
      this.showFulfillmentSelector() && this.fulfillment() === 'consumo',
  );
  readonly isConsumoBlocked = computed(
    () => this.fulfillment() === 'consumo' && !this.tableSession(),
  );
  readonly canConfirm = computed(() => {
    if (this.submitting()) return false;
    if (this.showFulfillmentSelector() && this.isConsumoBlocked()) return false;
    return (this.cartState()?.items?.length ?? 0) > 0;
  });

  readonly itemCount = computed(
    () => this.cartState()?.summary?.itemCount ?? 0,
  );
  readonly subtotal = computed(
    () => Number(this.cartState()?.summary?.subtotal ?? 0),
  );
  readonly taxAmount = computed(
    () => Number(this.cartState()?.summary?.taxAmount ?? 0),
  );
  readonly total = computed(
    () => Number(this.cartState()?.summary?.total ?? 0),
  );

  readonly tableLabel = computed(() => {
    const t = this.tableSession()?.table;
    if (!t) return '';
    return t.zone ? `${t.name} · ${t.zone}` : t.name;
  });

  // ─── Public handlers ─────────────────────────────────────────────
  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.cancelled.emit();
    this.isOpenChange.emit(false);
  }

  onTableSessionPicked(_result: any): void {
    this.openTablePicker.set(false);
    // fulfillment remains 'consumo' (it was the trigger). The session is
    // cached in `currentTableSession`; the derived `isConsumoBlocked`
    // now resolves to false so the operator can submit.
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

    const state = this.cartState();
    if (!state) return;

    this.submitting.set(true);

    // Dispatch the right create flow:
    //  - Restaurant counter / takeaway (no open table) → createCounterDraftOrder
    //  - Restaurant table-session (already open)         → addItemsToTableSession + maybeFireKitchen
    //  - Retail (or restaurant with no prepared items)  → saveDraft
    const isRestaurant = this.integration.isRestaurantMode();
    const hasPrepared = this.hasUnfiredPreparedItems();
    const session = this.tableSession();

    if (isRestaurant && hasPrepared && !session) {
      this.createCounterAndFire(state);
      return;
    }

    if (isRestaurant && hasPrepared && session?.order_id) {
      this.appendToTableAndFire(state, session);
      return;
    }

    this.createRetailDraft(state);
  }

  private createCounterAndFire(state: CartState): void {
    const lines = this.toCounterLines(state.items);
    if (lines.length === 0) {
      this.submitting.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    const customerId = this.resolveCustomerId(state.customer);
    this.integration
      .createCounterDraftOrder(customerId, lines)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          const orderId = order?.id;
          const preparedIds = this.preparedItemIdsFromOrder(order);
          this.maybeFireAndFinish(orderId, preparedIds, state);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo crear la orden'));
        },
      });
  }

  private appendToTableAndFire(state: CartState, session: any): void {
    const items = state.items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        quantity: it.quantity,
        product_variant_id: it.variant_id ?? undefined,
      }));
    if (items.length === 0) {
      this.submitting.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    this.integration
      .addItemsToTableSession(session.id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const orderId = updated?.order?.id ?? session.order_id;
          const orderItemIds = (updated?.order?.order_items ?? [])
            .filter((it: any) =>
              items.some(
                (i) =>
                  i.product_id === it.product_id && i.quantity === it.quantity,
              ),
            )
            .map((it: any) => it.id);
          this.maybeFireAndFinish(orderId, orderItemIds, state);
        },
        error: (err) => {
          this.submitting.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo agregar ítems a la mesa'));
        },
      });
  }

  private createRetailDraft(state: CartState): void {
    this.paymentService
      .saveDraft(state, 'current_user')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.submitting.set(false);
          if (!res?.success) {
            this.toastService.error(res?.message || 'Error al crear la orden');
            return;
          }
          this.toastService.success(res.message || 'Orden creada correctamente');
          this.finishCreate(res.order ?? null, [], false);
        },
        error: (err: any) => {
          this.submitting.set(false);
          this.toastService.error(
            this.toastError(err, 'Error al crear la orden'),
          );
        },
      });
  }

  private maybeFireAndFinish(
    orderId: number | undefined,
    orderItemIds: number[],
    state: CartState,
  ): void {
    if (!orderId) {
      this.finishCreate(null, orderItemIds, false);
      return;
    }
    this.integration
      .maybeFireKitchen(orderId, orderItemIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fireRes) => {
          const fired = !!fireRes && fireRes.fired_item_ids.length > 0;
          if (fired) {
            this.toastService.success('Orden creada y enviada a cocina');
          } else if (orderItemIds.length > 0) {
            this.toastService.success('Orden creada');
          } else {
            this.toastService.success('Orden creada');
          }
          this.finishCreate({ id: orderId } as any, orderItemIds, fired);
          void state; // keep for future extensions (notes / customer)
        },
        error: (err) => {
          // Order already persisted — surface the error but do not roll back.
          this.toastService.warning(
            'La orden se creó pero no se pudo enviar a cocina. Reintenta desde el panel.',
          );
          console.error('maybeFireKitchen failed', err);
          this.finishCreate({ id: orderId } as any, orderItemIds, false);
        },
      });
  }

  private finishCreate(
    order: any,
    orderItemIds: number[],
    firedToKitchen: boolean,
  ): void {
    const fulfillment: FulfillmentType | null = this.showFulfillmentSelector()
      ? this.fulfillment()
      : null;
    const tableId = this.tableSession()?.table_id ?? null;

    this.created.emit({
      order,
      fulfillment,
      tableId,
      firedToKitchen,
    });

    if (this.clearCartOnSuccess()) {
      this.cartService
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => this.isOpenChange.emit(false),
          error: () => this.isOpenChange.emit(false),
        });
    } else {
      this.isOpenChange.emit(false);
    }
    // Suppress unused-warning while keeping the variable available for callers
    void orderItemIds;
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  private toCounterLines(items: CartItem[]): Array<{
    product_id: number;
    product_variant_id?: number;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    tax_rate?: number;
  }> {
    return items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        product_variant_id: it.variant_id ?? undefined,
        product_name: it.product.name,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice || 0),
        total_price: Number(it.totalPrice || 0),
        tax_rate: (it.product as any)?.tax_rate ?? undefined,
      }));
  }

  private preparedItemIdsFromOrder(order: any): number[] {
    const items: any[] = order?.order_items ?? [];
    return items
      .filter(
        (it) =>
          it?.product?.product_type === 'prepared' ||
          it?.product_type === 'prepared',
      )
      .map((it) => Number(it.id))
      .filter((id) => Number.isFinite(id));
  }

  private resolveCustomerId(customer: PosCustomer | null | undefined): number {
    if (!customer) return 0;
    const id = Number((customer as any).id);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }


  private toastError(err: any, fallback: string): string {
    const msg = extractApiErrorMessage(err);
    return msg && msg.length ? msg : fallback;
  }
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  }
}
