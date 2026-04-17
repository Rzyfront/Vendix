import {Component, input, output, inject, effect, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';

import { CarteraService } from '../../services/cartera.service';
import {
  AccountPayable,
  ApPayment,
  ApPaymentSchedule,
} from '../../interfaces/cartera.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-payable-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="payable()?.document_number || 'Detalle Cuenta por Pagar'"
      size="xl"
    >
      @if (detail(); as d) {
        <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
          <!-- Supplier Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Proveedor</p>
              <p class="text-sm font-semibold">
                {{ d.supplier?.name || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Email</p>
              <p class="text-sm">{{ d.supplier?.email || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Telefono</p>
              <p class="text-sm">{{ d.supplier?.phone || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Origen</p>
              <p class="text-sm">
                {{ d.source_type }} #{{ d.source_id }}
              </p>
            </div>
          </div>

          <!-- Status + Priority -->
          <div class="flex items-center gap-3">
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getStatusClass(d.status)"
            >
              {{ getStatusLabel(d.status) }}
            </span>
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getPriorityClass(d.priority)"
            >
              {{ getPriorityLabel(d.priority) }}
            </span>
            @if (d.days_overdue > 0) {
              <span class="text-xs text-red-500 font-medium">
                {{ d.days_overdue }} dias vencido
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
                {{ formatCurrency(d.original_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Pagado</p>
              <p class="text-sm font-semibold font-mono text-emerald-600">
                {{ formatCurrency(d.paid_amount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Saldo</p>
              <p class="text-sm font-bold font-mono text-primary">
                {{ formatCurrency(d.balance) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Vencimiento</p>
              <p class="text-sm font-medium">
                {{ d.due_date | date: 'dd/MM/yyyy' }}
              </p>
            </div>
          </div>

          <!-- Dates -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Fecha Emision</p>
              <p class="text-sm">
                {{ d.issue_date | date: 'dd/MM/yyyy' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Ultimo Pago</p>
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
                <p class="text-xs text-gray-500">Notas</p>
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
              Historial de Pagos
            </h4>
            @if (d.ap_payments && d.ap_payments.length > 0) {
              <div class="space-y-2">
                @for (payment of d.ap_payments; track payment.id) {
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
                    @if (payment.bank_export_ref) {
                      <span class="text-xs text-gray-400 font-mono">
                        {{ payment.bank_export_ref }}
                      </span>
                    }
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-400 text-center py-4">
                No hay pagos registrados
              </p>
            }
          </div>

          <!-- Payment Schedules -->
          <div>
            <h4
              class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2"
            >
              <app-icon name="calendar-clock" [size]="16"></app-icon>
              Programacion de Pagos
            </h4>
            @if (
              d.ap_payment_schedules &&
              d.ap_payment_schedules.length > 0
            ) {
              <div class="space-y-2">
                @for (
                  schedule of d.ap_payment_schedules;
                  track schedule.id
                ) {
                  <div
                    class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                        [class]="getScheduleIconClass(schedule.status)"
                      >
                        <app-icon
                          [name]="getScheduleIcon(schedule.status)"
                          [size]="14"
                        ></app-icon>
                      </div>
                      <div>
                        <p class="text-sm font-medium">
                          {{ formatCurrency(schedule.amount) }}
                        </p>
                        <p class="text-xs text-gray-500">
                          Programado:
                          {{ schedule.scheduled_date | date: 'dd/MM/yyyy' }}
                          @if (schedule.processed_at) {
                            · Procesado:
                            {{ schedule.processed_at | date: 'dd/MM/yyyy' }}
                          }
                        </p>
                      </div>
                    </div>
                    <span
                      class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                      [class]="getScheduleStatusClass(schedule.status)"
                    >
                      {{ getScheduleStatusLabel(schedule.status) }}
                    </span>
                  </div>
                }
              </div>
            } @else {
              <p class="text-sm text-gray-400 text-center py-4">
                No hay pagos programados
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
                <app-icon name="x-circle" [size]="14" slot="icon"></app-icon>
                Castigar
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                (clicked)="paymentRequested.emit(d)"
              >
                <app-icon name="banknote" [size]="14" slot="icon"></app-icon>
                Registrar Pago
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
export class PayableDetailModalComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly payable = input<AccountPayable | null>(null);
  readonly paymentRequested = output<AccountPayable>();
  readonly writeOffRequested = output<AccountPayable>();

  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  detail = signal<AccountPayable | null>(null);
  is_loading = signal(false);

  constructor() {
    effect(() => {
      if (this.isOpen() && this.payable()) {
        this.loadDetail();
      }
      if (this.isOpen() === false) {
        this.detail.set(null);
      }
    });
  }

  private loadDetail(): void {
    const pay = this.payable();
    if (!pay) return;
    this.is_loading.set(true);
    this.carteraService.getPayable(pay.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.detail.set(response.data);
        this.is_loading.set(false);
      },
      error: () => {
        this.detail.set(pay);
        this.is_loading.set(false);
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

  getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      urgent: 'Urgente',
      high: 'Alta',
      normal: 'Normal',
      low: 'Baja',
    };
    return labels[priority] || priority;
  }

  getPriorityClass(priority: string): string {
    const classes: Record<string, string> = {
      urgent: 'bg-red-50 text-red-600',
      high: 'bg-orange-50 text-orange-600',
      normal: 'bg-blue-50 text-blue-600',
      low: 'bg-gray-100 text-gray-500',
    };
    return classes[priority] || 'bg-gray-100 text-gray-500';
  }

  getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia',
      check: 'Cheque',
    };
    return labels[method] || method;
  }

  getScheduleStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      scheduled: 'Programado',
      processed: 'Procesado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }

  getScheduleStatusClass(status: string): string {
    const classes: Record<string, string> = {
      scheduled: 'bg-blue-50 text-blue-600',
      processed: 'bg-emerald-50 text-emerald-600',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }

  getScheduleIcon(status: string): string {
    const icons: Record<string, string> = {
      scheduled: 'clock',
      processed: 'check',
      cancelled: 'x',
    };
    return icons[status] || 'clock';
  }

  getScheduleIconClass(status: string): string {
    const classes: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-600',
      processed: 'bg-emerald-100 text-emerald-600',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return classes[status] || 'bg-gray-100 text-gray-500';
  }
}
