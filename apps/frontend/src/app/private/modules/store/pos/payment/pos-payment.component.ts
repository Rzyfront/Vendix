import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Observable } from 'rxjs';
import { PosPaymentService } from '../services/pos-payment.service';
import {
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
} from '../models/payment.model';

@Component({
  selector: 'app-pos-payment',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="pos-payment-container">
      <div class="payment-header">
        <h2 class="text-2xl font-bold text-gray-900">Procesar Pago</h2>
        <p class="text-gray-600">
          Total a pagar: \${{ totalAmount | number: '1.2-2' }}
        </p>
      </div>

      <div class="payment-methods" *ngIf="!processing">
        <h3 class="text-lg font-semibold mb-4">Seleccionar Método de Pago</h3>
        <div class="methods-grid">
          <div
            *ngFor="let method of paymentMethods$ | async"
            class="method-card"
            [class.selected]="selectedMethod?.id === method.id"
            (click)="selectPaymentMethod(method)"
          >
            <div class="method-icon">
              <i class="fas fa-{{ method.icon }}"></i>
            </div>
            <div class="method-info">
              <h4>{{ method.name }}</h4>
            </div>
          </div>
        </div>
      </div>

      <div class="payment-form" *ngIf="selectedMethod && !processing">
        <form [formGroup]="paymentForm" (ngSubmit)="processPayment()">
          <div class="form-group" *ngIf="selectedMethod.type === 'cash'">
            <label for="cashReceived">Monto Recibido</label>
            <input
              type="number"
              id="cashReceived"
              formControlName="cashReceived"
              class="form-control"
              placeholder="0.00"
              step="0.01"
              min="0"
            />
            <div
              class="change-info"
              *ngIf="cashReceived && cashReceived > totalAmount"
            >
              <span class="change-amount"
                >Cambio: \${{
                  cashReceived - totalAmount | number: '1.2-2'
                }}</span
              >
            </div>
          </div>

          <div class="form-group" *ngIf="selectedMethod.requiresReference">
            <label for="reference">{{ selectedMethod.referenceLabel }}</label>
            <input
              type="text"
              id="reference"
              formControlName="reference"
              class="form-control"
              [placeholder]="selectedMethod.referenceLabel"
              [maxLength]="selectedMethod.type === 'card' ? 4 : 50"
            />
          </div>

          <div class="form-actions">
            <button
              type="button"
              class="btn btn-secondary"
              (click)="cancelPayment()"
            >
              Cancelar
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              [disabled]="!paymentForm.valid || processing"
            >
              {{ getProcessingText() }}
            </button>
          </div>
        </form>
      </div>

      <div class="payment-processing" *ngIf="processing">
        <div class="processing-content">
          <div class="spinner"></div>
          <p>{{ getProcessingMessage() }}</p>
        </div>
      </div>

      <div class="payment-result" *ngIf="paymentResult">
        <div
          class="result-content"
          [class.success]="paymentResult.success"
          [class.error]="!paymentResult.success"
        >
          <div class="result-icon">
            <i
              class="fas fa-{{
                paymentResult.success ? 'check-circle' : 'exclamation-circle'
              }}"
            ></i>
          </div>
          <h3>
            {{ paymentResult.success ? '¡Pago Exitoso!' : 'Error en el Pago' }}
          </h3>
          <p>{{ paymentResult.message }}</p>
          <div *ngIf="paymentResult.change" class="change-display">
            <strong
              >Cambio: \${{ paymentResult.change | number: '1.2-2' }}</strong
            >
          </div>
          <div *ngIf="paymentResult.transactionId" class="transaction-id">
            <small>ID de Transacción: {{ paymentResult.transactionId }}</small>
          </div>
          <div class="result-actions">
            <button class="btn btn-primary" (click)="onPaymentComplete()">
              {{ paymentResult.success ? 'Continuar' : 'Reintentar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .pos-payment-container {
        padding: 24px;
        max-width: 600px;
        margin: 0 auto;
      }

      .payment-header {
        text-align: center;
        margin-bottom: 32px;
      }

      .payment-header h2 {
        margin-bottom: 8px;
      }

      .methods-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 16px;
        margin-bottom: 32px;
      }

      .method-card {
        border: 2px solid #e5e7eb;
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .method-card:hover {
        border-color: #3b82f6;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .method-card.selected {
        border-color: #3b82f6;
        background-color: #eff6ff;
      }

      .method-icon {
        font-size: 32px;
        color: #3b82f6;
        margin-bottom: 12px;
      }

      .method-info h4 {
        margin: 0;
        font-weight: 600;
        color: #1f2937;
      }

      .payment-form {
        background: #f9fafb;
        border-radius: 12px;
        padding: 24px;
      }

      .form-group {
        margin-bottom: 20px;
      }

      .form-group label {
        display: block;
        margin-bottom: 8px;
        font-weight: 500;
        color: #374151;
      }

      .form-control {
        width: 100%;
        padding: 12px;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 16px;
        transition: border-color 0.3s ease;
      }

      .form-control:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .change-info {
        margin-top: 8px;
        padding: 8px 12px;
        background-color: #dcfce7;
        border-radius: 6px;
        color: #166534;
      }

      .change-amount {
        font-weight: 600;
      }

      .form-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        margin-top: 24px;
      }

      .btn {
        padding: 12px 24px;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .btn-primary {
        background-color: #3b82f6;
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background-color: #2563eb;
      }

      .btn-primary:disabled {
        background-color: #9ca3af;
        cursor: not-allowed;
      }

      .btn-secondary {
        background-color: #6b7280;
        color: white;
      }

      .btn-secondary:hover {
        background-color: #4b5563;
      }

      .payment-processing {
        text-align: center;
        padding: 40px;
      }

      .spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #e5e7eb;
        border-top: 4px solid #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 16px;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .payment-result {
        text-align: center;
        padding: 40px;
      }

      .result-content {
        max-width: 400px;
        margin: 0 auto;
        padding: 32px;
        border-radius: 12px;
      }

      .result-content.success {
        background-color: #dcfce7;
        color: #166534;
      }

      .result-content.error {
        background-color: #fef2f2;
        color: #991b1b;
      }

      .result-icon {
        font-size: 48px;
        margin-bottom: 16px;
      }

      .result-content h3 {
        margin-bottom: 8px;
      }

      .change-display {
        margin: 16px 0;
        font-size: 18px;
      }

      .transaction-id {
        margin: 12px 0;
        opacity: 0.8;
      }

      .result-actions {
        margin-top: 24px;
      }
    `,
  ],
})
export class PosPaymentComponent implements OnInit {
  @Input() totalAmount: number = 0;
  @Input() orderId: string = '';
  @Output() paymentComplete = new EventEmitter<PaymentResponse>();
  @Output() paymentCancelled = new EventEmitter<void>();

  paymentMethods$: Observable<PaymentMethod[]>;
  selectedMethod: PaymentMethod | null = null;
  paymentForm: FormGroup;
  processing: boolean = false;
  paymentResult: PaymentResponse | null = null;

  constructor(
    private paymentService: PosPaymentService,
    private fb: FormBuilder,
  ) {
    this.paymentMethods$ = this.paymentService.getPaymentMethods();
    this.paymentForm = this.fb.group({
      cashReceived: ['', [Validators.required, Validators.min(0)]],
      reference: [''],
    });
  }

  ngOnInit(): void {
    this.paymentForm.get('reference')?.valueChanges.subscribe(() => {
      this.updateReferenceValidation();
    });
  }

  selectPaymentMethod(method: PaymentMethod): void {
    this.selectedMethod = method;
    this.paymentResult = null;
    this.updateReferenceValidation();

    if (method.type === 'cash') {
      this.paymentForm
        .get('cashReceived')
        ?.setValidators([
          Validators.required,
          Validators.min(this.totalAmount),
        ]);
      this.paymentForm.get('reference')?.clearValidators();
    } else {
      this.paymentForm.get('cashReceived')?.clearValidators();
      this.paymentForm.get('reference')?.setValidators([Validators.required]);
    }

    this.paymentForm.get('cashReceived')?.updateValueAndValidity();
    this.paymentForm.get('reference')?.updateValueAndValidity();
  }

  private updateReferenceValidation(): void {
    if (this.selectedMethod?.type === 'card') {
      this.paymentForm
        .get('reference')
        ?.setValidators([
          Validators.required,
          Validators.pattern('^[0-9]{4}$'),
        ]);
    } else if (this.selectedMethod?.requiresReference) {
      this.paymentForm.get('reference')?.setValidators([Validators.required]);
    }
  }

  get cashReceived(): number {
    return parseFloat(this.paymentForm.get('cashReceived')?.value || '0');
  }

  processPayment(): void {
    if (!this.selectedMethod || this.paymentForm.invalid) {
      return;
    }

    this.processing = true;

    const paymentRequest: PaymentRequest = {
      orderId: this.orderId,
      amount: this.totalAmount,
      paymentMethod: this.selectedMethod,
      cashReceived:
        this.selectedMethod.type === 'cash' ? this.cashReceived : undefined,
      reference: this.paymentForm.get('reference')?.value,
    };

    this.paymentService.processPayment(paymentRequest).subscribe({
      next: (result) => {
        this.paymentResult = result;
        this.processing = false;
      },
      error: (error) => {
        this.paymentResult = {
          success: false,
          message: error.message || 'Error al procesar el pago',
        };
        this.processing = false;
      },
    });
  }

  cancelPayment(): void {
    this.paymentCancelled.emit();
  }

  onPaymentComplete(): void {
    if (this.paymentResult) {
      this.paymentComplete.emit(this.paymentResult);
    }
  }

  getProcessingText(): string {
    if (!this.selectedMethod) return 'Procesar Pago';

    switch (this.selectedMethod.type) {
      case 'cash':
        return 'Procesar Efectivo';
      case 'card':
        return 'Procesar Tarjeta';
      case 'transfer':
        return 'Procesar Transferencia';
      case 'digital_wallet':
        return 'Procesar Billetera Digital';
      default:
        return 'Procesar Pago';
    }
  }

  getProcessingMessage(): string {
    if (!this.selectedMethod) return 'Procesando pago...';

    switch (this.selectedMethod.type) {
      case 'cash':
        return 'Procesando pago en efectivo...';
      case 'card':
        return 'Procesando pago con tarjeta...';
      case 'transfer':
        return 'Verificando transferencia...';
      case 'digital_wallet':
        return 'Procesando billetera digital...';
      default:
        return 'Procesando pago...';
    }
  }
}
