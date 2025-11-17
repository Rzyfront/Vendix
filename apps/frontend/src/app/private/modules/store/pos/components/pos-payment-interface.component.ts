import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
} from '../../../../../shared/components';
import { PosCartService } from '../services/pos-cart.service';
import { PosOrderService } from '../services/pos-order.service';

@Component({
  selector: 'app-pos-payment-interface',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  template: `
    <div class="payment-interface">
      <div class="payment-container">
        <div class="payment-header">
          <h2>Procesar Pago</h2>
        </div>

        <div class="payment-methods">
          <button
            *ngFor="let method of paymentMethods"
            (click)="selectPaymentMethod(method)"
            [class]="getPaymentMethodClass(method)"
            class="payment-method-btn"
          >
            <app-icon [name]="getPaymentIcon(method)" [size]="24"></app-icon>
            <div class="payment-method-info">
              <p class="payment-method-name">
                {{ getPaymentMethodName(method) }}
              </p>
              <p class="payment-method-desc">
                {{ getPaymentDescription(method) }}
              </p>
            </div>
          </button>
        </div>

        <div class="payment-form">
          <div class="payment-amount">
            <p>
              Monto a pagar: $<span>{{ totalAmount }}</span>
            </p>
          </div>

          <div
            *ngIf="selectedPaymentMethod?.id === 'cash'"
            class="cash-payment"
          >
            <div>
              <label>Monto recibido:</label>
              <input
                type="number"
                class="cash-input"
                [(ngModel)]="cashReceived"
              />
            </div>

            <div *ngIf="cashReceived > totalAmount" class="change-amount">
              <p>
                Cambio: $<span>{{ cashReceived - totalAmount }}</span>
              </p>
            </div>
          </div>

          <div
            *ngIf="selectedPaymentMethod?.id === 'card'"
            class="card-payment"
          >
            <div>
              <label>Número de tarjeta:</label>
              <input
                type="text"
                class="card-input"
                placeholder="**** **** **** ****"
              />
            </div>
          </div>
        </div>

        <div class="payment-actions">
          <button (click)="cancelPayment()" class="cancel-btn">Cancelar</button>

          <button
            (click)="processPayment()"
            [disabled]="!selectedPaymentMethod || processing"
            class="confirm-btn"
          >
            <app-icon
              name="credit-card"
              [size]="16"
              *ngIf="!processing"
            ></app-icon>
            <app-spinner [size]="'sm'" *ngIf="processing"></app-spinner>
            <span *ngIf="!processing">Confirmar Pago</span>
            <span *ngIf="processing">Procesando...</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
      }

      .payment-interface {
        height: 100%;
        background: #f3f4f6;
        display: flex;
        flex-direction: column;
      }

      .payment-container {
        flex: 1;
        padding: 24px;
        max-width: 448px;
        margin: 0 auto;
        width: 100%;
      }

      .payment-header h2 {
        font-size: 24px;
        font-weight: bold;
        color: #111827;
        margin-bottom: 24px;
      }

      .payment-methods {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-bottom: 24px;
      }

      .payment-method-btn {
        padding: 16px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        text-align: center;
        background: white;
        cursor: pointer;
        transition: all 0.2s;
      }

      .payment-method-btn:hover {
        border-color: #d1d5db;
      }

      .payment-method-btn.selected {
        border-color: #3b82f6;
        background: #eff6ff;
      }

      .payment-method-info {
        margin-top: 8px;
      }

      .payment-method-name {
        font-weight: 500;
        margin: 0;
      }

      .payment-method-desc {
        font-size: 14px;
        color: #6b7280;
        margin: 4px 0 0 0;
      }

      .payment-form {
        background: white;
        border-radius: 8px;
        padding: 24px;
        margin-bottom: 24px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .payment-amount {
        margin-bottom: 16px;
      }

      .payment-amount p {
        font-size: 18px;
        font-weight: 500;
        color: #111827;
        margin: 0;
      }

      .cash-payment,
      .card-payment {
        margin-top: 16px;
      }

      .cash-payment label,
      .card-payment label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        color: #374151;
        margin-bottom: 8px;
      }

      .cash-input,
      .card-input {
        width: 100%;
        padding: 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 16px;
      }

      .change-amount {
        margin-top: 16px;
        color: #059669;
      }

      .payment-actions {
        display: flex;
        gap: 16px;
      }

      .cancel-btn {
        flex: 1;
        padding: 12px 16px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: white;
        color: #374151;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
      }

      .cancel-btn:hover {
        background: #f9fafb;
      }

      .confirm-btn {
        flex: 1;
        padding: 12px 16px;
        border: none;
        border-radius: 6px;
        background: #2563eb;
        color: white;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .confirm-btn:hover:not(:disabled) {
        background: #1d4ed8;
      }

      .confirm-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ],
})
export class PosPaymentInterfaceComponent implements OnInit, OnDestroy {
  selectedPaymentMethod: any = null;
  cashReceived: number = 0;
  processing = false;
  totalAmount = 0;

  paymentMethods = [
    {
      id: 'cash',
      name: 'Efectivo',
      icon: 'dollar-sign',
      description: 'Pago en efectivo',
    },
    {
      id: 'card',
      name: 'Tarjeta',
      icon: 'credit-card',
      description: 'Pago con tarjeta',
    },
    {
      id: 'transfer',
      name: 'Transferencia',
      icon: 'bank-transfer',
      description: 'Transferencia bancaria',
    },
  ];

  private destroy$ = new Subject<void>();

  constructor(
    private cartService: PosCartService,
    private orderService: PosOrderService,
    private toastService: ToastService,
  ) {}

  ngOnInit(): void {
    this.updateTotalAmount();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  selectPaymentMethod(method: any): void {
    this.selectedPaymentMethod = method;
  }

  getPaymentMethodClass(method: any): string {
    const baseClass = 'payment-method-btn';
    const selectedClass = 'selected';

    return this.selectedPaymentMethod?.id === method.id
      ? `${baseClass} ${selectedClass}`
      : baseClass;
  }

  getPaymentIcon(method: any): string {
    return method.icon || 'credit-card';
  }

  getPaymentMethodName(method: any): string {
    return method.name || 'Método de Pago';
  }

  getPaymentDescription(method: any): string {
    return method.description || 'Descripción del método';
  }

  cancelPayment(): void {
    this.selectedPaymentMethod = null;
    this.cashReceived = 0;
    this.toastService.info('Pago cancelado');
  }

  processPayment(): void {
    if (!this.selectedPaymentMethod) {
      this.toastService.warning('Por favor selecciona un método de pago');
      return;
    }

    this.processing = true;

    setTimeout(() => {
      this.processing = false;
      this.toastService.success('Pago procesado correctamente');
      this.selectedPaymentMethod = null;
      this.cashReceived = 0;
    }, 2000);
  }

  private updateTotalAmount(): void {
    this.totalAmount = 100;
  }
}
