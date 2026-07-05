import {
  Component,
  input,
  output,
  signal,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PayrollService } from '../../../services/payroll.service';
import { PayrollSettlement } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { StepsLineComponent } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import {
  BadgeComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../../shared/components';
import type { StepsLineItem, BadgeVariant } from '../../../../../../../shared/components';
import {
  getSettlementContractLabel,
  getSettlementReasonLabel,
  getSettlementStatusBadgeVariant,
  getSettlementStatusLabel,
} from '../settlement-labels';

interface BreakdownRow {
  concept: string;
  amount: number;
}

@Component({
  selector: 'app-settlement-detail',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
    BadgeComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="settlement()?.settlement_number || 'Detalle de Liquidacion'"
      [subtitle]="settlement()?.employee ? (settlement()!.employee.first_name + ' ' + settlement()!.employee.last_name) : ''"
      size="xl"
      >
      <!-- Header slot: badge de estado -->
      @if (settlement(); as s) {
        <app-badge slot="header" [variant]="statusVariant(s.status)" size="sm">
          {{ statusLabel(s.status) }}
        </app-badge>
      }

      @if (settlement(); as s) {
        <div class="space-y-4">
          <!-- 1. STEPS LINE -->
          <app-steps-line
            [steps]="statusSteps"
            [currentStep]="currentStatusIndex"
            size="sm"
            orientation="horizontal"
          ></app-steps-line>
          <!-- 2. EMPLOYEE INFO -->
          @if (s.employee) {
            <div class="p-3 bg-[var(--color-surface-secondary)] rounded-lg">
              <h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Empleado</h3>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <span class="text-xs text-text-secondary block">Nombre</span>
                  <span class="text-sm font-medium text-text-primary">{{ s.employee.first_name }} {{ s.employee.last_name }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Documento</span>
                  <span class="text-sm font-medium text-text-primary">{{ s.employee.document_number }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Cargo</span>
                  <span class="text-sm font-medium text-text-primary">{{ s.employee.position || '-' }}</span>
                </div>
              </div>
            </div>
          }
          <!-- 3. EMPLOYMENT INFO -->
          <div class="p-3 bg-[var(--color-surface-secondary)] rounded-lg grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="text-xs text-text-secondary block">Fecha Ingreso</span>
              <span class="text-sm font-medium text-text-primary">{{ formatDate(s.hire_date) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Fecha Terminacion</span>
              <span class="text-sm font-medium text-text-primary">{{ formatDate(s.termination_date) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Dias Trabajados</span>
              <span class="text-sm font-medium text-text-primary">{{ s.days_worked }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Motivo</span>
              <span class="text-sm font-medium text-text-primary">{{ reasonLabel(s.termination_reason) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Tipo Contrato</span>
              <span class="text-sm font-medium text-text-primary">{{ contractLabel(s.contract_type) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Salario Base</span>
              <span class="text-sm font-medium text-text-primary">{{ formatNumber(s.base_salary) }}</span>
            </div>
          </div>
          <!-- 4. PRESTACIONES SOCIALES -->
          <div>
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Prestaciones Sociales</h3>
            <app-responsive-data-view
              [data]="prestacionesRows()"
              [columns]="breakdownColumns"
              [cardConfig]="breakdownCardConfig"
              [bordered]="true"
              [compact]="true"
              [hoverable]="false"
            ></app-responsive-data-view>
          </div>
          <!-- 5. CALCULATION BREAKDOWN -->
          <div class="p-3 bg-[var(--color-info-light)] rounded-lg">
            <h3 class="text-xs font-bold text-[var(--color-info)] uppercase tracking-wider mb-2">
              Como se Calcula
            </h3>
            <div class="space-y-1.5 text-xs text-text-secondary">
              <p><span class="font-semibold text-text-primary">Cesantias:</span> Salario &times; Dias trabajados &divide; 360</p>
              <p><span class="font-semibold text-text-primary">Intereses Cesantias:</span> Cesantias &times; Dias trabajados &times; 12% &divide; 360</p>
              <p><span class="font-semibold text-text-primary">Prima:</span> Salario &times; Dias trabajados en semestre &divide; 360</p>
              <p><span class="font-semibold text-text-primary">Vacaciones:</span> Salario &times; Dias trabajados &divide; 720</p>
              @if (s.indemnification > 0) {
                <p><span class="font-semibold text-text-primary">Indemnizacion:</span> Aplica por despido sin justa causa segun tipo de contrato</p>
              }
            </div>
          </div>
          <!-- 6. DEDUCTIONS -->
          <div>
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Deducciones</h3>
            <app-responsive-data-view
              [data]="deduccionesRows()"
              [columns]="breakdownColumns"
              [cardConfig]="breakdownCardConfig"
              [bordered]="true"
              [compact]="true"
              [hoverable]="false"
            ></app-responsive-data-view>
          </div>
          <!-- 7. TOTALS -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="p-3 bg-[var(--color-info-light)] rounded-lg">
              <span class="text-xs text-[var(--color-info)] block">Total Bruto</span>
              <span class="text-lg font-bold text-[var(--color-info)]">{{ formatNumber(s.gross_settlement) }}</span>
            </div>
            <div class="p-3 bg-[var(--color-error-light)] rounded-lg">
              <span class="text-xs text-[var(--color-error)] block">Total Deducciones</span>
              <span class="text-lg font-bold text-[var(--color-error)]">{{ formatNumber(s.total_deductions) }}</span>
            </div>
            <div class="p-3 bg-[var(--color-success-light)] rounded-lg">
              <span class="text-xs text-[var(--color-success)] block">NETO A PAGAR</span>
              <span class="text-xl font-bold text-[var(--color-success)]">{{ formatNumber(s.net_settlement) }}</span>
            </div>
          </div>
          <!-- 8. NOTES -->
          @if (s.notes) {
            <div class="p-3 bg-[var(--color-warning-light)] rounded-lg">
              <h3 class="text-xs font-bold text-[var(--color-warning)] uppercase tracking-wider mb-1">Notas</h3>
              <p class="text-sm text-text-secondary">{{ s.notes }}</p>
            </div>
          }
          <!-- 9. CANCEL WITH DOUBLE CONFIRMATION -->
          @if (s.status !== 'paid' && s.status !== 'cancelled') {
            <div class="mt-4 pt-4 border-t border-border">
              @if (cancelConfirmStep === 0) {
                <button (click)="cancelConfirmStep = 1"
                  class="text-xs text-[var(--color-error)] hover:opacity-80 underline underline-offset-2 transition-opacity">
                  Cancelar esta liquidacion
                </button>
              }
              @if (cancelConfirmStep === 1) {
                <div class="p-3 bg-[var(--color-error-light)] rounded-xl border border-[var(--color-error)]">
                  <p class="text-sm font-semibold text-[var(--color-error)]">Cancelar liquidacion {{ s.settlement_number }}</p>
                  <p class="text-xs text-text-secondary mt-1">Esta accion no se puede deshacer.</p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="cancelConfirmStep = 2">
                      Si, quiero cancelar
                    </app-button>
                    <app-button variant="ghost" size="sm" (clicked)="cancelConfirmStep = 0">
                      No, volver
                    </app-button>
                  </div>
                </div>
              }
              @if (cancelConfirmStep === 2) {
                <div class="p-3 bg-[var(--color-error-light)] rounded-xl border-2 border-[var(--color-error)]">
                  <p class="text-sm font-bold text-[var(--color-error)]">Confirmacion final</p>
                  <p class="text-xs text-text-secondary mt-1">
                    Presione "Confirmar cancelacion" para cancelar definitivamente la liquidacion {{ s.settlement_number }}.
                  </p>
                  <div class="flex items-center gap-2 mt-3">
                    <app-button variant="danger" size="sm" (clicked)="onCancel(); cancelConfirmStep = 0" [loading]="actionLoading()">
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

      <!-- FOOTER -->
      <div slot="footer">
        <div class="flex items-center justify-between gap-3 w-full">
          <!-- Left: close -->
          <app-button variant="outline-danger" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>

          <!-- Right: action buttons -->
          <div class="flex items-center gap-2">
            @if (settlement()?.status === 'paid' || settlement()?.status === 'calculated' || settlement()?.status === 'approved') {
              <app-button
                variant="outline" size="sm"
                (clicked)="onDownloadPdf()" [loading]="downloadLoading()">
                <app-icon slot="icon" name="download" [size]="14"></app-icon>
                <span class="ml-1">PDF</span>
              </app-button>
            }

            @if (settlement()?.status === 'calculated' || settlement()?.status === 'draft') {
              <app-button variant="outline" size="sm" (clicked)="onRecalculate()" [loading]="actionLoading()">
                Recalcular
              </app-button>
            }

            @if (settlement()?.status === 'calculated') {
              <app-button variant="success" size="sm" (clicked)="onApprove()" [loading]="actionLoading()">
                Aprobar
              </app-button>
            }

            @if (settlement()?.status === 'approved') {
              <app-button variant="success" size="sm" (clicked)="onPay()" [loading]="actionLoading()">
                Pagar
              </app-button>
            }
          </div>
        </div>
      </div>
    </app-modal>
    ` })
export class SettlementDetailComponent {
  readonly isOpen = input(false);
  readonly settlement = input<PayrollSettlement | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly updated = output<void>();

  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);
  actionLoading = signal(false);
  downloadLoading = signal(false);
  cancelConfirmStep: 0 | 1 | 2 = 0;

  // ── StepsLine ─────────────────────────────────────────
  statusSteps: StepsLineItem[] = [
    { label: 'Borrador' },
    { label: 'Calculada' },
    { label: 'Aprobada' },
    { label: 'Pagada' },
  ];

  get currentStatusIndex(): number {
    const status = this.settlement()?.status;
    const map: Record<string, number> = { draft: 0, calculated: 1, approved: 2, paid: 3, cancelled: -1 };
    return map[status || 'draft'] ?? 0;
  }

  // ── Breakdown tables (desktop table + mobile cards) ───
  readonly breakdownColumns: TableColumn[] = [
    { key: 'concept', label: 'Concepto' },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      transform: (v: any) => this.formatNumber(v),
    },
  ];

  readonly breakdownCardConfig: ItemListCardConfig = {
    titleKey: 'concept',
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerTransform: (v: any) => this.formatNumber(v),
  };

  readonly prestacionesRows = computed<BreakdownRow[]>(() => {
    const s = this.settlement();
    if (!s) return [];
    const rows: BreakdownRow[] = [
      { concept: 'Cesantias', amount: Number(s.severance) || 0 },
      { concept: 'Intereses sobre Cesantias', amount: Number(s.severance_interest) || 0 },
      { concept: 'Prima de Servicios', amount: Number(s.bonus) || 0 },
      { concept: 'Vacaciones', amount: Number(s.vacation) || 0 },
      { concept: 'Salario Pendiente', amount: Number(s.pending_salary) || 0 },
    ];
    if (Number(s.indemnification) > 0) {
      rows.push({ concept: 'Indemnizacion', amount: Number(s.indemnification) });
    }
    return rows;
  });

  readonly deduccionesRows = computed<BreakdownRow[]>(() => {
    const s = this.settlement();
    if (!s) return [];
    const rows: BreakdownRow[] = [
      { concept: 'Salud', amount: Number(s.health_deduction) || 0 },
      { concept: 'Pension', amount: Number(s.pension_deduction) || 0 },
    ];
    if (Number(s.other_deductions) > 0) {
      rows.push({ concept: 'Otras Deducciones', amount: Number(s.other_deductions) });
    }
    return rows;
  });

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  onRecalculate(): void {
    if (!this.settlement()) return;
    this.actionLoading.set(true);
    this.payrollService.recalculateSettlement(this.settlement()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'success', description: 'Liquidacion recalculada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al recalcular' });
        } });
  }

  onApprove(): void {
    if (!this.settlement()) return;
    this.actionLoading.set(true);
    this.payrollService.approveSettlement(this.settlement()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'success', description: 'Liquidacion aprobada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al aprobar' });
        } });
  }

  onPay(): void {
    if (!this.settlement()) return;
    this.actionLoading.set(true);
    this.payrollService.paySettlement(this.settlement()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'success', description: 'Liquidacion pagada y contrato terminado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al pagar' });
        } });
  }

  onCancel(): void {
    if (!this.settlement()) return;
    this.actionLoading.set(true);
    this.payrollService.cancelSettlement(this.settlement()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'success', description: 'Liquidacion cancelada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al cancelar' });
        } });
  }

  onDownloadPdf(): void {
    if (!this.settlement()) return;
    this.downloadLoading.set(true);
    this.payrollService.getSettlementPayslip(this.settlement()!.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `liquidacion-${this.settlement()!.settlement_number}.pdf`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.downloadLoading.set(false);
        },
        error: () => {
          this.downloadLoading.set(false);
          this.toastService.show({ variant: 'error', description: 'Error al descargar PDF' });
        } });
  }

  onClose(): void {
    this.cancelConfirmStep = 0;
    this.isOpenChange.emit(false);
  }

  statusLabel(status: string): string {
    return getSettlementStatusLabel(status);
  }

  statusVariant(status: string): BadgeVariant {
    return getSettlementStatusBadgeVariant(status);
  }

  reasonLabel(reason: string): string {
    return getSettlementReasonLabel(reason);
  }

  contractLabel(type: string): string {
    return getSettlementContractLabel(type);
  }
}
