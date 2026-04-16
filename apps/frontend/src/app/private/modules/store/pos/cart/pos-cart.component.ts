import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subject } from 'rxjs';
import { takeUntil, map, distinctUntilChanged, skip } from 'rxjs/operators';
import {
  PosCartService,
  CartState,
  CartItem,
} from '../services/pos-cart.service';
import { CartDiscount } from '../models/cart.model';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { PosScaleService } from '../services/pos-scale.service';
import { PosApiService } from '../services/pos-api.service';

@Component({
  selector: 'app-pos-cart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    QuantityControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
            Carrito ({{ (cartState$ | async)?.items?.length || 0 }})
          </h2>
        </div>
    
        <!-- Totals Row (High Contrast) -->
        <div class="px-3 py-3 bg-muted/20">
          <div class="space-y-1.5 mb-4">
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Subtotal</span>
              <span class="font-medium">{{
                formatCurrency((summary$ | async)?.subtotal || 0)
              }}</span>
            </div>
            <div class="flex justify-between text-xs text-text-secondary">
              <span>Impuestos</span>
              <span class="font-medium">{{
                formatCurrency((summary$ | async)?.taxAmount || 0)
              }}</span>
            </div>
    
            <!-- Promotions & Coupons (hidden in quotation mode) -->
            @if (!isQuotationMode && !isLayawayMode) {
              <!-- Promotions Applied -->
              @if (getPromotionDiscounts().length > 0) {
                <div class="pt-1.5 border-t border-border/30">
                  <div class="flex items-center gap-1.5 mb-1">
                    <app-icon name="tag" [size]="12" class="text-green-600"></app-icon>
                    <span class="text-[11px] font-semibold text-green-700">Promociones aplicadas</span>
                    <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-100 text-green-700 text-[9px] font-bold">
                      {{ getPromotionDiscounts().length }}
                    </span>
                  </div>
                  @for (disc of getPromotionDiscounts(); track disc) {
                    <div class="flex items-center justify-between text-[11px] py-0.5">
                      <div class="flex items-center gap-1 min-w-0">
                        <span class="text-green-700 truncate">{{ disc.description }}</span>
                        @if (disc.is_auto_applied) {
                          <span class="inline-flex items-center px-1 rounded text-[8px] font-medium bg-green-100 text-green-600">auto</span>
                        }
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <span class="font-medium text-green-700">-{{ formatCurrency(disc.amount) }}</span>
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
                      <app-icon name="ticket" [size]="12" class="text-primary"></app-icon>
                      <span class="text-[11px] font-semibold text-primary">{{ coupon.coupon_code }}</span>
                    </div>
                    <div class="flex items-center gap-1">
                      <span class="text-[11px] font-medium text-green-700">-{{ formatCurrency(getCouponDiscountAmount()) }}</span>
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
                {{ formatCurrency((summary$ | async)?.total || 0) }}
              </span>
            </div>
          </div>
    
          <!-- Checkout Actions -->
          <div class="cart-actions">
            @if (isQuotationMode) {
              <!-- Quotation mode: only quote button, styled as primary -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="quote.emit()"
                [disabled]="(isEmpty$ | async) ?? false"
                >
                <app-icon name="file-text" [size]="18"></app-icon>
                <span>Crear Cotización</span>
              </button>
            } @else if (isLayawayMode) {
              <!-- Layaway mode: only layaway button -->
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="layaway.emit()"
                [disabled]="(isEmpty$ | async) ?? false"
                >
                <app-icon name="calendar" [size]="18"></app-icon>
                <span>Crear Plan Separé</span>
              </button>
            } @else {
              <!-- Normal POS buttons -->
              <div class="cart-actions-row">
                <button
                  type="button"
                  class="cart-btn save-btn"
                  (click)="saveCart()"
                  [disabled]="(isEmpty$ | async) ?? false"
                  >
                  <app-icon name="save" [size]="16"></app-icon>
                  <span>Guardar</span>
                </button>
                <button
                  type="button"
                  class="cart-btn shipping-btn"
                  (click)="shipping.emit()"
                  [disabled]="(isEmpty$ | async) ?? false"
                  >
                  <app-icon name="truck" [size]="16"></app-icon>
                  <span>Envío</span>
                </button>
              </div>
              <button
                type="button"
                class="cart-btn checkout-btn"
                (click)="proceedToPayment()"
                [disabled]="(isEmpty$ | async) ?? false"
                >
                <app-icon [name]="isEditMode ? 'check' : 'credit-card'" [size]="18"></app-icon>
                <span>{{ isEditMode ? 'Actualizar Orden' : 'Cobrar' }}</span>
              </button>
            }
          </div>
        </div>
    
        <!-- Customer Information (Compact) -->
        @if ((cartState$ | async)?.customer) {
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
                {{ (cartState$ | async)?.customer?.name }}
              </p>
            </div>
          </div>
        }
      </div>
    
      <!-- Cart Content (Scrollable Items) -->
      <div class="flex-1 overflow-y-auto p-4 bg-bg/30">
        <!-- Empty State -->
        @if (isEmpty$ | async) {
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
        @if (!(isEmpty$ | async)) {
          <div class="space-y-2">
            @for (
              item of (cartState$ | async)?.items; track trackByItemId($index,
              item)) {
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
                  <h4 class="text-sm font-semibold text-text-primary truncate leading-tight">
                    {{ item.product.name }}
                  </h4>
                  @if (item.variant_display_name) {
                    <p
                      class="text-[10px] text-primary font-medium truncate leading-tight"
                      >
                      {{ item.variant_display_name }}
                    </p>
                  }
                  <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[10px] text-text-muted">
                      Base: {{ formatCurrency(item.unitPrice) }}{{ item.is_weight_product ? '/' + (item.weight_unit || 'kg') : '' }}
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
                  </div>
                </div>
                <!-- Remove Button -->
                <button
                  (click)="removeFromCart(item.id)"
                  class="p-1 rounded-sm text-text-secondary hover:text-destructive hover:bg-destructive/10 transition-colors self-start"
                  title="Eliminar"
                  >
                  <app-icon name="trash-2" [size]="14"></app-icon>
                </button>
                <!-- Actions Row: Quantity + Total -->
                <div
                  class="col-span-3 flex items-center justify-between pt-2 mt-1 border-t border-border/50"
                  >
                  <!-- Weight products: show clickable weight badge instead of quantity control -->
                  @if (item.is_weight_product) {
                    <button
                      (click)="editWeight(item)"
                      class="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                      title="Editar peso"
                      >
                      <app-icon name="scale" [size]="14" class="text-blue-600"></app-icon>
                      <span class="text-xs font-bold text-blue-700">{{ item.weight }} {{ item.weight_unit || 'kg' }}</span>
                      <app-icon name="edit" [size]="10" class="text-blue-400"></app-icon>
                    </button>
                  } @else {
                    <app-quantity-control
                      [value]="item.quantity"
                      [min]="1"
                      [max]="item.product.track_inventory !== false ? item.product.stock : 999"
                      [editable]="true"
                      [size]="'sm'"
                      (valueChange)="updateQuantity(item.id, $event)"
                    ></app-quantity-control>
                  }
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
        grid-template-columns: 1fr 1fr;
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

      .shipping-btn:hover:not(:disabled) {
        opacity: 1;
      }

`,
  ],
})
export class PosCartComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  cartState$: Observable<CartState>;
  isEmpty$: Observable<boolean>;
  summary$: Observable<any>;

  activePromotions: any[] = [];
  couponCode = '';
  couponLoading = false;

  @Input() isEditMode = false;
  @Input() isQuotationMode = false;
  @Input() isLayawayMode = false;
  @Output() saveDraft = new EventEmitter<void>();
  @Output() shipping = new EventEmitter<void>();
  @Output() checkout = new EventEmitter<void>();
  @Output() quote = new EventEmitter<void>();
  @Output() layaway = new EventEmitter<void>();

  constructor(
    private cartService: PosCartService,
    private toastService: ToastService,
    private dialogService: DialogService,
    private currencyService: CurrencyFormatService,
    private scaleService: PosScaleService,
    private posApiService: PosApiService,
  ) {
    this.cartState$ = this.cartService.cartState;
    this.isEmpty$ = this.cartService.isEmpty;
    this.summary$ = this.cartService.summary;
  }

  ngOnInit(): void {
    // Load active promotions
    this.posApiService.getActivePromotions()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.activePromotions = response?.data || response || [];
        },
        error: () => {
          // Silently fail - promotions are not critical
          this.activePromotions = [];
        },
      });

    // Re-apply promotions when cart items change (use item count to avoid infinite loops)
    this.cartState$
      .pipe(
        map(state => JSON.stringify(state.items.map(i => ({ id: i.product.id, qty: i.quantity, vid: i.variant_id })))),
        distinctUntilChanged(),
        skip(1), // Skip initial emission
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        if (this.activePromotions.length > 0) {
          this.cartService.applyPromotions(this.activePromotions)
            .pipe(takeUntil(this.destroy$))
            .subscribe();
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  trackByItemId(_index: number, item: CartItem): string {
    return item.id;
  }

  updateQuantity(itemId: string, quantity: number): void {
    if (quantity <= 0) {
      this.removeFromCart(itemId);
      return;
    }

    this.cartService
      .updateCartItem({ itemId, quantity })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { },
        error: (error) => {
          this.toastService.error(
            error.message || 'Error al actualizar cantidad',
          );
        },
      });
  }

  removeFromCart(itemId: string): void {
    this.cartService
      .removeFromCart(itemId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Producto eliminado del carrito');
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
      title: 'Vaciar Carrito',
      message:
        '¿Estás seguro de que quieres vaciar todos los productos del carrito?',
      confirmText: 'Vaciar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (confirm) {
      this.cartService
        .clearCart()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.toastService.success('Carrito vaciado');
          },
          error: (error) => {
            this.toastService.error(error.message || 'Error al vaciar carrito');
          },
        });
    }
  }

  saveCart(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    this.saveDraft.emit();
  }

  proceedToPayment(): void {
    const currentState = this.cartService.getCurrentState();
    if (currentState.items.length === 0) {
      this.toastService.warning('El carrito está vacío');
      return;
    }

    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
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
        allowManualFallback: true,
      });
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
          inputType: 'number',
        },
        { size: 'sm' }
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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success(`Peso actualizado: ${newWeight} ${unit}`);
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al actualizar peso');
        },
      });
  }

  getPromotionDiscounts(): CartDiscount[] {
    return this.cartService.getCurrentState().appliedDiscounts.filter(d => d.promotion_id);
  }

  removePromoDiscount(discountId: string): void {
    this.cartService
      .removeDiscount(discountId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Promoción eliminada');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al eliminar promoción');
        },
      });
  }

  applyCoupon(): void {
    const code = this.couponCode?.trim().toUpperCase();
    if (!code) return;

    const currentState = this.cartService.getCurrentState();
    const subtotal = currentState.summary.subtotal + currentState.summary.taxAmount;
    const customerId = currentState.customer?.id;
    const productIds = currentState.items.map(item => parseInt(item.product.id));

    this.couponLoading = true;
    this.posApiService.validateCoupon(code, subtotal, customerId, productIds)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          const validation = response?.data || response;
          if (validation?.valid) {
            this.cartService.applyCouponDiscount(validation)
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: () => {
                  this.toastService.success(`Cupón "${code}" aplicado`);
                  this.couponCode = '';
                  this.couponLoading = false;
                },
                error: (error) => {
                  this.toastService.error(error.message || 'Error al aplicar cupón');
                  this.couponLoading = false;
                },
              });
          } else {
            this.toastService.error(validation?.message || 'Cupón no válido');
            this.couponLoading = false;
          }
        },
        error: (error) => {
          this.toastService.error(error?.error?.message || 'Cupón no válido o expirado');
          this.couponLoading = false;
        },
      });
  }

  removeCoupon(): void {
    this.cartService.removeCoupon()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Cupón eliminado');
        },
        error: (error) => {
          this.toastService.error(error.message || 'Error al eliminar cupón');
        },
      });
  }

  getAppliedCoupon(): { coupon_id: number; coupon_code: string } | null {
    return this.cartService.getAppliedCoupon();
  }

  getCouponDiscountAmount(): number {
    const state = this.cartService.getCurrentState();
    const couponDiscount = state.appliedDiscounts.find(d => d.coupon_id);
    return couponDiscount?.amount || 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
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

