import {Component, input, output, inject, effect, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { firstValueFrom } from 'rxjs';

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
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="receivable()?.document_number || 'Detalle Cuenta por Cobrar'"
      size="xl"
    >
      @if (detail(); as d) {
        <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
          <!-- Customer Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-text-secondary">Cliente</p>
              <p class="text-sm font-semibold">
                {{ d.customer?.name || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Email</p>
              <p class="text-sm">{{ d.customer?.email || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Telefono</p>
              <p class="text-sm">{{ d.customer?.phone || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Origen</p>
              <p class="text-sm">
                {{ d.source_type }} #{{ d.source_id }}
              </p>
            </div>
          </div>

          <!-- Status -->
          <div class="flex items-center gap-3">
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getStatusClass(d.status)"
            >
              {{ getStatusLabel(d.status) }}
            </span>
            @if (d.days_overdue > 0) {
              <span class="text-xs text-error font-medium">
                {{ d.days_overdue }} dias vencido
              </span>
            }
          </div>

          <!-- Financial Summary -->
          <div
            class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-[var(--color-surface-secondary)] rounded-lg"
          >
            <div>
              <p class="text-xs text-text-secondary">Monto Original</p>
              <p class="text-sm font-semibold font-mono">
                {{ formatCurrency(d.original_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Cobrado</p>
              <p class="text-sm font-semibold font-mono text-success">
                {{ formatCurrency(d.paid_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Saldo</p>
              <p class="text-sm font-bold font-mono text-[var(--color-primary)]">
                {{ formatCurrency(d.balance) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Vencimiento</p>
              <p class="text-sm font-medium">
                {{ d.due_date | date: 'dd/MM/yyyy' }}
              </p>
            </div>
          </div>

          <!-- Dates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-text-secondary">Fecha Emision</p>
              <p class="text-sm">
                {{ d.issue_date | date: 'dd/MM/yyyy' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-text-secondary">Ultimo Pago</p>
              <p class="text-sm">
                {{
                  d.last_payment_date
                    ? (d.last_payment_date | date: 'dd/MM/yyyy')
                    : '—'
                }}
              </p>
            </div>
            @if (d.notes) {
              <div class="col-span-2">
                <p class="text-xs text-text-secondary">Notas</p>
                <p class="text-sm">{{ d.notes }}</p>
              </div>
            }
          </div>

          <!-- Payment History -->
          <div>
            <h4
              class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2"
            >
              <app-icon name="history" [size]="16"></app-icon>
              Historial de Cobros
            </h4>
            @if (d.ar_payments && d.ar_payments.length > 0) {
              <div class="space-y-2">
                @for (payment of d.ar_payments; track payment.id) {
                  <div
                    class="flex items-center justify-between p-3 bg-[var(--color-surface-secondary)] rounded-lg"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-8 h-8 rounded-full bg-success-light flex items-center justify-center shrink-0"
                      >
                        <app-icon
                          name="banknote"
                          [size]="14"
                          class="text-success"
                        ></app-icon>
                      </div>
                      <div class="min-w-0">
                        <p class="text-sm font-medium">
                          {{ formatCurrency(payment.amount) }}
                        </p>
                        <p class="text-xs text-text-secondary">
                          {{ payment.payment_date | date: 'dd/MM/yyyy' }}
                          @if (payment.payment_method) {
                            ·
                            {{ getPaymentMethodLabel(payment.payment_method) }}
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
              <p class="text-sm text-text-secondary text-center py-4">
                No hay cobros registrados
              </p>
            }
          </div>

          <!-- Payment Agreements -->
          <div>
            <h4
              class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2"
            >
              <app-icon name="handshake" [size]="16"></app-icon>
              Acuerdos de Pago
            </h4>
            @if (
              d.payment_agreements &&
              d.payment_agreements.length > 0
            ) {
              <div class="space-y-3">
                @for (
                  agreement of d.payment_agreements;
                  track agreement.id
                ) {
                  <div class="p-3 bg-[var(--color-surface-secondary)] rounded-lg space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="text-sm font-medium">
                        {{ agreement.agreement_number }}
                      </span>
                      <span
                        class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                        [class]="
                          agreement.state === 'active'
                            ? 'bg-[var(--color-info-light)] text-[var(--color-info)]'
                            : 'bg-success-light text-success'
                        "
                      >
                        {{
                          agreement.state === 'active' ? 'Activo' : 'Completado'
                        }}
                      </span>
                    </div>
                    <div class="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span class="text-text-secondary">Monto</span>
                        <p class="font-medium font-mono">
                          {{ formatCurrency(agreement.total_amount) }}
                        </p>
                      </div>
                      <div>
                        <span class="text-text-secondary">Cuotas</span>
                        <p class="font-medium">
                          {{ agreement.num_installments }}
                        </p>
                      </div>
                      <div>
                        <span class="text-text-secondary">Interes</span>
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
                                ? 'bg-success-light'
                                : installment.state === 'partial'
                                  ? 'bg-warning-light'
                                  : 'bg-[var(--color-surface)]'
                            "
                          >
                            <span>
                              Cuota {{ installment.installment_number }} ·
                              {{ installment.due_date | date: 'dd/MM/yyyy' }}
                            </span>
                            <div class="flex items-center gap-2">
                              <span class="font-mono">
                                {{ formatCurrency(installment.amount) }}
                              </span>
                              <span
                                class="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                                [class]="
                                  getInstallmentStatusClass(installment.state)
                                "
                              >
                                {{
                                  getInstallmentStatusLabel(installment.state)
                                }}
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
              <p class="text-sm text-text-secondary text-center py-4">
                No hay acuerdos de pago
              </p>
            }
          </div>

          <!-- Actions -->
          @if (
            d.status !== 'paid' && d.status !== 'written_off'
          ) {
            <div class="flex justify-end gap-3 pt-4 border-t border-border">
              <app-button
                variant="outline"
                size="sm"
                (clicked)="writeOffRequested.emit(d)"
              >
                <app-icon name="x-circle" [size]="14" slot="icon" ></app-icon>
                Castigar
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="paymentRequested.emit(d)"
              >
                <app-icon name="banknote" [size]="14" slot="icon" ></app-icon>
                Registrar Cobro
              </app-button>
            </div>
          }
        </div>
      } @else {
        <div class="p-8 text-center text-text-secondary">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"
          ></div>
          <p class="mt-2">Cargando detalle...</p>
        </div>
      }
    </app-modal>
  `,
})
export class ReceivableDetailModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly receivable = input<AccountReceivable | null>(null);
  readonly paymentRequested = output<AccountReceivable>();
  readonly writeOffRequested = output<AccountReceivable>();

  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  detail = signal<AccountReceivable | null>(null);
  is_loading = signal(false);

  constructor() {
    effect(() => {
      if (this.isOpen() && this.receivable()) {
        this.loadDetail();
      }
      if (this.isOpen() === false) {
        this.detail.set(null);
      }
    });
  }

  private async loadDetail(): Promise<void> {
    const rec = this.receivable();
    if (!rec) return;
    this.is_loading.set(true);
    try {
      const response = await firstValueFrom(this.carteraService.getReceivable(rec.id));
      this.detail.set(response.data);
      this.is_loading.set(false);
    } catch {
      this.detail.set(rec);
      this.is_loading.set(false);
    }
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
      open: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      partial: 'bg-warning-light text-warning',
      overdue: 'bg-error-light text-error',
      paid: 'bg-success-light text-success',
      written_off: 'bg-[var(--color-surface-secondary)] text-text-secondary',
    };
    return classes[status] || 'bg-[var(--color-surface-secondary)] text-text-secondary';
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
      pending: 'bg-[var(--color-surface-secondary)] text-text-secondary',
      partial: 'bg-warning-light text-warning',
      paid: 'bg-success-light text-success',
    };
    return classes[state] || 'bg-[var(--color-surface-secondary)] text-text-secondary';
  }
}
