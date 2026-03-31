import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { CarteraService } from '../../services/cartera.service';
import {
  AccountReceivable,
  ArPayment,
  PaymentAgreement,
} from '../../interfaces/cartera.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-receivable-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="receivable?.document_number || 'Detalle Cuenta por Cobrar'"
      size="xl"
    >
      @if (detail) {
        <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
          <!-- Customer Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Cliente</p>
              <p class="text-sm font-semibold">
                {{ detail.customer?.name || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Email</p>
              <p class="text-sm">{{ detail.customer?.email || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Telefono</p>
              <p class="text-sm">{{ detail.customer?.phone || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Origen</p>
              <p class="text-sm">
                {{ detail.source_type }} #{{ detail.source_id }}
              </p>
            </div>
          </div>

          <!-- Status -->
          <div class="flex items-center gap-3">
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getStatusClass(detail.status)"
            >
              {{ getStatusLabel(detail.status) }}
            </span>
            @if (detail.days_overdue > 0) {
              <span class="text-xs text-red-500 font-medium">
                {{ detail.days_overdue }} dias vencido
              </span>
            }
          </div>

          <!-- Financial Summary -->
          <div
            class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg"
          >
            <div>
              <p class="text-xs text-gray-500">Monto Original</p>
              <p class="text-sm font-semibold font-mono">
                {{ formatCurrency(detail.original_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Cobrado</p>
              <p class="text-sm font-semibold font-mono text-emerald-600">
                {{ formatCurrency(detail.paid_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Saldo</p>
              <p class="text-sm font-bold font-mono text-primary">
                {{ formatCurrency(detail.balance) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Vencimiento</p>
              <p class="text-sm font-medium">
                {{ detail.due_date | date : 'dd/MM/yyyy' }}
              </p>
            </div>
          </div>

          <!-- Dates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Fecha Emision</p>
              <p class="text-sm">
                {{ detail.issue_date | date : 'dd/MM/yyyy' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Ultimo Pago</p>
              <p class="text-sm">
                {{
                  detail.last_payment_date
                    ? (detail.last_payment_date | date : 'dd/MM/yyyy')
                    : '—'
                }}
              </p>
            </div>
            @if (detail.notes) {
              <div class="col-span-2">
                <p class="text-xs text-gray-500">Notas</p>
                <p class="text-sm">{{ detail.notes }}</p>
              </div>
            }
          </div>

          <!-- Payment History -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <app-icon name="history" [size]="16"></app-icon>
              Historial de Cobros
            </h4>
            @if (detail.ar_payments && detail.ar_payments.length > 0) {
              <div class="space-y-2">
                @for (payment of detail.ar_payments; track payment.id) {
                  <div
                    class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0"
                      >
                        <app-icon
                          name="banknote"
                          [size]="14"
                          class="text-emerald-600"
                        ></app-icon>
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium">
                          {{ formatCurrency(payment.amount) }}
                        </p>
                        <p class="text-xs text-gray-500">
                          {{ payment.payment_date | date : 'dd/MM/yyyy' }}
                          @if (payment.payment_method) {
                            · {{ getPaymentMethodLabel(payment.payment_method) }}
                          }
                          @if (payment.reference) {
                            · Ref: {{ payment.reference }}
                          }
                        </p>
                      </div>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-400 text-center py-4">
                No hay cobros registrados
              </p>
            }
          </div>

          <!-- Payment Agreements -->
          <div>
            <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <app-icon name="handshake" [size]="16"></app-icon>
              Acuerdos de Pago
            </h4>
            @if (
              detail.payment_agreements &&
              detail.payment_agreements.length > 0
            ) {
              <div class="space-y-3">
                @for (
                  agreement of detail.payment_agreements;
                  track agreement.id
                ) {
                  <div class="p-3 bg-gray-50 rounded-lg space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium">
                        {{ agreement.agreement_number }}
                      </span>
                      <span
                        class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        [class]="
                          agreement.state === 'active'
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-emerald-50 text-emerald-600'
                        "
                      >
                        {{
                          agreement.state === 'active'
                            ? 'Activo'
                            : 'Completado'
                        }}
                      </span>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span class="text-gray-500">Monto</span>
                        <p class="font-medium font-mono">
                          {{ formatCurrency(agreement.total_amount) }}
                        </p>
                      </div>
                      <div>
                        <span class="text-gray-500">Cuotas</span>
                        <p class="font-medium">
                          {{ agreement.num_installments }}
                        </p>
                      </div>
                      <div>
                        <span class="text-gray-500">Interes</span>
                        <p class="font-medium">
                          {{ agreement.interest_rate }}%
                        </p>
                      </div>
                    </div>
                    <!-- Installments -->
                    @if (
                      agreement.agreement_installments &&
                      agreement.agreement_installments.length > 0
                    ) {
                      <div class="space-y-1 pt-1">
                        @for (
                          installment of agreement.agreement_installments;
                          track installment.id
                        ) {
                          <div
                            class="flex items-center justify-between text-xs p-2 rounded"
                            [class]="
                              installment.state === 'paid'
                                ? 'bg-emerald-50'
                                : installment.state === 'partial'
                                  ? 'bg-amber-50'
                                  : 'bg-white'
                            "
                          >
                            <span>
                              Cuota {{ installment.installment_number }} ·
                              {{ installment.due_date | date : 'dd/MM/yyyy' }}
                            </span>
                            <div class="flex items-center gap-2">
                              <span class="font-mono">
                                {{ formatCurrency(installment.amount) }}
                              </span>
                              <span
                                class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                                [class]="getInstallmentStatusClass(installment.state)"
                              >
                                {{ getInstallmentStatusLabel(installment.state) }}
                              </span>
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-400 text-center py-4">
                No hay acuerdos de pago
              </p>
            }
          </div>

          <!-- Actions -->
          @if (
            detail.status !== 'paid' && detail.status !== 'written_off'
          ) {
            <div
              class="flex justify-end gap-3 pt-4 border-t border-border"
            >
              <app-button
                variant="outline"
                size="sm"
                (clicked)="writeOffRequested.emit(detail)"
              >
                <app-icon
                  name="x-circle"
                  [size]="14"
                  slot="icon"
                ></app-icon>
                Castigar
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="paymentRequested.emit(detail)"
              >
                <app-icon
                  name="banknote"
                  [size]="14"
                  slot="icon"
                ></app-icon>
                Registrar Cobro
              </app-button>
            </div>
          }
        </div>
      } @else {
        <div class="p-8 text-center text-gray-400">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2">Cargando detalle...</p>
        </div>
      }
    </app-modal>
  `,
})
export class ReceivableDetailModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() receivable: AccountReceivable | null = null;
  @Output() paymentRequested = new EventEmitter<AccountReceivable>();
  @Output() writeOffRequested = new EventEmitter<AccountReceivable>();

  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  detail: AccountReceivable | null = null;
  is_loading = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.receivable) {
      this.loadDetail();
    }
    if (changes['isOpen'] && !this.isOpen) {
      this.detail = null;
    }
  }

  private loadDetail(): void {
    if (!this.receivable) return;
    this.is_loading = true;
    this.carteraService.getReceivable(this.receivable.id).subscribe({
      next: (response) => {
        this.detail = response.data;
        this.is_loading = false;
      },
      error: () => {
        this.detail = this.receivable;
        this.is_loading = false;
      },
    });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Abierta',
      partial: 'Parcial',
      overdue: 'Vencida',
      paid: 'Pagada',
      written_off: 'Castigada',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      open: 'bg-blue-50 text-blue-600',
      partial: 'bg-amber-50 text-amber-600',
      overdue: 'bg-red-50 text-red-600',
      paid: 'bg-emerald-50 text-emerald-600',
      written_off: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }

  getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia',
      check: 'Cheque',
    };
    return labels[method] || method;
  }

  getInstallmentStatusLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      partial: 'Parcial',
      paid: 'Pagada',
    };
    return labels[state] || state;
  }

  getInstallmentStatusClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-500',
      partial: 'bg-amber-50 text-amber-600',
      paid: 'bg-emerald-50 text-emerald-600',
    };
    return classes[state] || 'bg-gray-100 text-gray-500';
  }
}
