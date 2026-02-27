import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { PopCartSummary } from '../services/pop-cart.service';

@Component({
  selector: 'app-pop-mobile-footer',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pop-mobile-footer">
      <!-- Row 1: Cart Summary + View Order Button -->
      <div class="summary-row">
        <div class="cart-summary">
          <div class="cart-icon-wrapper">
            <app-icon name="shopping-bag" [size]="20"></app-icon>
            <span *ngIf="itemCount > 0" class="cart-badge">
              {{ itemCount > 99 ? '99+' : itemCount }}
            </span>
          </div>
          <div class="cart-totals">
            <span class="total-label">Total Estimado</span>
            <span class="total-amount">{{ formatCurrency(cartSummary?.total || 0) }}</span>
          </div>
        </div>

        <button
          class="view-order-btn"
          (click)="viewOrder.emit()"
          [disabled]="itemCount === 0"
        >
          <span>Ver orden</span>
          <app-icon name="chevron-up" [size]="16"></app-icon>
        </button>
      </div>

      <!-- Row 2: Secondary Action Buttons -->
      <div class="actions-row">
        <button
          class="action-btn draft-btn"
          (click)="saveDraft.emit()"
          [disabled]="itemCount === 0"
        >
          <app-icon name="save" [size]="16"></app-icon>
          <span>Borrador</span>
        </button>
        <button
          class="action-btn create-btn"
          (click)="createOrder.emit()"
          [disabled]="itemCount === 0"
        >
          <app-icon name="file-plus" [size]="16"></app-icon>
          <span>Crear</span>
        </button>
      </div>
      <!-- Row 3: Primary CTA -->
      <button
        class="action-btn receive-btn receive-btn-full"
        (click)="createAndReceive.emit()"
        [disabled]="itemCount === 0"
      >
        <app-icon name="package-check" [size]="18"></app-icon>
        <span>Crear + Recibir</span>
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .pop-mobile-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 40;
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid var(--color-border);
        padding: 10px 12px;
        padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Row 1: Summary */
      .summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .cart-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .cart-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        background: var(--color-primary);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
      }

      .cart-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        background: var(--color-destructive, #ef4444);
        color: white;
        font-size: 10px;
        font-weight: 700;
        border-radius: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border: 2px solid var(--color-surface);
      }

      .cart-totals {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .total-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-text-secondary);
        line-height: 1;
      }

      .total-amount {
        font-size: 18px;
        font-weight: 800;
        color: var(--color-text-primary);
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .view-order-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        border-radius: 20px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
        white-space: nowrap;
      }

      .view-order-btn:hover:not(:disabled) {
        background: var(--color-primary-light);
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .view-order-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .view-order-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* Row 2: Actions */
      .actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .action-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 38px;
        border: none;
        border-radius: 12px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .receive-btn-full {
        width: 100%;
        height: 46px;
        font-size: 15px;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
      }

      .action-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .action-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .draft-btn {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        color: var(--color-text-primary);
      }

      .draft-btn:hover:not(:disabled) {
        background: var(--color-muted);
        border-color: var(--color-text-secondary);
      }

      .create-btn {
        background: var(--color-primary);
        color: white;
      }

      .create-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }

      .receive-btn {
        background: var(--color-success, #22c55e);
        color: white;
      }

      .receive-btn:hover:not(:disabled) {
        filter: brightness(1.1);
      }

      /* Tablet: Respect collapsed sidebar */
      @media (min-width: 768px) and (max-width: 1023px) {
        .pop-mobile-footer {
          left: var(--sidebar-width-collapsed, 4rem);
        }
      }

      /* iPad and larger - hide this footer */
      @media (min-width: 1024px) {
        .pop-mobile-footer {
          display: none;
        }
      }

      /* Extra small screens */
      @media (max-width: 340px) {
        .total-amount {
          font-size: 16px;
        }

        .view-order-btn {
          padding: 8px 10px;
          font-size: 12px;
        }

        .action-btn {
          font-size: 13px;
          gap: 6px;
        }
      }
    `,
  ],
})
export class PopMobileFooterComponent {
  @Input() cartSummary: PopCartSummary | null = null;
  @Input() itemCount: number = 0;

  @Output() viewOrder = new EventEmitter<void>();
  @Output() saveDraft = new EventEmitter<void>();
  @Output() createOrder = new EventEmitter<void>();
  @Output() createAndReceive = new EventEmitter<void>();

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(amount);
  }
}
