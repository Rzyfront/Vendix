import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  PosCartService,
  CartState,
  CartItem,
} from '../services/pos-cart.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { DialogService } from '../../../../../shared/components/dialog/dialog.service';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';

@Component({
  selector: 'app-pos-cart',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    IconComponent,
    QuantityControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-md shadow-card border border-border overflow-hidden"
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
          <div
            class="flex flex-col sm:flex-row items-center justify-between gap-4"
          >
            <app-button
              variant="outline"
              size="md"
              (clicked)="saveCart()"
              [disabled]="(isEmpty$ | async) ?? false"
              class="!h-10 text-sm font-medium px-3"
            >
              <app-icon name="save" [size]="16" slot="icon"></app-icon>
              Guardar
            </app-button>
            <app-button
              variant="primary"
              size="md"
              (clicked)="proceedToPayment()"
              [disabled]="(isEmpty$ | async) ?? false"
              class="!h-10 text-sm font-bold px-6"
            >
              <app-icon name="credit-card" [size]="18" slot="icon"></app-icon>
              Cobrar
            </app-button>
          </div>
        </div>

        <!-- Customer Information (Compact) -->
        <div
          *ngIf="(cartState$ | async)?.customer"
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
      </div>

      <!-- Cart Content (Scrollable Items) -->
      <div class="flex-1 overflow-y-auto p-4 bg-bg/30">
        <!-- Empty State -->
        <div
          *ngIf="isEmpty$ | async"
          class="flex flex-col items-center justify-center h-full min-h-[200px] text-center opacity-60"
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

        <!-- Cart Items List -->
        <div *ngIf="!(isEmpty$ | async)" class="space-y-2">
          <div
            *ngFor="
              let item of (cartState$ | async)?.items;
              trackBy: trackByItemId
            "
            class="group grid grid-cols-[40px_1fr_auto] gap-x-2.5 gap-y-1.5 p-2.5 rounded-md border border-border bg-surface hover:bg-muted/30 hover:border-primary/30 transition-all duration-200"
          >
            <!-- Product Image -->
            <div
              class="row-span-1 w-10 h-10 shrink-0 bg-muted rounded-md overflow-hidden relative border border-border/50"
            >
              <img
                *ngIf="item.product.image_url || item.product.image"
                [src]="item.product.image_url || item.product.image"
                [alt]="item.product.name"
                class="absolute inset-0 w-full h-full object-cover"
                (error)="handleImageError($event)"
              />
              <div
                *ngIf="!item.product.image_url && !item.product.image"
                class="absolute inset-0 flex items-center justify-center text-text-secondary"
              >
                <app-icon name="image" [size]="14"></app-icon>
              </div>
            </div>

            <!-- Item Info -->
            <div class="min-w-0 flex flex-col justify-center">
              <h4 class="text-sm font-semibold text-text-primary truncate leading-tight">
                {{ item.product.name }}
              </h4>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-text-muted">
                  Base: {{ formatCurrency(item.unitPrice) }}
                </span>
                <span
                  *ngIf="getItemTaxAmount(item) > 0"
                  class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-medium bg-orange-100 text-orange-800"
                >
                  +{{ formatCurrency(getItemTaxAmount(item)) }}
                </span>
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
              <app-quantity-control
                [value]="item.quantity"
                [min]="1"
                [max]="item.product.stock"
                [editable]="true"
                [size]="'sm'"
                (valueChange)="updateQuantity(item.id, $event)"
              ></app-quantity-control>
              <span class="text-sm font-extrabold text-primary">
                {{ formatCurrency(item.totalPrice) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class PosCartComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  cartState$: Observable<CartState>;
  isEmpty$: Observable<boolean>;
  summary$: Observable<any>;

  @Output() saveDraft = new EventEmitter<void>();
  @Output() checkout = new EventEmitter<void>();

  constructor(
    private cartService: PosCartService,
    private toastService: ToastService,
    private dialogService: DialogService,
  ) {
    this.cartState$ = this.cartService.cartState;
    this.isEmpty$ = this.cartService.isEmpty;
    this.summary$ = this.cartService.summary;
  }

  ngOnInit(): void {
    // Component initialization logic if needed
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

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(amount);
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
