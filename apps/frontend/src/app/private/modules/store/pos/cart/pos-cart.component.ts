import { Component, input, output, inject, DestroyRef, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, distinctUntilChanged, skip } from 'rxjs/operators';
import { toSignal, toObservable, takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {
  PosCartService,
  CartState,
  CartItem } from '../services/pos-cart.service';
import { CartDiscount } from '../models/cart.model';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import {
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
} from '../../../../../shared/components';
import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { PosScaleService } from '../services/pos-scale.service';
import { PosApiService } from '../services/pos-api.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { TaxesService } from '../../products/services/taxes.service';
import { TaxCategory } from '../../products/interfaces';

@Component({
  selector: 'app-pos-cart',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    QuantityControlComponent,
  ],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border overflow-hidden"
    >
      <!-- Cart Header & Summary Section (Fixed at top) -->
      <div class="flex-none bg-surface border-b border-border shadow-sm">
        <!-- Header Row -->
        <div class="px-5 py-3 border-b border-border/50">
          <h2
            class="text-base font-bold text-text-primary flex items-center gap-2"
          >
            <app-icon
              name="shopping-cart"
              [size]="18"
              class="text-primary"
            ></app-icon>
            Carrito ({{ cartState().items.length }})
          </h2>
        </div>

        <!-- Totals Row (High Contrast) -->
        <div class="px-3 py-3 bg-muted/20">
          <div class="space-y-1.5 mb-4">
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Subtotal</span>
              <span class="font-medium">{{
                formatCurrency(summary()?.subtotal || 0)
              }}</span>
            </div>
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Impuestos</span>
              <span class="font-medium">{{
                formatCurrency(summary()?.taxAmount || 0)
              }}</span>
            </div>

            <!-- Promotions & Coupons (hidden in quotation mode) -->
            @if (!isQuotationMode() && !isLayawayMode()) {
              <!-- Promotions Applied -->
              @if (getPromotionDiscounts().length > 0) {
                <div class="pt-1.5 border-t border-border/30">
                  <div class="flex items-center gap-1.5 mb-1">
                    <app-icon
                      name="tag"
                      [size]="12"
                      class="text-green-600"
                    ></app-icon>
                    <span class="text-[11px] font-semibold text-green-700"
                      >Promociones aplicadas</span
                    >
                    <span
                      class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[9px] font-bold"
                    >
                      {{ getPromotionDiscounts().length }}
                    </span>
                  </div>
                  @for (disc of getPromotionDiscounts(); track disc) {
                    <div
                      class="flex items-center justify-between text-[11px] py-0.5"
                    >
                      <div class="flex items-center gap-1 min-w-0">
                        <span class="text-green-700 truncate">{{
                          disc.description
                        }}</span>
                        @if (disc.is_auto_applied) {
                          <span
                            class="inline-flex items-center px-1 rounded text-[8px] font-medium bg-green-100 text-green-600"
                            >auto</span
                          >
                        }
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <span class="font-medium text-green-700"
                          >-{{ formatCurrency(disc.amount) }}</span
                        >
                        @if (!disc.is_auto_applied) {
                          <button
                            (click)="removePromoDiscount(disc.id)"
                            class="p-0.5 rounded text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Eliminar promoción"
                          >
                            <app-icon name="x" [size]="10"></app-icon>
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Coupon Code Input / Applied Coupon -->
              <div class="pt-1.5 border-t border-border/30">
                @if (getAppliedCoupon(); as coupon) {
                  <div class="flex items-center justify-between py-0.5">
                    <div class="flex items-center gap-1.5">
                      <app-icon
                        name="ticket"
                        [size]="12"
                        class="text-primary"
                      ></app-icon>
                      <span class="text-[11px] font-semibold text-primary">{{
                        coupon.coupon_code
                      }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="text-[11px] font-medium text-green-700"
                        >-{{ formatCurrency(getCouponDiscountAmount()) }}</span
                      >
                      <button
                        (click)="removeCoupon()"
                        class="p-0.5 rounded text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Eliminar cupón"
                      >
                        <app-icon name="x" [size]="10"></app-icon>
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex items-center gap-1.5">
                    <input
                      type="text"
                      [(ngModel)]="couponCode"
                      placeholder="Código de cupón"
                      class="flex-1 px-2 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 uppercase"
                      (keydown.enter)="applyCoupon()"
                    />
                    <button
                      (click)="applyCoupon()"
                      [disabled]="!couponCode.trim() || couponLoading"
                      class="px-3 py-1.5 text-xs font-semibold rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {{ couponLoading ? '...' : 'Aplicar' }}
                    </button>
                  </div>
                }
              </div>
            }

            <div
              class="pt-2 border-t border-border/50 flex justify-between items-center"
            >
              <span class="font-bold text-text-primary text-base">Total</span>
              <span class="font-extrabold text-2xl text-primary tracking-tight">
                {{ formatCurrency(summary()?.total || 0) }}
              </span>
            </div>
          </div>

          <!-- Checkout Actions -->
          <div class="cart-actions">
            @if (isQuotationMode()) {
              <!-- Quotation mode: only quote button, styled as primary -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="quote.emit()"
                [disabled]="isEmpty()"
              >
                <app-icon name="file-text" [size]="18"></app-icon>
                <span>Crear Cotización</span>
              </button>
            } @else if (isLayawayMode()) {
              <!-- Layaway mode: only layaway button -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="layaway.emit()"
                [disabled]="isEmpty()"
              >
                <app-icon name="calendar" [size]="18"></app-icon>
                <span>Crear Plan Separé</span>
              </button>
            } @else {
              <!-- Normal POS buttons -->
              <div class="cart-actions-row">
                <button
                  type="button"
                  class="cart-btn custom-item-btn"
                  (click)="openCustomItemModal()"
                  [disabled]="!canCreateCustomItems()"
                  title="Agregar ítem personalizado"
                >
                  <app-icon name="file-plus" [size]="16"></app-icon>
                  <span>Ítem</span>
                </button>
                <button
                  type="button"
                  class="cart-btn save-btn"
                  (click)="saveCart()"
                  [disabled]="isEmpty()"
                >
                  <app-icon name="save" [size]="16"></app-icon>
                  <span>Guardar</span>
                </button>
                <button
                  type="button"
                  class="cart-btn shipping-btn"
                  (click)="shipping.emit()"
                  [disabled]="isEmpty()"
                >
                  <app-icon name="truck" [size]="16"></app-icon>
                  <span>Envío</span>
                </button>
              </div>
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="proceedToPayment()"
                [disabled]="isEmpty()"
              >
                <app-icon
                  [name]="isEditMode() ? 'check' : 'credit-card'"
                  [size]="18"
                ></app-icon>
                <span>{{ isEditMode() ? 'Actualizar Orden' : 'Cobrar' }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Customer Information (Compact) -->
        @if (cartState().customer) {
          <div
            class="px-5 py-2.5 bg-primary/5 border-t border-primary/10 flex items-center gap-3"
          >
            <div
              class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary"
            >
              <app-icon name="user" [size]="14"></app-icon>
            </div>
            <div class="flex-1 min-w-0">
              <p
                class="text-[11px] text-text-secondary font-medium leading-none mb-0.5"
              >
                Cliente
              </p>
              <p class="text-xs font-bold text-text-primary truncate">
                {{ cartState().customer?.name }}
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
              Tu carrito está vacío
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
              item of cartState().items;
              track trackByItemId($index, item)
            ) {
              <div
                class="group grid grid-cols-[40px_1fr_auto] gap-x-2.5 gap-y-1.5 p-2.5 rounded-md border border-border bg-surface hover:bg-muted/30 hover:border-primary/30 transition-all duration-200"
              >
                <!-- Product Image -->
                <div
                  class="row-span-1 w-10 h-10 shrink-0 bg-muted rounded-md overflow-hidden relative border border-border/50"
                >
                  @if (item.product.image_url || item.product.image) {
                    <img
                      [src]="item.product.image_url || item.product.image"
                      [alt]="item.product.name"
                      class="absolute inset-0 w-full h-full object-cover"
                      (error)="handleImageError($event)"
                    />
                  }
                  @if (!item.product.image_url && !item.product.image) {
                    <div
                      class="absolute inset-0 flex items-center justify-center text-text-secondary"
                    >
                      <app-icon name="image" [size]="14"></app-icon>
                    </div>
                  }
                </div>
                <!-- Item Info -->
                <div class="min-w-0 flex flex-col justify-center">
                  <h4
                    class="text-sm font-semibold text-text-primary truncate leading-tight"
                  >
                    {{ item.product.name }}
                  </h4>
                  @if (item.variant_display_name) {
                    <p
                      class="text-[10px] text-primary font-medium truncate leading-tight"
                    >
                      {{ item.variant_display_name }}
                    </p>
                  }
                  @if (item.itemType === 'custom' || item.description) {
                    <p
                      class="text-[10px] text-text-secondary truncate leading-tight"
                    >
                      {{ item.itemType === 'custom' ? 'Ítem personalizado' : item.description }}
                    </p>
                  }
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] text-text-muted">
                      Base: {{ formatCurrency(item.unitPrice)
                      }}{{
                        item.is_weight_product
                          ? '/' + (item.weight_unit || 'kg')
                          : ''
                      }}
                    </span>
                    @if (item.is_weight_product && item.weight) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-800"
                      >
                        {{ item.weight }} {{ item.weight_unit || 'kg' }}
                      </span>
                    }
                    @if (getItemTaxAmount(item) > 0) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-800"
                      >
                        +{{ formatCurrency(getItemTaxAmount(item)) }}
                      </span>
                    }
                    @if (item.isPriceOverridden) {
                      <span
                        class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-purple-100 text-purple-800"
                      >
                        precio editado
                      </span>
                    }
                  </div>
                </div>
                <!-- Item actions -->
                <div class="flex items-start gap-1 self-start">
                  @if (item.itemType === 'custom' && canEditItemPrice(item)) {
                    <button
                      type="button"
                      (click)="editItemPrice(item)"
                      class="p-1 rounded-sm text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Editar ítem personalizado"
                    >
                      <app-icon name="pencil" [size]="14"></app-icon>
                    </button>
                  }
                  <button
                    type="button"
                    (click)="removeFromCart(item.id)"
                    class="p-1 rounded-sm text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Eliminar"
                  >
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
                <!-- Actions Row: Quantity + Total -->
                <div
                  class="col-span-3 flex items-center justify-between pt-2 mt-1 border-t border-border/50"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <!-- Weight products: show clickable weight badge instead of quantity control -->
                    @if (item.is_weight_product) {
                      <button
                        (click)="editWeight(item)"
                        class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                        title="Editar peso"
                      >
                        <app-icon
                          name="scale"
                          [size]="14"
                          class="text-blue-600"
                        ></app-icon>
                        <span class="text-xs font-bold text-blue-700"
                          >{{ item.weight }} {{ item.weight_unit || 'kg' }}</span
                        >
                        <app-icon
                          name="edit"
                          [size]="10"
                          class="text-blue-400"
                        ></app-icon>
                      </button>
                    } @else {
                      <app-quantity-control
                        [value]="item.quantity"
                        [min]="1"
                        [max]="
                          item.product.track_inventory !== false
                            ? item.product.stock
                            : 999
                        "
                        [editable]="true"
                        [size]="'sm'"
                        (valueChange)="updateQuantity(item.id, $event)"
                      ></app-quantity-control>
                    }
                    @if (item.itemType !== 'custom' && canEditItemPrice(item)) {
                      <button
                        type="button"
                        (click)="editItemPrice(item)"
                        class="p-1.5 rounded-md text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Editar precio de venta"
                      >
                        <app-icon name="pencil" [size]="14"></app-icon>
                      </button>
                    }
                  </div>
                  <span class="text-sm font-extrabold text-primary">
                    {{ formatCurrency(item.totalPrice) }}
                  </span>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <app-modal
      [isOpen]="customItemModalOpen()"
      title="Ítem personalizado"
      subtitle="Agrega una línea facturable sin afectar inventario"
      size="sm"
      (closed)="customItemModalOpen.set(false)"
    >
      <div class="space-y-4">
        <app-input
          label="Nombre"
          placeholder="Servicio de instalación"
          [ngModel]="customItemDraft().name"
          (ngModelChange)="updateCustomItemDraft('name', $event)"
        ></app-input>

        <app-textarea
          label="Detalle"
          placeholder="Alcance, materiales, condiciones o notas visibles en la orden"
          [rows]="3"
          [ngModel]="customItemDraft().description"
          (ngModelChange)="updateCustomItemDraft('description', $event)"
        ></app-textarea>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <app-input
            label="Cantidad"
            type="number"
            min="1"
            [ngModel]="customItemDraft().quantity"
            (ngModelChange)="updateCustomItemDraft('quantity', $event)"
          ></app-input>

          <app-input
            label="Precio final"
            placeholder="$0"
            min="0"
            [currency]="true"
            [ngModel]="customItemDraft().finalPrice"
            (ngModelChange)="updateCustomItemDraft('finalPrice', $event)"
          ></app-input>
        </div>

        <app-selector
          label="IVA / impuesto"
          helpText="Usa los impuestos configurados para la tienda."
          [options]="taxCategoryOptions()"
          [ngModel]="customItemDraft().taxCategoryId ?? 0"
          (ngModelChange)="updateCustomItemDraft('taxCategoryId', $event)"
        ></app-selector>

        <div
          class="rounded-xl border border-border bg-[var(--color-background)]/60 px-3 py-2 text-xs"
        >
          <div class="flex justify-between">
            <span class="text-text-secondary">Base</span>
            <span class="font-semibold">{{
              formatCurrency(customItemBasePrice())
            }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-text-secondary">Impuesto</span>
            <span class="font-semibold">{{
              formatCurrency(customItemTaxAmount())
            }}</span>
          </div>
          <div class="mt-1 flex justify-between border-t border-border/60 pt-1">
            <span class="font-semibold text-text-primary">Total línea</span>
            <span class="font-bold text-[var(--color-primary)]">{{
              formatCurrency(customItemTotal())
            }}</span>
          </div>
        </div>
      </div>

      <div
        slot="footer"
        class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
      >
        <app-button
          class="w-full sm:w-auto"
          variant="outline"
          size="md"
          customClasses="min-w-[120px]"
          (clicked)="customItemModalOpen.set(false)"
        >
          Cancelar
        </app-button>
        <app-button
          class="w-full sm:w-auto"
          variant="primary"
          size="md"
          customClasses="min-w-[120px]"
          [disabled]="!canSubmitCustomItem()"
          (clicked)="addCustomItem()"
        >
          Agregar
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .cart-actions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .cart-actions-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }

      .cart-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 8px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
      }

      .cart-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .cart-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .checkout-btn {
        width: 100%;
        padding: 14px;
        background: var(--color-primary);
        color: white;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .checkout-btn:hover:not(:disabled) {
        filter: brightness(1.05);
        transform: translateY(-1px);
      }

      .save-btn {
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
      }

      .save-btn:hover:not(:disabled) {
        background: var(--color-surface);
        color: var(--color-text-primary);
        border-color: var(--color-text-secondary);
      }

      .shipping-btn {
        background: var(--color-primary);
        color: white;
        opacity: 0.85;
      }

      .custom-item-btn {
        background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface));
        border: 1px solid color-mix(in srgb, var(--color-primary) 25%, var(--color-border));
        color: var(--color-primary);
      }

      .custom-item-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
      }

      .shipping-btn:hover:not(:disabled) {
        opacity: 1;
      }
    `,
  ] })
export class PosCartComponent {
  private destroyRef = inject(DestroyRef);
private cartService = inject(PosCartService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);
  private scaleService = inject(PosScaleService);
  private posApiService = inject(PosApiService);
  private authFacade = inject(AuthFacade);
  private taxesService = inject(TaxesService);

  readonly cartState = this.cartService.cartState;
  readonly isEmpty = toSignal(this.cartService.isEmpty, { initialValue: false });
  readonly summary = toSignal(this.cartService.summary, { initialValue: null! });
  readonly taxCategories = signal<TaxCategory[]>([]);
  readonly customItemModalOpen = signal(false);
  readonly customItemDraft = signal({
    name: '',
    description: '',
    quantity: 1,
    finalPrice: 0,
    taxCategoryId: null as number | null,
  });
  readonly taxCategoryOptions = computed<SelectorOption[]>(() => [
    { value: 0, label: 'Sin impuesto' },
    ...this.taxCategories().map((tax) => ({
      value: tax.id,
      label: `${tax.name} (${this.formatPercentRate(tax)})`,
    })),
  ]);
  readonly canSubmitCustomItem = computed(() => {
    const draft = this.customItemDraft();
    return (
      draft.name.trim().length > 0 &&
      Number(draft.quantity || 0) > 0 &&
      Number(draft.finalPrice || 0) >= 0
    );
  });
  readonly canCreateCustomItems = computed(() =>
    this.hasPermission('store:pos:custom_items:create'),
  );
  readonly canOverridePrices = computed(() =>
    this.hasPermission('store:pos:price_override'),
  );

  activePromotions: any[] = [];
  couponCode = '';
  couponLoading = false;

  readonly isEditMode = input<boolean>(false);
  readonly isQuotationMode = input<boolean>(false);
  readonly isLayawayMode = input<boolean>(false);
  readonly saveDraft = output<void>();
  readonly shipping = output<void>();
  readonly checkout = output<void>();
  readonly quote = output<void>();
  readonly layaway = output<void>();

  constructor() {
    this.taxesService
      .getTaxCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (taxCategories) => this.taxCategories.set(taxCategories || []),
        error: () => this.taxCategories.set([]),
      });

// Load active promotions
    this.posApiService
      .getActivePromotions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.activePromotions = response?.data || response || [];
        },
        error: () => {
          // Silently fail - promotions are not critical
          this.activePromotions = [];
        } });

    // Re-apply promotions when cart items change (use item count to avoid infinite loops)
    toObservable(this.cartService.cartState)
      .pipe(
        map((state) =>
          JSON.stringify(
            state.items.map((i) => ({
              id: i.product.id,
              qty: i.quantity,
              vid: i.variant_id })),
          ),
        ),
        distinctUntilChanged(),
        skip(1), // Skip initial emission
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        if (this.activePromotions.length > 0) {
          this.cartService
            .applyPromotions(this.activePromotions)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
        }
      });
  }

  trackByItemId(_index: number, item: CartItem): string {
    return item.id;
  }

  private hasPermission(permission: string): boolean {
    const permissions = this.authFacade.userPermissions();
    const roles = this.authFacade.userRoles();
    return (
      permissions.includes(permission) ||
      roles.includes('super_admin') ||
      roles.includes('SUPER_ADMIN')
    );
  }

  openCustomItemModal(): void {
    if (!this.canCreateCustomItems()) {
      this.toastService.warning('No tienes permiso para agregar ítems personalizados');
      return;
    }
    this.customItemDraft.set({
      name: '',
      description: '',
      quantity: 1,
      finalPrice: 0,
      taxCategoryId: null,
    });
    this.customItemModalOpen.set(true);
  }

  updateCustomItemDraft(
    field: 'name' | 'description' | 'quantity' | 'finalPrice' | 'taxCategoryId',
    value: string | number | null,
  ): void {
    this.customItemDraft.update((draft) => ({
      ...draft,
      [field]:
        field === 'quantity' || field === 'finalPrice'
          ? Number(value || 0)
          : field === 'taxCategoryId'
            ? value === null || value === '' || Number(value) <= 0
              ? null
              : Number(value)
            : String(value || ''),
    }));
  }

  addCustomItem(): void {
    if (!this.canSubmitCustomItem()) {
      this.toastService.warning('Completa el nombre y un valor válido para el ítem');
      return;
    }

    const draft = this.customItemDraft();
    const taxCategory = this.getSelectedTaxCategory();

    this.cartService
      .addCustomItem({
        name: draft.name.trim(),
        description: draft.description.trim(),
        quantity: Number(draft.quantity || 1),
        finalPrice: Number(draft.finalPrice || 0),
        taxCategory,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.customItemModalOpen.set(false);
          this.toastService.success('Ítem personalizado agregado');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al agregar el ítem');
        },
      });
  }

  canEditItemPrice(item: CartItem): boolean {
    if (item.itemType === 'custom') {
      return this.canCreateCustomItems();
    }

    return (
      item.product.allow_pos_price_override === true &&
      this.canOverridePrices()
    );
  }

  async editItemPrice(item: CartItem): Promise<void> {
    if (!this.canEditItemPrice(item)) {
      this.toastService.warning('No tienes permiso para editar este precio');
      return;
    }

    const value = await this.dialogService.prompt(
      {
        title: 'Editar precio de venta',
        message: item.product.name,
        placeholder: 'Precio final',
        defaultValue: item.finalPrice.toString(),
        confirmText: 'Actualizar',
        cancelText: 'Cancelar',
        inputType: 'number',
      },
      { size: 'sm' },
    );

    if (value === undefined) return;
    const finalPrice = Number(value);
    if (Number.isNaN(finalPrice) || finalPrice < 0) {
      this.toastService.warning('El precio debe ser un número válido');
      return;
    }

    let reason = item.priceOverrideReason;
    if (item.itemType !== 'custom') {
      reason = await this.dialogService.prompt(
        {
          title: 'Motivo del cambio',
          message: 'Opcional, queda como referencia de auditoría de la orden.',
          placeholder: 'Ej. precio negociado con el cliente',
          defaultValue: item.priceOverrideReason || '',
          confirmText: 'Guardar',
          cancelText: 'Omitir',
        },
        { size: 'sm' },
      );
    }

    this.cartService
      .updateCartItemPrice({ itemId: item.id, finalPrice, reason })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.toastService.success('Precio actualizado'),
        error: (error) =>
          this.toastService.error(error.message || 'Error al actualizar precio'),
      });
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
        } });
  }

  removeFromCart(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado del carrito');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar producto',
          );
        } });
  }

  async clearCart(): Promise<void> {
    const confirm = await this.dialogService.confirm({
      title: 'Vaciar Carrito',
      message:
        '¿Estás seguro de que quieres vaciar todos los productos del carrito?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger' });

    if (confirm) {
      this.cartService
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Carrito vaciado');
          },
          error: (error) => {
            this.toastService.error(error.message || 'Error al vaciar carrito');
          } });
    }
  }

  saveCart(): void {
    this.saveDraft.emit();
  }

  proceedToPayment(): void {
    const currentState = this.cartService.getCurrentState();
    if (currentState.items.length === 0) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    this.checkout.emit();
  }

  async editWeight(item: CartItem): Promise<void> {
    const unit = item.weight_unit || 'kg';
    let newWeight: number;

    if (this.scaleService.isConnected()) {
      const scaleWeight = await this.scaleService.showWeightModal({
        title: 'Editar Peso',
        message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
        weightUnit: unit,
        allowManualFallback: true });
      if (scaleWeight === undefined) return;
      newWeight = scaleWeight;
    } else {
      const weightStr = await this.dialogService.prompt(
        {
          title: 'Editar Peso',
          message: `${item.product.name}\nPrecio: ${this.formatCurrency(item.unitPrice)}/${unit}`,
          placeholder: `Peso en ${unit}`,
          defaultValue: item.weight?.toString() || '1.0',
          confirmText: 'Actualizar',
          cancelText: 'Cancelar',
          inputType: 'number' },
        { size: 'sm' },
      );

      if (!weightStr) return;
      newWeight = parseFloat(weightStr.replace(',', '.'));
    }

    if (isNaN(newWeight) || newWeight <= 0) {
      this.toastService.warning('El peso debe ser mayor a 0');
      return;
    }
    if (newWeight > 999) {
      this.toastService.warning('El peso máximo permitido es 999 ' + unit);
      return;
    }

    this.cartService
      .updateCartItemWeight(item.id, newWeight)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(`Peso actualizado: ${newWeight} ${unit}`);
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al actualizar peso');
        } });
  }

  getPromotionDiscounts(): CartDiscount[] {
    return this.cartService
      .getCurrentState()
      .appliedDiscounts.filter((d) => d.promotion_id);
  }

  removePromoDiscount(discountId: string): void {
    this.cartService
      .removeDiscount(discountId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Promoción eliminada');
        },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al eliminar promoción',
          );
        } });
  }

  applyCoupon(): void {
    const code = this.couponCode?.trim().toUpperCase();
    if (!code) return;

    const currentState = this.cartService.getCurrentState();
    const subtotal =
      currentState.summary.subtotal + currentState.summary.taxAmount;
    const customerId = currentState.customer?.id;
    const productIds = currentState.items
      .filter((item) => item.itemType !== 'custom')
      .map((item) => parseInt(item.product.id))
      .filter((id) => Number.isFinite(id));
    const categoryIds = Array.from(
      new Set(
        currentState.items.flatMap((item) => {
          const product = item.product as any;
          const ids = Array.isArray(product.category_ids)
            ? product.category_ids
            : product.category_id
              ? [product.category_id]
              : [];
          return ids
            .map((id: string | number) => Number(id))
            .filter((id: number) => Number.isFinite(id));
        }),
      ),
    );
    const couponItems = currentState.items
      .filter((item) => item.itemType !== 'custom')
      .map((item) => {
        const product = item.product as any;
        const itemCategoryIds = Array.isArray(product.category_ids)
          ? product.category_ids
          : product.category_id
            ? [product.category_id]
            : [];

        return {
          product_id: Number(item.product.id),
          category_ids: itemCategoryIds
            .map((id: string | number) => Number(id))
            .filter((id: number) => Number.isFinite(id)),
          line_total: Number(item.totalPrice || 0),
        };
      })
      .filter((item) => Number.isFinite(item.product_id));

    this.couponLoading = true;
    this.posApiService
      .validateCoupon(code, subtotal, customerId, productIds, categoryIds, couponItems)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const validation = response?.data || response;
          if (validation?.valid) {
            this.cartService
              .applyCouponDiscount(validation)
              .pipe(takeUntilDestroyed(this.destroyRef))
              .subscribe({
                next: () => {
                  this.toastService.success(`Cupón "${code}" aplicado`);
                  this.couponCode = '';
                  this.couponLoading = false;
                },
                error: (error) => {
                  this.toastService.error(
                    error.message || 'Error al aplicar cupón',
                  );
                  this.couponLoading = false;
                } });
          } else {
            this.toastService.error(validation?.message || 'Cupón no válido');
            this.couponLoading = false;
          }
        },
        error: (error) => {
          this.toastService.error(
            error?.error?.message || 'Cupón no válido o expirado',
          );
          this.couponLoading = false;
        } });
  }

  removeCoupon(): void {
    this.cartService
      .removeCoupon()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Cupón eliminado');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al eliminar cupón');
        } });
  }

  getAppliedCoupon(): { coupon_id: number; coupon_code: string } | null {
    return this.cartService.getAppliedCoupon();
  }

  getCouponDiscountAmount(): number {
    const state = this.cartService.getCurrentState();
    const couponDiscount = state.appliedDiscounts.find((d) => d.coupon_id);
    return couponDiscount?.amount || 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  getTaxCategoryRate(taxCategory?: TaxCategory | null): number {
    return (
      taxCategory?.tax_rates?.reduce(
        (sum, rate: any) => sum + Number(rate.rate || 0),
        0,
      ) || 0
    );
  }

  formatPercentRate(taxCategory: TaxCategory): string {
    return `${(this.getTaxCategoryRate(taxCategory) * 100).toFixed(2)}%`;
  }

  getSelectedTaxCategory(): TaxCategory | null {
    const selectedId = this.customItemDraft().taxCategoryId;
    if (!selectedId) return null;
    return this.taxCategories().find((tax) => tax.id === selectedId) || null;
  }

  customItemBasePrice(): number {
    const draft = this.customItemDraft();
    const finalPrice = Number(draft.finalPrice || 0);
    const rate = this.getTaxCategoryRate(this.getSelectedTaxCategory());
    return rate > 0 ? finalPrice / (1 + rate) : finalPrice;
  }

  customItemTaxAmount(): number {
    const draft = this.customItemDraft();
    const quantity = Number(draft.quantity || 1);
    return (Number(draft.finalPrice || 0) - this.customItemBasePrice()) * quantity;
  }

  customItemTotal(): number {
    const draft = this.customItemDraft();
    return Number(draft.finalPrice || 0) * Number(draft.quantity || 1);
  }

  getItemTaxRate(item: CartItem): number {
    const rate =
      item.product.tax_assignments?.reduce((rateSum, assignment) => {
        const assignmentRate =
          assignment.tax_categories?.tax_rates?.reduce(
            (sum, tr) => sum + parseFloat(tr.rate || '0'),
            0,
          ) || 0;
        return rateSum + assignmentRate;
      }, 0) || 0;
    return rate;
  }

  getItemTaxAmount(item: CartItem): number {
    return item.taxAmount;
  }

  handleImageError(event: any): void {
    // Handle broken product images
    event.target.style.display = 'none';
  }
}
