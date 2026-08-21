import { Component, computed, output, inject, DestroyRef } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Observable } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  PopCartService,
  PopCartState,
  PopCartItem,
  PopCartSummary,
} from '../services/pop-cart.service';
import { deriveLineTax } from '../utils/purchase-line-tax.util';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TooltipComponent } from '../../../../../../shared/components/tooltip/tooltip.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { FormsModule } from '@angular/forms';

import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { QuantityControlComponent } from '../../../../../../shared/components/quantity-control/quantity-control.component';
import type { QuantityClampEvent } from '../../../../../../shared/components/quantity-control/quantity-control.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-pop-cart',
  standalone: true,
  imports: [
    DecimalPipe,
    ButtonComponent,
    IconComponent,
    TooltipComponent,
    InputComponent,
    FormsModule,
    QuantityControlComponent,
    ToggleComponent,
  ],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-md shadow-card border border-border"
    >
      <!-- Cart Header & Summary Section (Fixed at top) -->
      <div class="flex-none bg-surface border-b border-border shadow-sm">
        <!-- Header Row -->
        <div class="px-5 py-3 border-b border-border/50">
          <div class="flex justify-between items-center gap-4">
            <h2
              class="text-base font-bold text-text-primary flex items-center gap-2"
            >
              <app-icon
                name="shopping-cart"
                [size]="18"
                class="text-primary"
              ></app-icon>
              Orden de Compra ({{ cartState()?.items?.length || 0 }})
            </h2>
            @if ((cartState()?.items?.length ?? 0) > 0) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="clearCart()"
                [loading]="loading()"
                class="text-destructive hover:text-destructive hover:bg-destructive/10 !px-2 !h-8"
              >
                <app-icon name="trash-2" [size]="14" slot="icon" ></app-icon>
                Vaciar
              </app-button>
            }
          </div>
        </div>

        <!-- IVA master toggle — "¿Esta compra tiene IVA?" -->
        <div
          class="px-5 py-2.5 bg-primary/5 border-b border-border/50 flex items-center justify-between gap-3"
        >
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="receipt" [size]="14" class="text-primary"></app-icon>
            <span class="text-xs font-medium text-text-primary truncate">
              ¿Esta compra tiene IVA?
            </span>
          </div>
          <app-toggle
            [checked]="hasVat()"
            (changed)="onHasVatToggle($event)"
            ariaLabel="¿Esta compra tiene IVA?"
          ></app-toggle>
        </div>

        <!-- Totals Row (High Contrast) -->
        <div class="px-5 py-4 bg-muted/20">
          <div class="space-y-1.5 mb-4">
            <div class="flex justify-between text-xs text-text-secondary">
              <span>{{ hasVat() ? 'Subtotal (neto)' : 'Subtotal' }}</span>
              <span class="font-medium">{{
                formatCurrency(summary()?.subtotal || 0)
              }}</span>
            </div>
            <!--
              QUI-661 — Descuento comercial GENERAL de la factura. Se muestra
              ANTES del IVA porque ese es el orden real del cálculo: el
              descuento baja la base gravable, y el IVA de abajo ya sale de la
              base rebajada. El backend lo prorratea por línea para que llegue
              también al costo capitalizado del inventario.
            -->
            <div class="flex justify-between items-center text-xs text-text-secondary">
              <span>Descuento general</span>
              <div class="flex items-center gap-2">
                <input
                  type="number"
                  class="w-20 px-2 py-0.5 text-right border border-border rounded bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
                  [ngModel]="discountAmount()"
                  (ngModelChange)="updateGeneralDiscount($event)"
                  min="0"
                  step="0.01"
                />
                @if ((summary()?.discount_amount || 0) > 0) {
                  <span class="font-medium text-amber-600">
                    -{{ formatCurrency(summary()!.discount_amount) }}
                  </span>
                }
              </div>
            </div>
            @if (hasVat()) {
              <div class="flex justify-between text-xs text-text-secondary">
                <span>IVA</span>
                <span class="font-medium">{{
                  formatCurrency(summary()?.tax_amount || 0)
                }}</span>
              </div>
            }
            <div
              class="pt-2 border-t border-border/50 flex justify-between items-center"
            >
              <span class="font-bold text-text-primary text-base"
                >Total Estimado</span
              >
              <span class="font-extrabold text-2xl text-primary tracking-tight">
                {{ formatCurrency(summary()?.total || 0) }}
              </span>
            </div>
          </div>

          <!-- Checkout Actions -->
          @if (
            {
              loading: loading(),
              isEmpty: isEmpty(),
            };
            as actionState
          ) {
            <div
              class="relative mt-4"
              (mouseenter)="
                (actionState.loading || actionState.isEmpty) &&
                  onDisabledActionsHover(
                    actionState.loading,
                    actionState.isEmpty
                  )
              "
              (mouseleave)="hideDisabledActionsTooltip()"
            >
              <app-tooltip
                position="top"
                color="ai"
                size="sm"
                [content]="getDisabledActionsMessage(actionState.loading, actionState.isEmpty)"
                [visible]="
                  disabledActionsTooltipVisible &&
                  (actionState.loading || actionState.isEmpty)
                "
                class="!absolute left-1/2 -translate-x-1/2 top-0 z-10"
              ></app-tooltip>
              <div class="grid grid-cols-2 gap-2">
                <!-- Secondary CTAs (top row) -->
                <app-button
                  variant="outline"
                  size="sm"
                  [fullWidth]="true"
                  (clicked)="onSaveDraft()"
                  [disabled]="actionState.loading || actionState.isEmpty"
                  customClasses="!h-10 !font-semibold !border-border !text-text-primary !bg-surface hover:!bg-muted/30 hover:!text-text-primary"
                >
                  Borrador
                </app-button>
                <app-button
                  variant="primary"
                  size="sm"
                  [fullWidth]="true"
                  (clicked)="onSubmitOrder()"
                  [disabled]="actionState.loading || actionState.isEmpty"
                  customClasses="!h-10 !font-semibold"
                >
                  <app-icon name="file-text" [size]="18" slot="icon" ></app-icon>
                  Crear orden
                </app-button>
                <!-- Primary CTA: Create and Receive (bottom, full width) -->
                <app-button
                  class="col-span-2"
                  variant="success"
                  size="md"
                  [fullWidth]="true"
                  (clicked)="onCreateAndReceive()"
                  [disabled]="actionState.loading || actionState.isEmpty"
                  customClasses="!h-11 !font-semibold !shadow-sm"
                >
                  Crear + Recibir
                </app-button>
              </div>
            </div>
          }
        </div>

        <!-- Supplier Information (Compact) -->
        @if (cartState()?.supplierId) {
          <div
            class="px-5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-center gap-3"
          >
            <div
              class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"
            >
              <app-icon name="truck" [size]="14"></app-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p
                class="text-[11px] text-text-secondary font-medium leading-none mb-0.5"
              >
                Proveedor Seleccionado
              </p>
              <p class="text-xs font-bold text-text-primary truncate">
                ID: {{ cartState()?.supplierId }}
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Cart Content (Scrollable Items) -->
      <div class="flex-1 overflow-y-auto p-4 bg-bg/30">
        <!-- Empty State -->
        @if (isEmpty()) {
          <div
            class="flex flex-col items-center pt-10 min-h-[200px] text-center opacity-60"
          >
            <div
              class="w-12 h-12 bg-muted/20 rounded-full flex items-center justify-center mb-3"
            >
              <app-icon
                name="shopping-cart"
                [size]="24"
                class="text-muted"
              ></app-icon>
            </div>
            <h3 class="text-sm font-semibold text-text-primary mb-1">
              Orden vacía
            </h3>
            <p class="text-[11px] text-text-secondary">
              Selecciona productos en el panel izquierdo
            </p>
          </div>
        }

        <!-- Cart Items List -->
        @if (!isEmpty()) {
          <div class="space-y-2">
            @for (
              item of cartState()?.items;
              track trackByItemId($index, item)
            ) {
              <div
                class="group flex flex-col gap-2 p-2.5 rounded-md border border-border bg-surface hover:bg-muted/30 hover:border-primary/30 transition-all duration-200"
              >
                <!-- Top Row: Info and Remove Button -->
                <div class="flex items-start gap-3">
                  <!-- Item Info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start gap-2">
                      <h4
                        class="text-sm font-semibold text-text-primary truncate leading-tight mb-0.5"
                        [title]="item.product.name"
                      >
                        {{ item.product.name }}
                      </h4>
                      <div
                        class="relative"
                        (mouseenter)="hoveredRemoveTooltip = item.id"
                        (mouseleave)="hoveredRemoveTooltip = null"
                      >
                        <button
                          (click)="removeFromCart(item.id)"
                          class="p-1 rounded-sm text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <app-icon name="trash-2" [size]="14"></app-icon>
                        </button>
                        <app-tooltip
                          position="top"
                          size="sm"
                          color="ai"
                          content="Eliminar"
                          [visible]="hoveredRemoveTooltip === item.id"
                          class="!absolute left-1/2 -translate-x-1/2 bottom-full z-10"
                        ></app-tooltip>
                      </div>
                    </div>
                    <!-- Variant & SKU -->
                    @if (item.variant) {
                      <div class="text-[10px] text-primary font-medium mb-0.5">
                        Variante: {{ item.variant.name || item.variant.sku }}
                      </div>
                    }
                    <div class="text-[10px] text-text-secondary mb-2">
                      SKU: {{ item.variant?.sku || item.product.code }}
                    </div>
                    <div class="flex justify-between items-end">
                      <!-- Unit Cost Input (Editable for POP) -->
                      <div class="flex flex-col">
                        <span
                          class="text-[10px] text-text-secondary uppercase mb-1"
                        >
                          {{
                            item.product.pricing_type === 'weight'
                              ? 'Costo / kg'
                              : 'Costo Unit.'
                          }}
                        </span>
                        <app-input
                          type="number"
                          size="sm"
                          [ngModel]="item.unit_cost"
                          (ngModelChange)="updateCost(item.id, $event)"
                          customInputClass="text-right !h-7 !py-0"
                          customWrapperClass="!mt-0"
                          min="0"
                        ></app-input>
                      </div>
                      <!--
                        QUI-661 — Descuento comercial de ESTA línea, en %.
                        Baja el costo unitario ANTES de derivar el IVA, así que
                        reduce la base gravable y el costo que se capitaliza al
                        inventario. No es lo mismo que teclear un costo menor:
                        el descuento queda registrado como tal.
                      -->
                      <div class="flex flex-col">
                        <span
                          class="text-[10px] text-text-secondary uppercase mb-1"
                          >Desc. %</span
                        >
                        <app-input
                          type="number"
                          size="sm"
                          [ngModel]="item.discount"
                          (ngModelChange)="updateDiscount(item.id, $event)"
                          customInputClass="text-right !h-7 !py-0"
                          customWrapperClass="!mt-0"
                          min="0"
                          max="100"
                        ></app-input>
                      </div>
                      <div class="flex flex-col items-end">
                        <span
                          class="text-[10px] text-text-secondary uppercase mb-1"
                          >Total</span
                        >
                        <span class="text-sm font-bold text-primary">
                          {{ formatCurrency(item.total) }}
                        </span>
                      </div>
                    </div>
                    <!--
                      QUI-661 Fase 4 — visual del descuento comercial de la
                      línea. Se muestra SOLO cuando hay descuento > 0 para no
                      añadir ruido cuando la línea no tiene rebaje. El neto
                      sale del mismo `deriveLineTax` que usa el servicio: una
                      sola fuente, dos consumidores (servicio y template).
                      Mobile-first: flex-wrap para que el tachado + neto + (-%)
                      quepan en pantallas estrechas sin romper la fila.
                    -->
                    @if (item.discount > 0) {
                      <div
                        class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 mt-1 text-[10px]"
                      >
                        <span class="text-text-secondary">Precio neto:</span>
                        <span class="line-through text-text-muted">
                          {{ formatCurrency(item.unit_cost) }}
                        </span>
                        <app-icon
                          name="arrow-right"
                          [size]="10"
                          class="text-text-muted"
                        ></app-icon>
                        <span class="font-semibold text-text-primary">
                          {{ formatCurrency(lineNetUnit(item)) }}
                        </span>
                        <span class="text-text-secondary">
                          (-{{ item.discount | number: '1.0-0' }}%)
                        </span>
                      </div>
                    }
                    <!-- Cost comparison -->
                    @if (getCostDelta(item); as delta) {
                      <div class="flex items-center gap-1.5 mt-1 text-[10px]">
                        <span class="text-text-secondary">
                          Costo actual: {{ formatCurrency(delta.currentCost) }}
                        </span>
                        <app-icon
                          name="arrow-right"
                          [size]="10"
                          class="text-text-muted"
                        ></app-icon>
                        <span class="text-text-secondary">
                          Nuevo: {{ formatCurrency(item.unit_cost) }}
                        </span>
                        <span
                          class="font-bold px-1 py-0.5 rounded"
                          [class]="
                            delta.percentage < 0
                              ? 'text-success bg-success/10'
                              : delta.percentage > 0
                                ? 'text-destructive bg-destructive/10'
                                : 'text-text-muted'
                          "
                        >
                          {{ delta.percentage > 0 ? '+' : ''
                          }}{{ delta.percentage | number: '1.1-1' }}%
                        </span>
                      </div>
                    }
                  </div>
                </div>
                <!-- Bottom Row: Quantity Controls -->
                <div
                  class="flex items-center justify-between pt-2 border-t border-border/50"
                >
                  <span
                    class="text-[10px] uppercase tracking-wider font-bold text-text-secondary/60"
                  >
                    {{
                      item.product.pricing_type === 'weight'
                        ? 'Peso (kg)'
                        : 'Cantidad'
                    }}
                  </span>
                  @if (item.product.pricing_type === 'weight') {
                    <app-input
                      type="number"
                      size="sm"
                      [ngModel]="item.quantity"
                      (ngModelChange)="updateQuantity(item.id, $event)"
                      customInputClass="text-right !h-7 !py-0 !w-24"
                      customWrapperClass="!mt-0"
                      min="0.001"
                      step="0.001"
                    ></app-input>
                  } @else {
                    <app-quantity-control
                      [value]="item.quantity"
                      [min]="1"
                      [editable]="true"
                      [disabled]="loading()"
                      [size]="'sm'"
                      (valueChange)="updateQuantity(item.id, $event)"
                      (valueClamped)="onQuantityClamped($event)"
                    ></app-quantity-control>
                  }
                </div>
                <!-- IVA per-line: rate (%) + type + include/added override.
                     Solo visible cuando la orden marca IVA (maestro). -->
                @if (hasVat()) {
                  <div
                    class="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50 text-[10px]"
                  >
                    <span
                      class="uppercase tracking-wider font-bold text-text-secondary/60"
                    >
                      IVA
                    </span>
                    <div class="flex items-center gap-1">
                      <app-input
                        type="number"
                        size="sm"
                        [ngModel]="item.tax_rate"
                        (ngModelChange)="updateTaxRate(item.id, $event)"
                        customInputClass="text-right !h-7 !py-0 !w-14"
                        customWrapperClass="!mt-0"
                        min="0"
                        step="1"
                      ></app-input>
                      <span class="text-text-secondary">%</span>
                    </div>
                    <select
                      class="h-7 text-[10px] px-1.5 py-0 border border-border rounded bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
                      [value]="item.tax_type || 'iva'"
                      (change)="onTaxTypeChange(item.id, $event)"
                    >
                      <option value="iva">IVA</option>
                      <option value="inc">INC</option>
                    </select>
                    <div class="ml-auto flex items-center gap-1.5">
                      <span class="text-text-secondary">
                        {{ itemEffectiveInclude(item) ? 'Incluido' : 'Agregado' }}
                      </span>
                      <app-toggle
                        [checked]="itemEffectiveInclude(item)"
                        (changed)="onItemIncludeToggle(item, $event)"
                        ariaLabel="Precio con IVA incluido para esta línea"
                      ></app-toggle>
                    </div>
                  </div>
                }
                <!-- Config Trigger (Variants / Lot / Unit) -->
                <div
                  class="flex items-center gap-1.5 text-[10px] mt-1 px-2 py-1 rounded-md border border-dashed border-border hover:border-primary hover:bg-primary/5 cursor-pointer transition-colors"
                  (click)="openConfigModal(item)"
                >
                  <app-icon
                    name="settings"
                    [size]="11"
                    class="text-primary"
                  ></app-icon>
                  <span class="text-text-secondary">{{
                    getConfigDisplayText(item)
                  }}</span>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      /* Chrome, Safari, Edge, Opera */
      input::-webkit-outer-spin-button,
      input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      /* Firefox */
      input[type='number'] {
        -moz-appearance: textfield;
      }
    `,
  ],
})
export class PopCartComponent {
  private currencyService = inject(CurrencyFormatService);
  private cartService = inject(PopCartService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);
  private disabledActionsTooltipTimeout: ReturnType<typeof setTimeout> | null =
    null;

  readonly cartState$ = this.cartService.cartState$;
  readonly isEmpty$ = this.cartService.isEmpty$;
  readonly summary$ = this.cartService.summary$;
  readonly loading$ = this.cartService.loading$;

  // Signal-based properties
  readonly cartState = toSignal(this.cartState$, { initialValue: null! });
  readonly isEmpty = toSignal(this.isEmpty$, { initialValue: false });
  readonly summary = toSignal(this.summary$, { initialValue: null! });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  /**
   * QUI-661 — general commercial discount, read off the cart state so the input
   * survives a cart reload (editing an existing draft rehydrates it from
   * `purchase_orders.discount_amount`).
   */
  readonly discountAmount = computed(
    () => this.cartState()?.discountAmount ?? 0,
  );
  hoveredRemoveTooltip: string | null = null;
  disabledActionsTooltipVisible = false;

  readonly saveDraft = output<void>();
  readonly submitOrder = output<void>();
  readonly createAndReceive = output<void>();
  readonly requestLotConfig = output<any>();
  readonly requestItemConfig = output<PopCartItem>();

  constructor() {
    this.currencyService.loadCurrency();
    this.destroyRef.onDestroy(() => {
      if (this.disabledActionsTooltipTimeout) {
        clearTimeout(this.disabledActionsTooltipTimeout);
      }
    });
  }

  trackByItemId(_index: number, item: PopCartItem): string {
    return item.id;
  }

  /**
   * Feedback visible cuando `app-quantity-control` clampa un valor fuera de
   * rango (mismo patrón que POS `onQuantityClamped`). En POP el control solo
   * define `min=1` (no hay cap de stock en una orden de compra), así que en la
   * práctica solo se dispara `reason: 'min'`; se cubren ambos por robustez.
   */
  onQuantityClamped(event: QuantityClampEvent): void {
    const message =
      event.reason === 'min'
        ? `La cantidad mínima es ${event.limit}.`
        : `Cantidad ajustada a ${event.limit}.`;
    this.toastService.info(message, 'Cantidad ajustada', 2200);
  }

  updateQuantity(itemId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId, quantity })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {},
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al actualizar cantidad',
          );
        },
      });
  }

  // ============================================================
  // IVA cycle (F1): header mode + per-line tax capture
  // ============================================================

  /** Maestro "¿Esta compra tiene IVA?": gobierna la visibilidad y el cálculo. */
  hasVat(): boolean {
    return this.cartState()?.has_vat ?? false;
  }

  /** Encender/apagar el IVA de toda la orden (recomputa todas las líneas). */
  onHasVatToggle(value: boolean): void {
    this.cartService.setHasVat(value);
  }

  /** Header dominant mode: whether captured prices already include tax. */
  headerIncludeTax(): boolean {
    return this.cartState()?.prices_include_tax ?? false;
  }

  /** Effective include mode for a line: per-line override wins over header. */
  itemEffectiveInclude(item: PopCartItem): boolean {
    return item.prices_include_tax ?? this.headerIncludeTax();
  }

  /** Toggle the header dominant mode; recomputes lines that inherit it. */
  onHeaderIncludeToggle(value: boolean): void {
    this.cartService.setPricesIncludeTax(value);
  }

  /** Update a line's tax rate (%). */
  updateTaxRate(itemId: string, rate: number | string): void {
    const parsed = Number(rate);
    this.cartService.setItemTaxRate(itemId, Number.isFinite(parsed) ? parsed : 0);
  }

  /** Update a line's tax classification from the native <select>. */
  onTaxTypeChange(itemId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.cartService.setItemTaxType(itemId, value);
  }

  /**
   * Toggle a line's include/added mode. When the new value matches the header
   * the override is CLEARED so the line follows the header again; otherwise
   * an explicit per-line override is set (mixed invoices).
   */
  onItemIncludeToggle(item: PopCartItem, value: boolean): void {
    const header = this.headerIncludeTax();
    this.cartService.setItemPricesIncludeTax(
      item.id,
      value === header ? undefined : value,
    );
  }

  /**
   * QUI-661 — per-line commercial discount, as a percentage.
   *
   * Goes straight through the cart service (not `updateCartItem`) because the
   * discount is not an item attribute the backend resolves: it changes the
   * line's net, its VAT and the order's taxable base, so the service recomputes
   * the whole summary from it.
   */
  updateDiscount(itemId: string, percentage: number): void {
    this.cartService.setItemDiscount(itemId, Number(percentage));
  }

  /**
   * QUI-661 — general commercial discount on the whole invoice, in money.
   * The backend prorates it across the lines; here it only needs to reach the
   * cart state so the summary recomputes and the payload carries it.
   */
  updateGeneralDiscount(amount: number): void {
    this.cartService.setDiscountAmount(Number(amount));
  }

  updateCost(itemId: string, cost: number): void {
    if (cost < 0) return;

    this.cartService
      .updateCartItem({ itemId, unit_cost: Number(cost) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {},
        error: (error) => {
          this.toastService.error('Error al actualizar costo');
        },
      });
  }

  removeFromCart(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado de la orden');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        },
      });
  }

  async clearCart(): Promise<void> {
    const confirm = await this.dialogService.confirm({
      title: 'Vaciar Orden',
      message: '¿Estás seguro de que quieres eliminar todos los productos?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (confirm) {
      this.cartService
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.info('Orden vaciada');
          },
          error: (error) => {
            this.toastService.error(error.message || 'Error al vaciar orden');
          },
        });
    }
  }

  onSaveDraft(): void {
    this.saveDraft.emit();
  }

  onSubmitOrder(): void {
    this.submitOrder.emit();
  }

  onCreateAndReceive(): void {
    this.createAndReceive.emit();
  }

  onDisabledActionsHover(isLoading: boolean, isEmpty: boolean): void {
    if (!isLoading && !isEmpty) {
      return;
    }
    this.disabledActionsTooltipVisible = true;
  }

  hideDisabledActionsTooltip(): void {
    this.disabledActionsTooltipVisible = false;
  }

  getDisabledActionsMessage(isLoading: boolean, isEmpty: boolean): string {
    if (isLoading) {
      return 'Procesando cambios, espera un momento.';
    }
    if (isEmpty) {
      return 'Agrega al menos un producto para habilitar esta acción.';
    }
    return '';
  }

  openConfigModal(item: PopCartItem): void {
    this.requestItemConfig.emit(item);
  }

  getConfigDisplayText(item: PopCartItem): string {
    const parts: string[] = [];

    // Variant info
    if (item.variant) {
      parts.push(`Variante: ${item.variant.name || item.variant.sku}`);
    }

    // Lot info
    if (item.lot_info?.batch_number) {
      let lotText = `Lote: ${item.lot_info.batch_number}`;
      if (item.lot_info.expiration_date) {
        const date = new Date(item.lot_info.expiration_date);
        lotText += ` (${date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' })})`;
      }
      parts.push(lotText);
    } else if (item.lot_info) {
      parts.push('Lote configurado');
    }

    if (parts.length > 0) {
      return parts.join(' · ');
    }

    // Nothing configured yet
    const hasVariants = (item.product.product_variants?.length ?? 0) > 0;
    const needsLot = item.product.requires_batch_tracking;

    if (hasVariants && needsLot) return 'Configurar variante y lote';
    if (hasVariants) return 'Configurar variante';
    if (needsLot) return 'Configurar lote / vencimiento';
    return 'Configurar';
  }

  getCostDelta(
    item: PopCartItem,
  ): { currentCost: number; percentage: number } | null {
    const currentCost = Number(
      item.variant?.cost_price ||
        item.product.cost_price ||
        item.product.cost ||
        0,
    );
    if (!currentCost || currentCost <= 0) return null;
    if (item.unit_cost === currentCost) return null;
    const percentage = ((item.unit_cost - currentCost) / currentCost) * 100;
    return { currentCost, percentage };
  }

  /**
   * Precio unitario NETO de la línea (post-descuento, pre-impuesto).
   *
   * Alimenta la visualización "Precio neto" del carrito cuando la línea trae
   * descuento comercial > 0: lo que el operador ve tachado es el `unit_cost`
   * capturado, y al lado aparece el neto que la fórmula ya aplicó. Sale del
   * mismo `deriveLineTax` que usa el servicio para `recalculateItemTotals`, de
   * modo que el template y el resumen se mueven juntos — nunca hay un neto
   * distinto en la fila y en el pie.
   *
   * El parámetro `proratedHeaderDiscount` se deja en 0: el descuento general
   * se prorratea por línea en el summary (ver `calculateSummary`), no aquí;
   * esta vista muestra solo el efecto del descuento PROPIO de la línea sobre
   * el precio unitario.
   */
  lineNetUnit(item: PopCartItem): number {
    const safeTaxRate = this.hasVat() ? Number(item.tax_rate) || 0 : 0;
    const result = deriveLineTax(
      {
        unit_cost: item.unit_cost,
        quantity: item.quantity,
        discount_percentage: item.discount,
        tax_rate: safeTaxRate,
        prices_include_tax: item.prices_include_tax ?? undefined,
      },
      { prices_include_tax: this.headerIncludeTax() },
      0,
    );
    return result.unit_price_net;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount || 0);
  }
}
