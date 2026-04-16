import {
  Component,
  input,
  output,
  inject,
  effect,
} from '@angular/core';

import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ExpandableCardComponent } from '../../../../../../../shared/components/expandable-card/expandable-card.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PayrollItem } from '../../../interfaces/payroll.interface';

interface EntryRow {
  key: string;
  label: string;
  value: number;
}

@Component({
  selector: 'vendix-payroll-item-detail',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent,
    ExpandableCardComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="isOpenChange.emit(false)"
      [title]="modalTitle"
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

        <!-- 2. Resumen (4 mini-cards con colores) -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="p-3 rounded-lg bg-blue-50 border border-blue-100 text-center">
            <p class="text-[10px] uppercase tracking-wide text-blue-600">Devengado</p>
            <p class="text-sm font-bold text-blue-700">{{ formatCurrency(item()!.total_earnings) }}</p>
          </div>
          <div class="p-3 rounded-lg bg-red-50 border border-red-100 text-center">
            <p class="text-[10px] uppercase tracking-wide text-red-600">Deducciones</p>
            <p class="text-sm font-bold text-red-700">{{ formatCurrency(item()!.total_deductions) }}</p>
          </div>
          <div class="p-3 rounded-lg bg-yellow-50 border border-yellow-100 text-center">
            <p class="text-[10px] uppercase tracking-wide text-yellow-600">Costos Emp.</p>
            <p class="text-sm font-bold text-yellow-700">{{ formatCurrency(item()!.total_employer_costs) }}</p>
          </div>
          <div class="p-3 rounded-lg bg-green-50 border border-green-100 text-center">
            <p class="text-[10px] uppercase tracking-wide text-green-600">Neto a Pagar</p>
            <p class="text-sm font-bold text-green-700">{{ formatCurrency(item()!.net_pay) }}</p>
          </div>
        </div>

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
              @for (entry of earningsEntries; track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (earningsEntries.length === 0) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
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
              @for (entry of deductionsEntries; track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (deductionsEntries.length === 0) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
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
              @for (entry of employerCostsEntries; track entry.key) {
                <div class="flex justify-between items-center text-xs py-1">
                  <span class="text-[var(--color-text-secondary)]">{{ entry.label }}</span>
                  <span class="font-medium text-[var(--color-text-primary)]">{{ formatCurrency(entry.value) }}</span>
                </div>
              }
              @if (employerCostsEntries.length === 0) {
                <p class="text-xs text-[var(--color-text-secondary)]">Sin detalle</p>
              }
            </div>
          </app-expandable-card>

          <!-- Provisiones (solo si hay datos) -->
          @if (provisionsEntries.length > 0) {
            <app-expandable-card>
              <div slot="header" class="flex items-center gap-2 flex-1 min-w-0">
                <div class="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <app-icon name="coins" [size]="14" class="text-purple-600"></app-icon>
                </div>
                <span class="text-sm font-semibold text-[var(--color-text-primary)]">Provisiones</span>
                <span class="ml-auto text-sm font-bold text-purple-700">{{ formatCurrency(provisionsTotal) }}</span>
              </div>
              <div class="px-4 py-3 space-y-1">
                @for (entry of provisionsEntries; track entry.key) {
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
  readonly isOpenChange = output<boolean>();

  private currencyService = inject(CurrencyFormatService);

  earningsEntries: EntryRow[] = [];
  deductionsEntries: EntryRow[] = [];
  employerCostsEntries: EntryRow[] = [];
  provisionsEntries: EntryRow[] = [];
  provisionsTotal = 0;
  modalTitle = '';

  private readonly ENTRY_LABELS: Record<string, string | null> = {
    base_salary: 'Salario Base',
    transport_subsidy: 'Auxilio de Transporte',
    health: 'Salud (EPS)',
    pension: 'Pension (AFP)',
    retention: 'Retencion en la Fuente',
    advance_deduction: 'Descuento Anticipos',
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

  constructor() {
    effect(() => {
      this.computeEntries();
      this.computeTitle();
    });
  }

  formatCurrency(value: number | undefined | null): string {
    return this.currencyService.format(Number(value) || 0);
  }

  getCostCenterLabel(costCenter: string | undefined | null): string {
    if (!costCenter) return 'N/A';
    return this.COST_CENTER_LABELS[costCenter] || costCenter;
  }

  private computeTitle(): void {
    const item = this.item();
    if (!item) {
      this.modalTitle = '';
      return;
    }
    const emp = item.employee;
    this.modalTitle = emp
      ? `${emp.first_name} ${emp.last_name}`
      : `Empleado #${item.employee_id}`;
  }

  private computeEntries(): void {
    const item = this.item();
    if (!item) {
      this.earningsEntries = [];
      this.deductionsEntries = [];
      this.employerCostsEntries = [];
      this.provisionsEntries = [];
      this.provisionsTotal = 0;
      return;
    }

    this.earningsEntries = this.toEntryRows(item.earnings);
    this.deductionsEntries = this.toEntryRows(item.deductions);
    this.employerCostsEntries = this.toEntryRows(item.employer_costs);

    if (item.provisions) {
      this.provisionsEntries = this.toEntryRows(item.provisions);
      this.provisionsTotal = item.provisions['total'] || this.provisionsEntries.reduce((sum, e) => sum + e.value, 0);
    } else {
      this.provisionsEntries = [];
      this.provisionsTotal = 0;
    }
  }

  private toEntryRows(obj: Record<string, number> | undefined | null): EntryRow[] {
    if (!obj) return [];

    return Object.entries(obj)
      .filter(([key]) => this.ENTRY_LABELS[key] !== null) // exclude "total"
      .filter(([key]) => key !== 'total') // also exclude total even if not in map
      .map(([key, value]) => ({
        key,
        label: this.getLabel(key),
        value: Number(value) || 0,
      }));
  }

  private getLabel(key: string): string {
    const mapped = this.ENTRY_LABELS[key];
    if (mapped) return mapped;
    // Fallback: capitalize and replace underscores
    return key
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
