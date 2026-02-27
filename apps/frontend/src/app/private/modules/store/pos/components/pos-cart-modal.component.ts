import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { CartState, CartItem } from '../models/cart.model';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-pos-cart-modal',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
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
                  <app-icon name="image" [size]="18"></app-icon>
                </div>
              </div>

              <!-- Item Info -->
              <div class="item-info">
                <h4 class="item-name">{{ item.product.name }}</h4>
                <p *ngIf="item.variant_display_name" style="font-size: 11px; color: var(--color-primary); font-weight: 500; margin: 0 0 2px 0;">
                  {{ item.variant_display_name }}
                </p>
                <div class="item-meta">
                  <span *ngIf="item.variant_sku || item.product.sku" class="item-sku">{{ item.variant_sku || item.product.sku }}</span>
                  <span class="item-unit-price">{{ formatCurrency(item.finalPrice) }} c/u</span>
                </div>
              </div>

              <!-- Remove Button -->
              <button
                class="remove-btn"
                (click)="onRemoveItem(item.id)"
                title="Eliminar"
              >
                <app-icon name="x" [size]="16"></app-icon>
              </button>

              <!-- Actions Row: Quantity + Total -->
              <div class="item-actions">
                <app-quantity-control
                  [value]="item.quantity"
                  [min]="1"
                  [max]="item.product.track_inventory !== false ? item.product.stock : 999"
                  [editable]="true"
                  [size]="'sm'"
                  (valueChange)="onQuantityChange(item.id, $event)"
                ></app-quantity-control>
                <span class="item-total">{{ formatCurrency(item.totalPrice) }}</span>
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
          <div class="modal-actions-row">
            <button
              class="action-btn save-btn"
              (click)="saveDraft.emit()"
              [disabled]="!cartState?.items?.length"
            >
              <app-icon name="save" [size]="18"></app-icon>
              <span>Guardar</span>
            </button>
            <button
              class="action-btn shipping-btn"
              (click)="shipping.emit()"
              [disabled]="!cartState?.items?.length"
            >
              <app-icon name="truck" [size]="18"></app-icon>
              <span>Envío</span>
            </button>
          </div>
          <button
            class="action-btn checkout-btn"
            (click)="checkout.emit()"
            [disabled]="!cartState?.items?.length"
          >
            <app-icon name="credit-card" [size]="18"></app-icon>
            <span>Finalizar Venta</span>
          </button>
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
        display: grid;
        grid-template-columns: 56px 1fr auto;
        grid-template-rows: auto auto;
        gap: 6px 10px;
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
        grid-row: 1;
        grid-column: 1;
        width: 56px;
        height: 56px;
        border-radius: 10px;
        overflow: hidden;
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

      .item-info {
        grid-row: 1;
        grid-column: 2;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
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

      .item-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
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

      .remove-btn {
        grid-row: 1;
        grid-column: 3;
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
        transition: all 0.2s ease;
      }

      .remove-btn:hover {
        background: rgba(239, 68, 68, 0.1);
        color: var(--color-destructive);
      }

      .item-actions {
        grid-row: 2;
        grid-column: 1 / -1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 8px;
        border-top: 1px solid var(--color-border);
        margin-top: 4px;
      }

      .item-total {
        font-size: 15px;
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
        flex-direction: column;
        gap: 10px;
        padding: 16px 20px;
        padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        border-top: 1px solid var(--color-border);
        background: var(--color-surface);
        flex-shrink: 0;
      }

      .modal-actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 48px;
        border: none;
        border-radius: 12px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        width: 100%;
      }

      .modal-actions-row > .action-btn {
        height: 42px;
        font-size: 13px;
      }

      .action-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .save-btn {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }

      .save-btn:hover:not(:disabled) {
        background: var(--color-muted);
        border-color: var(--color-text-secondary);
      }

      .shipping-btn {
        background: var(--color-surface);
        border: 1px solid rgba(var(--color-primary-rgb), 0.5);
        color: var(--color-primary);
      }

      .shipping-btn:hover:not(:disabled) {
        background: rgba(var(--color-primary-rgb), 0.05);
      }

      .checkout-btn {
        background: var(--color-primary);
        color: white;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
      }

      .checkout-btn:hover:not(:disabled) {
        filter: brightness(1.1);
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
  private currencyService = inject(CurrencyFormatService);

  @Input() isOpen: boolean = false;
  @Input() cartState: CartState | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() itemQuantityChanged = new EventEmitter<{
    itemId: string;
    quantity: number;
  }>();
  @Output() itemRemoved = new EventEmitter<string>();
  @Output() clearCart = new EventEmitter<void>();
  @Output() saveDraft = new EventEmitter<void>();
  @Output() shipping = new EventEmitter<void>();
  @Output() checkout = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        document.body.style.overflow = 'hidden';
        // Asegurar que la moneda esté cargada cuando el modal se abre
        this.currencyService.loadCurrency();
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
    return this.currencyService.format(amount);
  }
}
