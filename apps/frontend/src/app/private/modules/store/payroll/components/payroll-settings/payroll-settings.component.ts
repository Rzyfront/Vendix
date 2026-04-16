import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, finalize } from 'rxjs/operators';

import { PayrollService } from '../../services/payroll.service';
import { PayrollRules, PayrollUpdateAvailable } from '../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';

interface RuleField {
  key: keyof PayrollRules;
  label: string;
  type: 'currency' | 'percent' | 'number';
  readonly: boolean;
}

interface RuleSection {
  title: string;
  fields: RuleField[];
}

interface SettingsCard {
  title: string;
  icon: string;
  iconBgClass: string;
  iconTextClass: string;
  subsections: RuleSection[];
  includeArl?: boolean;
}

interface DiffEntry {
  field: string;
  current: any;
  system: any;
}

const FIELD_LABELS: Record<string, string> = {
  minimum_wage: 'Salario mínimo',
  transport_subsidy: 'Auxilio de transporte',
  transport_subsidy_threshold: 'Umbral transporte (×SMMLV)',
  retention_exempt_threshold: 'Umbral retención (×SMMLV)',
  days_per_month: 'Días por mes',
  days_per_year: 'Días por año',
  severance_rate: 'Cesantías',
  severance_interest_rate: 'Intereses cesantías',
  vacation_rate: 'Vacaciones',
  bonus_rate: 'Prima',
  health_employee_rate: 'Salud (empleado)',
  pension_employee_rate: 'Pensión (empleado)',
  health_employer_rate: 'Salud (empleador)',
  pension_employer_rate: 'Pensión (empleador)',
  sena_rate: 'SENA',
  icbf_rate: 'ICBF',
  compensation_fund_rate: 'Caja de compensación',
};

const PERCENT_FIELDS = new Set([
  'severance_rate',
  'severance_interest_rate',
  'vacation_rate',
  'bonus_rate',
  'health_employee_rate',
  'pension_employee_rate',
  'health_employer_rate',
  'pension_employer_rate',
  'sena_rate',
  'icbf_rate',
  'compensation_fund_rate',
]);

const CURRENCY_FIELDS = new Set([
  'minimum_wage',
  'transport_subsidy',
]);

@Component({
  selector: 'vendix-payroll-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <app-sticky-header
      title="Configuración de Nómina"
      [subtitle]="'Año fiscal ' + selectedYear"
      icon="settings"
      [badgeText]="hasChanges ? 'Cambios sin guardar' : ''"
      [badgeColor]="'yellow'"
      [badgePulse]="hasChanges"
      [actions]="headerActions"
      (actionClicked)="onHeaderAction($event)"
    ></app-sticky-header>
    
    <div class="w-full px-2 md:px-0 mt-4">
      <!-- Year Selector -->
      <div class="flex items-center gap-2 mb-4">
        <div
          class="flex items-center gap-1.5 bg-surface border border-border rounded-lg px-2.5 py-1.5"
          >
          <span class="text-xs font-medium text-text-muted">Año fiscal</span>
          <select
            [ngModel]="selectedYear"
            (ngModelChange)="onYearChange($event)"
            class="text-sm font-semibold text-text-primary bg-transparent border-none focus:outline-none cursor-pointer appearance-none pr-4"
            style="background-image: url('data:image/svg+xml;charset=UTF-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23999%22 stroke-width=%222%22%3E%3Cpath d=%22M6 9l6 6 6-6%22/%3E%3C/svg%3E'); background-repeat: no-repeat; background-position: right 0 center;"
            >
            @for (year of availableYears; track year) {
              <option [value]="year">
                {{ year }}
              </option>
            }
          </select>
        </div>
      </div>
    
      <!-- Update Banner -->
      @if (available_update()) {
        <div class="mb-4 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <div class="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3 md:px-5 md:py-4">
            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <app-icon name="arrow-up-circle" [size]="18" class="text-blue-600" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-blue-900">
                Parámetros de nómina actualizados disponibles
              </p>
              @if (available_update()!.decree_ref || available_update()!.published_at) {
                <p class="text-xs text-blue-700 mt-0.5">
                  @if (available_update()!.decree_ref) {
                    {{ available_update()!.decree_ref }}
                  }
                  @if (available_update()!.decree_ref && available_update()!.published_at) {
                    <span class="mx-1">—</span>
                  }
                  @if (available_update()!.published_at) {
                    Publicado el {{ available_update()!.published_at | date:'d MMM yyyy' }}
                  }
                </p>
              }
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                (click)="toggleDiff()"
                class="text-xs font-medium text-blue-700 hover:text-blue-900 underline underline-offset-2 transition-colors"
                >
                {{ show_diff() ? 'Ocultar cambios' : 'Ver cambios' }}
              </button>
              <button
                type="button"
                (click)="applyDefaults()"
                [disabled]="applying_defaults"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                @if (applying_defaults) {
                  <span class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  Aplicando...
                } @else {
                  <app-icon name="check-circle" [size]="13" />
                  Aplicar valores oficiales
                }
              </button>
            </div>
          </div>
    
          <!-- Diff Table -->
          @if (show_diff() && diffEntries().length > 0) {
            <div class="border-t border-blue-200 px-4 pb-3 md:px-5 md:pb-4 pt-3">
              <p class="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-2">
                Cambios incluidos
              </p>
              <div class="overflow-x-auto rounded-lg border border-blue-200">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-blue-100/60">
                      <th class="text-left px-3 py-2 font-semibold text-blue-800">Campo</th>
                      <th class="text-right px-3 py-2 font-semibold text-blue-800">Valor actual</th>
                      <th class="text-right px-3 py-2 font-semibold text-blue-800">Valor oficial</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (entry of diffEntries(); track entry.field) {
                      <tr class="border-t border-blue-100">
                        <td class="px-3 py-2 text-text-primary font-medium">{{ getFieldLabel(entry.field) }}</td>
                        <td class="px-3 py-2 text-right text-red-500 font-mono">{{ formatValue(entry.field, entry.current) }}</td>
                        <td class="px-3 py-2 text-right text-green-600 font-mono font-semibold">{{ formatValue(entry.field, entry.system) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>
      }
    
      <!-- Loading State -->
      @if (loading) {
        <div class="flex items-center justify-center py-12">
          <div
            class="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"
          ></div>
          <span class="ml-3 text-sm text-text-secondary">Cargando reglas...</span>
        </div>
      }
    
      <!-- Grouped Cards Grid -->
      @if (!loading && rules) {
        <div class="payroll-grid">
          @for (card of cards; track card) {
            <div
              class="payroll-card rounded-xl overflow-hidden"
              >
              <!-- Card Header with Icon -->
              <div
                class="flex items-center gap-2.5 px-4 py-3 md:px-5 md:py-4 border-b border-border"
                >
                <div
                  class="w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
                  [ngClass]="[card.iconBgClass, card.iconTextClass]"
                  >
                  <app-icon [name]="card.icon" [size]="18" />
                </div>
                <h3 class="text-sm font-semibold text-text-primary">
                  {{ card.title }}
                </h3>
              </div>
              <!-- Card Body: Subsections -->
              <div class="p-3 md:p-4">
                @for (sub of card.subsections; track sub; let last = $last) {
                  <h4
                    class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2"
                    >
                    {{ sub.title }}
                  </h4>
                  <div class="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3">
                    @for (field of sub.fields; track field) {
                      <div class="relative">
                        <label
                          class="block text-[11px] font-medium text-text-secondary mb-1 leading-tight"
                          >
                          {{ field.label }}
                          @if (isModified(field.key)) {
                            <span
                              class="ml-1 inline-block w-1.5 h-1.5 bg-primary rounded-full align-middle"
                              title="Modificado"
                            ></span>
                          }
                        </label>
                        <div class="relative">
                          @if (field.type === 'currency') {
                            <span
                              class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted font-medium"
                              >$</span
                              >
                              <input
                                type="number"
                                [ngModel]="getFieldValue(field.key)"
                                (ngModelChange)="onFieldChange(field.key, $event)"
                                [disabled]="field.readonly"
                                class="w-full pl-6 pr-2 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                step="100"
                                />
                            }
                            @if (field.type === 'percent') {
                              <input
                                type="number"
                                [ngModel]="getPercentValue(field.key)"
                                (ngModelChange)="onPercentChange(field.key, $event)"
                                [disabled]="field.readonly"
                                class="w-full pl-2.5 pr-6 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                step="0.01"
                                />
                              <span
                                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted font-medium"
                                >%</span
                                >
                              }
                              @if (field.type === 'number') {
                                <input
                                  type="number"
                                  [ngModel]="getFieldValue(field.key)"
                                  (ngModelChange)="onFieldChange(field.key, $event)"
                                  [disabled]="field.readonly"
                                  class="w-full px-2.5 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  step="1"
                                  />
                              }
                            </div>
                          </div>
                        }
                      </div>
                      @if (!last || card.includeArl) {
                        <hr
                          class="border-t border-border/60 my-3 md:my-4"
                          />
                      }
                    }
                    <!-- ARL Rates (only in Seguridad Social card) -->
                    @if (card.includeArl) {
                      <h4
                        class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2"
                        >
                        Tarifas ARL por Nivel de Riesgo
                      </h4>
                      <div class="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                        @for (level of [1, 2, 3, 4, 5]; track level) {
                          <div class="relative">
                            <label
                              class="block text-[11px] font-medium text-text-secondary mb-1"
                              >
                              Nivel {{ level }}
                              @if (isArlModified(level)) {
                                <span
                                  class="ml-1 inline-block w-1.5 h-1.5 bg-primary rounded-full align-middle"
                                ></span>
                              }
                            </label>
                            <div class="relative">
                              <input
                                type="number"
                                [ngModel]="getArlPercent(level)"
                                (ngModelChange)="onArlChange(level, $event)"
                                class="w-full pl-2.5 pr-6 py-1.5 text-xs border border-border rounded-md bg-background text-text-primary focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-colors"
                                step="0.001"
                                />
                              <span
                                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted font-medium"
                                >%</span
                                >
                              </div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          </div>
    `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .payroll-grid {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      @media (min-width: 1024px) {
        .payroll-grid {
          display: block;
          columns: 2;
          column-gap: 24px;
        }
        .payroll-card {
          display: inline-block;
          width: 100%;
          margin-bottom: 24px;
          background-color: var(--color-surface);
          border: 1px solid var(--color-border);
        }
      }
    `,
  ],
})
export class PayrollSettingsComponent implements OnInit, OnDestroy {
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  rules: PayrollRules | null = null;
  defaultRules: PayrollRules | null = null;
  editedFields: Partial<PayrollRules> = {};
  loading = false;
  saving = false;
  applying_defaults = false;
  selectedYear = String(new Date().getFullYear());
  availableYears: string[] = [this.selectedYear];
  hasChanges = false;

  available_update = signal<PayrollUpdateAvailable | null>(null);
  show_diff = signal(false);

  readonly diffEntries = computed<DiffEntry[]>(() => {
    const update = this.available_update();
    if (!update || !update.diff) return [];
    return Object.entries(update.diff).map(([field, values]) => ({
      field,
      current: values.current,
      system: values.system,
    }));
  });

  headerActions: StickyHeaderActionButton[] = [
    {
      id: 'save',
      label: 'Guardar',
      variant: 'primary',
      icon: 'save',
      loading: false,
      disabled: true,
    },
  ];

  cards: SettingsCard[] = [
    {
      title: 'Valores Base',
      icon: 'coins',
      iconBgClass: 'bg-blue-50',
      iconTextClass: 'text-blue-600',
      subsections: [
        {
          title: 'Valores Anuales',
          fields: [
            {
              key: 'minimum_wage',
              label: 'Salario Mínimo (COP)',
              type: 'currency',
              readonly: false,
            },
            {
              key: 'transport_subsidy',
              label: 'Auxilio de Transporte (COP)',
              type: 'currency',
              readonly: false,
            },
          ],
        },
        {
          title: 'Umbrales',
          fields: [
            {
              key: 'transport_subsidy_threshold',
              label: 'Umbral Transporte (×SMMLV)',
              type: 'number',
              readonly: false,
            },
            {
              key: 'retention_exempt_threshold',
              label: 'Umbral Retención (×SMMLV)',
              type: 'number',
              readonly: false,
            },
          ],
        },
        {
          title: 'Calendario',
          fields: [
            {
              key: 'days_per_month',
              label: 'Días por Mes',
              type: 'number',
              readonly: true,
            },
            {
              key: 'days_per_year',
              label: 'Días por Año',
              type: 'number',
              readonly: true,
            },
          ],
        },
      ],
    },
    {
      title: 'Prestaciones Sociales',
      icon: 'gift',
      iconBgClass: 'bg-purple-50',
      iconTextClass: 'text-purple-600',
      subsections: [
        {
          title: 'Provisiones',
          fields: [
            {
              key: 'severance_rate',
              label: 'Cesantías',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'severance_interest_rate',
              label: 'Intereses Cesantías',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'vacation_rate',
              label: 'Vacaciones',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'bonus_rate',
              label: 'Prima',
              type: 'percent',
              readonly: false,
            },
          ],
        },
      ],
    },
    {
      title: 'Seguridad Social',
      icon: 'shield',
      iconBgClass: 'bg-green-50',
      iconTextClass: 'text-green-600',
      includeArl: true,
      subsections: [
        {
          title: 'Deducciones Empleado',
          fields: [
            {
              key: 'health_employee_rate',
              label: 'Salud',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'pension_employee_rate',
              label: 'Pensión',
              type: 'percent',
              readonly: false,
            },
          ],
        },
        {
          title: 'Aportes Empleador',
          fields: [
            {
              key: 'health_employer_rate',
              label: 'Salud',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'pension_employer_rate',
              label: 'Pensión',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'sena_rate',
              label: 'SENA',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'icbf_rate',
              label: 'ICBF',
              type: 'percent',
              readonly: false,
            },
            {
              key: 'compensation_fund_rate',
              label: 'Caja de Compensación',
              type: 'percent',
              readonly: false,
            },
          ],
        },
      ],
    },
  ];

  ngOnInit(): void {
    this.loadYears();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadYears(): void {
    this.payrollService
      .getConfiguredYears()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.availableYears = res.data.years;
          this.selectedYear = res.data.default_year;
          this.loadRules();
          this.loadAvailableUpdates();
        },
        error: () => {
          this.loadRules();
          this.loadAvailableUpdates();
        },
      });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'save') this.saveChanges();
  }

  private updateHeaderActions(): void {
    this.headerActions = [
      {
        id: 'save',
        label: this.saving ? 'Guardando...' : 'Guardar',
        variant: 'primary',
        icon: 'save',
        loading: this.saving,
        disabled: !this.hasChanges || this.saving,
      },
    ];
  }

  onYearChange(year: string): void {
    this.selectedYear = year;
    this.editedFields = {};
    this.hasChanges = false;
    this.show_diff.set(false);
    this.updateHeaderActions();
    this.loadRules();
    this.loadAvailableUpdates();
  }

  private loadRules(): void {
    this.loading = true;
    this.payrollService
      .getPayrollRules(+this.selectedYear)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.loading = false)),
      )
      .subscribe({
        next: (res) => {
          this.rules = { ...res.data };
          this.defaultRules = { ...res.data };
        },
        error: () => {
          this.toastService.error('Error al cargar las reglas de nómina');
        },
      });
  }

  private loadAvailableUpdates(): void {
    this.payrollService
      .getAvailableUpdates()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const year = +this.selectedYear;
          const update = res.data.find((u) => u.year === year && u.has_diff);
          this.available_update.set(update ?? null);
        },
        error: () => {
          // Fallo silencioso — el banner es opcional
        },
      });
  }

  toggleDiff(): void {
    this.show_diff.update((v) => !v);
  }

  applyDefaults(): void {
    const update = this.available_update();
    if (!update || this.applying_defaults) return;

    this.applying_defaults = true;
    this.payrollService
      .applySystemDefaults(update.year)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => (this.applying_defaults = false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Parámetros actualizados correctamente');
          this.available_update.set(null);
          this.show_diff.set(false);
          this.editedFields = {};
          this.hasChanges = false;
          this.updateHeaderActions();
          this.loadRules();
        },
        error: () => {
          this.toastService.error('Error al aplicar los parámetros oficiales');
        },
      });
  }

  // --- Diff helpers ---

  getFieldLabel(field: string): string {
    return FIELD_LABELS[field] ?? field;
  }

  formatValue(field: string, value: any): string {
    if (value === null || value === undefined) return '—';
    if (CURRENCY_FIELDS.has(field)) {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(Number(value));
    }
    if (PERCENT_FIELDS.has(field)) {
      return (Math.round(Number(value) * 10000) / 100).toFixed(2) + '%';
    }
    return String(value);
  }

  // --- Field value accessors ---

  getFieldValue(key: keyof PayrollRules): number {
    if (!this.rules) return 0;
    const val = this.rules[key];
    if (typeof val === 'number') return val;
    return 0;
  }

  getPercentValue(key: keyof PayrollRules): number {
    return Math.round(this.getFieldValue(key) * 10000) / 100;
  }

  getArlPercent(level: number): number {
    if (!this.rules) return 0;
    return Math.round((this.rules.arl_rates[level] || 0) * 10000) / 100;
  }

  // --- Field change handlers ---

  onFieldChange(key: keyof PayrollRules, value: number): void {
    if (!this.rules) return;
    (this.rules as any)[key] = value;
    (this.editedFields as any)[key] = value;
    this.hasChanges = true;
    this.updateHeaderActions();
  }

  onPercentChange(key: keyof PayrollRules, percent: number): void {
    const decimal = Math.round(percent * 100) / 10000;
    this.onFieldChange(key, decimal);
  }

  onArlChange(level: number, percent: number): void {
    if (!this.rules) return;
    const decimal = Math.round(percent * 100) / 10000;
    this.rules.arl_rates = { ...this.rules.arl_rates, [level]: decimal };
    this.editedFields.arl_rates = {
      ...this.editedFields.arl_rates,
      [level]: decimal,
    };
    this.hasChanges = true;
    this.updateHeaderActions();
  }

  // --- Modified indicators ---

  isModified(key: keyof PayrollRules): boolean {
    return key in this.editedFields;
  }

  isArlModified(level: number): boolean {
    return (
      !!this.editedFields.arl_rates && level in this.editedFields.arl_rates
    );
  }

  // --- Save ---

  saveChanges(): void {
    if (!this.hasChanges || this.saving) return;

    this.saving = true;
    this.updateHeaderActions();
    this.payrollService
      .updatePayrollRules(+this.selectedYear, this.editedFields)
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => {
          this.saving = false;
          this.updateHeaderActions();
        }),
      )
      .subscribe({
        next: (res) => {
          this.rules = { ...res.data };
          this.defaultRules = { ...res.data };
          this.editedFields = {};
          this.hasChanges = false;
          this.updateHeaderActions();
          this.toastService.success(
            'Reglas de nómina actualizadas exitosamente',
          );
        },
        error: () => {
          this.toastService.error('Error al actualizar las reglas de nómina');
        },
      });
  }
}
