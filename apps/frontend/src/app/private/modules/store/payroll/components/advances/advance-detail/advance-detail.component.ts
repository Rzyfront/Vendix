import { Component, Input, Output, EventEmitter, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../../../services/payroll.service';
import { EmployeeAdvance, AdvanceApproveDto, AdvanceManualPaymentDto } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-advance-detail',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Detalle de Adelanto"
      size="xl"
    >
      <div class="p-4 max-h-[75vh] overflow-y-auto" *ngIf="advance">

        <!-- Header -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <span class="text-lg font-semibold text-text-primary">{{ advance.advance_number }}</span>
          <span [class]="getStatusBadgeClass(advance.status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ getStatusLabel(advance.status) }}
          </span>
          <span class="text-sm text-text-secondary ml-auto">
            {{ getFrequencyLabel(advance.frequency) }}
          </span>
        </div>

        <!-- Employee Info -->
        <div class="mb-4 p-3 bg-gray-50 rounded-lg" *ngIf="advance.employee">
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="text-xs text-text-secondary block">Empleado</span>
              <span class="text-sm font-medium">{{ advance.employee.first_name }} {{ advance.employee.last_name }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Documento</span>
              <span class="text-sm font-medium">{{ advance.employee.document_number }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Fecha Solicitud</span>
              <span class="text-sm font-medium">{{ advance.advance_date | date:'dd/MM/yyyy' }}</span>
            </div>
          </div>
        </div>

        <!-- Financial Summary -->
        <div class="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <span class="text-xs text-blue-600 block">Solicitado</span>
            <span class="text-lg font-bold text-blue-800">{{ formatNumber(advance.amount_requested) }}</span>
          </div>
          <div class="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <span class="text-xs text-indigo-600 block">Aprobado</span>
            <span class="text-lg font-bold text-indigo-800">{{ formatNumber(advance.amount_approved) }}</span>
          </div>
          <div class="p-3 bg-green-50 rounded-lg border border-green-100">
            <span class="text-xs text-green-600 block">Pagado</span>
            <span class="text-lg font-bold text-green-800">{{ formatNumber(advance.amount_paid) }}</span>
          </div>
          <div class="p-3 bg-red-50 rounded-lg border border-red-100">
            <span class="text-xs text-red-600 block">Pendiente</span>
            <span class="text-lg font-bold text-red-800">{{ formatNumber(advance.amount_pending) }}</span>
          </div>
        </div>

        <!-- Installment Info -->
        <div class="mb-4 p-3 bg-gray-50 rounded-lg grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <span class="text-xs text-text-secondary block">Cuotas</span>
            <span class="text-sm font-medium">{{ advance.installments }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Valor por Cuota</span>
            <span class="text-sm font-medium">{{ formatNumber(advance.installment_value) }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Frecuencia</span>
            <span class="text-sm font-medium">{{ getFrequencyLabel(advance.frequency) }}</span>
          </div>
        </div>

        <!-- Reason -->
        <div *ngIf="advance.reason" class="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
          <h3 class="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1">Motivo</h3>
          <p class="text-sm text-yellow-800">{{ advance.reason }}</p>
        </div>

        <!-- Notes -->
        <div *ngIf="advance.notes" class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <h3 class="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Notas</h3>
          <p class="text-sm text-blue-800">{{ advance.notes }}</p>
        </div>

        <!-- Payment History -->
        <div *ngIf="advance.advance_payments && advance.advance_payments.length > 0" class="mb-4">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Historial de Pagos</h3>

          <!-- Desktop Table -->
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-gray-50">
                  <th class="text-left py-2 px-3 font-medium text-text-secondary">Fecha</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Monto</th>
                  <th class="text-center py-2 px-3 font-medium text-text-secondary">Tipo</th>
                  <th class="text-left py-2 px-3 font-medium text-text-secondary">Notas</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let payment of advance.advance_payments" class="border-b border-border">
                  <td class="py-2 px-3">{{ payment.payment_date | date:'dd/MM/yyyy' }}</td>
                  <td class="py-2 px-3 text-right font-medium">{{ formatNumber(payment.amount) }}</td>
                  <td class="py-2 px-3 text-center">
                    <span [class]="payment.payment_type === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'"
                      class="px-2 py-0.5 rounded-full text-xs font-medium">
                      {{ payment.payment_type === 'manual' ? 'Manual' : 'Deduccion Nomina' }}
                    </span>
                  </td>
                  <td class="py-2 px-3 text-text-secondary">{{ payment.notes || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Mobile Cards -->
          <div class="md:hidden space-y-2">
            <div *ngFor="let payment of advance.advance_payments"
              class="p-3 bg-surface rounded-lg border border-border">
              <div class="flex justify-between items-center mb-1">
                <span class="text-sm font-medium">{{ formatNumber(payment.amount) }}</span>
                <span [class]="payment.payment_type === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'"
                  class="px-2 py-0.5 rounded-full text-[10px] font-medium">
                  {{ payment.payment_type === 'manual' ? 'Manual' : 'Nomina' }}
                </span>
              </div>
              <span class="text-xs text-text-secondary">{{ payment.payment_date | date:'dd/MM/yyyy' }}</span>
              <span *ngIf="payment.notes" class="text-xs text-text-secondary block mt-1">{{ payment.notes }}</span>
            </div>
          </div>
        </div>

        <!-- Empty payment history -->
        <div *ngIf="!advance.advance_payments || advance.advance_payments.length === 0"
          class="mb-4 py-6 flex flex-col items-center rounded-lg border-2 border-dashed border-border">
          <app-icon name="receipt" [size]="28" class="text-gray-400 mb-2"></app-icon>
          <p class="text-sm text-text-secondary">Sin pagos registrados</p>
        </div>

        <!-- Manual Payment Form (inline) -->
        <div *ngIf="advance.status === 'approved' || advance.status === 'repaying'"
          class="mb-4 p-4 bg-gray-50 rounded-xl border border-border">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Registrar Pago Manual</h3>
          <form [formGroup]="paymentForm" class="space-y-3">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <app-input
                label="Monto"
                type="number"
                formControlName="amount"
                [control]="paymentForm.get('amount')"
                [required]="true"
                placeholder="0"
              ></app-input>

              <app-input
                label="Fecha de Pago"
                type="date"
                formControlName="payment_date"
                [control]="paymentForm.get('payment_date')"
                [required]="true"
              ></app-input>
            </div>

            <div>
              <label class="block text-sm font-medium text-text-primary mb-1">Notas</label>
              <textarea
                formControlName="notes"
                rows="2"
                class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm
                       text-text-primary placeholder-text-secondary focus:border-primary
                       focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                placeholder="Notas del pago (opcional)..."
              ></textarea>
            </div>

            <app-button
              variant="primary"
              size="sm"
              (clicked)="onRegisterPayment()"
              [disabled]="paymentForm.invalid || paymentLoading"
              [loading]="paymentLoading"
            >
              <app-icon name="plus" [size]="14" slot="icon"></app-icon>
              Registrar Pago
            </app-button>
          </form>
        </div>

        <!-- Actions -->
        <div class="mt-6 pt-4 border-t border-border"
          *ngIf="advance.status !== 'paid' && advance.status !== 'rejected' && advance.status !== 'cancelled'">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Acciones</h3>
          <div class="space-y-2">
            <!-- Approve (pending) -->
            <ng-container *ngIf="advance.status === 'pending'">
              <app-button
                variant="success"
                [fullWidth]="true"
                (clicked)="onApprove()"
                [loading]="actionLoading"
              >
                <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                Aprobar Adelanto
              </app-button>

              <app-button
                variant="outline-danger"
                [fullWidth]="true"
                (clicked)="onReject()"
                [loading]="actionLoading"
              >
                <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
                Rechazar
              </app-button>
            </ng-container>

            <!-- Cancel -->
            <app-button
              *ngIf="advance.status === 'approved' || advance.status === 'repaying'"
              variant="outline-danger"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="actionLoading"
            >
              <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
              Cancelar Adelanto
            </app-button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class AdvanceDetailComponent implements OnDestroy {
  @Input() isOpen = false;
  @Input() advance: EmployeeAdvance | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() updated = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  actionLoading = false;
  paymentLoading = false;

  paymentForm: FormGroup = this.fb.group({
    amount: [null, [Validators.required, Validators.min(1)]],
    payment_date: [new Date().toISOString().split('T')[0], [Validators.required]],
    notes: [''],
  });

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  onApprove(): void {
    if (!this.advance) return;
    this.actionLoading = true;
    this.payrollService.approveAdvance(this.advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.advance = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto aprobado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al aprobar' });
        },
      });
  }

  onReject(): void {
    if (!this.advance) return;
    this.actionLoading = true;
    this.payrollService.rejectAdvance(this.advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.advance = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto rechazado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al rechazar' });
        },
      });
  }

  onCancel(): void {
    if (!this.advance) return;
    this.actionLoading = true;
    this.payrollService.cancelAdvance(this.advance.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.advance = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto cancelado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al cancelar' });
        },
      });
  }

  onRegisterPayment(): void {
    if (!this.advance || this.paymentForm.invalid) return;
    this.paymentLoading = true;

    const val = this.paymentForm.value;
    const dto: AdvanceManualPaymentDto = {
      amount: val.amount,
      payment_date: val.payment_date,
      notes: val.notes || undefined,
    };

    this.payrollService.registerAdvancePayment(this.advance.id, dto)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.advance = res.data;
          this.paymentLoading = false;
          this.paymentForm.reset({
            payment_date: new Date().toISOString().split('T')[0],
          });
          this.toastService.show({ variant: 'success', description: 'Pago registrado' });
          this.updated.emit();
        },
        error: () => {
          this.paymentLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al registrar pago' });
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      repaying: 'En Pago',
      paid: 'Pagado',
      rejected: 'Rechazado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      repaying: 'bg-purple-100 text-purple-800',
      paid: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  getFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      monthly: 'Mensual',
      biweekly: 'Quincenal',
      weekly: 'Semanal',
    };
    return labels[frequency] || frequency || '-';
  }
}
