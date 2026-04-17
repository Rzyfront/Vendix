import { Component, input, output, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { PosPaymentService } from '../services/pos-payment.service';
import {
  PaymentMethod,
  PaymentRequest,
  PaymentResponse,
} from '../models/payment.model';

@Component({
  selector: 'app-pos-payment',
  standalone: true,
  imports: [DecimalPipe, ReactiveFormsModule],
  template: `
    <div class="pos-payment-container">
      <div class="payment-header">
        <h2 class="text-2xl font-bold text-gray-900">Procesar Pago</h2>
        <p class="text-gray-600">
          Total a pagar: \${{ totalAmount() | number: '1.2-2' }}
        </p>
      </div>

      @if (!processing) {
        <div class="payment-methods">
          <h3 class="text-lg font-semibold mb-4">Seleccionar Método de Pago</h3>
          <div class="methods-grid">
            @for (method of paymentMethods(); track method.id) {
              <div
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
            }
          </div>
        </div>
      }

      @if (selectedMethod && !processing) {
        <div class="payment-form">
          <form [formGroup]="paymentForm" (ngSubmit)="processPayment()">
            @if (selectedMethod.type === 'cash') {
              <div class="form-group">
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
                @if (cashReceived && cashReceived > totalAmount()) {
                  <div class="change-info">
                    <span class="change-amount"
                      >Cambio: \${{
                        cashReceived - totalAmount() | number: '1.2-2'
                      }}</span
                    >
                  </div>
                }
              </div>
            }
            @if (selectedMethod.requiresReference) {
              <div class="form-group">
                <label for="reference">{{
                  selectedMethod.referenceLabel
                }}</label>
                <input
                  type="text"
                  id="reference"
                  formControlName="reference"
                  class="form-control"
                  [placeholder]="selectedMethod.referenceLabel"
                  [maxLength]="selectedMethod.type === 'card' ? 4 : 50"
                />
              </div>
            }
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
      }

      @if (processing) {
        <div class="payment-processing">
          <div class="processing-content">
            <div class="spinner"></div>
            <p>{{ getProcessingMessage() }}</p>
          </div>
        </div>
      }

      @if (awaitingConfirmation) {
        <div class="payment-awaiting">
          <div class="awaiting-content">
            <div class="spinner"></div>
            <p class="text-lg font-semibold">{{ awaitingMessage }}</p>
            <p class="text-sm text-gray-500 mt-2">
              El estado se actualizará automáticamente cuando el pago sea
              confirmado.
            </p>
            <div class="awaiting-actions mt-4">
              <button
                class="btn btn-secondary"
                (click)="cancelAwaitingPayment()"
              >
                Cancelar espera
              </button>
              <button class="btn btn-primary" (click)="checkPaymentStatus()">
                Verificar estado
              </button>
            </div>
          </div>
        </div>
      }

      @if (paymentResult) {
        <div class="payment-result">
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
              {{
                paymentResult.success ? '¡Pago Exitoso!' : 'Error en el Pago'
              }}
            </h3>
            <p>{{ paymentResult.message }}</p>
            @if (paymentResult.change) {
              <div class="change-display">
                <strong
                  >Cambio: \${{
                    paymentResult.change | number: '1.2-2'
                  }}</strong
                >
              </div>
            }
            @if (paymentResult.transactionId) {
              <div class="transaction-id">
                <small
                  >ID de Transacción: {{ paymentResult.transactionId }}</small
                >
              </div>
            }
            <div class="result-actions">
              <button class="btn btn-primary" (click)="onPaymentComplete()">
                {{ paymentResult.success ? 'Continuar' : 'Reintentar' }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .pos-payment-container {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 20px;
        max-width: 600px;
        margin: 0 auto;
        box-shadow: var(--shadow-sm);
      }

      .payment-header {
        text-align: center;
        margin-bottom: 24px;
      }

      .payment-header h2 {
        margin-bottom: 8px;
      }

      .methods-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-bottom: 24px;
      }

      .method-card {
        border: 2px solid var(--color-border);
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s ease;
        background: var(--color-surface);
      }

      .method-card:hover {
        border-color: var(--color-primary);
        transform: translateY(-1px);
        box-shadow: var(--shadow-md);
      }

      .method-card.selected {
        border-color: var(--color-primary);
        background-color: var(--color-primary-light);
        box-shadow: var(--shadow-sm);
      }

      .method-icon {
        font-size: 28px;
        color: var(--color-primary);
        margin-bottom: 8px;
      }

      .method-info h4 {
        margin: 0;
        font-weight: 600;
        color: var(--color-text-primary);
      }

      .payment-form {
        background: var(--color-surface);
        border-radius: 8px;
        padding: 20px;
        border: 1px solid var(--color-border);
        box-shadow: var(--shadow-sm);
      }

      .form-group {
        margin-bottom: 16px;
      }

      .form-group label {
        display: block;
        margin-bottom: 6px;
        font-weight: 500;
        color: var(--color-text-primary);
      }

      .form-control {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 16px;
        transition: border-color 0.2s ease;
        background: var(--color-surface);
      }

      .form-control:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-ring);
      }

      .change-info {
        margin-top: 6px;
        padding: 6px 10px;
        background-color: var(--color-success-light);
        border-radius: 4px;
        color: var(--color-success);
        border: 1px solid rgba(34, 197, 94, 0.2);
      }

      .change-amount {
        font-weight: 600;
      }

      .form-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
      }

      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .btn-primary {
        background-color: var(--color-primary);
        color: var(--color-text-on-primary);
      }

      .btn-primary:hover:not(:disabled) {
        background-color: var(--color-secondary);
      }

      .btn-primary:disabled {
        background-color: var(--color-muted);
        cursor: not-allowed;
        opacity: 0.6;
      }

      .btn-secondary {
        background-color: var(--color-text-secondary);
        color: var(--color-surface);
      }

      .btn-secondary:hover {
        background-color: var(--color-text-muted);
      }

      .payment-processing {
        text-align: center;
        padding: 32px 20px;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 3px solid var(--color-border);
        border-top: 3px solid var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 12px;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }

      .payment-awaiting {
        text-align: center;
        padding: 32px 20px;
      }

      .awaiting-content {
        max-width: 400px;
        margin: 0 auto;
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
      }

      .awaiting-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
      }

      .payment-result {
        text-align: center;
        padding: 32px 20px;
      }

      .result-content {
        max-width: 360px;
        margin: 0 auto;
        padding: 24px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
      }

      .result-content.success {
        background-color: var(--color-success-light);
        color: var(--color-success);
      }

      .result-content.error {
        background-color: var(--color-error-light);
        color: var(--color-error);
      }

      .result-icon {
        font-size: 40px;
        margin-bottom: 12px;
      }

      .result-content h3 {
        margin-bottom: 6px;
      }

      .change-display {
        margin: 12px 0;
        font-size: 16px;
      }

      .transaction-id {
        margin: 10px 0;
        opacity: 0.8;
      }

      .result-actions {
        margin-top: 20px;
      }
    `,
  ],
})
export class PosPaymentComponent {
  readonly totalAmount = input<number>(0);
  readonly orderId = input<string>('');
  readonly paymentComplete = output<PaymentResponse>();
  readonly paymentCancelled = output<void>();

  private paymentService = inject(PosPaymentService);
  private fb = inject(FormBuilder);

  readonly paymentMethods = toSignal(this.paymentService.getPaymentMethods(), {
    initialValue: [] as PaymentMethod[],
  });
  selectedMethod: PaymentMethod | null = null;
  paymentForm: FormGroup;
  processing: boolean = false;
  paymentResult: PaymentResponse | null = null;
  awaitingConfirmation: boolean = false;
  awaitingMessage: string = '';

  constructor() {
    this.paymentForm = this.fb.group({
      cashReceived: ['', [Validators.required, Validators.min(0)]],
      reference: [''],
    });

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
          Validators.min(this.totalAmount()),
        ]);
      this.paymentForm.get('reference')?.clearValidators();
    } else if (method.type === 'wallet') {
      this.paymentForm.get('cashReceived')?.clearValidators();
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
      orderId: this.orderId(),
      amount: this.totalAmount(),
      paymentMethod: this.selectedMethod,
      cashReceived:
        this.selectedMethod.type === 'cash' ? this.cashReceived : undefined,
      reference: this.paymentForm.get('reference')?.value,
    };

    this.paymentService.processPayment(paymentRequest).subscribe({
      next: (result) => {
        if (result.nextAction?.type === 'redirect' && result.nextAction.url) {
          window.open(result.nextAction.url, '_blank');
          this.processing = false;
          this.awaitingConfirmation = true;
          this.awaitingMessage =
            'Se abrió la página del banco. Completa el pago y vuelve aquí.';
        } else if (result.nextAction?.type === 'await') {
          this.processing = false;
          this.awaitingConfirmation = true;
          this.awaitingMessage =
            'Esperando confirmación en la app de Nequi del cliente...';
        } else {
          this.paymentResult = result;
          this.processing = false;
        }
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

  cancelAwaitingPayment(): void {
    this.awaitingConfirmation = false;
    this.paymentResult = {
      success: false,
      message: 'Espera cancelada. Verifica el estado del pago manualmente.',
    };
  }

  checkPaymentStatus(): void {
    this.awaitingConfirmation = false;
    this.paymentResult = {
      success: true,
      message: 'Verifica el estado del pago en el historial de órdenes.',
    };
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
      case 'wompi':
        return 'Procesar con Wompi';
      case 'voucher':
        return 'Pagar con Wallet';
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
      case 'wompi':
        return 'Conectando con Wompi...';
      case 'voucher':
        return 'Procesando pago con wallet...';
      default:
        return 'Procesando pago...';
    }
  }
}
