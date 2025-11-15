import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components';
import { PosPaymentService } from '../services/pos-payment.service';

@Component({
  selector: 'app-pos-order-confirmation',
  standalone: true,
  imports: [CommonModule, ButtonComponent, ModalComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      (closed)="onModalClosed()"
      [showCloseButton]="false"
    >
      <div class="confirmation-header">
        <div class="success-icon">
          <app-icon name="check-circle" [size]="32"></app-icon>
        </div>
        <h2>¡Venta Completada!</h2>
        <p>Orden #{{ orderNumber }} procesada exitosamente</p>
      </div>

      <div class="confirmation-content">
        <div class="receipt">
          <div class="store-info">
            <h3>Vendix POS</h3>
            <p>Sistema de Punto de Venta</p>
          </div>

          <div class="order-info">
            <p><strong>Fecha:</strong> {{ currentDate }}</p>
            <p><strong>Cajero:</strong> {{ cashierName }}</p>
            <p *ngIf="customerName">
              <strong>Cliente:</strong> {{ customerName }}
            </p>
          </div>

          <div class="items-list">
            <div class="items-header">
              <span>Producto</span>
              <span>Total</span>
            </div>
            <div *ngFor="let item of orderItems" class="item-row">
              <span>{{ item.quantity }}x {{ item.name }}</span>
              <span
                >$<span>{{ item.totalPrice }}</span></span
              >
            </div>
          </div>

          <div class="order-summary">
            <div class="summary-row">
              <span>Subtotal:</span>
              <span
                >$<span>{{ orderSubtotal }}</span></span
              >
            </div>
            <div *ngIf="hasDiscount()" class="summary-row discount">
              <span>Descuento:</span>
              <span
                >-$<span>{{ orderDiscount }}</span></span
              >
            </div>
            <div class="summary-row">
              <span>Impuesto:</span>
              <span
                >$<span>{{ orderTax }}</span></span
              >
            </div>
            <div class="summary-row total">
              <span>Total:</span>
              <span
                >$<span>{{ orderTotal }}</span></span
              >
            </div>
          </div>

          <div *ngIf="paymentInfo" class="payment-info">
            <div class="payment-row">
              <span>{{ paymentInfo.method }}:</span>
              <span
                >$<span>{{ paymentInfo.amount }}</span></span
              >
            </div>
          </div>
        </div>
      </div>

      <div class="confirmation-actions">
        <app-button
          variant="outline"
          (clicked)="printReceipt()"
          [loading]="printing"
        >
          <app-icon name="printer" [size]="16" slot="icon"></app-icon>
          Imprimir Ticket
        </app-button>

        <app-button
          variant="primary"
          (clicked)="emailReceipt()"
          [disabled]="!customerEmail"
          [loading]="emailing"
        >
          <app-icon name="mail" [size]="16" slot="icon"></app-icon>
          Enviar por Email
        </app-button>

        <app-button variant="primary" (clicked)="startNewSale()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Nueva Venta
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .confirmation-header {
        text-align: center;
        padding: 24px;
        border-bottom: 1px solid var(--color-border);
      }

      .success-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto 16px;
        border-radius: 50%;
        background: var(--color-success-light);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-success);
      }

      .confirmation-header h2 {
        font-size: 24px;
        font-weight: bold;
        color: var(--color-text-primary);
        margin: 0 0 8px 0;
      }

      .confirmation-header p {
        color: var(--color-text-secondary);
        margin: 0;
      }

      .confirmation-content {
        padding: 24px;
      }

      .receipt {
        max-width: 448px;
        margin: 0 auto;
        background: white;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 24px;
        font-size: 14px;
      }

      .store-info {
        text-align: center;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--color-border);
      }

      .store-info h3 {
        font-weight: bold;
        font-size: 18px;
        color: var(--color-text-primary);
        margin: 0 0 4px 0;
      }

      .store-info p {
        color: var(--color-text-secondary);
        margin: 0;
      }

      .order-info {
        margin-bottom: 16px;
      }

      .order-info p {
        margin: 4px 0;
      }

      .items-list {
        margin-bottom: 16px;
      }

      .items-header {
        display: flex;
        justify-content: space-between;
        font-weight: bold;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--color-border);
      }

      .item-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }

      .order-summary {
        border-top: 1px solid var(--color-border);
        padding-top: 16px;
        margin-bottom: 16px;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }

      .summary-row.discount {
        color: var(--color-danger);
      }

      .summary-row.total {
        font-weight: bold;
        font-size: 16px;
        border-top: 1px solid var(--color-border);
        padding-top: 8px;
        margin-top: 8px;
      }

      .payment-info {
        border-top: 1px solid var(--color-border);
        padding-top: 16px;
      }

      .payment-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
      }

      .confirmation-actions {
        display: flex;
        gap: 12px;
        padding: 24px;
        border-top: 1px solid var(--color-border);
        justify-content: center;
        flex-wrap: wrap;
      }

      @media (max-width: 768px) {
        .confirmation-actions {
          flex-direction: column;
        }

        .confirmation-actions app-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class PosOrderConfirmationComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() orderData: any = null;
  @Output() closed = new EventEmitter<void>();
  @Output() newSale = new EventEmitter<void>();

  printing = false;
  emailing = false;

  // Mock data for now
  orderNumber = '0001';
  currentDate = new Date().toLocaleString();
  cashierName = 'Juan Pérez';
  customerName = 'María García';
  customerEmail = 'maria@example.com';
  orderItems = [
    { quantity: 2, name: 'Producto A', totalPrice: '20.00' },
    { quantity: 1, name: 'Producto B', totalPrice: '15.00' },
  ];
  orderSubtotal = '35.00';
  orderDiscount = '5.00';
  orderTax = '3.00';
  orderTotal = '33.00';
  paymentInfo = { method: 'Efectivo', amount: '33.00' };

  private destroy$ = new Subject<void>();

  constructor(
    private paymentService: PosPaymentService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    if (this.orderData) {
      this.loadOrderData();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadOrderData(): void {
    // Load order data from input
    // For now using mock data
  }

  onModalClosed(): void {
    this.closed.emit();
  }

  printReceipt(): void {
    this.printing = true;

    setTimeout(() => {
      this.printing = false;
      this.toastService.success('Ticket impreso correctamente');
    }, 2000);
  }

  emailReceipt(): void {
    if (!this.customerEmail) {
      this.toastService.warning('No hay email de cliente disponible');
      return;
    }

    this.emailing = true;

    setTimeout(() => {
      this.emailing = false;
      this.toastService.success('Ticket enviado por email correctamente');
    }, 2000);
  }

  startNewSale(): void {
    this.newSale.emit();
    this.onModalClosed();
  }

  hasDiscount(): boolean {
    return Number(this.orderDiscount) > 0;
  }
}
