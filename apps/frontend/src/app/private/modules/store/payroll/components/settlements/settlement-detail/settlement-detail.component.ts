import { Component, Input, Output, EventEmitter, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { PayrollService } from '../../../services/payroll.service';
import { PayrollSettlement } from '../../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-settlement-detail',
  standalone: true,
  imports: [
    CommonModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Detalle de Liquidacion"
      size="xl"
    >
      <div class="p-4 max-h-[75vh] overflow-y-auto" *ngIf="settlement">

        <!-- Header -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <span class="text-lg font-semibold text-text-primary">{{ settlement.settlement_number }}</span>
          <span [class]="getStatusBadgeClass(settlement.status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ getStatusLabel(settlement.status) }}
          </span>
        </div>

        <!-- Employee Info -->
        <div class="mb-4 p-3 bg-gray-50 rounded-lg" *ngIf="settlement.employee">
          <h3 class="text-xs font-bold text-text-secondary uppercase tracking-wider mb-2">Empleado</h3>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <span class="text-xs text-text-secondary block">Nombre</span>
              <span class="text-sm font-medium">{{ settlement.employee.first_name }} {{ settlement.employee.last_name }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Documento</span>
              <span class="text-sm font-medium">{{ settlement.employee.document_number }}</span>
            </div>
            <div>
              <span class="text-xs text-text-secondary block">Cargo</span>
              <span class="text-sm font-medium">{{ settlement.employee.position || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- Employment Info -->
        <div class="mb-4 p-3 bg-gray-50 rounded-lg grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <span class="text-xs text-text-secondary block">Fecha Ingreso</span>
            <span class="text-sm font-medium">{{ settlement.hire_date | date:'dd/MM/yyyy' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Fecha Terminacion</span>
            <span class="text-sm font-medium">{{ settlement.termination_date | date:'dd/MM/yyyy' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Dias Trabajados</span>
            <span class="text-sm font-medium">{{ settlement.days_worked }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Motivo</span>
            <span class="text-sm font-medium">{{ getReasonLabel(settlement.termination_reason) }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Tipo Contrato</span>
            <span class="text-sm font-medium">{{ getContractLabel(settlement.contract_type) }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Salario Base</span>
            <span class="text-sm font-medium">\${{ formatNumber(settlement.base_salary) }}</span>
          </div>
        </div>

        <!-- Prestaciones -->
        <div class="mb-4">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Prestaciones Sociales</h3>
          <div class="bg-surface rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <tbody>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Cesantias</td>
                  <td class="py-2 px-3 text-right font-medium">\${{ formatNumber(settlement.severance) }}</td>
                </tr>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Intereses sobre Cesantias</td>
                  <td class="py-2 px-3 text-right font-medium">\${{ formatNumber(settlement.severance_interest) }}</td>
                </tr>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Prima de Servicios</td>
                  <td class="py-2 px-3 text-right font-medium">\${{ formatNumber(settlement.bonus) }}</td>
                </tr>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Vacaciones</td>
                  <td class="py-2 px-3 text-right font-medium">\${{ formatNumber(settlement.vacation) }}</td>
                </tr>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Salario Pendiente</td>
                  <td class="py-2 px-3 text-right font-medium">\${{ formatNumber(settlement.pending_salary) }}</td>
                </tr>
                <tr *ngIf="settlement.indemnification > 0">
                  <td class="py-2 px-3 text-text-secondary">Indemnizacion</td>
                  <td class="py-2 px-3 text-right font-medium text-blue-600">\${{ formatNumber(settlement.indemnification) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Deductions -->
        <div class="mb-4">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Deducciones</h3>
          <div class="bg-surface rounded-lg border border-border overflow-hidden">
            <table class="w-full text-sm">
              <tbody>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Salud</td>
                  <td class="py-2 px-3 text-right font-medium text-red-600">\${{ formatNumber(settlement.health_deduction) }}</td>
                </tr>
                <tr class="border-b border-border">
                  <td class="py-2 px-3 text-text-secondary">Pension</td>
                  <td class="py-2 px-3 text-right font-medium text-red-600">\${{ formatNumber(settlement.pension_deduction) }}</td>
                </tr>
                <tr *ngIf="settlement.other_deductions > 0">
                  <td class="py-2 px-3 text-text-secondary">Otras Deducciones</td>
                  <td class="py-2 px-3 text-right font-medium text-red-600">\${{ formatNumber(settlement.other_deductions) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Totals -->
        <div class="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <span class="text-xs text-blue-600 block">Total Bruto</span>
            <span class="text-lg font-bold text-blue-800">\${{ formatNumber(settlement.gross_settlement) }}</span>
          </div>
          <div class="p-3 bg-red-50 rounded-lg border border-red-100">
            <span class="text-xs text-red-600 block">Total Deducciones</span>
            <span class="text-lg font-bold text-red-800">\${{ formatNumber(settlement.total_deductions) }}</span>
          </div>
          <div class="p-3 bg-green-50 rounded-lg border border-green-100">
            <span class="text-xs text-green-600 block">NETO A PAGAR</span>
            <span class="text-xl font-bold text-green-800">\${{ formatNumber(settlement.net_settlement) }}</span>
          </div>
        </div>

        <!-- Notes -->
        <div *ngIf="settlement.notes" class="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
          <h3 class="text-xs font-bold text-yellow-700 uppercase tracking-wider mb-1">Notas</h3>
          <p class="text-sm text-yellow-800">{{ settlement.notes }}</p>
        </div>

        <!-- Actions -->
        <div class="mt-6 pt-4 border-t border-border"
          *ngIf="settlement.status !== 'paid' && settlement.status !== 'cancelled'">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Acciones</h3>
          <div class="space-y-2">
            <!-- Recalculate -->
            <ng-container *ngIf="settlement.status === 'calculated' || settlement.status === 'draft'">
              <app-button
                variant="outline"
                [fullWidth]="true"
                (clicked)="onRecalculate()"
                [loading]="actionLoading"
              >
                <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
                Recalcular
              </app-button>
            </ng-container>

            <!-- Approve -->
            <ng-container *ngIf="settlement.status === 'calculated'">
              <app-button
                variant="success"
                [fullWidth]="true"
                (clicked)="onApprove()"
                [loading]="actionLoading"
              >
                <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                Aprobar Liquidacion
              </app-button>
            </ng-container>

            <!-- Pay -->
            <ng-container *ngIf="settlement.status === 'approved'">
              <app-button
                variant="success"
                [fullWidth]="true"
                (clicked)="onPay()"
                [loading]="actionLoading"
              >
                <app-icon name="banknote" [size]="16" slot="icon"></app-icon>
                Pagar y Terminar Contrato
              </app-button>
            </ng-container>

            <!-- Cancel -->
            <app-button
              variant="outline-danger"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="actionLoading"
            >
              <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
              Cancelar Liquidacion
            </app-button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button
            *ngIf="settlement?.status === 'paid' || settlement?.status === 'calculated' || settlement?.status === 'approved'"
            variant="outline"
            size="sm"
            (clicked)="onDownloadPdf()"
            [loading]="downloadLoading"
          >
            <app-icon name="download" [size]="14"></app-icon>
            <span class="ml-1">PDF</span>
          </app-button>
          <app-button variant="outline" size="sm" (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class SettlementDetailComponent implements OnDestroy {
  @Input() isOpen = false;
  @Input() settlement: PayrollSettlement | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() updated = new EventEmitter<void>();

  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  actionLoading = false;
  downloadLoading = false;

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  formatNumber(value: number): string {
    return (value || 0).toLocaleString('es-CO');
  }

  onRecalculate(): void {
    if (!this.settlement) return;
    this.actionLoading = true;
    this.payrollService.recalculateSettlement(this.settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.settlement = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Liquidacion recalculada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al recalcular' });
        },
      });
  }

  onApprove(): void {
    if (!this.settlement) return;
    this.actionLoading = true;
    this.payrollService.approveSettlement(this.settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.settlement = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Liquidacion aprobada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al aprobar' });
        },
      });
  }

  onPay(): void {
    if (!this.settlement) return;
    this.actionLoading = true;
    this.payrollService.paySettlement(this.settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.settlement = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Liquidacion pagada y contrato terminado' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al pagar' });
        },
      });
  }

  onCancel(): void {
    if (!this.settlement) return;
    this.actionLoading = true;
    this.payrollService.cancelSettlement(this.settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.settlement = res.data;
          this.actionLoading = false;
          this.toastService.show({ variant: 'success', description: 'Liquidacion cancelada' });
          this.updated.emit();
        },
        error: () => {
          this.actionLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al cancelar' });
        },
      });
  }

  onDownloadPdf(): void {
    if (!this.settlement) return;
    this.downloadLoading = true;
    this.payrollService.getSettlementPayslip(this.settlement.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `liquidacion-${this.settlement!.settlement_number}.pdf`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.downloadLoading = false;
        },
        error: () => {
          this.downloadLoading = false;
          this.toastService.show({ variant: 'error', description: 'Error al descargar PDF' });
        },
      });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      calculated: 'bg-blue-100 text-blue-800',
      approved: 'bg-yellow-100 text-yellow-800',
      paid: 'bg-green-100 text-green-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
  }

  getReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      voluntary_resignation: 'Renuncia Voluntaria',
      just_cause_dismissal: 'Despido con Justa Causa',
      unjust_cause_dismissal: 'Despido sin Justa Causa',
      mutual_agreement: 'Mutuo Acuerdo',
      contract_expiration: 'Vencimiento Contrato',
      retirement: 'Jubilacion',
    };
    return labels[reason] || reason || '-';
  }

  getContractLabel(type: string): string {
    const labels: Record<string, string> = {
      indefinite: 'Indefinido',
      fixed_term: 'Termino Fijo',
      service: 'Prestacion de Servicios',
      apprentice: 'Aprendizaje',
    };
    return labels[type] || type || '-';
  }
}
