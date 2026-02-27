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
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TooltipComponent } from '../../../../../../shared/components/tooltip/tooltip.component';
import { QuantityControlComponent } from '../../../../../../shared/components/quantity-control/quantity-control.component';
import { PopCartState, PopCartItem } from '../services/pop-cart.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-pop-cart-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    TooltipComponent,
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
        <div class="context-section" [class.context-warning]="!supplierName || !locationName">
          <!-- Missing Config Alert -->
          <div *ngIf="!supplierName || !locationName" class="config-alert">
            <div class="alert-content">
              <app-icon name="alert-circle" [size]="18"></app-icon>
              <span>Configura proveedor y bodega para continuar</span>
            </div>
            <button class="config-btn" (click)="onConfigureClick()">
              <app-icon name="settings" [size]="14"></app-icon>
              Configurar
            </button>
          </div>

          <!-- Normal context display -->
          <div *ngIf="supplierName && locationName" class="context-items">
            <div class="context-item">
              <app-icon name="truck" [size]="16"></app-icon>
              <span>{{ supplierName }}</span>
            </div>
            <div class="context-item">
              <app-icon name="warehouse" [size]="16"></app-icon>
              <span>{{ locationName }}</span>
            </div>
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
                  <app-icon name="image" [size]="18"></app-icon>
                </div>
              </div>

              <!-- Item Info -->
              <div class="item-info">
                <h4 class="item-name">{{ item.product.name }}</h4>
                <div class="item-meta">
                  <span *ngIf="item.product.code" class="item-sku">{{ item.product.code }}</span>
                  <!-- Editable Unit Cost -->
                  <div class="cost-input">
                    <span class="currency">$</span>
                    <input
                      type="number"
                      [value]="item.unit_cost"
                      (change)="onCostChange(item.id, $event)"
                      min="0"
                      step="1"
                      placeholder="Costo"
                    />
                  </div>
                </div>
              </div>

              <!-- Remove Button -->
              <div class="remove-btn-wrapper"
                   (mouseenter)="hoveredRemoveTooltip = item.id"
                   (mouseleave)="hoveredRemoveTooltip = null">
                <button
                  class="remove-btn"
                  (click)="onRemoveItem(item.id)"
                >
                  <app-icon name="x" [size]="16"></app-icon>
                </button>
                <app-tooltip position="top" size="sm" [visible]="hoveredRemoveTooltip === item.id"
                  class="remove-tooltip">
                  Eliminar
                </app-tooltip>
              </div>

              <!-- Actions Row: Quantity + Total -->
              <div class="item-actions">
                <app-quantity-control
                  [value]="item.quantity"
                  [min]="1"
                  [editable]="true"
                  [size]="'sm'"
                  (valueChange)="onQuantityChange(item.id, $event)"
                ></app-quantity-control>
                <span class="item-total">{{ formatCurrency(item.total) }}</span>
              </div>

              <!-- Lot Config Row (POP-specific) -->
              <div class="item-lot" *ngIf="!item.lot_info">
                <button class="lot-btn" (click)="configureLot.emit(item)">
                  <app-icon name="tag" [size]="12"></app-icon>
                  Configurar lote
                </button>
              </div>
              <div class="item-lot lot-configured" *ngIf="item.lot_info">
                <app-icon name="check-circle" [size]="12"></app-icon>
                <span>Lote: {{ item.lot_info.batch_number || 'Configurado' }}</span>
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
          <div class="modal-actions-row">
            <button
              class="action-btn draft-btn"
              (click)="saveDraft.emit()"
              [disabled]="!cartState?.items?.length"
            >
              <app-icon name="save" [size]="18"></app-icon>
              <span>Borrador</span>
            </button>
            <button
              class="action-btn create-btn"
              (click)="createOrder.emit()"
              [disabled]="!cartState?.items?.length"
            >
              <app-icon name="file-plus" [size]="18"></app-icon>
              <span>Crear orden</span>
            </button>
          </div>
          <button
            class="action-btn receive-btn"
            (click)="createAndReceive.emit()"
            [disabled]="!cartState?.items?.length || isProcessing"
          >
            <app-icon *ngIf="!isProcessing" name="package-check" [size]="18"></app-icon>
            <span>{{ isProcessing ? 'Procesando...' : 'Crear + Recibir' }}</span>
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

      /* Context Section (POP-specific) */
      .context-section {
        display: flex;
        gap: 16px;
        padding: 12px 20px;
        background: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .context-section.context-warning {
        background: rgba(245, 158, 11, 0.1);
        border-bottom-color: rgba(245, 158, 11, 0.3);
      }

      .context-items {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }

      .context-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
      }

      .config-alert {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
      }

      .alert-content {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--color-warning, #f59e0b);
        font-size: 13px;
        font-weight: 500;
      }

      .config-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        background: var(--color-warning, #f59e0b);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .config-btn:hover {
        filter: brightness(1.1);
      }

      .config-btn:active {
        transform: scale(0.97);
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

      /* Cart Item - Grid Layout like POS */
      .cart-item {
        display: grid;
        grid-template-columns: 56px 1fr auto;
        grid-template-rows: auto auto auto;
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
        margin-top: 4px;
        flex-wrap: wrap;
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
        padding: 3px 6px;
      }

      .cost-input .currency {
        font-size: 11px;
        color: var(--color-text-secondary);
        margin-right: 2px;
      }

      .cost-input input {
        width: 60px;
        border: none;
        background: transparent;
        font-size: 12px;
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

      .remove-btn-wrapper {
        grid-row: 1;
        grid-column: 3;
        position: relative;
      }

      .remove-tooltip {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        bottom: 100%;
        z-index: 10;
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

      /* Lot config row (POP-specific) */
      .item-lot {
        grid-row: 3;
        grid-column: 1 / -1;
        padding-top: 6px;
      }

      .lot-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: transparent;
        border: 1px dashed var(--color-border);
        border-radius: 4px;
        color: var(--color-text-muted);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .lot-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .item-lot.lot-configured {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--color-success);
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

      .modal-actions .action-btn {
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

      .modal-actions .action-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .modal-actions .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .modal-actions .create-btn {
        background: var(--color-primary);
        color: white;
      }

      .modal-actions .create-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }

      .modal-actions .draft-btn {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }

      .modal-actions .draft-btn:hover:not(:disabled) {
        background: var(--color-muted);
        border-color: var(--color-text-secondary);
      }

      .modal-actions .receive-btn {
        background: var(--color-success, #22c55e);
        color: white;
      }

      .modal-actions .receive-btn:hover:not(:disabled) {
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
export class PopCartModalComponent implements OnChanges {
  private currencyService = inject(CurrencyFormatService);
  @Input() isOpen: boolean = false;
  @Input() cartState: PopCartState | null = null;
  @Input() supplierName: string = '';
  @Input() locationName: string = '';
  @Input() isProcessing: boolean = false;

  hoveredRemoveTooltip: string | null = null;

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
  @Output() configure = new EventEmitter<void>();

  onConfigureClick(): void {
    this.configure.emit();
    this.closed.emit();
  }

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
    return this.currencyService.format(amount, 0);
  }
}
