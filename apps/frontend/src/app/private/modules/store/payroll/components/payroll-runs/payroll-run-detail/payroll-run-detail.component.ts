import { Component, OnChanges, OnDestroy, SimpleChanges, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import { Observable, Subject } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
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
import { selectCurrentPayrollRunLoading } from '../../../state/selectors/payroll.selectors';
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

        <!-- No Items (Empty State) -->
        <div *ngIf="!payrollRun.items || payrollRun.items.length === 0"
          class="py-12 flex flex-col items-center rounded-lg border-2 border-dashed border-border">
          <div class="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <app-icon name="file-text" [size]="28" class="text-gray-400"></app-icon>
          </div>
          <p class="text-sm font-medium text-text-primary mb-1">No hay items en esta nomina</p>
          <p class="text-xs text-text-secondary" *ngIf="payrollRun.status === 'draft'">
            Calcule la nomina para generar el desglose por empleado.
          </p>
          <p class="text-xs text-text-secondary" *ngIf="payrollRun.status !== 'draft'">
            Esta nomina no tiene items registrados.
          </p>
        </div>

        <!-- State Transition Actions -->
        <div class="mt-6 pt-4 border-t border-border"
          *ngIf="payrollRun.status !== 'paid' && payrollRun.status !== 'cancelled'">
          <h3 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Acciones</h3>

          <!-- Fast-track: process all remaining steps -->
          <div *ngIf="getRemainingSteps(payrollRun.status).length > 1 && !fastTracking"
            class="mb-3 p-3 bg-primary/5 rounded-xl border border-primary/15">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <app-icon name="zap" [size]="16" class="text-primary"></app-icon>
              </div>
              <div class="flex-1 min-w-0">
                <span class="text-xs font-semibold text-text-primary block mb-0.5">Procesamiento rapido</span>
                <span class="text-[11px] text-text-secondary block mb-2">
                  {{ getRemainingStepsLabel(payrollRun.status) }}
                </span>
                <app-button
                  variant="primary"
                  size="sm"
                  [fullWidth]="true"
                  (clicked)="onFastTrack()"
                  [loading]="(loading$ | async) || false"
                >
                  <app-icon name="skip-forward" [size]="16" slot="icon"></app-icon>
                  Procesar Completo
                </app-button>
              </div>
            </div>
          </div>

          <!-- Fast-track progress indicator -->
          <div *ngIf="fastTracking"
            class="mb-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span class="text-xs font-semibold text-blue-800">Procesando: {{ fastTrackCurrentLabel }}</span>
            </div>
            <div class="w-full bg-blue-200 rounded-full h-1.5">
              <div class="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                [style.width.%]="fastTrackProgress"></div>
            </div>
          </div>

          <!-- Step-by-step actions -->
          <div class="space-y-2" *ngIf="!fastTracking">
            <!-- Divider when fast-track is available -->
            <div *ngIf="getRemainingSteps(payrollRun.status).length > 1"
              class="flex items-center gap-3 py-1">
              <div class="flex-1 h-px bg-border"></div>
              <span class="text-[10px] font-bold text-text-secondary uppercase tracking-widest">Paso a paso</span>
              <div class="flex-1 h-px bg-border"></div>
            </div>

            <!-- Draft: Calculate -->
            <ng-container *ngIf="payrollRun.status === 'draft'">
              <app-button
                variant="primary"
                [fullWidth]="true"
                (clicked)="onCalculate()"
                [loading]="(loading$ | async) || false"
              >
                <app-icon name="calculator" [size]="16" slot="icon"></app-icon>
                Calcular Nomina
              </app-button>
            </ng-container>

            <!-- Calculated: Approve -->
            <ng-container *ngIf="payrollRun.status === 'calculated'">
              <app-button
                variant="success"
                [fullWidth]="true"
                (clicked)="onApprove()"
                [loading]="(loading$ | async) || false"
              >
                <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                Aprobar
              </app-button>
            </ng-container>

            <!-- Approved: Send -->
            <ng-container *ngIf="payrollRun.status === 'approved'">
              <app-button
                variant="primary"
                [fullWidth]="true"
                (clicked)="onSend()"
                [loading]="(loading$ | async) || false"
              >
                <app-icon name="send" [size]="16" slot="icon"></app-icon>
                Enviar
              </app-button>
            </ng-container>

            <!-- Sent/Accepted: Pay -->
            <ng-container *ngIf="payrollRun.status === 'sent' || payrollRun.status === 'accepted'">
              <app-button
                variant="success"
                [fullWidth]="true"
                (clicked)="onPay()"
                [loading]="(loading$ | async) || false"
              >
                <app-icon name="banknote" [size]="16" slot="icon"></app-icon>
                Marcar Pagada
              </app-button>
            </ng-container>

            <!-- Cancel -->
            <app-button
              variant="outline-danger"
              [fullWidth]="true"
              (clicked)="onCancel()"
              [loading]="(loading$ | async) || false"
            >
              <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
              Cancelar Nomina
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
export class PayrollRunDetailComponent implements OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() payrollRun: PayrollRun | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();

  loading$: Observable<boolean>;
  expandedItems: Record<number, boolean> = {};

  // Fast-track state
  fastTracking = false;
  fastTrackCurrentLabel = '';
  fastTrackProgress = 0;

  private destroy$ = new Subject<void>();
  private fastTrackCancel$ = new Subject<void>();
  private actions$ = inject(Actions);

  private readonly STEPS_ORDER = ['draft', 'calculated', 'approved', 'sent', 'paid'] as const;
  private readonly STEP_CONFIG: Record<string, { label: string; totalWeight: number }> = {
    draft: { label: 'Calculando nomina...', totalWeight: 25 },
    calculated: { label: 'Aprobando...', totalWeight: 50 },
    approved: { label: 'Enviando...', totalWeight: 75 },
    sent: { label: 'Registrando pago...', totalWeight: 100 },
  };

  constructor(private store: Store) {
    this.loading$ = this.store.select(selectCurrentPayrollRunLoading);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['payrollRun']) {
      const prev = changes['payrollRun'].previousValue;
      const curr = changes['payrollRun'].currentValue;
      if (prev?.id !== curr?.id) {
        this.expandedItems = {};
        this.stopFastTrack();
      }
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.fastTrackCancel$.next();
    this.fastTrackCancel$.complete();
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

  // ── Fast-track ──────────────────────────────────────────

  getRemainingSteps(status: string): string[] {
    const idx = this.STEPS_ORDER.indexOf(status as any);
    if (idx === -1) return [];
    return this.STEPS_ORDER.slice(idx + 1) as unknown as string[];
  }

  getRemainingStepsLabel(status: string): string {
    const steps = this.getRemainingSteps(status);
    const labels: Record<string, string> = {
      calculated: 'Calcular',
      approved: 'Aprobar',
      sent: 'Enviar',
      paid: 'Pagar',
    };
    return steps.map(s => labels[s] || s).join(' → ');
  }

  onFastTrack(): void {
    if (!this.payrollRun) return;
    this.fastTracking = true;
    this.fastTrackCancel$ = new Subject<void>();
    this.dispatchNextStep(this.payrollRun.status, this.payrollRun.id);
  }

  private dispatchNextStep(currentStatus: string, id: number): void {
    const config = this.STEP_CONFIG[currentStatus];
    if (!config) {
      this.stopFastTrack();
      return;
    }

    this.fastTrackCurrentLabel = config.label;
    this.fastTrackProgress = config.totalWeight - 25;

    // Map status to action + success/failure actions
    const actionMap: Record<string, { dispatch: any; success: any; failure: any; nextStatus: string }> = {
      draft: {
        dispatch: calculatePayrollRun({ id }),
        success: calculatePayrollRunSuccess,
        failure: calculatePayrollRunFailure,
        nextStatus: 'calculated',
      },
      calculated: {
        dispatch: approvePayrollRun({ id }),
        success: approvePayrollRunSuccess,
        failure: approvePayrollRunFailure,
        nextStatus: 'approved',
      },
      approved: {
        dispatch: sendPayrollRun({ id }),
        success: sendPayrollRunSuccess,
        failure: sendPayrollRunFailure,
        nextStatus: 'sent',
      },
      sent: {
        dispatch: payPayrollRun({ id }),
        success: payPayrollRunSuccess,
        failure: payPayrollRunFailure,
        nextStatus: 'paid',
      },
    };

    const step = actionMap[currentStatus];
    if (!step) {
      this.stopFastTrack();
      return;
    }

    // Listen for success or failure
    this.actions$.pipe(
      ofType(step.success, step.failure),
      take(1),
      takeUntil(this.fastTrackCancel$),
      takeUntil(this.destroy$),
    ).subscribe((action) => {
      if (action.type === step.failure.type) {
        this.stopFastTrack();
        return;
      }

      this.fastTrackProgress = this.STEP_CONFIG[currentStatus]?.totalWeight || 100;

      if (step.nextStatus === 'paid') {
        // All done
        setTimeout(() => this.stopFastTrack(), 500);
      } else {
        this.dispatchNextStep(step.nextStatus, id);
      }
    });

    this.store.dispatch(step.dispatch);
  }

  private stopFastTrack(): void {
    this.fastTracking = false;
    this.fastTrackCurrentLabel = '';
    this.fastTrackProgress = 0;
    this.fastTrackCancel$.next();
  }

  // ── Step-by-step actions ────────────────────────────────

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
    }
  }

  onClose() {
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
