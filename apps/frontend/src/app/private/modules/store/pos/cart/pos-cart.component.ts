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

@Component({
  selector: 'app-pos-cart',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border overflow-hidden"
    >
      <!-- Cart Header -->
      <div class="px-6 py-4 border-b border-border">
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Carrito de Compras ({{
                (cartState$ | async)?.items?.length || 0
              }})
            </h2>
          </div>

          <app-button
            *ngIf="(cartState$ | async)?.items?.length ?? 0 > 0"
            variant="outline"
            size="sm"
            (clicked)="clearCart()"
            [loading]="(loading$ | async) ?? false"
            class="text-destructive hover:text-destructive hover:bg-destructive-light"
          >
            <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
            Vaciar
          </app-button>
        </div>
      </div>

      <!-- Customer Information -->
      <div
        *ngIf="(cartState$ | async)?.customer"
        class="px-6 py-3 bg-primary/5 border-b border-primary/20"
      >
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <app-icon name="user" [size]="16" class="text-primary"></app-icon>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-xs text-text-secondary font-medium">Cliente asignado</p>
            <p class="text-sm font-semibold text-text-primary truncate">
              {{ (cartState$ | async)?.customer?.name }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-xs text-text-secondary">DNI</p>
            <p class="text-sm font-medium text-text-primary">
              {{ (cartState$ | async)?.customer?.document_number || 'N/A' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Cart Content -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- Empty State -->
        <div
          *ngIf="isEmpty$ | async"
          class="flex flex-col items-center justify-center h-64 text-center"
        >
          <div
            class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4"
          >
            <app-icon
              name="shopping-cart"
              [size]="32"
              class="text-text-secondary"
            ></app-icon>
          </div>
          <h3 class="text-lg font-semibold text-text-primary mb-2">
            Tu carrito está vacío
          </h3>
          <p class="text-sm text-text-secondary">
            Selecciona productos para comenzar
          </p>
        </div>

        <!-- Cart Items List -->
        <div *ngIf="!(isEmpty$ | async)" class="space-y-3">
          <div
            *ngFor="
              let item of (cartState$ | async)?.items;
              trackBy: trackByItemId
            "
            class="flex gap-3 p-3 rounded-lg border border-border bg-surface hover:bg-muted/30 transition-colors"
          >
            <!-- Product Image -->
            <div
              class="w-12 h-12 shrink-0 bg-muted rounded-lg overflow-hidden relative"
            >
              <div
                class="absolute inset-0 flex items-center justify-center text-text-secondary"
              >
                <app-icon name="image" [size]="16"></app-icon>
              </div>
            </div>

            <!-- Item Details -->
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium text-text-primary truncate">
                {{ item.product.name }}
              </h4>
              <div class="flex justify-between items-center mt-1">
                <span class="text-xs text-text-secondary">
                  {{ formatCurrency(item.unitPrice) }} x {{ item.quantity }}
                </span>
                <span class="text-sm font-bold text-text-primary">
                  {{ formatCurrency(item.totalPrice) }}
                </span>
              </div>

              <!-- Quantity Controls -->
              <div class="flex items-center justify-between mt-2">
                <div
                  class="flex items-center bg-surface border border-border rounded-lg h-7"
                >
                  <button
                    class="px-2 hover:bg-muted h-full flex items-center text-text-secondary rounded-l-lg transition-colors"
                    (click)="updateQuantity(item.id, item.quantity - 1)"
                    [disabled]="(loading$ | async) ?? false"
                  >
                    <app-icon name="minus" [size]="10"></app-icon>
                  </button>
                  <span
                    class="w-8 text-center text-xs font-bold text-text-primary"
                  >
                    {{ item.quantity }}
                  </span>
                  <button
                    class="px-2 hover:bg-muted h-full flex items-center text-text-secondary rounded-r-lg transition-colors"
                    (click)="updateQuantity(item.id, item.quantity + 1)"
                    [disabled]="
                      ((loading$ | async) ?? false) ||
                      item.quantity >= item.product.stock
                    "
                  >
                    <app-icon name="plus" [size]="10"></app-icon>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Summary Footer -->
      <div
        class="border-t border-border p-6 shrink-0 bg-muted/30"
        *ngIf="!(isEmpty$ | async)"
      >
        <!-- Totals -->
        <div class="space-y-2 mb-4">
          <div class="flex justify-between text-sm text-text-secondary">
            <span>Subtotal</span>
            <span>{{ formatCurrency((summary$ | async)?.subtotal || 0) }}</span>
          </div>
          <div class="flex justify-between text-sm text-text-secondary">
            <span>IVA (21%)</span>
            <span>{{
              formatCurrency((summary$ | async)?.taxAmount || 0)
            }}</span>
          </div>

          <div
            class="pt-2 border-t border-border flex justify-between items-center"
          >
            <span class="font-bold text-text-primary text-lg">Total</span>
            <span class="font-extrabold text-2xl text-primary">
              {{ formatCurrency((summary$ | async)?.total || 0) }}
            </span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-3">
          <app-button
            variant="outline"
            size="md"
            (clicked)="saveCart()"
            [disabled]="(loading$ | async) ?? false"
            class="flex-1"
          >
            Guardar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            (clicked)="proceedToPayment()"
            [disabled]="(loading$ | async) ?? false"
            class="flex-1"
          >
            Cobrar
          </app-button>
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
  loading$: Observable<boolean>;

  @Output() saveDraft = new EventEmitter<void>();
  @Output() checkout = new EventEmitter<void>();

  constructor(
    private cartService: PosCartService,
    private toastService: ToastService,
  ) {
    this.cartState$ = this.cartService.cartState;
    this.isEmpty$ = this.cartService.isEmpty;
    this.summary$ = this.cartService.summary;
    this.loading$ = this.cartService.loading;
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
        next: () => {
          this.toastService.success('Cantidad actualizada');
        },
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

  clearCart(): void {
    if (confirm('¿Estás seguro de que quieres vaciar el carrito?')) {
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

  handleImageError(event: any): void {
    // Handle broken product images
    event.target.style.display = 'none';
  }
}
