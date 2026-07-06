import {
  Component,
  input,
  output,
  model,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import { PayrollService } from '../../../services/payroll.service';
import {
  EmployeeAdvance,
  AdvanceManualPaymentDto,
  AdvanceInstallment,
} from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../../../shared/components/badge/badge.component';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  toLocalDateString,
  formatDateOnlyUTC,
} from '../../../../../../../shared/utils/date.util';

/** Estado del adelanto → variante semántica del app-badge. */
const ADVANCE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  approved: 'primary',
  repaying: 'service',
  paid: 'success',
  rejected: 'error',
  cancelled: 'neutral',
};

/**
 * Estado de la cuota → color (hex 7-char requerido por el badge custom del
 * data-view). `overdue` no existe en el mapa de estados semántico compartido,
 * por eso se usa el modo custom para preservar el rojo de "vencida".
 */
const INSTALLMENT_BADGE_COLORS: Record<string, string> = {
  pending: '#6b7280',
  paid: '#16a34a',
  overdue: '#dc2626',
  cancelled: '#9ca3af',
};

/** Tipo de pago → color (hex 7-char) para el badge custom del data-view. */
const PAYMENT_TYPE_COLORS: Record<string, string> = {
  manual: '#2563eb',
  payroll_deduction: '#7c3aed',
};

interface PaymentFormControls {
  amount: FormControl<number | null>;
  payment_date: FormControl<string>;
  notes: FormControl<string>;
}

@Component({
  selector: 'app-advance-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    BadgeComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (cancel)="onClose()"
      [title]="advance()?.advance_number || 'Detalle de Adelanto'"
      [subtitle]="employeeName()"
      size="xl"
    >
      @if (advance(); as a) {
        <app-badge slot="header" [variant]="statusVariant()" size="sm">
          {{ getStatusLabel(a.status) }}
        </app-badge>
      }

      @if (advance(); as a) {
        <div class="p-4 max-h-[75vh] overflow-y-auto space-y-4">
          <!-- Employee Info -->
          @if (a.employee) {
            <div class="p-3 bg-background rounded-lg border border-border">
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <span class="text-xs text-text-secondary block">Empleado</span>
                  <span class="text-sm font-medium text-text-primary"
                    >{{ a.employee.first_name }} {{ a.employee.last_name }}</span
                  >
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Documento</span>
                  <span class="text-sm font-medium text-text-primary">{{
                    a.employee.document_number
                  }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block"
                    >Fecha Solicitud</span
                  >
                  <span class="text-sm font-medium text-text-primary">{{
                    formatDate(a.advance_date)
                  }}</span>
                </div>
              </div>
            </div>
          }

          <!-- Financial Summary -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 bg-background rounded-lg border border-border">
              <span class="text-xs text-text-secondary block">Solicitado</span>
              <span class="text-lg font-bold text-text-primary">{{
                formatNumber(a.amount_requested)
              }}</span>
            </div>
            <div class="p-3 bg-background rounded-lg border border-border">
              <span class="text-xs text-text-secondary block">Aprobado</span>
              <span class="text-lg font-bold text-primary">{{
                formatNumber(a.amount_approved)
              }}</span>
            </div>
            <div class="p-3 bg-background rounded-lg border border-border">
              <span class="text-xs text-text-secondary block">Pagado</span>
              <span class="text-lg font-bold text-success">{{
                formatNumber(a.amount_paid)
              }}</span>
            </div>
            <div class="p-3 bg-background rounded-lg border border-border">
              <span class="text-xs text-text-secondary block">Pendiente</span>
              <span class="text-lg font-bold text-error">{{
                formatNumber(a.amount_pending)
              }}</span>
            </div>
          </div>

          <!-- Installment Info -->
          <div
            class="p-3 bg-background rounded-lg border border-border grid grid-cols-2 md:grid-cols-3 gap-3"
          >
            <div>
              <span class="text-xs text-text-secondary block">Cuotas</span>
              <span class="text-sm font-medium text-text-primary">{{
                a.installments
              }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Valor por Cuota</span>
              <span class="text-sm font-medium text-text-primary">{{
                formatNumber(a.installment_value)
              }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Frecuencia</span>
              <span class="text-sm font-medium text-text-primary">{{
                getFrequencyLabel(a.frequency)
              }}</span>
            </div>
          </div>

          <!-- Repayment Progress -->
          @if (a.status !== 'pending' && a.status !== 'rejected') {
            <div>
              <div class="flex justify-between text-xs text-text-secondary mb-1">
                <span>Progreso de Pago</span>
                <span>{{ getProgressPercent() }}%</span>
              </div>
              <div class="w-full bg-border rounded-full h-2.5 overflow-hidden">
                <div
                  class="bg-success h-2.5 rounded-full transition-all duration-300"
                  [style.width.%]="getProgressPercent()"
                ></div>
              </div>
              <div
                class="flex justify-between text-[10px] text-text-secondary mt-0.5"
              >
                <span>{{ getPaidInstallments() }} de {{ a.installments }} cuotas</span>
                <span
                  >{{ formatNumber(a.amount_paid) }} /
                  {{ formatNumber(a.amount_approved) }}</span
                >
              </div>
            </div>
          }

          <!-- Installment Schedule -->
          @if (a.advance_installments && a.advance_installments.length > 0) {
            <div>
              <h3
                class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3"
              >
                Cronograma de Cuotas
              </h3>
              <app-responsive-data-view
                [data]="a.advance_installments"
                [columns]="installmentColumns"
                [cardConfig]="installmentCardConfig"
                [actions]="installmentActions"
                emptyMessage="Sin cuotas programadas"
                emptyIcon="calendar"
              ></app-responsive-data-view>
            </div>
          }

          <!-- Reason -->
          @if (a.reason) {
            <div class="p-3 bg-background rounded-lg border border-border">
              <h3
                class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 flex items-center gap-1.5"
              >
                <app-icon name="info" [size]="12"></app-icon>
                Motivo
              </h3>
              <p class="text-sm text-text-primary">{{ a.reason }}</p>
            </div>
          }

          <!-- Notes -->
          @if (a.notes) {
            <div class="p-3 bg-background rounded-lg border border-border">
              <h3
                class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 flex items-center gap-1.5"
              >
                <app-icon name="sticky-note" [size]="12"></app-icon>
                Notas
              </h3>
              <p class="text-sm text-text-primary">{{ a.notes }}</p>
            </div>
          }

          <!-- Payment History -->
          @if (
            (a.advance_payments && a.advance_payments.length > 0) ||
            a.status === 'approved' ||
            a.status === 'repaying' ||
            a.status === 'paid'
          ) {
            <div>
              <h3
                class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3"
              >
                Historial de Pagos
              </h3>
              @if (a.advance_payments && a.advance_payments.length > 0) {
                <app-responsive-data-view
                  [data]="a.advance_payments"
                  [columns]="paymentColumns"
                  [cardConfig]="paymentCardConfig"
                  emptyMessage="Sin pagos registrados"
                  emptyIcon="receipt"
                ></app-responsive-data-view>
              } @else {
                <div
                  class="py-6 flex flex-col items-center rounded-lg border-2 border-dashed border-border"
                >
                  <app-icon
                    name="receipt"
                    [size]="28"
                    class="text-text-secondary mb-2"
                  ></app-icon>
                  <p class="text-sm text-text-secondary">
                    Sin pagos registrados
                  </p>
                </div>
              }
            </div>
          }

          <!-- Manual Payment Form (inline) -->
          @if (a.status === 'approved' || a.status === 'repaying') {
            <div class="p-4 bg-background rounded-xl border border-border">
              <h3
                class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3"
              >
                Registrar Pago Manual
              </h3>
              <form [formGroup]="paymentForm" class="space-y-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <app-input
                    label="Monto"
                    [currency]="true"
                    formControlName="amount"
                    [control]="paymentForm.controls.amount"
                    [required]="true"
                    placeholder="0"
                  ></app-input>
                  <app-input
                    label="Fecha de Pago"
                    type="date"
                    formControlName="payment_date"
                    [control]="paymentForm.controls.payment_date"
                    [required]="true"
                  ></app-input>
                </div>
                <div>
                  <label
                    class="block text-sm font-medium text-text-primary mb-1"
                    >Notas</label
                  >
                  <textarea
                    formControlName="notes"
                    rows="2"
                    class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm
                           text-text-primary placeholder-text-secondary focus:border-primary-600
                           focus:outline-none focus:ring-1 focus:ring-primary-600 resize-none"
                    placeholder="Notas del pago (opcional)..."
                  ></textarea>
                </div>
                <app-button
                  variant="primary"
                  size="sm"
                  (clicked)="onRegisterPayment()"
                  [disabled]="!paymentFormValid() || paymentLoading()"
                  [loading]="paymentLoading()"
                >
                  <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                  Registrar Pago
                </app-button>
              </form>
            </div>
          }

          <!-- Actions -->
          @if (
            a.status !== 'paid' &&
            a.status !== 'rejected' &&
            a.status !== 'cancelled'
          ) {
            <div class="pt-4 border-t border-border">
              <h3
                class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3"
              >
                Acciones
              </h3>
              <div class="space-y-2">
                @if (a.status === 'pending') {
                  <app-button
                    variant="success"
                    [fullWidth]="true"
                    (clicked)="onApprove()"
                    [loading]="actionLoading()"
                  >
                    <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                    Aprobar Adelanto
                  </app-button>
                  <app-button
                    variant="outline-danger"
                    [fullWidth]="true"
                    (clicked)="onReject()"
                    [loading]="actionLoading()"
                  >
                    <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
                    Rechazar
                  </app-button>
                }
                @if (a.status === 'approved' || a.status === 'repaying') {
                  <app-button
                    variant="outline-danger"
                    [fullWidth]="true"
                    (clicked)="onCancel()"
                    [loading]="actionLoading()"
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
        <div
          class="flex items-center justify-end gap-2 p-3 bg-background rounded-b-xl border-t border-border"
        >
          <app-button variant="outline" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class AdvanceDetailComponent {
  private destroyRef = inject(DestroyRef);
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = model<boolean>(false);
  readonly advanceInput = input<EmployeeAdvance | null>(null);
  readonly updated = output<void>();

  readonly advance = signal<EmployeeAdvance | null>(null);

  readonly actionLoading = signal(false);
  readonly paymentLoading = signal(false);

  readonly employeeName = computed(() => {
    const e = this.advance()?.employee;
    return e ? `${e.first_name} ${e.last_name}` : '';
  });

  readonly statusVariant = computed<BadgeVariant>(() => {
    const status = this.advance()?.status;
    return status ? (ADVANCE_STATUS_VARIANT[status] ?? 'neutral') : 'neutral';
  });

  readonly paymentForm = new FormGroup<PaymentFormControls>({
    amount: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(1),
    ]),
    payment_date: new FormControl(toLocalDateString(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    notes: new FormControl('', { nonNullable: true }),
  });

  /** Estado del form puenteado a signal (form.status no es reactivo en zoneless). */
  private readonly paymentFormStatus = toSignal(
    this.paymentForm.statusChanges.pipe(startWith(this.paymentForm.status)),
    { initialValue: this.paymentForm.status },
  );
  readonly paymentFormValid = computed(
    () => this.paymentFormStatus() === 'VALID',
  );

  // ─── Data-view configs ─────────────────────────────

  readonly installmentColumns: TableColumn[] = [
    { key: 'installment_number', label: '#', width: '56px', align: 'center' },
    {
      key: 'due_date',
      label: 'Vencimiento',
      transform: (v: any) => (v ? formatDateOnlyUTC(v) : '-'),
    },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      transform: (v: any) => this.formatNumber(v),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: INSTALLMENT_BADGE_COLORS },
      badgeTransform: (v: any) => this.getInstallmentLabel(v),
    },
    {
      key: 'paid_at',
      label: 'Fecha Pago',
      transform: (v: any) => (v ? formatDateOnlyUTC(v) : '-'),
    },
  ];

  readonly installmentCardConfig: ItemListCardConfig = {
    titleKey: 'installment_number',
    titleTransform: (inst: any) => `Cuota #${inst.installment_number}`,
    subtitleKey: 'due_date',
    subtitleTransform: (inst: any) =>
      inst.due_date ? `Vence: ${formatDateOnlyUTC(inst.due_date)}` : '-',
    badgeKey: 'status',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: INSTALLMENT_BADGE_COLORS },
    badgeTransform: (v: any) => this.getInstallmentLabel(v),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.formatNumber(v),
    detailKeys: [
      {
        key: 'paid_at',
        label: 'Pagada',
        icon: 'calendar-check',
        transform: (v: any) => (v ? formatDateOnlyUTC(v) : '—'),
      },
    ],
  };

  readonly installmentActions: TableAction[] = [
    {
      label: 'Pagar',
      icon: 'dollar-sign',
      variant: 'primary',
      show: (inst: AdvanceInstallment) =>
        inst.status === 'pending' || inst.status === 'overdue',
      disabled: () => this.paymentLoading(),
      action: (inst: AdvanceInstallment) => this.onMarkInstallmentPaid(inst),
    },
  ];

  readonly paymentColumns: TableColumn[] = [
    {
      key: 'payment_date',
      label: 'Fecha',
      transform: (v: any) => (v ? formatDateOnlyUTC(v) : '-'),
    },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      transform: (v: any) => this.formatNumber(v),
    },
    {
      key: 'payment_type',
      label: 'Tipo',
      align: 'center',
      badge: true,
      badgeConfig: { type: 'custom', size: 'sm', colorMap: PAYMENT_TYPE_COLORS },
      badgeTransform: (v: any) => this.getPaymentTypeLabel(v),
    },
    { key: 'notes', label: 'Notas', transform: (v: any) => v || '-' },
  ];

  readonly paymentCardConfig: ItemListCardConfig = {
    titleKey: 'amount',
    titleTransform: (p: any) => this.formatNumber(p.amount),
    subtitleKey: 'payment_date',
    subtitleTransform: (p: any) =>
      p.payment_date ? formatDateOnlyUTC(p.payment_date) : '-',
    badgeKey: 'payment_type',
    badgeConfig: { type: 'custom', size: 'sm', colorMap: PAYMENT_TYPE_COLORS },
    badgeTransform: (v: any) => this.getPaymentTypeLabel(v),
    detailKeys: [
      {
        key: 'notes',
        label: 'Notas',
        icon: 'sticky-note',
        transform: (v: any) => v || '—',
      },
    ],
  };

  constructor() {
    // Sincroniza el adelanto de entrada con el signal editable (mutado por acciones).
    effect(() => {
      const incoming = this.advanceInput();
      if (incoming) this.advance.set(incoming);
    });
  }

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  formatDate(value: string | Date | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  onApprove(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading.set(true);
    this.payrollService
      .approveAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'success',
            description: 'Adelanto aprobado',
          });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al aprobar',
          });
        },
      });
  }

  onReject(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading.set(true);
    this.payrollService
      .rejectAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'success',
            description: 'Adelanto rechazado',
          });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al rechazar',
          });
        },
      });
  }

  onCancel(): void {
    const adv = this.advance();
    if (!adv) return;
    this.actionLoading.set(true);
    this.payrollService
      .cancelAdvance(adv.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'success',
            description: 'Adelanto cancelado',
          });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al cancelar',
          });
        },
      });
  }

  onRegisterPayment(): void {
    const adv = this.advance();
    if (!adv || this.paymentForm.invalid) return;
    this.paymentLoading.set(true);

    const val = this.paymentForm.getRawValue();
    const dto: AdvanceManualPaymentDto = {
      amount: Number(val.amount),
      payment_date: val.payment_date,
      notes: val.notes || undefined,
    };

    this.payrollService
      .registerAdvancePayment(adv.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.paymentLoading.set(false);
          this.paymentForm.reset({
            amount: null,
            payment_date: toLocalDateString(),
            notes: '',
          });
          this.toastService.show({
            variant: 'success',
            description: 'Pago registrado',
          });
          this.updated.emit();
        },
        error: () => {
          this.paymentLoading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al registrar pago',
          });
        },
      });
  }

  onMarkInstallmentPaid(installment: AdvanceInstallment): void {
    const adv = this.advance();
    if (!adv) return;
    this.paymentLoading.set(true);

    const dto: AdvanceManualPaymentDto = {
      amount: installment.amount,
      payment_date: toLocalDateString(),
    };

    this.payrollService
      .markInstallmentPaid(adv.id, installment.id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.advance.set(res.data);
          this.paymentLoading.set(false);
          this.toastService.show({
            variant: 'success',
            description: `Cuota #${installment.installment_number} pagada`,
          });
          this.updated.emit();
        },
        error: () => {
          this.paymentLoading.set(false);
          this.toastService.show({
            variant: 'error',
            description: 'Error al pagar cuota',
          });
        },
      });
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
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }

  getFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      monthly: 'Mensual',
      biweekly: 'Quincenal',
      weekly: 'Semanal',
    };
    return labels[frequency] || frequency || '-';
  }

  getProgressPercent(): number {
    const adv = this.advance();
    if (!adv || !Number(adv.amount_approved)) return 0;
    return Math.min(
      100,
      Math.round((Number(adv.amount_paid) / Number(adv.amount_approved)) * 100),
    );
  }

  getPaidInstallments(): number {
    return (
      this.advance()?.advance_installments?.filter((i) => i.status === 'paid')
        .length || 0
    );
  }

  getInstallmentLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      paid: 'Pagada',
      overdue: 'Vencida',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getPaymentTypeLabel(type: string): string {
    return type === 'manual' ? 'Manual' : 'Nómina';
  }
}
