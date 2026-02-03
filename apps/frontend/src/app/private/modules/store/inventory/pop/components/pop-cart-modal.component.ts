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
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { QuantityControlComponent } from '../../../../../../shared/components/quantity-control/quantity-control.component';
import { PopCartState, PopCartItem } from '../services/pop-cart.service';

@Component({
  selector: 'app-pop-cart-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
            Orden de Compra
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

        <!-- Context Info (Supplier + Location) -->
        <div class="context-section" *ngIf="supplierName || locationName">
          <div class="context-item" *ngIf="supplierName">
            <app-icon name="truck" [size]="16"></app-icon>
            <span>{{ supplierName }}</span>
          </div>
          <div class="context-item" *ngIf="locationName">
            <app-icon name="warehouse" [size]="16"></app-icon>
            <span>{{ locationName }}</span>
          </div>
        </div>

        <!-- Items Container -->
        <div class="items-container">
          <!-- Empty State -->
          <div *ngIf="!cartState?.items?.length" class="empty-state">
            <div class="empty-icon">
              <app-icon name="shopping-bag" [size]="40"></app-icon>
            </div>
            <p class="empty-text">Tu orden está vacía</p>
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
                  *ngIf="item.product.image_url"
                  [src]="item.product.image_url"
                  [alt]="item.product.name"
                  (error)="handleImageError($event)"
                />
                <div
                  *ngIf="!item.product.image_url"
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
                  <span *ngIf="item.product.code" class="item-sku">{{
                    item.product.code
                  }}</span>
                  <!-- Editable Unit Cost (key difference from POS) -->
                  <div class="cost-input">
                    <span class="currency">$</span>
                    <input
                      type="number"
                      [value]="item.unit_cost"
                      (change)="onCostChange(item.id, $event)"
                      min="0"
                      step="1"
                    />
                  </div>
                </div>

                <div class="item-footer">
                  <app-quantity-control
                    [value]="item.quantity"
                    [min]="1"
                    [editable]="true"
                    [size]="'sm'"
                    (valueChange)="onQuantityChange(item.id, $event)"
                  ></app-quantity-control>
                  <span class="item-total">{{
                    formatCurrency(item.total)
                  }}</span>
                </div>

                <!-- Lot Config (POP-specific) -->
                <button
                  *ngIf="!item.lot_info"
                  class="lot-btn"
                  (click)="configureLot.emit(item)"
                >
                  <app-icon name="tag" [size]="14"></app-icon>
                  Configurar lote
                </button>
                <div *ngIf="item.lot_info" class="lot-info">
                  <app-icon name="tag" [size]="14"></app-icon>
                  Lote: {{ item.lot_info.batch_number || 'Configurado' }}
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
            <span>{{ formatCurrency(cartState?.summary?.tax_amount || 0) }}</span>
          </div>
          <div class="summary-row total">
            <span>Total Estimado</span>
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
            Borrador
          </app-button>
          <app-button
            variant="primary"
            size="md"
            (clicked)="createOrder.emit()"
            [disabled]="!cartState?.items?.length"
            class="action-btn create"
          >
            Crear
          </app-button>
          <app-button
            variant="success"
            size="md"
            (clicked)="createAndReceive.emit()"
            [disabled]="!cartState?.items?.length"
            class="action-btn receive"
          >
            C+R
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

      /* Context Section (POP-specific) */
      .context-section {
        display: flex;
        gap: 16px;
        padding: 12px 20px;
        background: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .context-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
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

      /* Cost input (POP-specific - editable) */
      .cost-input {
        display: flex;
        align-items: center;
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 4px 8px;
      }

      .cost-input .currency {
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-right: 2px;
      }

      .cost-input input {
        width: 70px;
        border: none;
        background: transparent;
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        outline: none;
        -moz-appearance: textfield;
      }

      .cost-input input::-webkit-outer-spin-button,
      .cost-input input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
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

      /* Lot config (POP-specific) */
      .lot-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        background: transparent;
        border: 1px dashed var(--color-border);
        border-radius: 6px;
        color: var(--color-text-muted);
        font-size: 12px;
        cursor: pointer;
        margin-top: 8px;
        transition: all 0.2s ease;
      }

      .lot-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .lot-info {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--color-success);
        margin-top: 8px;
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
        gap: 10px;
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
        font-size: 14px;
      }

      .action-btn.create {
        flex: 1.2;
      }

      .action-btn.receive {
        flex: 1;
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
export class PopCartModalComponent implements OnChanges {
  @Input() isOpen: boolean = false;
  @Input() cartState: PopCartState | null = null;
  @Input() supplierName: string = '';
  @Input() locationName: string = '';

  @Output() closed = new EventEmitter<void>();
  @Output() itemQuantityChanged = new EventEmitter<{
    itemId: string;
    quantity: number;
  }>();
  @Output() itemCostChanged = new EventEmitter<{
    itemId: string;
    cost: number;
  }>();
  @Output() itemRemoved = new EventEmitter<string>();
  @Output() clearCart = new EventEmitter<void>();
  @Output() configureLot = new EventEmitter<PopCartItem>();
  @Output() saveDraft = new EventEmitter<void>();
  @Output() createOrder = new EventEmitter<void>();
  @Output() createAndReceive = new EventEmitter<void>();

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

  onCostChange(itemId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const cost = Number(input.value) || 0;
    this.itemCostChanged.emit({ itemId, cost });
  }

  onRemoveItem(itemId: string): void {
    this.itemRemoved.emit(itemId);
  }

  onClearCart(): void {
    this.clearCart.emit();
  }

  trackByItemId(_index: number, item: PopCartItem): string {
    return item.id;
  }

  handleImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    target.style.display = 'none';
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(amount);
  }
}
