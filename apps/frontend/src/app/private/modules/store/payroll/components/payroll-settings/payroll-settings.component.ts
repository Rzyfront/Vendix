import { Component, inject, DestroyRef, signal, computed } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { DatePipe, NgClass } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators } from '@angular/forms';

import { finalize, startWith } from 'rxjs/operators';

import { PayrollService } from '../../services/payroll.service';
import {
  PayrollRules,
  PayrollUpdateAvailable } from '../../interfaces/payroll.interface';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton } from '../../../../../../shared/components/sticky-header/sticky-header.component';

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
  current: unknown;
  system: unknown;
}

/**
 * Controles del formulario tipado de reglas de nómina. Los rates se editan
 * como porcentaje visible (ej. 8.33) y se persisten como decimal (0.0833).
 * Los valores de moneda y umbrales se editan/persisten como número crudo.
 * ARL se aplana a arl_1..arl_5 (porcentaje) para simplificar el binding.
 */
interface PayrollRulesFormControls {
  minimum_wage: FormControl<number | null>;
  transport_subsidy: FormControl<number | null>;
  transport_subsidy_threshold: FormControl<number | null>;
  retention_exempt_threshold: FormControl<number | null>;
  days_per_month: FormControl<number | null>;
  days_per_year: FormControl<number | null>;
  severance_rate: FormControl<number | null>;
  severance_interest_rate: FormControl<number | null>;
  vacation_rate: FormControl<number | null>;
  bonus_rate: FormControl<number | null>;
  health_employee_rate: FormControl<number | null>;
  pension_employee_rate: FormControl<number | null>;
  health_employer_rate: FormControl<number | null>;
  pension_employer_rate: FormControl<number | null>;
  sena_rate: FormControl<number | null>;
  icbf_rate: FormControl<number | null>;
  compensation_fund_rate: FormControl<number | null>;
  arl_1: FormControl<number | null>;
  arl_2: FormControl<number | null>;
  arl_3: FormControl<number | null>;
  arl_4: FormControl<number | null>;
  arl_5: FormControl<number | null>;
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
  compensation_fund_rate: 'Caja de compensación' };

const CURRENCY_KEYS = ['minimum_wage', 'transport_subsidy'] as const;
/** Umbrales/calendario editables como número crudo (los días son readonly). */
const NUMBER_KEYS = [
  'transport_subsidy_threshold',
  'retention_exempt_threshold',
] as const;
const READONLY_KEYS = ['days_per_month', 'days_per_year'] as const;
const PERCENT_KEYS = [
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
] as const;
const ARL_LEVELS = [1, 2, 3, 4, 5] as const;

const CURRENCY_FIELDS = new Set<string>(CURRENCY_KEYS);
const PERCENT_FIELDS = new Set<string>(PERCENT_KEYS);

@Component({
  selector: 'vendix-payroll-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    InputComponent,
    SelectorComponent,
    StickyHeaderComponent,
    DatePipe,
    NgClass,
  ],
  template: `
    <app-sticky-header
      title="Configuración de Nómina"
      [subtitle]="'Año fiscal ' + selectedYear()"
      icon="settings"
      [badgeText]="hasChanges() ? 'Cambios sin guardar' : ''"
      [badgeColor]="'yellow'"
      [badgePulse]="hasChanges()"
      [actions]="headerActions()"
      (actionClicked)="onHeaderAction($event)"
    ></app-sticky-header>

    <div class="w-full px-2 md:px-0 mt-4">
      <!-- Year Selector -->
      <div class="flex items-center gap-2 mb-4">
        <div class="w-40">
          <app-selector
            label="Año fiscal"
            size="sm"
            [formControl]="yearControl"
            [options]="yearOptions()"
          ></app-selector>
        </div>
      </div>

      <!-- Update Banner -->
      @if (available_update()) {
        <div
          class="mb-4 rounded-xl border border-[var(--color-info)] bg-[var(--color-info-light)] overflow-hidden"
        >
          <div
            class="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3 md:px-5 md:py-4"
          >
            <div
              class="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--color-info-light)] flex items-center justify-center"
            >
              <app-icon
                name="arrow-up-circle"
                [size]="18"
                class="text-[var(--color-info)]"
              />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-[var(--color-info)]">
                Parámetros de nómina actualizados disponibles
              </p>
              @if (
                available_update()!.decree_ref ||
                available_update()!.published_at
              ) {
                <p class="text-xs text-[var(--color-info)] mt-0.5">
                  @if (available_update()!.decree_ref) {
                    {{ available_update()!.decree_ref }}
                  }
                  @if (
                    available_update()!.decree_ref &&
                    available_update()!.published_at
                  ) {
                    <span class="mx-1">—</span>
                  }
                  @if (available_update()!.published_at) {
                    Publicado el
                    {{ available_update()!.published_at | date: 'd MMM yyyy' }}
                  }
                </p>
              }
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                (click)="toggleDiff()"
                class="text-xs font-medium text-[var(--color-info)] hover:text-[var(--color-info)] underline underline-offset-2 transition-colors"
              >
                {{ show_diff() ? 'Ocultar cambios' : 'Ver cambios' }}
              </button>
              <button
                type="button"
                (click)="applyDefaults()"
                [disabled]="applying_defaults()"
                class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--color-info)] hover:bg-[var(--color-info)] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                @if (applying_defaults()) {
                  <span
                    class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"
                  ></span>
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
            <div
              class="border-t border-[var(--color-info)] px-4 pb-3 md:px-5 md:pb-4 pt-3"
            >
              <p
                class="text-[10px] font-semibold text-[var(--color-info)] uppercase tracking-wider mb-2"
              >
                Cambios incluidos
              </p>
              <div class="overflow-x-auto rounded-lg border border-[var(--color-info)]">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-[var(--color-info-light)]">
                      <th
                        class="text-left px-3 py-2 font-semibold text-[var(--color-info)]"
                      >
                        Campo
                      </th>
                      <th
                        class="text-right px-3 py-2 font-semibold text-[var(--color-info)]"
                      >
                        Valor actual
                      </th>
                      <th
                        class="text-right px-3 py-2 font-semibold text-[var(--color-info)]"
                      >
                        Valor oficial
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (entry of diffEntries(); track entry.field) {
                      <tr class="border-t border-[var(--color-info)]">
                        <td class="px-3 py-2 text-text-primary font-medium">
                          {{ getFieldLabel(entry.field) }}
                        </td>
                        <td class="px-3 py-2 text-right text-error font-mono">
                          {{ formatValue(entry.field, entry.current) }}
                        </td>
                        <td
                          class="px-3 py-2 text-right text-success font-mono font-semibold"
                        >
                          {{ formatValue(entry.field, entry.system) }}
                        </td>
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
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div
            class="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"
          ></div>
          <span class="ml-3 text-sm text-text-secondary"
            >Cargando reglas...</span
          >
        </div>
      }

      <!-- Grouped Cards Grid -->
      @if (!loading() && loaded()) {
        <form [formGroup]="form">
          <div class="payroll-grid">
            @for (card of cards; track card.title) {
              <div class="payroll-card rounded-xl overflow-hidden">
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
                  @for (
                    sub of card.subsections;
                    track sub.title;
                    let last = $last
                  ) {
                    <h4
                      class="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2"
                    >
                      {{ sub.title }}
                    </h4>
                    <div
                      class="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-3"
                    >
                      @for (field of sub.fields; track field.key) {
                        <div>
                          <label
                            class="block text-[11px] font-medium text-text-secondary mb-1 leading-tight"
                          >
                            {{ field.label }}
                            @if (isModified(field.key)) {
                              <span
                                class="ml-1 inline-block w-1.5 h-1.5 bg-primary-600 rounded-full align-middle"
                                title="Modificado"
                              ></span>
                            }
                          </label>
                          @switch (field.type) {
                            @case ('currency') {
                              <app-input
                                size="sm"
                                [currency]="true"
                                [formControlName]="field.key"
                              ></app-input>
                            }
                            @case ('percent') {
                              <app-input
                                size="sm"
                                type="number"
                                step="0.01"
                                [suffixIcon]="true"
                                [formControlName]="field.key"
                              >
                                <span
                                  slot="suffix-icon"
                                  class="text-[10px] text-text-muted font-medium"
                                  >%</span
                                >
                              </app-input>
                            }
                            @case ('number') {
                              <app-input
                                size="sm"
                                type="number"
                                step="1"
                                [formControlName]="field.key"
                              ></app-input>
                            }
                          }
                        </div>
                      }
                    </div>
                    @if (!last || card.includeArl) {
                      <hr class="border-t border-border/60 my-3 md:my-4" />
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
                      @for (level of arlLevels; track level) {
                        <div>
                          <label
                            class="block text-[11px] font-medium text-text-secondary mb-1"
                          >
                            Nivel {{ level }}
                            @if (isArlModified(level)) {
                              <span
                                class="ml-1 inline-block w-1.5 h-1.5 bg-primary-600 rounded-full align-middle"
                              ></span>
                            }
                          </label>
                          <app-input
                            size="sm"
                            type="number"
                            step="0.001"
                            [suffixIcon]="true"
                            [formControlName]="'arl_' + level"
                          >
                            <span
                              slot="suffix-icon"
                              class="text-[10px] text-text-muted font-medium"
                              >%</span
                            >
                          </app-input>
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </form>
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
  ] })
export class PayrollSettingsComponent {
  private payrollService = inject(PayrollService);
  private toastService = inject(ToastService);
  private currencyFormat = inject(CurrencyFormatService);
  private destroyRef = inject(DestroyRef);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly applying_defaults = signal(false);

  readonly available_update = signal<PayrollUpdateAvailable | null>(null);
  readonly show_diff = signal(false);

  readonly arlLevels = ARL_LEVELS;

  /** Selector de año (fuente de verdad para el año fiscal activo). */
  readonly yearControl = new FormControl<string>(
    String(new Date().getFullYear()),
    { nonNullable: true },
  );
  readonly selectedYear = toSignal(
    this.yearControl.valueChanges.pipe(startWith(this.yearControl.value)),
    { initialValue: this.yearControl.value },
  );
  readonly availableYears = signal<string[]>([
    String(new Date().getFullYear()),
  ]);
  readonly yearOptions = computed<SelectorOption[]>(() =>
    this.availableYears().map((y) => ({ value: y, label: y })),
  );

  /** Snapshot de los valores cargados (en formato de formulario). */
  private readonly baseline = signal<Record<string, number> | null>(null);
  /** True cuando ya hay reglas cargadas (habilita el render del grid). */
  readonly loaded = computed(() => this.baseline() !== null);

  readonly form = new FormGroup<PayrollRulesFormControls>({
    minimum_wage: new FormControl<number | null>(null, [Validators.min(0)]),
    transport_subsidy: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    transport_subsidy_threshold: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    retention_exempt_threshold: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    days_per_month: new FormControl<number | null>({
      value: null,
      disabled: true,
    }),
    days_per_year: new FormControl<number | null>({
      value: null,
      disabled: true,
    }),
    severance_rate: new FormControl<number | null>(null, [Validators.min(0)]),
    severance_interest_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    vacation_rate: new FormControl<number | null>(null, [Validators.min(0)]),
    bonus_rate: new FormControl<number | null>(null, [Validators.min(0)]),
    health_employee_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    pension_employee_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    health_employer_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    pension_employer_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    sena_rate: new FormControl<number | null>(null, [Validators.min(0)]),
    icbf_rate: new FormControl<number | null>(null, [Validators.min(0)]),
    compensation_fund_rate: new FormControl<number | null>(null, [
      Validators.min(0),
    ]),
    arl_1: new FormControl<number | null>(null, [Validators.min(0)]),
    arl_2: new FormControl<number | null>(null, [Validators.min(0)]),
    arl_3: new FormControl<number | null>(null, [Validators.min(0)]),
    arl_4: new FormControl<number | null>(null, [Validators.min(0)]),
    arl_5: new FormControl<number | null>(null, [Validators.min(0)]),
  });

  /** Valores actuales del form puenteados a signal (zoneless-safe). */
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );

  /** Estado de validez puenteado a signal (form.status no es reactivo). */
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  readonly formValid = computed(() => this.formStatus() === 'VALID');

  /** Claves cuyo valor difiere del snapshot cargado. */
  readonly modifiedKeys = computed<Set<string>>(() => {
    const base = this.baseline();
    if (!base) return new Set<string>();
    const current = this.formValue() as Record<string, number | null>;
    const changed = new Set<string>();
    for (const key of [...CURRENCY_KEYS, ...NUMBER_KEYS, ...PERCENT_KEYS]) {
      if (!this.numEq(current[key], base[key])) changed.add(key);
    }
    for (const level of ARL_LEVELS) {
      const k = `arl_${level}`;
      if (!this.numEq(current[k], base[k])) changed.add(k);
    }
    return changed;
  });

  readonly hasChanges = computed(() => this.modifiedKeys().size > 0);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const saving = this.saving();
    return [
      {
        id: 'save',
        label: saving ? 'Guardando...' : 'Guardar',
        variant: 'primary',
        icon: 'save',
        loading: saving,
        disabled: !this.hasChanges() || saving || !this.formValid() },
    ];
  });

  readonly diffEntries = computed<DiffEntry[]>(() => {
    const update = this.available_update();
    if (!update || !update.diff) return [];
    return Object.entries(update.diff).map(([field, values]) => ({
      field,
      current: values.current,
      system: values.system }));
  });

  cards: SettingsCard[] = [
    {
      title: 'Valores Base',
      icon: 'coins',
      iconBgClass: 'bg-[var(--color-info-light)]',
      iconTextClass: 'text-[var(--color-info)]',
      subsections: [
        {
          title: 'Valores Anuales',
          fields: [
            {
              key: 'minimum_wage',
              label: 'Salario Mínimo (COP)',
              type: 'currency',
              readonly: false },
            {
              key: 'transport_subsidy',
              label: 'Auxilio de Transporte (COP)',
              type: 'currency',
              readonly: false },
          ] },
        {
          title: 'Umbrales',
          fields: [
            {
              key: 'transport_subsidy_threshold',
              label: 'Umbral Transporte (×SMMLV)',
              type: 'number',
              readonly: false },
            {
              key: 'retention_exempt_threshold',
              label: 'Umbral Retención (×SMMLV)',
              type: 'number',
              readonly: false },
          ] },
        {
          title: 'Calendario',
          fields: [
            {
              key: 'days_per_month',
              label: 'Días por Mes',
              type: 'number',
              readonly: true },
            {
              key: 'days_per_year',
              label: 'Días por Año',
              type: 'number',
              readonly: true },
          ] },
      ] },
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
              readonly: false },
            {
              key: 'severance_interest_rate',
              label: 'Intereses Cesantías',
              type: 'percent',
              readonly: false },
            {
              key: 'vacation_rate',
              label: 'Vacaciones',
              type: 'percent',
              readonly: false },
            {
              key: 'bonus_rate',
              label: 'Prima',
              type: 'percent',
              readonly: false },
          ] },
      ] },
    {
      title: 'Seguridad Social',
      icon: 'shield',
      iconBgClass: 'bg-success-light',
      iconTextClass: 'text-success',
      includeArl: true,
      subsections: [
        {
          title: 'Deducciones Empleado',
          fields: [
            {
              key: 'health_employee_rate',
              label: 'Salud',
              type: 'percent',
              readonly: false },
            {
              key: 'pension_employee_rate',
              label: 'Pensión',
              type: 'percent',
              readonly: false },
          ] },
        {
          title: 'Aportes Empleador',
          fields: [
            {
              key: 'health_employer_rate',
              label: 'Salud',
              type: 'percent',
              readonly: false },
            {
              key: 'pension_employer_rate',
              label: 'Pensión',
              type: 'percent',
              readonly: false },
            {
              key: 'sena_rate',
              label: 'SENA',
              type: 'percent',
              readonly: false },
            {
              key: 'icbf_rate',
              label: 'ICBF',
              type: 'percent',
              readonly: false },
            {
              key: 'compensation_fund_rate',
              label: 'Caja de Compensación',
              type: 'percent',
              readonly: false },
          ] },
      ] },
  ];

  constructor() {
    this.loadYears();

    // El cambio de año recarga reglas y updates (el default inicial se aplica
    // con emitEvent:false para no disparar una recarga duplicada).
    this.yearControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.onYearChange());
  }

  private loadYears(): void {
    this.payrollService
      .getConfiguredYears()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.availableYears.set(res.data.years);
          this.yearControl.setValue(res.data.default_year, {
            emitEvent: false });
          this.loadRules();
          this.loadAvailableUpdates();
        },
        error: () => {
          this.loadRules();
          this.loadAvailableUpdates();
        } });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'save') this.saveChanges();
  }

  private onYearChange(): void {
    this.baseline.set(null);
    this.show_diff.set(false);
    this.loadRules();
    this.loadAvailableUpdates();
  }

  private loadRules(): void {
    this.loading.set(true);
    this.payrollService
      .getPayrollRules(+this.yearControl.value)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          const values = this.rulesToFormValues(res.data);
          this.baseline.set(values);
          this.form.patchValue(values);
        },
        error: () => {
          this.toastService.error('Error al cargar las reglas de nómina');
        } });
  }

  private loadAvailableUpdates(): void {
    this.payrollService
      .getAvailableUpdates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const year = +this.yearControl.value;
          const update = res.data.find((u) => u.year === year && u.has_diff);
          this.available_update.set(update ?? null);
        },
        error: () => {
          // Fallo silencioso — el banner es opcional
        } });
  }

  toggleDiff(): void {
    this.show_diff.update((v) => !v);
  }

  applyDefaults(): void {
    const update = this.available_update();
    if (!update || this.applying_defaults()) return;

    this.applying_defaults.set(true);
    this.payrollService
      .applySystemDefaults(update.year)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.applying_defaults.set(false)),
      )
      .subscribe({
        next: () => {
          this.toastService.success('Parámetros actualizados correctamente');
          this.available_update.set(null);
          this.show_diff.set(false);
          this.loadRules();
        },
        error: () => {
          this.toastService.error('Error al aplicar los parámetros oficiales');
        } });
  }

  // --- Diff helpers ---

  getFieldLabel(field: string): string {
    return FIELD_LABELS[field] ?? field;
  }

  formatValue(field: string, value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (CURRENCY_FIELDS.has(field)) {
      return this.currencyFormat.format(Number(value), 0);
    }
    if (PERCENT_FIELDS.has(field)) {
      return this.toPercent(value).toFixed(2) + '%';
    }
    return String(value);
  }

  // --- Modified indicators ---

  isModified(key: keyof PayrollRules): boolean {
    return this.modifiedKeys().has(key);
  }

  isArlModified(level: number): boolean {
    return this.modifiedKeys().has(`arl_${level}`);
  }

  // --- Value mapping (rules ⇄ form) ---

  private rulesToFormValues(rules: PayrollRules): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of CURRENCY_KEYS) out[key] = Number(rules[key]) || 0;
    for (const key of NUMBER_KEYS) out[key] = Number(rules[key]) || 0;
    for (const key of READONLY_KEYS) out[key] = Number(rules[key]) || 0;
    for (const key of PERCENT_KEYS) out[key] = this.toPercent(rules[key]);
    for (const level of ARL_LEVELS) {
      out[`arl_${level}`] = this.toPercent(rules.arl_rates?.[level] ?? 0);
    }
    return out;
  }

  /** Decimal (0.0833) → porcentaje visible (8.33). */
  private toPercent(decimal: unknown): number {
    return Math.round((Number(decimal) || 0) * 10000) / 100;
  }

  /** Porcentaje visible (8.33) → decimal persistido (0.0833). */
  private toDecimal(percent: unknown): number {
    return Math.round((Number(percent) || 0) * 100) / 10000;
  }

  private numEq(a: unknown, b: unknown): boolean {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-9;
  }

  // --- Save ---

  private buildPatch(): Partial<PayrollRules> {
    const current = this.form.getRawValue() as Record<string, number | null>;
    const base = this.baseline();
    const patch: Partial<PayrollRules> = {};
    if (!base) return patch;

    for (const key of CURRENCY_KEYS) {
      if (!this.numEq(current[key], base[key])) {
        patch[key] = Number(current[key]) || 0;
      }
    }
    for (const key of NUMBER_KEYS) {
      if (!this.numEq(current[key], base[key])) {
        patch[key] = Number(current[key]) || 0;
      }
    }
    for (const key of PERCENT_KEYS) {
      if (!this.numEq(current[key], base[key])) {
        patch[key] = this.toDecimal(current[key]);
      }
    }
    const arl: Record<number, number> = {};
    let arlChanged = false;
    for (const level of ARL_LEVELS) {
      const k = `arl_${level}`;
      if (!this.numEq(current[k], base[k])) {
        arl[level] = this.toDecimal(current[k]);
        arlChanged = true;
      }
    }
    if (arlChanged) patch.arl_rates = arl;
    return patch;
  }

  saveChanges(): void {
    if (!this.hasChanges() || this.saving() || !this.formValid()) return;

    const patch = this.buildPatch();
    this.saving.set(true);
    this.payrollService
      .updatePayrollRules(+this.yearControl.value, patch)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (res) => {
          const values = this.rulesToFormValues(res.data);
          this.baseline.set(values);
          this.form.patchValue(values);
          this.toastService.success(
            'Reglas de nómina actualizadas exitosamente',
          );
        },
        error: () => {
          this.toastService.error('Error al actualizar las reglas de nómina');
        } });
  }
}

