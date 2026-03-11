import { Component, OnChanges, SimpleChanges, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import {
  calculatePayrollRun,
  approvePayrollRun,
  sendPayrollRun,
  payPayrollRun,
  cancelPayrollRun,
} from '../../../state/actions/payroll.actions';
import { selectPayrollRunsLoading } from '../../../state/selectors/payroll.selectors';
import { PayrollRun, PayrollItem } from '../../../interfaces/payroll.interface';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-payroll-run-detail',
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
      title="Detalle de Nomina"
      size="xl"
    >
      <div class="p-4 max-h-[75vh] overflow-y-auto" *ngIf="payrollRun">
        <!-- Header Info -->
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <span class="text-lg font-semibold text-text-primary">{{ payrollRun.payroll_number }}</span>
          <span [class]="getStatusBadgeClass(payrollRun.status)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ getStatusLabel(payrollRun.status) }}
          </span>
          <span class="text-sm text-text-secondary ml-auto">
            {{ getFrequencyLabel(payrollRun.frequency) }}
          </span>
        </div>

        <!-- Period Info -->
        <div class="mb-4 p-3 bg-gray-50 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <span class="text-xs text-text-secondary block">Inicio del Período</span>
            <span class="text-sm font-medium">{{ payrollRun.period_start | date:'dd/MM/yyyy' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Fin del Período</span>
            <span class="text-sm font-medium">{{ payrollRun.period_end | date:'dd/MM/yyyy' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Fecha de Pago</span>
            <span class="text-sm font-medium">{{ payrollRun.payment_date ? (payrollRun.payment_date | date:'dd/MM/yyyy') : 'Sin definir' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Items</span>
            <span class="text-sm font-medium">{{ payrollRun.items?.length || 0 }} empleados</span>
          </div>
        </div>

        <!-- Summary Totals -->
        <div class="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <span class="text-xs text-blue-600 block">Total Devengado</span>
            <span class="text-lg font-bold text-blue-800">\${{ formatNumber(payrollRun.total_earnings) }}</span>
          </div>
          <div class="p-3 bg-red-50 rounded-lg border border-red-100">
            <span class="text-xs text-red-600 block">Total Deducciones</span>
            <span class="text-lg font-bold text-red-800">\${{ formatNumber(payrollRun.total_deductions) }}</span>
          </div>
          <div class="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
            <span class="text-xs text-yellow-600 block">Costo Empleador</span>
            <span class="text-lg font-bold text-yellow-800">\${{ formatNumber(payrollRun.total_employer_costs) }}</span>
          </div>
          <div class="p-3 bg-green-50 rounded-lg border border-green-100">
            <span class="text-xs text-green-600 block">Neto a Pagar</span>
            <span class="text-lg font-bold text-green-800">\${{ formatNumber(payrollRun.total_net_pay) }}</span>
          </div>
        </div>

        <!-- Payroll Items Table -->
        <div *ngIf="payrollRun.items && payrollRun.items.length > 0">
          <h3 class="text-sm font-semibold text-text-primary mb-3 uppercase tracking-wide">Desglose por Empleado</h3>

          <!-- Desktop Table -->
          <div class="hidden md:block overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-gray-50">
                  <th class="text-left py-2 px-3 font-medium text-text-secondary">Empleado</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Salario Base</th>
                  <th class="text-center py-2 px-3 font-medium text-text-secondary">Días</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Devengado</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Deducciones</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Costo Emp.</th>
                  <th class="text-right py-2 px-3 font-medium text-text-secondary">Neto</th>
                  <th class="text-center py-2 px-3 font-medium text-text-secondary"></th>
                </tr>
              </thead>
              <tbody>
                <ng-container *ngFor="let item of payrollRun.items; let i = index">
                  <tr class="border-b border-border hover:bg-gray-50 cursor-pointer" (click)="toggleItem(i)">
                    <td class="py-2 px-3">
                      {{ item.employee ? item.employee.first_name + ' ' + item.employee.last_name : 'Empleado #' + item.employee_id }}
                    </td>
                    <td class="py-2 px-3 text-right">\${{ formatNumber(item.base_salary) }}</td>
                    <td class="py-2 px-3 text-center">{{ item.worked_days }}</td>
                    <td class="py-2 px-3 text-right text-blue-600">\${{ formatNumber(item.total_earnings) }}</td>
                    <td class="py-2 px-3 text-right text-red-600">\${{ formatNumber(item.total_deductions) }}</td>
                    <td class="py-2 px-3 text-right text-yellow-600">\${{ formatNumber(item.total_employer_costs) }}</td>
                    <td class="py-2 px-3 text-right font-semibold text-green-600">\${{ formatNumber(item.net_pay) }}</td>
                    <td class="py-2 px-3 text-center">
                      <app-icon [name]="expandedItems[i] ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
                    </td>
                  </tr>
                  <!-- Expanded Detail -->
                  <tr *ngIf="expandedItems[i]">
                    <td colspan="8" class="p-3 bg-gray-50">
                      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <!-- Earnings -->
                        <div>
                          <h4 class="text-xs font-semibold text-blue-600 mb-2 uppercase">Devengados</h4>
                          <div *ngFor="let entry of getEntries(item.earnings)" class="flex justify-between text-xs py-0.5">
                            <span class="text-text-secondary">{{ entry[0] }}</span>
                            <span>\${{ formatNumber(entry[1]) }}</span>
                          </div>
                          <div *ngIf="getEntries(item.earnings).length === 0" class="text-xs text-text-secondary">Sin detalle</div>
                        </div>
                        <!-- Deductions -->
                        <div>
                          <h4 class="text-xs font-semibold text-red-600 mb-2 uppercase">Deducciones</h4>
                          <div *ngFor="let entry of getEntries(item.deductions)" class="flex justify-between text-xs py-0.5">
                            <span class="text-text-secondary">{{ entry[0] }}</span>
                            <span>\${{ formatNumber(entry[1]) }}</span>
                          </div>
                          <div *ngIf="getEntries(item.deductions).length === 0" class="text-xs text-text-secondary">Sin detalle</div>
                        </div>
                        <!-- Employer Costs -->
                        <div>
                          <h4 class="text-xs font-semibold text-yellow-600 mb-2 uppercase">Costos Empleador</h4>
                          <div *ngFor="let entry of getEntries(item.employer_costs)" class="flex justify-between text-xs py-0.5">
                            <span class="text-text-secondary">{{ entry[0] }}</span>
                            <span>\${{ formatNumber(entry[1]) }}</span>
                          </div>
                          <div *ngIf="getEntries(item.employer_costs).length === 0" class="text-xs text-text-secondary">Sin detalle</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </ng-container>
              </tbody>
            </table>
          </div>

          <!-- Mobile Cards -->
          <div class="md:hidden space-y-3">
            <div *ngFor="let item of payrollRun.items; let i = index"
              class="bg-surface rounded-xl border border-border shadow-[0_2px_8px_rgba(0,0,0,0.07)] overflow-hidden">
              <div class="p-3 cursor-pointer" (click)="toggleItem(i)">
                <div class="flex justify-between items-start mb-2">
                  <span class="font-medium text-sm text-text-primary">
                    {{ item.employee ? item.employee.first_name + ' ' + item.employee.last_name : 'Empleado #' + item.employee_id }}
                  </span>
                  <app-icon [name]="expandedItems[i] ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
                </div>
                <div class="flex justify-between text-xs text-text-secondary">
                  <span>{{ item.worked_days }} días</span>
                  <span class="font-semibold text-green-600 text-sm">\${{ formatNumber(item.net_pay) }}</span>
                </div>
              </div>
              <div *ngIf="expandedItems[i]" class="px-3 pb-3 border-t border-border pt-2 space-y-3">
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span class="text-text-secondary block">Devengado</span>
                    <span class="text-blue-600 font-medium">\${{ formatNumber(item.total_earnings) }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary block">Deducciones</span>
                    <span class="text-red-600 font-medium">\${{ formatNumber(item.total_deductions) }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary block">Costo Emp.</span>
                    <span class="text-yellow-600 font-medium">\${{ formatNumber(item.total_employer_costs) }}</span>
                  </div>
                  <div>
                    <span class="text-text-secondary block">Salario Base</span>
                    <span class="font-medium">\${{ formatNumber(item.base_salary) }}</span>
                  </div>
                </div>
                <!-- Detailed breakdown -->
                <div *ngIf="getEntries(item.earnings).length > 0">
                  <h4 class="text-xs font-semibold text-blue-600 mb-1">Devengados</h4>
                  <div *ngFor="let entry of getEntries(item.earnings)" class="flex justify-between text-xs py-0.5">
                    <span class="text-text-secondary">{{ entry[0] }}</span>
                    <span>\${{ formatNumber(entry[1]) }}</span>
                  </div>
                </div>
                <div *ngIf="getEntries(item.deductions).length > 0">
                  <h4 class="text-xs font-semibold text-red-600 mb-1">Deducciones</h4>
                  <div *ngFor="let entry of getEntries(item.deductions)" class="flex justify-between text-xs py-0.5">
                    <span class="text-text-secondary">{{ entry[0] }}</span>
                    <span>\${{ formatNumber(entry[1]) }}</span>
                  </div>
                </div>
                <div *ngIf="getEntries(item.employer_costs).length > 0">
                  <h4 class="text-xs font-semibold text-yellow-600 mb-1">Costos Empleador</h4>
                  <div *ngFor="let entry of getEntries(item.employer_costs)" class="flex justify-between text-xs py-0.5">
                    <span class="text-text-secondary">{{ entry[0] }}</span>
                    <span>\${{ formatNumber(entry[1]) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- No Items -->
        <div *ngIf="!payrollRun.items || payrollRun.items.length === 0" class="p-6 text-center text-text-secondary">
          <app-icon name="file-text" [size]="40" class="text-gray-300 mb-2"></app-icon>
          <p>No hay ítems en esta nómina.</p>
          <p class="text-xs mt-1" *ngIf="payrollRun.status === 'draft'">Calcule la nómina para generar el desglose.</p>
        </div>

        <!-- State Transition Actions -->
        <div class="mt-5 pt-4 border-t border-border space-y-2"
          *ngIf="payrollRun.status !== 'paid' && payrollRun.status !== 'cancelled'">
          <span class="text-xs font-medium text-text-secondary uppercase tracking-wide">Acciones</span>

          <!-- Draft: Calculate -->
          <div *ngIf="payrollRun.status === 'draft'" class="grid grid-cols-2 gap-2">
            <app-button
              variant="primary"
              size="sm"
              [fullWidth]="true"
              (clicked)="onCalculate()"
              [loading]="(loading$ | async) || false"
            >
              Calcular Nómina
            </app-button>
            <app-button
              variant="outline-danger"
              size="sm"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="(loading$ | async) || false"
            >
              Cancelar
            </app-button>
          </div>

          <!-- Calculated: Approve / Cancel -->
          <div *ngIf="payrollRun.status === 'calculated'" class="grid grid-cols-2 gap-2">
            <app-button
              variant="success"
              size="sm"
              [fullWidth]="true"
              (clicked)="onApprove()"
              [loading]="(loading$ | async) || false"
            >
              Aprobar
            </app-button>
            <app-button
              variant="outline-warning"
              size="sm"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="(loading$ | async) || false"
            >
              Cancelar
            </app-button>
          </div>

          <!-- Approved: Send / Cancel -->
          <div *ngIf="payrollRun.status === 'approved'" class="grid grid-cols-2 gap-2">
            <app-button
              variant="primary"
              size="sm"
              [fullWidth]="true"
              (clicked)="onSend()"
              [loading]="(loading$ | async) || false"
            >
              Enviar
            </app-button>
            <app-button
              variant="outline-warning"
              size="sm"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="(loading$ | async) || false"
            >
              Cancelar
            </app-button>
          </div>

          <!-- Sent: Pay / Cancel -->
          <div *ngIf="payrollRun.status === 'sent' || payrollRun.status === 'accepted'" class="grid grid-cols-2 gap-2">
            <app-button
              variant="success"
              size="sm"
              [fullWidth]="true"
              (clicked)="onPay()"
              [loading]="(loading$ | async) || false"
            >
              Marcar Pagada
            </app-button>
            <app-button
              variant="outline-warning"
              size="sm"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="(loading$ | async) || false"
            >
              Cancelar
            </app-button>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button
            variant="outline"
            size="sm"
            (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class PayrollRunDetailComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() payrollRun: PayrollRun | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();

  loading$: Observable<boolean>;
  expandedItems: Record<number, boolean> = {};

  constructor(private store: Store) {
    this.loading$ = this.store.select(selectPayrollRunsLoading);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['payrollRun']) {
      this.expandedItems = {};
    }
  }

  toggleItem(index: number): void {
    this.expandedItems[index] = !this.expandedItems[index];
  }

  getEntries(obj: Record<string, number> | undefined): [string, number][] {
    if (!obj) return [];
    return Object.entries(obj);
  }

  formatNumber(value: number): string {
    return (value || 0).toLocaleString('es-CO');
  }

  // State transition actions
  onCalculate(): void {
    if (this.payrollRun) {
      this.store.dispatch(calculatePayrollRun({ id: this.payrollRun.id }));
    }
  }

  onApprove(): void {
    if (this.payrollRun) {
      this.store.dispatch(approvePayrollRun({ id: this.payrollRun.id }));
    }
  }

  onSend(): void {
    if (this.payrollRun) {
      this.store.dispatch(sendPayrollRun({ id: this.payrollRun.id }));
    }
  }

  onPay(): void {
    if (this.payrollRun) {
      this.store.dispatch(payPayrollRun({ id: this.payrollRun.id }));
    }
  }

  onCancel(): void {
    if (this.payrollRun) {
      this.store.dispatch(cancelPayrollRun({ id: this.payrollRun.id }));
      this.onClose();
    }
  }

  onClose() {
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
