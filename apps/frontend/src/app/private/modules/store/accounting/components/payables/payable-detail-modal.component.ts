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
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="payable?.document_number || 'Detalle Cuenta por Pagar'"
      size="xl"
    >
      @if (detail) {
        <div class="p-4 space-y-6 max-h-[70vh] overflow-y-auto">
          <!-- Supplier Info -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-gray-500">Proveedor</p>
              <p class="text-sm font-semibold">
                {{ detail.supplier?.name || '—' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Email</p>
              <p class="text-sm">{{ detail.supplier?.email || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Telefono</p>
              <p class="text-sm">{{ detail.supplier?.phone || '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">Origen</p>
              <p class="text-sm">
                {{ detail.source_type }} #{{ detail.source_id }}
              </p>
            </div>
          </div>

          <!-- Status + Priority -->
          <div class="flex items-center gap-3">
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getStatusClass(detail.status)"
            >
              {{ getStatusLabel(detail.status) }}
            </span>
            <span
              class="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
              [class]="getPriorityClass(detail.priority)"
            >
              {{ getPriorityLabel(detail.priority) }}
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
              <p class="text-xs text-gray-500">Pagado</p>
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
              Historial de Pagos
            </h4>
            @if (detail.ap_payments && detail.ap_payments.length > 0) {
              <div class="space-y-2">
                @for (payment of detail.ap_payments; track payment.id) {
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
            <h4 class="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <app-icon name="calendar-clock" [size]="16"></app-icon>
              Programacion de Pagos
            </h4>
            @if (
              detail.ap_payment_schedules &&
              detail.ap_payment_schedules.length > 0
            ) {
              <div class="space-y-2">
                @for (
                  schedule of detail.ap_payment_schedules;
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
                          {{
                            schedule.scheduled_date | date : 'dd/MM/yyyy'
                          }}
                          @if (schedule.processed_at) {
                            · Procesado:
                            {{
                              schedule.processed_at | date : 'dd/MM/yyyy'
                            }}
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
export class PayableDetailModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() payable: AccountPayable | null = null;
  @Output() paymentRequested = new EventEmitter<AccountPayable>();
  @Output() writeOffRequested = new EventEmitter<AccountPayable>();

  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);

  detail: AccountPayable | null = null;
  is_loading = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.payable) {
      this.loadDetail();
    }
    if (changes['isOpen'] && !this.isOpen) {
      this.detail = null;
    }
  }

  private loadDetail(): void {
    if (!this.payable) return;
    this.is_loading = true;
    this.carteraService.getPayable(this.payable.id).subscribe({
      next: (response) => {
        this.detail = response.data;
        this.is_loading = false;
      },
      error: () => {
        this.detail = this.payable;
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
