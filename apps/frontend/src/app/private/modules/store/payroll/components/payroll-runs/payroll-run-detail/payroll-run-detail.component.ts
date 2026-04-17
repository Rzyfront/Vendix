import {
  Component,
  input,
  output,
  inject,
  effect,
  DestroyRef,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Subject } from 'rxjs';
import { take, timeout, takeUntil } from 'rxjs/operators';
import {
  calculatePayrollRun,
  calculatePayrollRunSuccess,
  approvePayrollRun,
  approvePayrollRunSuccess,
  sendPayrollRun,
  sendPayrollRunSuccess,
  payPayrollRun,
  payPayrollRunSuccess,
  cancelPayrollRun,
  calculatePayrollRunFailure,
  approvePayrollRunFailure,
  sendPayrollRunFailure,
  payPayrollRunFailure,
} from '../../../state/actions/payroll.actions';
import { PayrollRun, PayrollItem } from '../../../interfaces/payroll.interface';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  StepsLineComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../../shared/components';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  StepsLineItem,
  ButtonVariant,
} from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PayrollItemDetailComponent } from '../payroll-item-detail/payroll-item-detail.component';

@Component({
  selector: 'vendix-payroll-run-detail',
  standalone: true,
  imports: [
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    ResponsiveDataViewComponent,
    PayrollItemDetailComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="payrollRun()?.payroll_number || 'Detalle de Nomina'"
      [subtitle]="payrollRun() ? getFrequencyLabel(payrollRun()!.frequency) : ''"
      size="xl"
    >
      <!-- Header slot: icono de nómina -->
      @if (payrollRun()) {
        <div slot="header"
             class="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex-shrink-0">
          <app-icon name="banknote" [size]="18"></app-icon>
        </div>
      }

      <!-- Header-end slot: badge de estado -->
      @if (payrollRun()) {
        <span slot="header-end"
              [class]="getStatusBadgeClass(payrollRun()!.status)"
              class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap">
          {{ getStatusLabel(payrollRun()!.status) }}
        </span>
      }

      @if (payrollRun()) {
        <div class="space-y-4">

          <!-- 1. STEPS LINE -->
          <app-steps-line
            [steps]="statusSteps"
            [currentStep]="currentStatusIndex"
            size="sm"
            orientation="horizontal"
          ></app-steps-line>

          <!-- 3. PERIODO INFO -->
          <div class="p-3 bg-[var(--color-background)] rounded-lg grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Inicio del Periodo</span>
              <span class="text-sm font-medium">{{ payrollRun()!.period_start | date:'dd/MM/yyyy' }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Fin del Periodo</span>
              <span class="text-sm font-medium">{{ payrollRun()!.period_end | date:'dd/MM/yyyy' }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Fecha de Pago</span>
              <span class="text-sm font-medium">{{ payrollRun()!.payment_date ? (payrollRun()!.payment_date | date:'dd/MM/yyyy') : 'Sin definir' }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Items</span>
              <span class="text-sm font-medium">{{ payrollRun()!.items?.length || 0 }} empleados</span>
            </div>
          </div>

          <!-- 4. RESUMEN TOTALES -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <span class="text-xs text-blue-600 block">Total Devengado</span>
              <span class="text-lg font-bold text-blue-800">{{ formatNumber(payrollRun()!.total_earnings) }}</span>
            </div>
            <div class="p-3 bg-red-50 rounded-lg border border-red-100">
              <span class="text-xs text-red-600 block">Total Deducciones</span>
              <span class="text-lg font-bold text-red-800">{{ formatNumber(payrollRun()!.total_deductions) }}</span>
            </div>
            <div class="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
              <span class="text-xs text-yellow-600 block">Costo Empleador</span>
              <span class="text-lg font-bold text-yellow-800">{{ formatNumber(payrollRun()!.total_employer_costs) }}</span>
            </div>
            <div class="p-3 bg-green-50 rounded-lg border border-green-100">
              <span class="text-xs text-green-600 block">Neto a Pagar</span>
              <span class="text-lg font-bold text-green-800">{{ formatNumber(payrollRun()!.total_net_pay) }}</span>
            </div>
          </div>

          <!-- 5. DESGLOSE POR EMPLEADO -->
          @if (payrollRun()!.items && payrollRun()!.items!.length > 0) {
            <div>
              <h3 class="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
                Desglose por Empleado
              </h3>
              <app-responsive-data-view
                [data]="employeeTableData()"
                [columns]="employeeColumns"
                [cardConfig]="employeeCardConfig"
                tableSize="sm"
                [hoverable]="true"
                (rowClick)="onEmployeeClick($event)"
                emptyMessage="No hay empleados en esta nomina"
              ></app-responsive-data-view>
            </div>
          }

          <!-- 6. EMPTY STATE (contextual segun status) -->
          @if (!payrollRun()!.items || payrollRun()!.items!.length === 0) {
            <div class="text-center py-8 text-[var(--color-text-secondary)]">
              @if (payrollRun()!.status === 'draft') {
                <p class="text-sm">Esta nomina aun no ha sido calculada</p>
                <p class="text-xs mt-1">Presione "Calcular Nomina" para generar el desglose por empleado</p>
              } @else {
                <p class="text-sm">No se encontro el desglose por empleado</p>
                <p class="text-xs mt-1">El detalle de empleados no esta disponible para esta nomina</p>
              }
            </div>
          }

          <!-- 7. PROCESAMIENTO COMPLETO (en body, al final del scroll) -->
          @if (showQuickProcess && !fastTracking()) {
            <div class="mt-6 pt-4 border-t border-[var(--color-border)]">
              <label class="flex items-start gap-3 p-3 rounded-xl cursor-pointer select-none transition-all"
                     [class]="quickProcessEnabled
                       ? 'bg-[var(--color-primary)]/10 border-2 border-[var(--color-primary)]/30'
                       : 'bg-[var(--color-background)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/20'">
                <input type="checkbox"
                       [checked]="quickProcessEnabled"
                       (change)="quickProcessEnabled = $any($event.target).checked"
                       class="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]" />
                <div>
                  <p class="text-sm font-semibold text-[var(--color-text-primary)]">Procesamiento completo</p>
                  <p class="text-xs text-[var(--color-text-secondary)] mt-1">
                    Al activar, la nomina se procesara automaticamente en los siguientes pasos:
                  </p>
                  <p class="text-xs font-medium text-[var(--color-primary)] mt-1">
                    {{ remainingStepsDescription }}
                  </p>
                  <p class="text-[11px] text-[var(--color-text-secondary)] mt-1">
                    Cada paso sera ejecutado secuencialmente. Si alguno falla, el proceso se detendra en ese punto.
                  </p>
                </div>
              </label>
            </div>
          }

          <!-- 8. CANCELAR NOMINA (en body, al final, con doble confirmacion) -->
          @if (canProcess && payrollRun()!.status !== 'draft') {
            <div class="mt-4 pt-4 border-t border-[var(--color-border)]">
              @if (!cancelConfirmStep) {
                <button (click)="cancelConfirmStep = 1"
                        class="text-xs text-red-400 hover:text-red-600 underline underline-offset-2 transition-colors">
                  Cancelar esta nomina
                </button>
              } @else if (cancelConfirmStep === 1) {
                <div class="p-3 bg-red-50 rounded-xl border border-red-200">
                  <p class="text-sm font-semibold text-red-700">Cancelar nomina {{ payrollRun()!.payroll_number }}</p>
                  <p class="text-xs text-red-600 mt-1">
                    Esta accion no se puede deshacer. Todos los asientos contables asociados permaneceran registrados.
                  </p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="cancelConfirmStep = 2">
                      Si, quiero cancelar
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="cancelConfirmStep = 0">
                      No, volver
                    </app-button>
                  </div>
                </div>
              } @else if (cancelConfirmStep === 2) {
                <div class="p-3 bg-red-100 rounded-xl border-2 border-red-300">
                  <p class="text-sm font-bold text-red-800">Confirmacion final</p>
                  <p class="text-xs text-red-700 mt-1">
                    Presione "Confirmar cancelacion" para cancelar definitivamente la nomina {{ payrollRun()!.payroll_number }}.
                  </p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="onCancelPayroll(); cancelConfirmStep = 0" [loading]="loading()">
                      Confirmar cancelacion
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="cancelConfirmStep = 0">
                      No, volver
                    </app-button>
                  </div>
                </div>
              }
            </div>
          }

        </div>
      }

      <!-- FOOTER (solo botones de accion y cerrar) -->
      <div slot="footer">
        <div class="flex items-center justify-between gap-3 w-full">

          <!-- Izquierda: cerrar -->
          <app-button variant="outline-danger" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>

          <!-- Derecha: accion principal -->
          <div class="flex items-center gap-2">
            @if (fastTracking()) {
              <div class="flex items-center gap-2 px-3 py-2">
                <div class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin"></div>
                <span class="text-xs font-semibold text-[var(--color-text-primary)]">{{ fastTrackCurrentLabel() }}</span>
              </div>
            } @else if (canProcess) {
              @if (quickProcessEnabled) {
                <app-button variant="primary" (clicked)="onFastTrack()" [loading]="loading()">
                  <app-icon name="zap" [size]="16" class="mr-1"></app-icon>
                  Procesar Completo
                </app-button>
              } @else {
                <app-button [variant]="nextStepVariant" (clicked)="onNextStep()" [loading]="loading()">
                  {{ nextStepLabel }}
                </app-button>
              }
            }
          </div>

        </div>
      </div>
    </app-modal>

    <!-- Sub-modal de detalle por empleado -->
    <vendix-payroll-item-detail
      [isOpen]="employeeDetailOpen"
      [item]="selectedItem"
      (isOpenChange)="employeeDetailOpen = $event"
    ></vendix-payroll-item-detail>
  `,
})
export class PayrollRunDetailComponent {
  readonly isOpen = input<boolean>(false);
  readonly payrollRun = input<PayrollRun | null>(null);
  readonly isOpenChange = output<boolean>();

  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);
private fastTrackCancel$ = new Subject<void>();

  // ── StepsLine ─────────────────────────────────────────
  statusSteps: StepsLineItem[] = [
    { label: 'Borrador' },
    { label: 'Calculada' },
    { label: 'Aprobada' },
    { label: 'Enviada' },
    { label: 'Pagada' },
  ];
  currentStatusIndex = 0;

  // ── Quick process ─────────────────────────────────────
  quickProcessEnabled = false;
  readonly loading = signal(false);

  // ── Fast-track state ──────────────────────────────────
  readonly fastTracking = signal(false);
  readonly fastTrackCurrentLabel = signal('');

  // ── Cancel confirmation (0=hidden, 1=first confirm, 2=final confirm) ──
  cancelConfirmStep: 0 | 1 | 2 = 0;

  // ── Employee detail sub-modal ─────────────────────────
  employeeDetailOpen = false;
  selectedItem: PayrollItem | null = null;

  // ── ResponsiveDataView ────────────────────────────────
  readonly employeeTableData = signal<any[]>([]);

  employeeColumns: TableColumn[] = [
    {
      key: 'employee_name',
      label: 'Empleado',
      sortable: false,
    },
    {
      key: 'base_salary_fmt',
      label: 'Salario Base',
      align: 'right',
    },
    {
      key: 'worked_days',
      label: 'Dias',
      align: 'center',
    },
    {
      key: 'total_earnings_fmt',
      label: 'Devengado',
      align: 'right',
      cellClass: () => 'text-blue-600',
    },
    {
      key: 'total_deductions_fmt',
      label: 'Deducciones',
      align: 'right',
      cellClass: () => 'text-red-600',
    },
    {
      key: 'net_pay_fmt',
      label: 'Neto',
      align: 'right',
      cellClass: () => 'font-semibold text-green-600',
    },
  ];

  employeeCardConfig: ItemListCardConfig = {
    titleKey: 'employee_name',
    subtitleKey: 'worked_days_label',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'net_pay_fmt',
    detailKeys: [
      { key: 'total_earnings_fmt', label: 'Devengado' },
      { key: 'total_deductions_fmt', label: 'Deducciones' },
    ],
    footerKey: 'net_pay_fmt',
    footerLabel: 'Neto a Pagar',
    footerStyle: 'prominent',
  };

  // ── Step config ───────────────────────────────────────
  private readonly STEPS_ORDER = ['draft', 'calculated', 'approved', 'sent', 'paid'] as const;
  private readonly STEP_CONFIG: Record<string, { label: string }> = {
    draft: { label: 'Calculando nomina...' },
    calculated: { label: 'Aprobando...' },
    approved: { label: 'Enviando...' },
    sent: { label: 'Registrando pago...' },
  };

  private readonly FAST_TRACK_TIMEOUT = 30_000;

  // ── Lifecycle ─────────────────────────────────────────

  constructor() {
    effect(() => {
      const run = this.payrollRun();
      this.updateStatusIndex();
      this.rebuildTableData();
    });

    this.destroyRef.onDestroy(() => {
      this.fastTrackCancel$.next();
      this.fastTrackCancel$.complete();
    });
  }

  // ── Computed getters ──────────────────────────────────

  get showQuickProcess(): boolean {
    const run = this.payrollRun();
    if (!run) return false;
    const remaining = this.getRemainingSteps(run.status);
    return remaining.length > 1;
  }

  get remainingStepsDescription(): string {
    const run = this.payrollRun();
    if (!run) return '';
    const remaining = this.getRemainingSteps(run.status);
    return remaining.map(s => this.getStepActionLabel(s)).join(' \u2192 ');
  }

  get canProcess(): boolean {
    const run = this.payrollRun();
    return !!run && !['paid', 'cancelled'].includes(run.status);
  }

  get nextStepLabel(): string {
    const run = this.payrollRun();
    if (!run) return '';
    const labels: Record<string, string> = {
      draft: 'Calcular Nomina',
      calculated: 'Aprobar',
      approved: 'Enviar',
      sent: 'Marcar Pagada',
      accepted: 'Marcar Pagada',
    };
    return labels[run.status] || '';
  }

  get nextStepVariant(): ButtonVariant {
    const run = this.payrollRun();
    if (!run) return 'primary';
    const variants: Record<string, ButtonVariant> = {
      draft: 'primary',
      calculated: 'success',
      approved: 'primary',
      sent: 'success',
      accepted: 'success',
    };
    return variants[run.status] || 'primary';
  }

  // ── Employee detail ───────────────────────────────────

  onEmployeeClick(row: any): void {
    // Find the original PayrollItem from the row's _originalItem reference
    this.selectedItem = row._originalItem || null;
    this.employeeDetailOpen = true;
  }

  // ── Step actions ──────────────────────────────────────

  onNextStep(): void {
    const run = this.payrollRun();
    if (!run) return;
    this.loading.set(true);
    const status = run.status;
    const id = run.id;

    const actionMap: Record<string, () => void> = {
      draft: () => this.store.dispatch(calculatePayrollRun({ id })),
      calculated: () => this.store.dispatch(approvePayrollRun({ id })),
      approved: () => this.store.dispatch(sendPayrollRun({ id })),
      sent: () => this.store.dispatch(payPayrollRun({ id })),
      accepted: () => this.store.dispatch(payPayrollRun({ id })),
    };

    const dispatchFn = actionMap[status];
    if (dispatchFn) {
      // Listen for success/failure to reset loading
      const successFailureMap = this.getSuccessFailureActions(status);
      if (successFailureMap) {
        this.actions$.pipe(
          ofType(successFailureMap.success, successFailureMap.failure),
          take(1),
          takeUntilDestroyed(this.destroyRef),
        ).subscribe(() => {
          this.loading.set(false);
        });
      }
      dispatchFn();
    } else {
      this.loading.set(false);
    }
  }

  onCancelPayroll(): void {
    const run = this.payrollRun();
    if (run) {
      this.store.dispatch(cancelPayrollRun({ id: run.id }));
    }
  }

  // ── Fast-track ────────────────────────────────────────

  onFastTrack(): void {
    const run = this.payrollRun();
    if (!run) return;
    this.fastTracking.set(true);
    this.loading.set(true);
    // Do NOT recreate fastTrackCancel$ — just signal to cancel previous subscriptions
    this.fastTrackCancel$.next();
    this.dispatchNextStep(run.status, run.id);
  }

  private dispatchNextStep(currentStatus: string, id: number): void {
    const config = this.STEP_CONFIG[currentStatus];
    if (!config) {
      this.stopFastTrack();
      return;
    }

    this.fastTrackCurrentLabel.set(config.label);

    const successFailure = this.getSuccessFailureActions(currentStatus);
    if (!successFailure) {
      this.stopFastTrack();
      return;
    }

    const actionMap: Record<string, any> = {
      draft: calculatePayrollRun({ id }),
      calculated: approvePayrollRun({ id }),
      approved: sendPayrollRun({ id }),
      sent: payPayrollRun({ id }),
    };

    const dispatchAction = actionMap[currentStatus];
    if (!dispatchAction) {
      this.stopFastTrack();
      return;
    }

    const nextStatusMap: Record<string, string> = {
      draft: 'calculated',
      calculated: 'approved',
      approved: 'sent',
      sent: 'paid',
    };

    // Listen for success or failure WITH timeout
    this.actions$.pipe(
      ofType(successFailure.success, successFailure.failure),
      take(1),
      timeout(this.FAST_TRACK_TIMEOUT),
      takeUntil(this.fastTrackCancel$),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (action: any) => {
        if (action.type === successFailure.failure.type) {
          this.stopFastTrack();
          return;
        }

        const nextStatus = nextStatusMap[currentStatus];
        if (nextStatus === 'paid') {
          // All done
          setTimeout(() => this.stopFastTrack(), 500);
        } else {
          this.dispatchNextStep(nextStatus, id);
        }
      },
      error: () => {
        // Timeout or other error
        console.warn('[PayrollRunDetail] Fast-track timeout on step:', currentStatus);
        this.stopFastTrack();
      },
    });

    this.store.dispatch(dispatchAction);
  }

  private stopFastTrack(): void {
    this.fastTracking.set(false);
    this.fastTrackCurrentLabel.set('');
    this.loading.set(false);
    this.fastTrackCancel$.next();
  }

  // ── Helpers ───────────────────────────────────────────

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  getRemainingSteps(status: string): string[] {
    const idx = this.STEPS_ORDER.indexOf(status as any);
    if (idx === -1) return [];
    return this.STEPS_ORDER.slice(idx + 1) as unknown as string[];
  }

  private getStepActionLabel(step: string): string {
    const labels: Record<string, string> = {
      calculated: 'Calcular',
      approved: 'Aprobar',
      sent: 'Enviar',
      paid: 'Pagar',
    };
    return labels[step] || step;
  }

  private updateStatusIndex(): void {
    const run = this.payrollRun();
    const statusMap: Record<string, number> = {
      draft: 0,
      calculated: 1,
      approved: 2,
      sent: 3,
      accepted: 3,
      paid: 4,
      cancelled: -1,
      rejected: -1,
    };
    this.currentStatusIndex = statusMap[run?.status || 'draft'] ?? 0;
  }

  private rebuildTableData(): void {
    const run = this.payrollRun();
    if (!run?.items) {
      this.employeeTableData.set([]);
      return;
    }

    this.employeeTableData.set(run.items.map((item) => ({
      _originalItem: item,
      employee_name: item.employee
        ? `${item.employee.first_name} ${item.employee.last_name}`
        : `Empleado #${item.employee_id}`,
      base_salary_fmt: this.formatNumber(item.base_salary),
      worked_days: item.worked_days,
      worked_days_label: `${item.worked_days} dias`,
      total_earnings_fmt: this.formatNumber(item.total_earnings),
      total_deductions_fmt: this.formatNumber(item.total_deductions),
      total_employer_costs_fmt: this.formatNumber(item.total_employer_costs),
      net_pay_fmt: this.formatNumber(item.net_pay),
    })));
  }

  private getSuccessFailureActions(status: string): { success: any; failure: any } | null {
    const map: Record<string, { success: any; failure: any }> = {
      draft: { success: calculatePayrollRunSuccess, failure: calculatePayrollRunFailure },
      calculated: { success: approvePayrollRunSuccess, failure: approvePayrollRunFailure },
      approved: { success: sendPayrollRunSuccess, failure: sendPayrollRunFailure },
      sent: { success: payPayrollRunSuccess, failure: payPayrollRunFailure },
      accepted: { success: payPayrollRunSuccess, failure: payPayrollRunFailure },
    };
    return map[status] || null;
  }

  onClose(): void {
    this.stopFastTrack();
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      calculated: 'bg-blue-100 text-blue-800',
      approved: 'bg-green-100 text-green-800',
      sent: 'bg-blue-100 text-blue-800',
      accepted: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      paid: 'bg-emerald-100 text-emerald-800',
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
    return labels[frequency] || frequency;
  }
}
