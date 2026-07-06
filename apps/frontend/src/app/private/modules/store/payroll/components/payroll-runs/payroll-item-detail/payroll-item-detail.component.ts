import {
  Component,
  input,
  output,
  inject,
  computed,
  signal,
} from '@angular/core';
import { Store } from '@ngrx/store';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import {
  BadgeComponent,
  type BadgeVariant,
} from '../../../../../../../shared/components/badge/badge.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  PayrollItem,
  OvertimeEarningDetail,
  VacationEarningDetail,
  DisabilityEarningDetail,
  LicenseEarningDetail,
  BonusEarningDetail,
  RetentionDetails,
  DianItemResult,
  DianAdjustmentPayload,
} from '../../../interfaces/payroll.interface';
import { sendAdjustment } from '../../../state/actions/payroll.actions';
import {
  selectDianSendResult,
  selectAdjustmentLoadingByItem,
  selectAdjustmentResultByItem,
} from '../../../state/selectors/payroll.selectors';
import {
  formatDateOnlyUTC,
  toUTCDateString,
} from '../../../../../../../shared/utils/date.util';

interface EntryRow {
  key: string;
  label: string;
  value: number;
}

interface DerivedEntries {
  earningsEntries: EntryRow[];
  deductionsEntries: EntryRow[];
  employerCostsEntries: EntryRow[];
  provisionsEntries: EntryRow[];
  provisionsTotal: number;
  overtimeDetails: OvertimeEarningDetail[];
  vacationDetails: VacationEarningDetail[];
  disabilityDetails: DisabilityEarningDetail[];
  licenseDetails: LicenseEarningDetail[];
  bonusDetails: BonusEarningDetail[];
  otherDeductions: Array<{ description: string; amount: number }>;
  retentionDetails: RetentionDetails | null;
}

const EMPTY_DERIVED: DerivedEntries = {
  earningsEntries: [],
  deductionsEntries: [],
  employerCostsEntries: [],
  provisionsEntries: [],
  provisionsTotal: 0,
  overtimeDetails: [],
  vacationDetails: [],
  disabilityDetails: [],
  licenseDetails: [],
  bonusDetails: [],
  otherDeductions: [],
  retentionDetails: null,
};

@Component({
  selector: 'vendix-payroll-item-detail',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    ExpandableCardComponent,
    BadgeComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="isOpenChange.emit(false)"
      [title]="modalTitle()"
      size="lg"
    >
      @if (item()) {
        <!-- 1. Info del empleado -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 bg-[var(--color-background)] rounded-lg text-xs">
          <div>
            <span class="text-[var(--color-text-secondary)]">Cargo</span>
            <p class="font-medium">{{ item()!.employee?.position || 'N/A' }}</p>
          </div>
          <div>
            <span class="text-[var(--color-text-secondary)]">Departamento</span>
            <p class="font-medium">{{ item()!.employee?.department || 'N/A' }}</p>
          </div>
          <div>
            <span class="text-[var(--color-text-secondary)]">Centro de Costo</span>
            <p class="font-medium">{{ getCostCenterLabel(item()!.employee?.cost_center) }}</p>
          </div>
          <div>
            <span class="text-[var(--color-text-secondary)]">Dias Trabajados</span>
            <p class="font-medium">{{ item()!.worked_days }}/30</p>
          </div>
        </div>

        <!-- 2. Resumen (4 mini-cards con tokens semanticos dark-safe) -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="p-3 rounded-lg text-center bg-[var(--color-info-bg)] border border-[var(--color-border)]">
            <p class="text-[10px] uppercase tracking-wide text-[var(--color-info-text)]">Devengado</p>
            <p class="text-sm font-bold text-[var(--color-info-text)]">{{ formatCurrency(item()!.total_earnings) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center bg-[var(--color-error-bg)] border border-[var(--color-border)]">
            <p class="text-[10px] uppercase tracking-wide text-[var(--color-error-text)]">Deducciones</p>
            <p class="text-sm font-bold text-[var(--color-error-text)]">{{ formatCurrency(item()!.total_deductions) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center bg-[var(--color-warning-bg)] border border-[var(--color-border)]">
            <p class="text-[10px] uppercase tracking-wide text-[var(--color-warning-text)]">Costos Emp.</p>
            <p class="text-sm font-bold text-[var(--color-warning-text)]">{{ formatCurrency(item()!.total_employer_costs) }}</p>
          </div>
          <div class="p-3 rounded-lg text-center bg-[var(--color-success-bg)] border border-[var(--color-border)]">
            <p class="text-[10px] uppercase tracking-wide text-[var(--color-success-text)]">Neto a Pagar</p>
            <p class="text-sm font-bold text-[var(--color-success-text)]">{{ formatCurrency(item()!.net_pay) }}</p>
          </div>
        </div>

        <!-- 2b. NOMINA ELECTRONICA DIAN (por item) -->
        @if (hasDianInfo() || (itemRejected() && runId() != null)) {
          <div class="mb-4 p-3 rounded-lg bg-[var(--color-background)] border border-[var(--color-border)]">
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                Nomina Electronica DIAN
              </span>
              @if (itemDianBadge(); as badge) {
                <app-badge [variant]="badge.variant" size="xs">{{ badge.label }}</app-badge>
              }
            </div>

            @if (itemCune()) {
              <div class="flex items-center justify-between gap-2 text-xs py-0.5">
                <span class="text-[var(--color-text-secondary)]">CUNE</span>
                <span class="font-mono text-[10px] text-[var(--color-text-primary)] break-all text-right">{{ itemCune() }}</span>
              </div>
            }

            @if (dianItemResult()?.message; as msg) {
              <p class="text-[11px] text-[var(--color-text-secondary)] mt-1">{{ msg }}</p>
            }

            @if (adjustmentResult()?.adjustment_result?.message; as adjMsg) {
              <p class="text-[11px] text-[var(--color-text-secondary)] mt-1">Ajuste: {{ adjMsg }}</p>
            }

            <!-- Accion: Nota de ajuste (tipo 103) para items rechazados -->
            @if (itemRejected() && runId() != null) {
              @if (!showAdjustForm()) {
                <div class="mt-2">
                  <app-button variant="outline" size="sm" (clicked)="openAdjustForm()" [loading]="adjustmentLoading()">
                    <app-icon slot="icon" name="file-signature" [size]="14" class="mr-1"></app-icon>
                    Nota de ajuste
                  </app-button>
                </div>
              } @else {
                <div class="mt-2 space-y-2">
                  <div>
                    <label class="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] block mb-1">CUNE predecesor</label>
                    <input type="text"
                           [value]="adjPredecessorCune()"
                           (input)="adjPredecessorCune.set($any($event.target).value)"
                           class="w-full px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]" />
                  </div>
                  <div>
                    <label class="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] block mb-1">Documento predecesor</label>
                    <input type="text"
                           [value]="adjPredecessorDoc()"
                           (input)="adjPredecessorDoc.set($any($event.target).value)"
                           class="w-full px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]" />
                  </div>
                  <div>
                    <label class="text-[10px] uppercase tracking-wide text-[var(--color-text-secondary)] block mb-1">Fecha de generacion</label>
                    <input type="date"
                           [value]="adjPredecessorDate()"
                           (input)="adjPredecessorDate.set($any($event.target).value)"
                           class="w-full px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]" />
                  </div>
                  <div class="flex items-center gap-2">
                    <app-button variant="primary" size="sm"
                                (clicked)="submitAdjustment()"
                                [disabled]="!adjustValid()"
                                [loading]="adjustmentLoading()">
                      Enviar ajuste
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="showAdjustForm.set(false)">
                      Cancelar
                    </app-button>
                  </div>
                </div>
              }
            }
          </div>
        }

        <!-- 3. ExpandableCards por seccion -->
        <div class="space-y-3">
          <!-- Devengados -->
          <app-expandable-card [expanded]="true">
            <div slot="header" class="flex items-center gap-2 flex-1 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <app-icon name="trending-up" [size]="14" class="text-blue-600"></app-icon>
              </div>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">Devengados</span>
              <span class="ml-auto text-sm font-bold text-blue-700">{{ formatCurrency(item()!.total_earnings) }}</span>
            </div>
            <div class="px-4 py-3 space-y-1">
              @for (entry of earningsEntries(); track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (earningsEntries().length === 0 && !hasEarningsDetails()) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
              }

              <!-- Horas extras y recargos -->
              @if (overtimeDetails().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Horas Extras y Recargos</p>
                  @for (entry of overtimeDetails(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">
                        {{ getOvertimeLabel(entry.type) }}
                        <span class="text-[10px]">({{ entry.hours }} h · +{{ entry.percentage }}%)</span>
                      </span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.amount) }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Vacaciones -->
              @if (vacationDetails().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Vacaciones</p>
                  @for (entry of vacationDetails(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">
                        {{ formatDateRange(entry.start_date, entry.end_date) }}
                        <span class="text-[10px]">({{ entry.quantity }} días)</span>
                      </span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.payment) }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Incapacidades -->
              @if (disabilityDetails().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Incapacidades</p>
                  @for (entry of disabilityDetails(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">
                        {{ getDisabilityLabel(entry.type) }} · {{ formatDateRange(entry.start_date, entry.end_date) }}
                        <span class="text-[10px]">({{ entry.quantity }} días)</span>
                      </span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.payment) }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Licencias -->
              @if (licenseDetails().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Licencias</p>
                  @for (entry of licenseDetails(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">
                        {{ getLicenseLabel(entry.type) }} · {{ formatDateRange(entry.start_date, entry.end_date) }}
                        <span class="text-[10px]">({{ entry.quantity }} días)</span>
                      </span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.payment) }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Bonificaciones -->
              @if (bonusDetails().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Bonificaciones</p>
                  @for (entry of bonusDetails(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">Bonificación {{ $index + 1 }}</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.taxable + entry.non_taxable) }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          </app-expandable-card>

          <!-- Deducciones -->
          <app-expandable-card [expanded]="true">
            <div slot="header" class="flex items-center gap-2 flex-1 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                <app-icon name="trending-down" [size]="14" class="text-red-600"></app-icon>
              </div>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">Deducciones</span>
              <span class="ml-auto text-sm font-bold text-red-700">{{ formatCurrency(item()!.total_deductions) }}</span>
            </div>
            <div class="px-4 py-3 space-y-1">
              @for (entry of deductionsEntries(); track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (deductionsEntries().length === 0 && otherDeductions().length === 0) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
              }

              <!-- Otras deducciones (novedades manuales) -->
              @if (otherDeductions().length > 0) {
                <div class="mt-2 pt-2 border-t border-[var(--color-border)]">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1">Otras Deducciones</p>
                  @for (entry of otherDeductions(); track $index) {
                    <div class="flex justify-between items-center text-xs py-1">
                      <span class="text-[var(--color-text-secondary)]">{{ entry.description }}</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.amount) }}</span>
                    </div>
                  }
                </div>
              }

              <!-- Desglose retefuente art. 383 ET -->
              @if (retentionDetails(); as ret) {
                <div class="mt-2 p-3 bg-[var(--color-background)] rounded-lg">
                  <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-2">
                    Retefuente — Art. 383 ET (Procedimiento 1)
                  </p>
                  <div class="space-y-1">
                    <div class="flex justify-between items-center text-xs py-0.5">
                      <span class="text-[var(--color-text-secondary)]">Base depurada</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(ret.base_depurada) }}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs py-0.5">
                      <span class="text-[var(--color-text-secondary)]">Renta exenta (25%)</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(ret.exempt_amount) }}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs py-0.5">
                      <span class="text-[var(--color-text-secondary)]">Base en UVT</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ ret.base_uvt }} UVT</span>
                    </div>
                    <div class="flex justify-between items-center text-xs py-0.5">
                      <span class="text-[var(--color-text-secondary)]">Tarifa marginal</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ getMarginalRatePercent(ret.marginal_rate) }}%</span>
                    </div>
                    <div class="flex justify-between items-center text-xs py-0.5">
                      <span class="text-[var(--color-text-secondary)]">UVT usada</span>
                      <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(ret.uvt_value) }}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs py-0.5 border-t border-[var(--color-border)] mt-1 pt-1">
                      <span class="text-[var(--color-text-secondary)] font-semibold">Retención calculada</span>
                      <span class="font-semibold text-[var(--color-text-primary)]">{{ formatCurrency(ret.retention) }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </app-expandable-card>

          <!-- Costos Empleador -->
          <app-expandable-card>
            <div slot="header" class="flex items-center gap-2 flex-1 min-w-0">
              <div class="w-7 h-7 rounded-lg bg-yellow-100 flex items-center justify-center flex-shrink-0">
                <app-icon name="building" [size]="14" class="text-yellow-600"></app-icon>
              </div>
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">Costos Empleador</span>
              <span class="ml-auto text-sm font-bold text-yellow-700">{{ formatCurrency(item()!.total_employer_costs) }}</span>
            </div>
            <div class="px-4 py-3 space-y-1">
              @for (entry of employerCostsEntries(); track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (employerCostsEntries().length === 0) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
              }
            </div>
          </app-expandable-card>

          <!-- Provisiones (solo si hay datos) -->
          @if (provisionsEntries().length > 0) {
            <app-expandable-card>
              <div slot="header" class="flex items-center gap-2 flex-1 min-w-0">
                <div class="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <app-icon name="coins" [size]="14" class="text-purple-600"></app-icon>
                </div>
                <span class="text-sm font-semibold text-[var(--color-text-primary)]">Provisiones</span>
                <span class="ml-auto text-sm font-bold text-purple-700">{{ formatCurrency(provisionsTotal()) }}</span>
              </div>
              <div class="px-4 py-3 space-y-1">
                @for (entry of provisionsEntries(); track entry.key) {
                  <div class="flex justify-between items-center text-xs py-1">
                    <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                    <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                  </div>
                }
              </div>
            </app-expandable-card>
          }
        </div>
      }

      <div slot="footer">
        <div class="flex justify-end p-3">
          <app-button variant="outline" size="sm" (clicked)="isOpenChange.emit(false)">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PayrollItemDetailComponent {
  readonly isOpen = input<boolean>(false);
  readonly item = input<PayrollItem | null>(null);
  /** Run id — required to dispatch a per-item adjustment note. */
  readonly runId = input<number | null>(null);
  readonly isOpenChange = output<boolean>();

  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);

  // ── DIAN store reads (signals) ────────────────────────
  private readonly dianSendResult = this.store.selectSignal(selectDianSendResult);
  private readonly adjustmentLoadingByItem = this.store.selectSignal(
    selectAdjustmentLoadingByItem,
  );
  private readonly adjustmentResultByItem = this.store.selectSignal(
    selectAdjustmentResultByItem,
  );

  // ── Derived entries (computed, zoneless-safe — reemplaza el effect) ──
  private readonly derived = computed<DerivedEntries>(() => {
    const item = this.item();
    if (!item) return EMPTY_DERIVED;

    const earnings = item.earnings || {};
    const deductions = item.deductions || {};

    let provisionsEntries: EntryRow[] = [];
    let provisionsTotal = 0;
    if (item.provisions) {
      provisionsEntries = this.toEntryRows(item.provisions);
      provisionsTotal =
        item.provisions['total'] ??
        provisionsEntries.reduce((sum, e) => sum + e.value, 0);
    }

    return {
      earningsEntries: this.toEntryRows(item.earnings),
      deductionsEntries: this.toEntryRows(item.deductions),
      employerCostsEntries: this.toEntryRows(item.employer_costs),
      provisionsEntries,
      provisionsTotal,
      overtimeDetails: Array.isArray(earnings.overtime) ? earnings.overtime : [],
      vacationDetails: Array.isArray(earnings.vacations) ? earnings.vacations : [],
      disabilityDetails: Array.isArray(earnings.disabilities)
        ? earnings.disabilities
        : [],
      licenseDetails: Array.isArray(earnings.licenses) ? earnings.licenses : [],
      bonusDetails: Array.isArray(earnings.bonuses) ? earnings.bonuses : [],
      otherDeductions: Array.isArray(deductions.other_deductions)
        ? deductions.other_deductions
        : [],
      retentionDetails:
        deductions.retention_details &&
        typeof deductions.retention_details === 'object'
          ? deductions.retention_details
          : null,
    };
  });

  readonly earningsEntries = computed(() => this.derived().earningsEntries);
  readonly deductionsEntries = computed(() => this.derived().deductionsEntries);
  readonly employerCostsEntries = computed(() => this.derived().employerCostsEntries);
  readonly provisionsEntries = computed(() => this.derived().provisionsEntries);
  readonly provisionsTotal = computed(() => this.derived().provisionsTotal);
  readonly overtimeDetails = computed(() => this.derived().overtimeDetails);
  readonly vacationDetails = computed(() => this.derived().vacationDetails);
  readonly disabilityDetails = computed(() => this.derived().disabilityDetails);
  readonly licenseDetails = computed(() => this.derived().licenseDetails);
  readonly bonusDetails = computed(() => this.derived().bonusDetails);
  readonly otherDeductions = computed(() => this.derived().otherDeductions);
  readonly retentionDetails = computed(() => this.derived().retentionDetails);

  readonly hasEarningsDetails = computed(() => {
    const d = this.derived();
    return (
      d.overtimeDetails.length > 0 ||
      d.vacationDetails.length > 0 ||
      d.disabilityDetails.length > 0 ||
      d.licenseDetails.length > 0 ||
      d.bonusDetails.length > 0
    );
  });

  readonly modalTitle = computed(() => {
    const item = this.item();
    if (!item) return '';
    const emp = item.employee;
    return emp ? `${emp.first_name} ${emp.last_name}` : `Empleado #${item.employee_id}`;
  });

  // ── DIAN per-item derived state ───────────────────────
  readonly dianItemResult = computed<DianItemResult | null>(() => {
    const doc = this.item()?.employee?.document_number;
    const results = this.dianSendResult()?.dian_summary?.item_results;
    if (!doc || !results) return null;
    return results.find((r) => r.employee_document === doc) ?? null;
  });

  readonly adjustmentResult = computed(() => {
    const id = this.item()?.id;
    return id != null ? (this.adjustmentResultByItem()[id] ?? null) : null;
  });

  readonly adjustmentLoading = computed(() => {
    const id = this.item()?.id;
    return id != null ? (this.adjustmentLoadingByItem()[id] ?? false) : false;
  });

  readonly itemCune = computed<string | null>(
    () =>
      this.adjustmentResult()?.adjustment_result?.cune ??
      this.dianItemResult()?.cune ??
      null,
  );

  readonly itemRejected = computed(() => {
    const r = this.dianItemResult();
    return !!r && !r.success;
  });

  readonly hasDianInfo = computed(
    () => this.dianItemResult() !== null || this.adjustmentResult() !== null,
  );

  readonly itemDianBadge = computed<{ label: string; variant: BadgeVariant } | null>(
    () => {
      const adj = this.adjustmentResult();
      if (adj) {
        return adj.adjustment_result?.success
          ? { label: 'Ajuste enviado', variant: 'success' }
          : { label: 'Ajuste fallido', variant: 'error' };
      }
      const r = this.dianItemResult();
      if (!r) return null;
      return r.success
        ? { label: 'Enviado a DIAN', variant: 'success' }
        : { label: 'Rechazado', variant: 'error' };
    },
  );

  // ── Adjustment note form (signal-backed, zoneless-safe) ──
  readonly showAdjustForm = signal(false);
  readonly adjPredecessorCune = signal('');
  readonly adjPredecessorDoc = signal('');
  readonly adjPredecessorDate = signal('');

  readonly adjustValid = computed(
    () =>
      this.adjPredecessorCune().trim() !== '' &&
      this.adjPredecessorDoc().trim() !== '' &&
      this.adjPredecessorDate().trim() !== '',
  );

  formatCurrency(value: number | undefined | null): string {
    return this.currencyService.format(Number(value) || 0);
  }

  getCostCenterLabel(costCenter: string | undefined | null): string {
    if (!costCenter) return 'N/A';
    return this.COST_CENTER_LABELS[costCenter] || costCenter;
  }

  openAdjustForm(): void {
    this.adjPredecessorCune.set(this.dianItemResult()?.cune ?? '');
    this.adjPredecessorDoc.set(this.item()?.employee?.document_number ?? '');
    this.adjPredecessorDate.set(toUTCDateString(new Date()));
    this.showAdjustForm.set(true);
  }

  submitAdjustment(): void {
    const item = this.item();
    const runId = this.runId();
    if (!item || runId == null || !this.adjustValid()) return;
    const payload: DianAdjustmentPayload = {
      predecessor_cune: this.adjPredecessorCune().trim(),
      predecessor_document_number: this.adjPredecessorDoc().trim(),
      predecessor_generation_date: this.adjPredecessorDate(),
      adjustment_type: '1',
    };
    this.store.dispatch(sendAdjustment({ runId, itemId: item.id, payload }));
    this.showAdjustForm.set(false);
  }

  private toEntryRows(obj: Record<string, unknown> | undefined | null): EntryRow[] {
    if (!obj) return [];

    return Object.entries(obj)
      .filter(([key]) => this.ENTRY_LABELS[key] !== null) // exclude "total"
      .filter(([key]) => key !== 'total') // also exclude total even if not in map
      // Detail arrays/objects (overtime, vacations, retention_details, …)
      // render in dedicated sections, not as flat numeric rows.
      .filter(([, value]) => typeof value !== 'object' || value === null)
      .map(([key, value]) => ({
        key,
        label: this.getLabel(key),
        value: Number(value) || 0,
      }));
  }

  formatDateRange(start: string, end: string): string {
    if (!start) return '-';
    const startLabel = formatDateOnlyUTC(start);
    if (end && end !== start) {
      return `${startLabel} — ${formatDateOnlyUTC(end)}`;
    }
    return startLabel;
  }

  getOvertimeLabel(type: string): string {
    return this.OVERTIME_LABELS[type] || type;
  }

  getDisabilityLabel(type: number): string {
    // Códigos DIAN: 1 = común/general, 2 = profesional, 3 = laboral
    const labels: Record<number, string> = {
      1: 'Incapacidad General',
      2: 'Incapacidad Profesional',
      3: 'Incapacidad Laboral',
    };
    return labels[type] || `Incapacidad (${type})`;
  }

  getLicenseLabel(type: string): string {
    const labels: Record<string, string> = {
      remunerada: 'Licencia Remunerada',
      no_remunerada: 'Licencia No Remunerada',
    };
    return labels[type] || type;
  }

  getMarginalRatePercent(rate: number): number {
    // marginal_rate llega como decimal (0.19 = 19%)
    return Math.round(rate * 10000) / 100;
  }

  private getLabel(key: string): string {
    const mapped = this.ENTRY_LABELS[key];
    if (mapped) return mapped;
    // Fallback: capitalize and replace underscores
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /** Códigos DSPNE de horas extras/recargos → etiqueta en español. */
  private readonly OVERTIME_LABELS: Record<string, string> = {
    HED: 'H.E. Diurna',
    HEN: 'H.E. Nocturna',
    HEDDF: 'H.E. Dominical Diurna',
    HENDF: 'H.E. Dominical Nocturna',
    RN: 'Recargo Nocturno',
    RDDF: 'Recargo Dominical',
  };

  private readonly ENTRY_LABELS: Record<string, string | null> = {
    base_salary: 'Salario Base',
    transport_subsidy: 'Auxilio de Transporte',
    health: 'Salud (EPS)',
    pension: 'Pension (AFP)',
    retention: 'Retencion en la Fuente',
    advance_deduction: 'Descuento Anticipos',
    commissions: 'Comisiones',
    arl: 'ARL',
    sena: 'SENA',
    icbf: 'ICBF',
    compensation_fund: 'Caja de Compensacion',
    severance: 'Cesantias',
    severance_interest: 'Intereses de Cesantias',
    vacation: 'Vacaciones',
    bonus: 'Prima de Servicios',
    total: null,
  };

  private readonly COST_CENTER_LABELS: Record<string, string> = {
    operational: 'Operativo',
    administrative: 'Administrativo',
    sales: 'Ventas',
  };
}
