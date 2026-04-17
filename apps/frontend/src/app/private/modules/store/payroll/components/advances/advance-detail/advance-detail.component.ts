import { Component, input, output, model, inject, signal, effect, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';


import { PayrollService } from '../../../services/payroll.service';
import { EmployeeAdvance, AdvanceApproveDto, AdvanceManualPaymentDto, AdvanceInstallment } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { toLocalDateString } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-advance-detail',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onClose()"
      title="Detalle de Adelanto"
      size="xl"
      >
      @if (advance()) {
        <div class="p-4 max-h-[75vh] overflow-y-auto">
          <!-- Header -->
          <div class="mb-4 flex flex-wrap items-center gap-3">
            <span class="text-lg font-semibold text-text-primary">{{ advance()?.advance_number }}</span>
            <span [class]="getStatusBadgeClass(advance()!.status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
              {{ getStatusLabel(advance()!.status) }}
            </span>
            <span class="text-sm text-text-secondary ml-auto">
              {{ getFrequencyLabel(advance()!.frequency) }}
            </span>
          </div>
          <!-- Employee Info -->
          @if (advance()?.employee) {
            <div class="mb-4 p-3 bg-gray-50 rounded-lg">
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <span class="text-xs text-text-secondary block">Empleado</span>
                  <span class="text-sm font-medium">{{ advance()?.employee.first_name }} {{ advance()?.employee.last_name }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Documento</span>
                  <span class="text-sm font-medium">{{ advance()?.employee.document_number }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Fecha Solicitud</span>
                  <span class="text-sm font-medium">{{ advance()?.advance_date | date:'dd/MM/yyyy' }}</span>
                </div>
              </div>
            </div>
          }
          <!-- Financial Summary -->
          <div class="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <span class="text-xs text-blue-600 block">Solicitado</span>
              <span class="text-lg font-bold text-blue-800">{{ formatNumber(advance()!.amount_requested) }}</span>
            </div>
            <div class="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
              <span class="text-xs text-indigo-600 block">Aprobado</span>
              <span class="text-lg font-bold text-indigo-800">{{ formatNumber(advance()!.amount_approved) }}</span>
            </div>
            <div class="p-3 bg-green-50 rounded-lg border border-green-100">
              <span class="text-xs text-green-600 block">Pagado</span>
              <span class="text-lg font-bold text-green-800">{{ formatNumber(advance()!.amount_paid) }}</span>
            </div>
            <div class="p-3 bg-red-50 rounded-lg border border-red-100">
              <span class="text-xs text-red-600 block">Pendiente</span>
              <span class="text-lg font-bold text-red-800">{{ formatNumber(advance()!.amount_pending) }}</span>
            </div>
          </div>
          <!-- Installment Info -->
          <div class="mb-4 p-3 bg-gray-50 rounded-lg grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="text-xs text-text-secondary block">Cuotas</span>
              <span class="text-sm font-medium">{{ advance()?.installments }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Valor por Cuota</span>
              <span class="text-sm font-medium">{{ formatNumber(advance()!.installment_value) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Frecuencia</span>
              <span class="text-sm font-medium">{{ getFrequencyLabel(advance()!.frequency) }}</span>
            </div>
          </div>
          <!-- Repayment Progress -->
          @if (advance()?.status !== 'pending' && advance()!.status !== 'rejected') {
            <div class="mb-4">
              <div class="flex justify-between text-xs text-text-secondary mb-1">
                <span>Progreso de Pago</span>
                <span>{{ getProgressPercent() }}%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2.5">
                <div class="bg-green-500 h-2.5 rounded-full transition-all duration-300"
                  [style.width.%]="getProgressPercent()">
                </div>
              </div>
              <div class="flex justify-between text-[10px] text-text-secondary mt-0.5">
                <span>{{ getPaidInstallments() }} de {{ advance()?.installments }} cuotas</span>
                <span>{{ formatNumber(advance()!.amount_paid) }} / {{ formatNumber(advance()!.amount_approved) }}</span>
              </div>
            </div>
          }
          <!-- Installment Schedule -->
          @if (advance()?.advance_installments && advance()!.advance_installments!.length > 0) {
            <div class="mb-4">
              <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Cronograma de Cuotas</h3>
              <!-- Desktop Table -->
              <div class="hidden md:block overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-border bg-gray-50">
                      <th class="text-left py-2 px-3 font-medium text-text-secondary">#</th>
                      <th class="text-left py-2 px-3 font-medium text-text-secondary">Vencimiento</th>
                      <th class="text-right py-2 px-3 font-medium text-text-secondary">Monto</th>
                      <th class="text-center py-2 px-3 font-medium text-text-secondary">Estado</th>
                      <th class="text-left py-2 px-3 font-medium text-text-secondary">Fecha Pago</th>
                      <th class="text-center py-2 px-3 font-medium text-text-secondary"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (inst of advance()!.advance_installments; track inst) {
                      <tr
                        class="border-b border-border"
                        [class.bg-green-50]="inst.status === 'paid'"
                        [class.bg-red-50]="inst.status === 'overdue'">
                        <td class="py-2 px-3 text-text-secondary">{{ inst.installment_number }}</td>
                        <td class="py-2 px-3">{{ inst.due_date | date:'dd/MM/yyyy' }}</td>
                        <td class="py-2 px-3 text-right font-medium">{{ formatNumber(inst.amount) }}</td>
                        <td class="py-2 px-3 text-center">
                          <span [class]="getInstallmentBadge(inst.status)">
                            {{ getInstallmentLabel(inst.status) }}
                          </span>
                        </td>
                        <td class="py-2 px-3 text-text-secondary">{{ inst.paid_at ? (inst.paid_at | date:'dd/MM/yyyy') : '-' }}</td>
                        <td class="py-2 px-3 text-center">
                          @if (inst.status === 'pending' || inst.status === 'overdue') {
                            <button
                              type="button"
                              (click)="onMarkInstallmentPaid(inst)"
                              [disabled]="paymentLoading"
                              class="text-xs text-primary hover:text-primary-dark font-medium px-2 py-1 rounded hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                              Pagar
                            </button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <!-- Mobile Cards -->
              <div class="md:hidden space-y-2">
                @for (inst of advance()!.advance_installments; track inst) {
                  <div
                    class="p-3 rounded-lg border"
                    [class.bg-green-50]="inst.status === 'paid'"
                    [class.border-green-200]="inst.status === 'paid'"
                    [class.bg-red-50]="inst.status === 'overdue'"
                    [class.border-red-200]="inst.status === 'overdue'"
                    [class.bg-surface]="inst.status === 'pending' || inst.status === 'cancelled'"
                    [class.border-border]="inst.status === 'pending' || inst.status === 'cancelled'">
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm font-medium">Cuota #{{ inst.installment_number }}</span>
                      <span [class]="getInstallmentBadge(inst.status)">
                        {{ getInstallmentLabel(inst.status) }}
                      </span>
                    </div>
                    <div class="flex justify-between items-center text-xs">
                      <span class="text-text-secondary">Vence: {{ inst.due_date | date:'dd/MM/yyyy' }}</span>
                      <span class="font-medium text-text-primary">{{ formatNumber(inst.amount) }}</span>
                    </div>
                    @if (inst.paid_at) {
                      <div class="text-[10px] text-text-secondary mt-1">
                        Pagada: {{ inst.paid_at | date:'dd/MM/yyyy' }}
                      </div>
                    }
                    @if (inst.status === 'pending' || inst.status === 'overdue') {
                      <button
                        type="button"
                        (click)="onMarkInstallmentPaid(inst)"
                        [disabled]="paymentLoading"
                        class="mt-2 w-full text-xs text-primary font-medium py-1.5 rounded border border-primary/20 hover:bg-primary/10 transition-colors text-center disabled:opacity-50 disabled:cursor-not-allowed">
                        Pagar Cuota
                      </button>
                    }
                  </div>
                }
              </div>
            </div>
          }
          <!-- Reason -->
          @if (advance()?.reason) {
            <div class="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
              <h3 class="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1">Motivo</h3>
              <p class="text-sm text-yellow-800">{{ advance()?.reason }}</p>
            </div>
          }
          <!-- Notes -->
          @if (advance()?.notes) {
            <div class="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <h3 class="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Notas</h3>
              <p class="text-sm text-blue-800">{{ advance()?.notes }}</p>
            </div>
          }
          <!-- Payment History -->
          @if (advance()?.advance_payments && advance()!.advance_payments!.length > 0) {
            <div class="mb-4">
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
                    @for (payment of advance()!.advance_payments; track payment) {
                      <tr class="border-b border-border">
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
                    }
                  </tbody>
                </table>
              </div>
              <!-- Mobile Cards -->
              <div class="md:hidden space-y-2">
                @for (payment of advance()!.advance_payments; track payment) {
                  <div
                    class="p-3 bg-surface rounded-lg border border-border">
                    <div class="flex justify-between items-center mb-1">
                      <span class="text-sm font-medium">{{ formatNumber(payment.amount) }}</span>
                      <span [class]="payment.payment_type === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'"
                        class="px-2 py-0.5 rounded-full text-[10px] font-medium">
                        {{ payment.payment_type === 'manual' ? 'Manual' : 'Nomina' }}
                      </span>
                    </div>
                    <span class="text-xs text-text-secondary">{{ payment.payment_date | date:'dd/MM/yyyy' }}</span>
                    @if (payment.notes) {
                      <span class="text-xs text-text-secondary block mt-1">{{ payment.notes }}</span>
                    }
                  </div>
                }
              </div>
            </div>
          }
          <!-- Empty payment history -->
          @if (!advance()?.advance_payments || advance()!.advance_payments!.length === 0) {
            <div
              class="mb-4 py-6 flex flex-col items-center rounded-lg border-2 border-dashed border-border">
              <app-icon name="receipt" [size]="28" class="text-gray-400 mb-2"></app-icon>
              <p class="text-sm text-text-secondary">Sin pagos registrados</p>
            </div>
          }
          <!-- Manual Payment Form (inline) -->
          @if (advance()?.status === 'approved' || advance()!.status === 'repaying') {
            <div
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
          }
          <!-- Actions -->
          @if (advance()?.status !== 'paid' && advance()!.status !== 'rejected' && advance()!.status !== 'cancelled') {
            <div class="mt-6 pt-4 border-t border-border"
              >
              <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Acciones</h3>
              <div class="space-y-2">
                <!-- Approve (pending) -->
                @if (advance()?.status === 'pending') {
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
                }
                <!-- Cancel -->
                @if (advance()?.status === 'approved' || advance()!.status === 'repaying') {
                  <app-button
                    variant="outline-danger"
                    [fullWidth]="true"
                    (clicked)="onCancel()"
                    [loading]="actionLoading"
                    >
                    <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
                    Cancelar Adelanto
                  </app-button>
                }
              </div>
            </div>
          }
        </div>
      }
    
      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
    ` })
export class AdvanceDetailComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = model<boolean>(false);
  readonly advanceInput = input<EmployeeAdvance | null>(null);
  readonly updated = output<void>();

  readonly advance = signal<EmployeeAdvance | null>(null);

  private fb = inject(FormBuilder);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
constructor() {
  }

  actionLoading = false;
  paymentLoading = false;

  paymentForm: FormGroup = this.fb.group({
    amount: [null, [Validators.required, Validators.min(1)]],
    payment_date: [toLocalDateString(), [Validators.required]],
    notes: [''] });

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  onApprove(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading = true;
    this.payrollService.approveAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto aprobado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al aprobar' });
        } });
  }

  onReject(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading = true;
    this.payrollService.rejectAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto rechazado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al rechazar' });
        } });
  }

  onCancel(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading = true;
    this.payrollService.cancelAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Adelanto cancelado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al cancelar' });
        } });
  }

  onRegisterPayment(): void {
    const adv = this.advance();
    if (!adv || this.paymentForm.invalid) return;
    this.paymentLoading = true;

    const val = this.paymentForm.value;
    const dto: AdvanceManualPaymentDto = {
      amount: val.amount,
      payment_date: val.payment_date,
      notes: val.notes || undefined };

    this.payrollService.registerAdvancePayment(adv.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.paymentLoading = false;
          this.paymentForm.reset({
            payment_date: toLocalDateString() });
          this.toastService.show({ variant: 'success', description: 'Pago registrado' });
          this.updated.emit();
        },
        error: () => {
          this.paymentLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al registrar pago' });
        } });
  }

  onClose(): void {
    this.isOpen.set(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      repaying: 'En Pago',
      paid: 'Pagado',
      rejected: 'Rechazado',
      cancelled: 'Cancelado' };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      repaying: 'bg-purple-100 text-purple-800',
      paid: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800' };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  getFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      monthly: 'Mensual',
      biweekly: 'Quincenal',
      weekly: 'Semanal' };
    return labels[frequency] || frequency || '-';
  }

  // ─── Installment Methods ───────────────────────

  getProgressPercent(): number {
    const adv = this.advance();
    if (!adv || !Number(adv.amount_approved)) return 0;
    return Math.min(100, Math.round((Number(adv.amount_paid) / Number(adv.amount_approved)) * 100));
  }

  getPaidInstallments(): number {
    return this.advance()?.advance_installments?.filter(i => i.status === 'paid').length || 0;
  }

  getInstallmentLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagada',
      overdue: 'Vencida',
      cancelled: 'Cancelada' };
    return labels[status] || status;
  }

  getInstallmentBadge(status: string): string {
    const base = 'px-2 py-0.5 rounded-full text-xs font-medium';
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700',
      paid: 'bg-green-100 text-green-800',
      overdue: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-500' };
    return `${base} ${colors[status] || 'bg-gray-100 text-gray-700'}`;
  }

  onMarkInstallmentPaid(installment: AdvanceInstallment): void {
    const adv = this.advance();
    if (!adv) return;
    this.paymentLoading = true;

    const dto: AdvanceManualPaymentDto = {
      amount: installment.amount,
      payment_date: toLocalDateString() };

    this.payrollService.markInstallmentPaid(adv.id, installment.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.paymentLoading = false;
          this.toastService.show({ variant: 'success', description: `Cuota #${installment.installment_number} pagada` });
          this.updated.emit();
        },
        error: () => {
          this.paymentLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al pagar cuota' });
        } });
  }
}
