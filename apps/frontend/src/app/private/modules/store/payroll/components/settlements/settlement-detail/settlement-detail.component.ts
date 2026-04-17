import { Component, input, output, signal, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';


import { PayrollService } from '../../../services/payroll.service';
import { PayrollSettlement } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { StepsLineComponent } from '../../../../../../../shared/components/steps-line/steps-line.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import type { StepsLineItem } from '../../../../../../../shared/components';

@Component({
  selector: 'app-settlement-detail',
  standalone: true,
  imports: [
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    StepsLineComponent,
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
        <span slot="header"
          [class]="getStatusBadgeClass(s.status)"
          class="px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap">
          {{ getStatusLabel(s.status) }}
        </span>
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
            <div class="p-3 bg-gray-50 rounded-lg">
              <h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Empleado</h3>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <span class="text-xs text-text-secondary block">Nombre</span>
                  <span class="text-sm font-medium">{{ s.employee.first_name }} {{ s.employee.last_name }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Documento</span>
                  <span class="text-sm font-medium">{{ s.employee.document_number }}</span>
                </div>
                <div>
                  <span class="text-xs text-text-secondary block">Cargo</span>
                  <span class="text-sm font-medium">{{ s.employee.position || '-' }}</span>
                </div>
              </div>
            </div>
          }
          <!-- 3. EMPLOYMENT INFO -->
          <div class="p-3 bg-gray-50 rounded-lg grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="text-xs text-text-secondary block">Fecha Ingreso</span>
              <span class="text-sm font-medium">{{ s.hire_date | date:'dd/MM/yyyy' }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Fecha Terminacion</span>
              <span class="text-sm font-medium">{{ s.termination_date | date:'dd/MM/yyyy' }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Dias Trabajados</span>
              <span class="text-sm font-medium">{{ s.days_worked }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Motivo</span>
              <span class="text-sm font-medium">{{ getReasonLabel(s.termination_reason) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Tipo Contrato</span>
              <span class="text-sm font-medium">{{ getContractLabel(s.contract_type) }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Salario Base</span>
              <span class="text-sm font-medium">{{ formatNumber(s.base_salary) }}</span>
            </div>
          </div>
          <!-- 4. PRESTACIONES SOCIALES -->
          <div>
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Prestaciones Sociales</h3>
            <div class="bg-surface rounded-lg border border-border overflow-hidden">
              <table class="w-full text-sm">
                <tbody>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Cesantias</td>
                    <td class="py-2 px-3 text-right font-medium">{{ formatNumber(s.severance) }}</td>
                  </tr>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Intereses sobre Cesantias</td>
                    <td class="py-2 px-3 text-right font-medium">{{ formatNumber(s.severance_interest) }}</td>
                  </tr>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Prima de Servicios</td>
                    <td class="py-2 px-3 text-right font-medium">{{ formatNumber(s.bonus) }}</td>
                  </tr>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Vacaciones</td>
                    <td class="py-2 px-3 text-right font-medium">{{ formatNumber(s.vacation) }}</td>
                  </tr>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Salario Pendiente</td>
                    <td class="py-2 px-3 text-right font-medium">{{ formatNumber(s.pending_salary) }}</td>
                  </tr>
                  @if (s.indemnification > 0) {
                    <tr>
                      <td class="py-2 px-3 text-text-secondary">Indemnizacion</td>
                      <td class="py-2 px-3 text-right font-medium text-blue-600">{{ formatNumber(s.indemnification) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <!-- 5. CALCULATION BREAKDOWN -->
          <div class="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
            <h3 class="text-xs font-bold text-indigo-700 uppercase tracking-wider mb-2">
              Como se Calcula
            </h3>
            <div class="space-y-1.5 text-xs text-indigo-800">
              <p><span class="font-semibold">Cesantias:</span> Salario &times; Dias trabajados &divide; 360</p>
              <p><span class="font-semibold">Intereses Cesantias:</span> Cesantias &times; Dias trabajados &times; 12% &divide; 360</p>
              <p><span class="font-semibold">Prima:</span> Salario &times; Dias trabajados en semestre &divide; 360</p>
              <p><span class="font-semibold">Vacaciones:</span> Salario &times; Dias trabajados &divide; 720</p>
              @if (s.indemnification > 0) {
                <p><span class="font-semibold">Indemnizacion:</span> Aplica por despido sin justa causa segun tipo de contrato</p>
              }
            </div>
          </div>
          <!-- 6. DEDUCTIONS -->
          <div>
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Deducciones</h3>
            <div class="bg-surface rounded-lg border border-border overflow-hidden">
              <table class="w-full text-sm">
                <tbody>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Salud</td>
                    <td class="py-2 px-3 text-right font-medium text-red-600">{{ formatNumber(s.health_deduction) }}</td>
                  </tr>
                  <tr class="border-b border-border">
                    <td class="py-2 px-3 text-text-secondary">Pension</td>
                    <td class="py-2 px-3 text-right font-medium text-red-600">{{ formatNumber(s.pension_deduction) }}</td>
                  </tr>
                  @if (s.other_deductions > 0) {
                    <tr>
                      <td class="py-2 px-3 text-text-secondary">Otras Deducciones</td>
                      <td class="py-2 px-3 text-right font-medium text-red-600">{{ formatNumber(s.other_deductions) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <!-- 7. TOTALS -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
              <span class="text-xs text-blue-600 block">Total Bruto</span>
              <span class="text-lg font-bold text-blue-800">{{ formatNumber(s.gross_settlement) }}</span>
            </div>
            <div class="p-3 bg-red-50 rounded-lg border border-red-100">
              <span class="text-xs text-red-600 block">Total Deducciones</span>
              <span class="text-lg font-bold text-red-800">{{ formatNumber(s.total_deductions) }}</span>
            </div>
            <div class="p-3 bg-green-50 rounded-lg border border-green-100">
              <span class="text-xs text-green-600 block">NETO A PAGAR</span>
              <span class="text-xl font-bold text-green-800">{{ formatNumber(s.net_settlement) }}</span>
            </div>
          </div>
          <!-- 8. NOTES -->
          @if (s.notes) {
            <div class="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
              <h3 class="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1">Notas</h3>
              <p class="text-sm text-yellow-800">{{ s.notes }}</p>
            </div>
          }
          <!-- 9. CANCEL WITH DOUBLE CONFIRMATION -->
          @if (s.status !== 'paid' && s.status !== 'cancelled') {
            <div class="mt-4 pt-4 border-t border-border">
              @if (cancelConfirmStep === 0) {
                <button (click)="cancelConfirmStep = 1"
                  class="text-xs text-red-400 hover:text-red-600 underline underline-offset-2 transition-colors">
                  Cancelar esta liquidacion
                </button>
              }
              @if (cancelConfirmStep === 1) {
                <div class="p-3 bg-red-50 rounded-xl border border-red-200">
                  <p class="text-sm font-semibold text-red-700">Cancelar liquidacion {{ s.settlement_number }}</p>
                  <p class="text-xs text-red-600 mt-1">Esta accion no se puede deshacer.</p>
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
                <div class="p-3 bg-red-100 rounded-xl border-2 border-red-300">
                  <p class="text-sm font-bold text-red-800">Confirmacion final</p>
                  <p class="text-xs text-red-700 mt-1">
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
                <app-icon name="download" [size]="14"></app-icon>
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

  constructor() {
    this.destroyRef.onDestroy(() => {
    });
  }

  formatNumber(value: number): string {
    return this.currencyService.format(Number(value) || 0);
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

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      paid: 'Pagada',
      cancelled: 'Cancelada' };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      calculated: 'bg-blue-100 text-blue-800',
      approved: 'bg-yellow-100 text-yellow-800',
      paid: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800' };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  getReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      voluntary_resignation: 'Renuncia Voluntaria',
      just_cause: 'Despido con Justa Causa',
      without_just_cause: 'Despido sin Justa Causa',
      mutual_agreement: 'Mutuo Acuerdo',
      contract_expiry: 'Vencimiento Contrato',
      retirement: 'Jubilacion',
      death: 'Muerte del Trabajador' };
    return labels[reason] || reason || '-';
  }

  getContractLabel(type: string): string {
    const labels: Record<string, string> = {
      indefinite: 'Indefinido',
      fixed_term: 'Termino Fijo',
      service: 'Prestacion de Servicios',
      apprentice: 'Aprendizaje' };
    return labels[type] || type || '-';
  }
}
