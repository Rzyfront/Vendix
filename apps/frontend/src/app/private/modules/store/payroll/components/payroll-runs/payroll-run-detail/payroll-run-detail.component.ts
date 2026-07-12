import {
  Component,
  input,
  output,
  inject,
  effect,
  computed,
  DestroyRef,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Subject, firstValueFrom } from 'rxjs';
import { timeout, takeUntil } from 'rxjs/operators';
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
  sendToDian,
  sendToDianSuccess,
  sendToDianFailure,
  loadDianStatus,
  loadAvailableBanks,
  validateBankData,
  exportAch,
} from '../../../state/actions/payroll.actions';
import {
  selectDianStatusByRun,
  selectDianLoading,
  selectAvailableBanks,
  selectAvailableBanksLoading,
  selectBankValidationResult,
  selectBankValidationLoading,
  selectBankExportResult,
  selectBankExportLoading,
} from '../../../state/selectors/payroll.selectors';
import {
  PayrollRun,
  PayrollItem,
  PayrollNovelty,
  DianStatusView,
} from '../../../interfaces/payroll.interface';
import { PayrollService } from '../../../services/payroll.service';
import {
  getNoveltyTypeLabel,
  getNoveltyUnit,
} from '../../novelties/novelty-labels';
import {
  formatDateOnlyUTC,
  toUTCDateString,
} from '../../../../../../../shared/utils/date.util';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  BadgeComponent,
  SelectorComponent,
  StepsLineComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../../shared/components';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  StepsLineItem,
  ButtonVariant,
  BadgeVariant,
  SelectorOption,
} from '../../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PayrollItemDetailComponent } from '../payroll-item-detail/payroll-item-detail.component';

@Component({
  selector: 'vendix-payroll-run-detail',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
    SelectorComponent,
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
             class="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)] flex-shrink-0">
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
              <span class="text-sm font-medium">{{ formatDate(payrollRun()!.period_start) }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Fin del Periodo</span>
              <span class="text-sm font-medium">{{ formatDate(payrollRun()!.period_end) }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Fecha de Pago</span>
              <span class="text-sm font-medium">{{ payrollRun()!.payment_date ? formatDate(payrollRun()!.payment_date!) : 'Sin definir' }}</span>
            </div>
            <div>
              <span class="text-xs text-[var(--color-text-secondary)] block">Items</span>
              <span class="text-sm font-medium">{{ payrollRun()!.items?.length || 0 }} empleados</span>
            </div>
          </div>

          <!-- 4. RESUMEN TOTALES -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="p-3 bg-[var(--color-info-light)] rounded-lg border border-[var(--color-info)]">
              <span class="text-xs text-[var(--color-info)] block">Total Devengado</span>
              <span class="text-lg font-bold text-[var(--color-info)]">{{ formatNumber(payrollRun()!.total_earnings) }}</span>
            </div>
            <div class="p-3 bg-error-light rounded-lg border border-error">
              <span class="text-xs text-error block">Total Deducciones</span>
              <span class="text-lg font-bold text-error">{{ formatNumber(payrollRun()!.total_deductions) }}</span>
            </div>
            <div class="p-3 bg-warning-light rounded-lg border border-warning">
              <span class="text-xs text-warning block">Costo Empleador</span>
              <span class="text-lg font-bold text-warning">{{ formatNumber(payrollRun()!.total_employer_costs) }}</span>
            </div>
            <div class="p-3 bg-success-light rounded-lg border border-success">
              <span class="text-xs text-success block">Neto a Pagar</span>
              <span class="text-lg font-bold text-success">{{ formatNumber(payrollRun()!.total_net_pay) }}</span>
            </div>
          </div>

          <!-- 4b. NOMINA ELECTRONICA DIAN + EXPORT BANCARIO (visible desde aprobada) -->
          @if (isDianEligible(payrollRun()!.status)) {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">

              <!-- DIAN electronic payroll (DSPNE) -->
              <div class="p-3 rounded-lg bg-[var(--color-background)] border border-[var(--color-border)]">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <div class="flex items-center gap-2">
                    <app-icon name="landmark" [size]="16" class="text-[var(--color-primary)]"></app-icon>
                    <span class="text-sm font-semibold text-[var(--color-text-primary)]">Nomina Electronica DIAN</span>
                  </div>
                  <app-badge [variant]="dianBadge().variant" size="sm">{{ dianBadge().label }}</app-badge>
                </div>

                @if (dianCune()) {
                  <div class="flex items-center justify-between gap-2 text-xs py-0.5">
                    <span class="text-[var(--color-text-secondary)]">CUNE</span>
                    <span class="font-mono text-[10px] text-[var(--color-text-primary)] break-all text-right">{{ dianCune() }}</span>
                  </div>
                }

                @if (dianStatusView()?.dian_status?.message; as msg) {
                  <p class="text-[11px] text-[var(--color-text-secondary)] mt-1">{{ msg }}</p>
                }

                @if (!dianAccepted()) {
                  <div class="mt-2">
                    <app-button variant="primary" size="sm" (clicked)="onSendDian()" [loading]="dianLoading()">
                      <app-icon slot="icon" name="send" [size]="14" class="mr-1"></app-icon>
                      {{ dianStatusView() ? 'Reenviar a DIAN' : 'Enviar a DIAN' }}
                    </app-button>
                  </div>
                }
              </div>

              <!-- Bank export (ACH) -->
              <div class="p-3 rounded-lg bg-[var(--color-background)] border border-[var(--color-border)]">
                <div class="flex items-center gap-2 mb-2">
                  <app-icon name="banknote" [size]="16" class="text-[var(--color-primary)]"></app-icon>
                  <span class="text-sm font-semibold text-[var(--color-text-primary)]">Export Bancario (ACH)</span>
                </div>

                <div class="space-y-2">
                  <app-button variant="outline" size="sm" (clicked)="onValidateBankData()" [loading]="bankValidationLoading()">
                    <app-icon slot="icon" name="shield-check" [size]="14" class="mr-1"></app-icon>
                    Validar datos bancarios
                  </app-button>

                  @if (bankValidationResult(); as bv) {
                    <div class="text-xs rounded-md p-2 bg-[var(--color-surface)]">
                      <div class="flex items-center gap-3">
                        <span class="text-[var(--color-success)] font-medium">{{ bv.valid.length }} validos</span>
                        <span class="text-[var(--color-error)] font-medium">{{ bv.invalid.length }} con errores</span>
                      </div>
                      @if (bv.invalid.length > 0) {
                        <div class="mt-1 space-y-0.5">
                          @for (inv of bv.invalid; track inv.employee_id) {
                            <div class="flex items-start justify-between gap-2">
                              <span class="text-[var(--color-text-secondary)]">{{ inv.name }}</span>
                              <span class="text-[var(--color-error)] text-[10px] text-right">{{ inv.errors.join(', ') }}</span>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }

                  <app-selector
                    [options]="bankOptions()"
                    placeholder="Selecciona un banco"
                    size="sm"
                    (valueChange)="selectedBank.set($any($event))"
                  ></app-selector>

                  <input type="text"
                         [value]="sourceAccount()"
                         (input)="sourceAccount.set($any($event.target).value)"
                         placeholder="Cuenta origen (opcional)"
                         class="w-full px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]" />

                  <app-button variant="primary" size="sm"
                              (clicked)="onExportAch()"
                              [disabled]="!selectedBank()"
                              [loading]="bankExportLoading()">
                    <app-icon slot="icon" name="download" [size]="14" class="mr-1"></app-icon>
                    Exportar ACH
                  </app-button>

                  @if (bankExportResult(); as be) {
                    <div class="text-xs rounded-md p-2 bg-[var(--color-surface)]">
                      <a [href]="be.download_url" target="_blank" rel="noopener"
                         class="text-[var(--color-primary)] underline underline-offset-2 break-all">
                        {{ be.file_name }}
                      </a>
                      <p class="text-[var(--color-text-secondary)] mt-0.5">
                        {{ be.record_count }} registros · {{ formatNumber(be.total_amount) }}
                      </p>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

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

          <!-- 5b. NOVEDADES APLICADAS (read-only, agrupadas por empleado) -->
          @if (groupedNovelties().length > 0) {
            <div>
              <h3 class="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-3">
                Novedades Aplicadas
              </h3>
              <div class="space-y-3">
                @for (group of groupedNovelties(); track group.key) {
                  <div class="p-3 bg-[var(--color-background)] rounded-lg">
                    <p class="text-xs font-semibold text-[var(--color-text-primary)] mb-2">
                      {{ group.employeeName }}
                    </p>
                    <div class="space-y-1">
                      @for (novelty of group.novelties; track novelty.id) {
                        <div class="flex items-center justify-between gap-2 text-xs py-0.5">
                          <span class="text-[var(--color-text-secondary)]">
                            {{ getNoveltyLabel(novelty) }}
                            <span class="text-[10px]">· {{ getNoveltyDates(novelty) }}</span>
                          </span>
                          <span class="font-medium text-[var(--color-text-primary)] whitespace-nowrap">
                            {{ getNoveltyQuantity(novelty) }}
                          </span>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
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
                     [class]="quickProcessEnabled()
                        ? 'bg-[var(--color-primary-light)] border-2 border-[var(--color-primary)]/30'
                        : 'bg-[var(--color-background)] border border-[var(--color-border)] hover:border-[var(--color-primary)]/20'">
                <input type="checkbox"
                       [checked]="quickProcessEnabled()"
                       (change)="quickProcessEnabled.set($any($event.target).checked)"
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
              @if (!cancelConfirmStep()) {
                <button (click)="cancelConfirmStep.set(1)"
                        class="text-xs text-error hover:text-error underline underline-offset-2 transition-colors">
                  Cancelar esta nomina
                </button>
              } @else if (cancelConfirmStep() === 1) {
                <div class="p-3 bg-error-light rounded-xl border border-error">
                  <p class="text-sm font-semibold text-error">Cancelar nomina {{ payrollRun()!.payroll_number }}</p>
                  <p class="text-xs text-error mt-1">
                    Esta accion no se puede deshacer. Todos los asientos contables asociados permaneceran registrados.
                  </p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="cancelConfirmStep.set(2)">
                      Si, quiero cancelar
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="cancelConfirmStep.set(0)">
                      No, volver
                    </app-button>
                  </div>
                </div>
              } @else if (cancelConfirmStep() === 2) {
                <div class="p-3 bg-error-light rounded-xl border-2 border-error">
                  <p class="text-sm font-bold text-error">Confirmacion final</p>
                  <p class="text-xs text-error mt-1">
                    Presione "Confirmar cancelacion" para cancelar definitivamente la nomina {{ payrollRun()!.payroll_number }}.
                  </p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="onCancelPayroll(); cancelConfirmStep.set(0)" [loading]="loading()">
                      Confirmar cancelacion
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="cancelConfirmStep.set(0)">
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
              @if (quickProcessEnabled()) {
                <app-button variant="primary" (clicked)="onFastTrack()" [loading]="loading()">
                  <app-icon slot="icon" name="zap" [size]="16" class="mr-1"></app-icon>
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
      [isOpen]="employeeDetailOpen()"
      [item]="selectedItem"
      [runId]="payrollRun()?.id ?? null"
      (isOpenChange)="employeeDetailOpen.set($event)"
    ></vendix-payroll-item-detail>
  `,
})
export class PayrollRunDetailComponent {
  readonly isOpen = input<boolean>(false);
  readonly payrollRun = input<PayrollRun | null>(null);
  readonly isOpenChange = output<boolean>();

  private currencyService = inject(CurrencyFormatService);
  private payrollService = inject(PayrollService);
  private store = inject(Store);
  private actions$ = inject(Actions);
  private destroyRef = inject(DestroyRef);
private fastTrackCancel$ = new Subject<void>(); // LEGÍTIMO — cancellation token para fast-track pipeline

  // ── DIAN + Bank export state (NgRx signals) ───────────
  private readonly dianStatusByRun = this.store.selectSignal(selectDianStatusByRun);
  readonly dianLoading = this.store.selectSignal(selectDianLoading);
  private readonly availableBanks = this.store.selectSignal(selectAvailableBanks);
  readonly availableBanksLoading = this.store.selectSignal(selectAvailableBanksLoading);
  readonly bankValidationResult = this.store.selectSignal(selectBankValidationResult);
  readonly bankValidationLoading = this.store.selectSignal(selectBankValidationLoading);
  readonly bankExportResult = this.store.selectSignal(selectBankExportResult);
  readonly bankExportLoading = this.store.selectSignal(selectBankExportLoading);

  /** DIAN status view for the current run (null until fetched). */
  readonly dianStatusView = computed<DianStatusView | null>(() => {
    const id = this.payrollRun()?.id;
    return id != null ? (this.dianStatusByRun()[id] ?? null) : null;
  });

  readonly dianAccepted = computed(
    () => this.dianStatusView()?.dian_status?.status === 'accepted',
  );

  readonly dianCune = computed<string | null>(
    () => this.dianStatusView()?.dian_status?.cune ?? null,
  );

  readonly dianBadge = computed<{ label: string; variant: BadgeVariant }>(() => {
    const status = this.dianStatusView()?.dian_status?.status;
    switch (status) {
      case 'accepted':
        return { label: 'Aceptado', variant: 'success' };
      case 'rejected':
        return { label: 'Rechazado', variant: 'error' };
      case 'error':
        return { label: 'Error', variant: 'error' };
      case 'pending':
        return { label: 'Enviado', variant: 'info' };
      default:
        return { label: 'No enviado', variant: 'neutral' };
    }
  });

  /** Bank options for the ACH selector. */
  readonly bankOptions = computed<SelectorOption[]>(() =>
    this.availableBanks().map((bank) => ({ value: bank.code, label: bank.name })),
  );

  readonly selectedBank = signal<string | null>(null);
  readonly sourceAccount = signal<string>('');

  /** One-shot guard so banks are requested only once per open eligible run. */
  private banksRequested = false;

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
  quickProcessEnabled = signal(false);
  readonly loading = signal(false);

  // ── Fast-track state ──────────────────────────────────
  readonly fastTracking = signal(false);
  readonly fastTrackCurrentLabel = signal('');

  // ── Cancel confirmation (0=hidden, 1=first confirm, 2=final confirm) ──
  readonly cancelConfirmStep = signal<0 | 1 | 2>(0);

  // ── Employee detail sub-modal ─────────────────────────
  readonly employeeDetailOpen = signal(false);
  selectedItem: PayrollItem | null = null;

  // ── ResponsiveDataView ────────────────────────────────
  readonly employeeTableData = signal<any[]>([]);

  // ── Novedades aplicadas (read-only) ───────────────────
  readonly groupedNovelties = signal<
    Array<{ key: string; employeeName: string; novelties: PayrollNovelty[] }>
  >([]);
  /** Evita recargar novedades si el run no cambió de id/estado. */
  private lastNoveltiesKey = '';

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
      cellClass: () => 'text-[var(--color-info)]',
    },
    {
      key: 'total_deductions_fmt',
      label: 'Deducciones',
      align: 'right',
      cellClass: () => 'text-error',
    },
    {
      key: 'net_pay_fmt',
      label: 'Neto',
      align: 'right',
      cellClass: () => 'font-semibold text-success',
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
      this.loadAppliedNovelties(run);
    });

    // Lazily load the ACH bank catalogue once the modal shows a DIAN-eligible run.
    effect(() => {
      const run = this.payrollRun();
      if (
        this.isOpen() &&
        run &&
        this.isDianEligible(run.status) &&
        this.availableBanks().length === 0 &&
        !this.banksRequested
      ) {
        this.banksRequested = true;
        this.store.dispatch(loadAvailableBanks());
      }
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

  // ── Employee detail ──────────────────────────────────

  onEmployeeClick(row: any): void {
    this.selectedItem = row._originalItem || null;
    this.employeeDetailOpen.set(true);
  }

  // ── Step actions ──────────────────────────────────────

  async onNextStep(): Promise<void> {
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
        const actionPromise = firstValueFrom(
          this.actions$.pipe(
            ofType(successFailureMap.success, successFailureMap.failure),
            takeUntilDestroyed(this.destroyRef),
          ),
        );
        dispatchFn();
        try {
          await actionPromise;
        } finally {
          this.loading.set(false);
        }
      } else {
        dispatchFn();
      }
    } else {
      this.loading.set(false);
    }
  }

  onCancelPayroll(): void {
    const run = this.payrollRun();
    if (run) {
      this.store.dispatch(cancelPayrollRun({ id: run.id }));
    }
    this.cancelConfirmStep.set(0);
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

  private async dispatchNextStep(currentStatus: string, id: number): Promise<void> {
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
    const actionPromise = firstValueFrom(
      this.actions$.pipe(
        ofType(successFailure.success, successFailure.failure),
        timeout(this.FAST_TRACK_TIMEOUT),
        takeUntil(this.fastTrackCancel$),
        takeUntilDestroyed(this.destroyRef),
      ),
    );

    this.store.dispatch(dispatchAction);

    try {
      const action: any = await actionPromise;
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
    } catch {
      // Timeout or other error — stop the pipeline gracefully.
      this.stopFastTrack();
    }
  }

  private stopFastTrack(): void {
    this.fastTracking.set(false);
    this.fastTrackCurrentLabel.set('');
    this.loading.set(false);
    this.fastTrackCancel$.next();
  }

  // ── Novedades aplicadas ───────────────────────────────

  /**
   * Carga las novedades aplicadas a este run. El endpoint de novelties no
   * filtra por payroll_run_id, así que se acota por el período del run y se
   * filtra client-side por payroll_run_id.
   */
  private loadAppliedNovelties(run: PayrollRun | null): void {
    if (!run || run.status === 'draft') {
      this.lastNoveltiesKey = '';
      this.groupedNovelties.set([]);
      return;
    }

    const key = `${run.id}:${run.status}`;
    if (key === this.lastNoveltiesKey) return;
    this.lastNoveltiesKey = key;

    this.payrollService
      .getNovelties({
        status: 'applied',
        date_from: toUTCDateString(new Date(run.period_start)),
        date_to: toUTCDateString(new Date(run.period_end)),
        limit: 500,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const runNovelties = (res.data || []).filter(
            (novelty) =>
              novelty.payroll_run_id === run.id ||
              novelty.payroll_run?.id === run.id,
          );
          this.groupedNovelties.set(this.groupByEmployee(runNovelties));
        },
        error: () => this.groupedNovelties.set([]),
      });
  }

  private groupByEmployee(
    novelties: PayrollNovelty[],
  ): Array<{ key: string; employeeName: string; novelties: PayrollNovelty[] }> {
    const groups = new Map<string, { employeeName: string; novelties: PayrollNovelty[] }>();
    for (const novelty of novelties) {
      const key = String(novelty.employee_id);
      if (!groups.has(key)) {
        groups.set(key, {
          employeeName: novelty.employee
            ? `${novelty.employee.first_name} ${novelty.employee.last_name}`
            : `Empleado #${novelty.employee_id}`,
          novelties: [],
        });
      }
      groups.get(key)!.novelties.push(novelty);
    }
    return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }));
  }

  getNoveltyLabel(novelty: PayrollNovelty): string {
    return getNoveltyTypeLabel(novelty.novelty_type);
  }

  getNoveltyDates(novelty: PayrollNovelty): string {
    if (!novelty.date_start) return '-';
    const start = formatDateOnlyUTC(novelty.date_start);
    if (novelty.date_end) {
      return `${start} — ${formatDateOnlyUTC(novelty.date_end)}`;
    }
    return start;
  }

  getNoveltyQuantity(novelty: PayrollNovelty): string {
    const unit = getNoveltyUnit(novelty.novelty_type);
    if (unit === 'hours') {
      return novelty.hours != null ? `${Number(novelty.hours)} h` : '-';
    }
    if (unit === 'days') {
      return novelty.days != null ? `${Number(novelty.days)} días` : '-';
    }
    return novelty.amount != null
      ? this.currencyService.format(Number(novelty.amount))
      : '-';
  }

  // ── Helpers ───────────────────────────────────────────

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  /** UTC-safe date-only formatting (prevents off-by-one on pure dates). */
  formatDate(value: string): string {
    return value ? formatDateOnlyUTC(value) : 'Sin definir';
  }

  // ── DIAN + Bank export actions ────────────────────────

  /** DIAN electronic payroll + bank export are available once the run is approved. */
  isDianEligible(status: string): boolean {
    return ['approved', 'sent', 'accepted', 'rejected', 'paid'].includes(status);
  }

  async onSendDian(): Promise<void> {
    const run = this.payrollRun();
    if (!run) return;
    const runId = run.id;

    const actionPromise = firstValueFrom(
      this.actions$.pipe(
        ofType(sendToDianSuccess, sendToDianFailure),
        takeUntilDestroyed(this.destroyRef),
      ),
    );
    this.store.dispatch(sendToDian({ runId }));

    const action: any = await actionPromise;
    if (action.type === sendToDianSuccess.type) {
      // Kick off the polling loop to reflect acceptance/rejection.
      this.store.dispatch(loadDianStatus({ runId }));
    }
  }

  onValidateBankData(): void {
    const run = this.payrollRun();
    if (!run) return;
    this.store.dispatch(validateBankData({ runId: run.id }));
  }

  onExportAch(): void {
    const run = this.payrollRun();
    const bank = this.selectedBank();
    if (!run || !bank) return;
    const account = this.sourceAccount().trim();
    this.store.dispatch(
      exportAch({
        runId: run.id,
        payload: { bank, source_account: account || undefined },
      }),
    );
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
    const neutral = 'bg-[var(--color-surface-secondary)] text-text-primary';
    const classes: Record<string, string> = {
      draft: neutral,
      calculated: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      approved: 'bg-success-light text-success',
      sent: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      accepted: 'bg-success-light text-success',
      rejected: 'bg-error-light text-error',
      paid: 'bg-success-light text-success',
      cancelled: neutral,
    };
    return classes[status] || neutral;
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
