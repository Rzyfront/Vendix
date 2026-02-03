import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { CartState, CartItem } from '../models/cart.model';

@Component({
  selector: 'app-pos-cart-modal',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    QuantityControlComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Overlay -->
    <div
      class="modal-overlay"
      [class.open]="isOpen"
      (click)="onOverlayClick($event)"
    >
      <!-- Modal Content -->
      <div
        class="modal-content"
        [class.open]="isOpen"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="modal-header">
          <button class="back-btn" (click)="closed.emit()">
            <app-icon name="chevron-left" [size]="24"></app-icon>
          </button>
          <h2 class="modal-title">
            Carrito
            <span class="item-count">({{ cartState?.items?.length || 0 }})</span>
          </h2>
          <button
            class="clear-btn"
            (click)="onClearCart()"
            [disabled]="!cartState?.items?.length"
          >
            Vaciar
          </button>
        </div>

        <!-- Customer Section -->
        <div class="customer-section">
          <button
            *ngIf="!cartState?.customer"
            class="assign-customer-btn"
            (click)="assignCustomer.emit()"
          >
            <app-icon name="user-plus" [size]="18"></app-icon>
            <span>Asignar Cliente</span>
          </button>

          <div *ngIf="cartState?.customer" class="customer-card">
            <div class="customer-avatar">
              <app-icon name="user" [size]="16"></app-icon>
            </div>
            <div class="customer-info">
              <span class="customer-name">{{ cartState?.customer?.name }}</span>
              <span class="customer-email">{{ cartState?.customer?.email }}</span>
            </div>
            <button class="change-customer-btn" (click)="assignCustomer.emit()">
              <app-icon name="edit-2" [size]="14"></app-icon>
            </button>
          </div>
        </div>

        <!-- Items List -->
        <div class="items-container">
          <!-- Empty State -->
          <div *ngIf="!cartState?.items?.length" class="empty-state">
            <div class="empty-icon">
              <app-icon name="shopping-cart" [size]="40"></app-icon>
            </div>
            <p class="empty-text">Tu carrito está vacío</p>
            <p class="empty-hint">Selecciona productos para comenzar</p>
          </div>

          <!-- Cart Items -->
          <div *ngIf="cartState?.items?.length" class="items-list">
            <div
              *ngFor="let item of cartState?.items; trackBy: trackByItemId"
              class="cart-item"
            >
              <!-- Product Image -->
              <div class="item-image">
                <img
                  *ngIf="item.product.image_url || item.product.image"
                  [src]="item.product.image_url || item.product.image"
                  [alt]="item.product.name"
                  (error)="handleImageError($event)"
                />
                <div
                  *ngIf="!item.product.image_url && !item.product.image"
                  class="image-placeholder"
                >
                  <app-icon name="image" [size]="20"></app-icon>
                </div>
              </div>

              <!-- Item Details -->
              <div class="item-details">
                <div class="item-header">
                  <h4 class="item-name">{{ item.product.name }}</h4>
                  <button
                    class="remove-btn"
                    (click)="onRemoveItem(item.id)"
                    title="Eliminar"
                  >
                    <app-icon name="x" [size]="16"></app-icon>
                  </button>
                </div>

                <div class="item-meta">
                  <span *ngIf="item.product.sku" class="item-sku">{{
                    item.product.sku
                  }}</span>
                  <span class="item-unit-price"
                    >{{ formatCurrency(item.finalPrice) }} c/u</span
                  >
                </div>

                <div class="item-footer">
                  <app-quantity-control
                    [value]="item.quantity"
                    [min]="1"
                    [max]="item.product.stock"
                    [editable]="true"
                    [size]="'sm'"
                    (valueChange)="onQuantityChange(item.id, $event)"
                  ></app-quantity-control>
                  <span class="item-total">{{
                    formatCurrency(item.totalPrice)
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Summary Section -->
        <div class="summary-section" *ngIf="cartState?.items?.length">
          <div class="summary-row">
            <span>Subtotal</span>
            <span>{{ formatCurrency(cartState?.summary?.subtotal || 0) }}</span>
          </div>
          <div class="summary-row">
            <span>Impuestos</span>
            <span>{{ formatCurrency(cartState?.summary?.taxAmount || 0) }}</span>
          </div>
          <div class="summary-row total">
            <span>Total</span>
            <span class="total-amount">{{
              formatCurrency(cartState?.summary?.total || 0)
            }}</span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="modal-actions">
          <app-button
            variant="outline"
            size="md"
            (clicked)="saveDraft.emit()"
            [disabled]="!cartState?.items?.length"
            class="action-btn"
          >
            <app-icon name="save" [size]="18" slot="icon"></app-icon>
            Guardar
          </app-button>
          <app-button
            variant="primary"
            size="md"
            (clicked)="checkout.emit()"
            [disabled]="!cartState?.items?.length"
            class="action-btn checkout"
          >
            <app-icon name="credit-card" [size]="18" slot="icon"></app-icon>
            Finalizar Venta
          </app-button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: rgba(0, 0, 0, 0);
        pointer-events: none;
        transition: background 0.3s ease;
      }

      .modal-overlay.open {
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }

      .modal-content {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        max-height: 90vh;
        background: var(--color-surface);
        border-radius: 20px 20px 0 0;
        transform: translateY(100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-content.open {
        transform: translateY(0);
      }

      /* Header */
      .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .back-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: none;
        background: transparent;
        color: var(--color-text-primary);
        cursor: pointer;
        border-radius: 10px;
        transition: background 0.2s ease;
      }

      .back-btn:hover {
        background: var(--color-muted);
      }

      .modal-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
      }

      .item-count {
        font-weight: 500;
        color: var(--color-text-secondary);
      }

      .clear-btn {
        padding: 8px 14px;
        border: none;
        background: transparent;
        color: var(--color-destructive);
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border-radius: 8px;
        transition: background 0.2s ease;
      }

      .clear-btn:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.1);
      }

      .clear-btn:disabled {
        color: var(--color-text-muted);
        cursor: not-allowed;
      }

      /* Customer Section */
      .customer-section {
        padding: 12px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .assign-customer-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 12px;
        border: 2px dashed var(--color-border);
        border-radius: 12px;
        background: transparent;
        color: var(--color-text-secondary);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .assign-customer-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
        background: var(--color-primary-light);
      }

      .customer-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        background: var(--color-primary-light);
        border: 1px solid var(--color-primary);
        border-radius: 12px;
      }

      .customer-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--color-primary);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .customer-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .customer-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customer-email {
        font-size: 12px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .change-customer-btn {
        width: 32px;
        height: 32px;
        border: none;
        background: white;
        border-radius: 8px;
        color: var(--color-text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      .change-customer-btn:hover {
        color: var(--color-primary);
        background: var(--color-surface);
      }

      /* Items Container */
      .items-container {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
        -webkit-overflow-scrolling: touch;
      }

      /* Empty State */
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
      }

      .empty-icon {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: var(--color-muted);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        margin-bottom: 16px;
      }

      .empty-text {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0 0 4px 0;
      }

      .empty-hint {
        font-size: 14px;
        color: var(--color-text-secondary);
        margin: 0;
      }

      /* Items List */
      .items-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .cart-item {
        display: flex;
        gap: 12px;
        padding: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 14px;
        transition: border-color 0.2s ease;
      }

      .cart-item:hover {
        border-color: var(--color-primary);
      }

      .item-image {
        width: 70px;
        height: 70px;
        border-radius: 10px;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--color-muted);
      }

      .item-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .image-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
      }

      .item-details {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 8px;
      }

      .item-name {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .remove-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        color: var(--color-text-muted);
        cursor: pointer;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
      }

      .remove-btn:hover {
        background: rgba(239, 68, 68, 0.1);
        color: var(--color-destructive);
      }

      .item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }

      .item-sku {
        font-size: 11px;
        color: var(--color-text-muted);
        font-family: monospace;
      }

      .item-unit-price {
        font-size: 12px;
        color: var(--color-text-secondary);
      }

      .item-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: auto;
        padding-top: 8px;
      }

      .item-total {
        font-size: 16px;
        font-weight: 700;
        color: var(--color-primary);
      }

      /* Summary Section */
      .summary-section {
        padding: 16px 20px;
        border-top: 1px solid var(--color-border);
        background: var(--color-muted);
        flex-shrink: 0;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 14px;
        color: var(--color-text-secondary);
        padding: 4px 0;
      }

      .summary-row.total {
        padding-top: 12px;
        margin-top: 8px;
        border-top: 1px solid var(--color-border);
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .total-amount {
        font-size: 22px;
        color: var(--color-primary);
      }

      /* Action Buttons */
      .modal-actions {
        display: flex;
        gap: 12px;
        padding: 16px 20px;
        padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid var(--color-border);
        background: var(--color-surface);
        flex-shrink: 0;
      }

      .action-btn {
        flex: 1;
        height: 48px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 15px;
      }

      .action-btn.checkout {
        flex: 2;
      }

      /* Hide on desktop */
      @media (min-width: 1024px) {
        .modal-overlay {
          display: none;
        }
      }
    `,
  ],
})
export class PosCartModalComponent implements OnChanges {
  @Input() isOpen: boolean = false;
  @Input() cartState: CartState | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() itemQuantityChanged = new EventEmitter<{
    itemId: string;
    quantity: number;
  }>();
  @Output() itemRemoved = new EventEmitter<string>();
  @Output() clearCart = new EventEmitter<void>();
  @Output() assignCustomer = new EventEmitter<void>();
  @Output() saveDraft = new EventEmitter<void>();
  @Output() checkout = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closed.emit();
    }
  }

  onQuantityChange(itemId: string, quantity: number): void {
    this.itemQuantityChanged.emit({ itemId, quantity });
  }

  onRemoveItem(itemId: string): void {
    this.itemRemoved.emit(itemId);
  }

  onClearCart(): void {
    this.clearCart.emit();
  }

  trackByItemId(_index: number, item: CartItem): string {
    return item.id;
  }

  handleImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(amount);
  }
}
