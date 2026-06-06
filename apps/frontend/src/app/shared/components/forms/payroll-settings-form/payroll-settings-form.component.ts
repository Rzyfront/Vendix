import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { ToggleComponent } from '../../toggle/toggle.component';
import { TooltipComponent } from '../../tooltip/tooltip.component';
import { IconComponent } from '../../icon/icon.component';

export type PaymentFrequency = 'MENSUAL' | 'QUINCENAL' | 'SEMANAL';

export interface PayrollParafiscales {
  sena: boolean;
  icbf: boolean;
  caja_compensacion: boolean;
  eps: boolean;
  arl: boolean;
  pension: boolean;
}

export interface PayrollSettingsValue {
  payment_frequency: PaymentFrequency;
  withholding_enabled: boolean;
  parafiscales: PayrollParafiscales;
  pila_operator: string;
}

interface ParafiscalesControls {
  sena: FormControl<boolean>;
  icbf: FormControl<boolean>;
  caja_compensacion: FormControl<boolean>;
  eps: FormControl<boolean>;
  arl: FormControl<boolean>;
  pension: FormControl<boolean>;
}

interface PayrollSettingsControls {
  payment_frequency: FormControl<PaymentFrequency>;
  withholding_enabled: FormControl<boolean>;
  parafiscales: FormGroup<ParafiscalesControls>;
  pila_operator: FormControl<string>;
}

interface ParafiscalDescriptor {
  key: keyof ParafiscalesControls;
  label: string;
  /** Short human description (1 line) shown next to the toggle. */
  short: string;
  /** Long description used in the help tooltip. */
  long: string;
}

/**
 * SENA / ICBF / Caja de Compensación son los llamados "parafiscales" en
 * Colombia. EPS / Pensión / ARL son "seguridad social". El form anterior
 * mezclaba los dos bajo un mismo fieldset; ahora se renderizan en dos
 * fieldsets separados para evitar confusiones al usuario.
 */
const PARAFISCALES_DESCRIPTORS: ParafiscalDescriptor[] = [
  {
    key: 'sena',
    label: 'SENA',
    short: 'Aporte al Servicio Nacional de Aprendizaje (2% sobre la nómina).',
    long:
      'Aporte parafiscal del 2% sobre el total de la nómina. Lo recaudan las cajas de compensación para financiar la formación técnica.',
  },
  {
    key: 'icbf',
    label: 'ICBF',
    short: 'Instituto Colombiano de Bienestar Familiar (3% sobre la nómina).',
    long:
      'Aporte parafiscal del 3% sobre la nómina, dirigido a programas de bienestar familiar y atención a la primera infancia.',
  },
  {
    key: 'caja_compensacion',
    label: 'Caja de Compensación',
    short: 'Aporte del 4% sobre la nómina (subsidio familiar, recreación).',
    long:
      'Aporte parafiscal del 4% sobre la nómina. Los empleados acceden a subsidio familiar, recreación y vivienda. CajaCompensar, Comfenalco, Compensar, etc.',
  },
];

const SEGURIDAD_SOCIAL_DESCRIPTORS: ParafiscalDescriptor[] = [
  {
    key: 'eps',
    label: 'EPS (Salud)',
    short: 'Entidad Promotora de Salud — aporte del 8.5% del salario.',
    long:
      'Aporte a salud del 8.5% del salario (4% empleado, 4.5% empleador). El empleado escoge libremente su EPS (Sura, Sanitas, Nueva EPS, Compensar, etc.).',
  },
  {
    key: 'pension',
    label: 'Pensión',
    short: 'Fondo de pensiones — aporte del 12% del salario.',
    long:
      'Aporte a pensión del 12% del salario (4% empleado, 8% empleador). El empleado escoge entre Colpensiones (público) o un fondo privado (Porvenir, Protección, Skandia, etc.).',
  },
  {
    key: 'arl',
    label: 'ARL (Riesgos laborales)',
    short: 'Aseguradora de Riesgos Laborales — depende del nivel de riesgo.',
    long:
      'Aporte a riesgos laborales. El porcentaje va del 0.522% al 6.960% según el nivel de riesgo I-V de la actividad económica. Lo asume 100% el empleador.',
  },
];

const FREQUENCY_DESCRIPTORS: Record<
  PaymentFrequency,
  { hint: string; long: string }
> = {
  MENSUAL: {
    hint: 'Una liquidación al final de cada mes (forma más común).',
    long:
      'Periodicidad mensual: una sola liquidación de nómina al final del mes. Es la forma más usada para empleados con contrato a término indefinido.',
  },
  QUINCENAL: {
    hint: 'Dos liquidaciones al mes (día 15 y último día).',
    long:
      'Periodicidad quincenal: dos liquidaciones al mes, típicamente los días 15 y 30/31. Común en empresas con flujo de caja quincenal.',
  },
  SEMANAL: {
    hint: 'Una liquidación por semana.',
    long:
      'Periodicidad semanal: siete liquidaciones al mes. Típica en comercio, manufactura y trabajo por turnos.',
  },
};

@Component({
  selector: 'app-payroll-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    TooltipComponent,
    IconComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-5">
      <!-- ─── 1. Pago (periodicidad) ────────────────────────────────────── -->
      <fieldset class="space-y-2">
        <legend
          class="text-sm font-medium text-text-primary mb-2 flex items-center gap-1.5"
        >
          <app-icon name="calendar" [size]="14" class="text-text-muted"></app-icon>
          <span>Pago</span>
        </legend>
        <app-selector
          label="Periodicidad de pago"
          formControlName="payment_frequency"
          [options]="frequencyOptions"
          [required]="true"
          [tooltipText]="frequencyLong()"
          [helpText]="frequencyHint()"
        ></app-selector>
      </fieldset>

      <!-- ─── 2. Retención en la fuente ────────────────────────────────── -->
      <fieldset class="space-y-2">
        <legend
          class="text-sm font-medium text-text-primary mb-2 flex items-center gap-1.5"
        >
          <app-icon name="dollar-sign" [size]="14" class="text-text-muted"></app-icon>
          <span>Retención en la fuente</span>
        </legend>
        <div class="flex items-center justify-between p-3 border border-border rounded-lg">
          <div class="min-w-0 pr-3">
            <div class="text-sm font-medium text-text-primary flex items-center gap-1.5">
              <span>Activar retención en la fuente sobre salarios</span>
              <app-tooltip
                content="Calcula y deduce automáticamente la retención en la fuente aplicable a cada salario, según la tabla del Estatuto Tributario (Art. 383 ET) y la normatividad vigente. Si lo desactivas, no se hará ninguna deducción automática por este concepto."
                position="top"
              >
                <span class="help-icon">
                  <app-icon name="help-circle" [size]="14"></app-icon>
                </span>
              </app-tooltip>
            </div>
            <div class="text-xs text-text-secondary mt-0.5">
              Deducción automática de retención en la fuente sobre el salario
              bruto, según las tablas oficiales (procedimiento 1 del ET).
            </div>
          </div>
          <app-toggle formControlName="withholding_enabled"></app-toggle>
        </div>
      </fieldset>

      <!-- ─── 3. Seguridad social ───────────────────────────────────────── -->
      <fieldset formGroupName="parafiscales" class="space-y-2">
        <legend
          class="text-sm font-medium text-text-primary mb-2 flex items-center gap-1.5"
        >
          <app-icon name="shield" [size]="14" class="text-text-muted"></app-icon>
          <span>Seguridad social</span>
          <app-tooltip
            content="Aportes obligatorios a salud, pensión y riesgos laborales. El empleado elige libremente su EPS y fondo de pensiones. La ARL depende del nivel de riesgo de la actividad económica."
            position="top"
          >
            <span class="help-icon">
              <app-icon name="help-circle" [size]="14"></app-icon>
            </span>
          </app-tooltip>
        </legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          @for (item of seguridadSocialItems; track item.key) {
            <div
              class="flex items-start justify-between gap-2 p-2.5 border border-border rounded"
            >
              <div class="min-w-0 flex-1">
                <div
                  class="text-sm font-medium text-text-primary flex items-center gap-1.5"
                >
                  <span>{{ item.label }}</span>
                  <app-tooltip
                    [content]="item.long"
                    position="top"
                  >
                    <span class="help-icon">
                      <app-icon name="help-circle" [size]="13"></app-icon>
                    </span>
                  </app-tooltip>
                </div>
                <p class="text-[11px] text-text-secondary mt-0.5">
                  {{ item.short }}
                </p>
              </div>
              <app-toggle [formControlName]="item.key"></app-toggle>
            </div>
          }
        </div>
      </fieldset>

      <!-- ─── 4. Parafiscales ──────────────────────────────────────────── -->
      <fieldset formGroupName="parafiscales" class="space-y-2">
        <legend
          class="text-sm font-medium text-text-primary mb-2 flex items-center gap-1.5"
        >
          <app-icon name="book" [size]="14" class="text-text-muted"></app-icon>
          <span>Parafiscales</span>
          <app-tooltip
            content="Aportes parafiscales obligatorios sobre la nómina: SENA (2%), ICBF (3%) y Caja de Compensación (4%). Los recauda la Caja donde el empleado esté afiliado y financian formación, bienestar familiar y subsidio familiar."
            position="top"
          >
            <span class="help-icon">
              <app-icon name="help-circle" [size]="14"></app-icon>
            </span>
          </app-tooltip>
        </legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          @for (item of parafiscalesItems; track item.key) {
            <div
              class="flex items-start justify-between gap-2 p-2.5 border border-border rounded"
            >
              <div class="min-w-0 flex-1">
                <div
                  class="text-sm font-medium text-text-primary flex items-center gap-1.5"
                >
                  <span>{{ item.label }}</span>
                  <app-tooltip
                    [content]="item.long"
                    position="top"
                  >
                    <span class="help-icon">
                      <app-icon name="help-circle" [size]="13"></app-icon>
                    </span>
                  </app-tooltip>
                </div>
                <p class="text-[11px] text-text-secondary mt-0.5">
                  {{ item.short }}
                </p>
              </div>
              <app-toggle [formControlName]="item.key"></app-toggle>
            </div>
          }
        </div>
      </fieldset>

      <!-- ─── 5. Operador PILA ─────────────────────────────────────────── -->
      <fieldset class="space-y-2">
        <legend
          class="text-sm font-medium text-text-primary mb-2 flex items-center gap-1.5"
        >
          <app-icon name="link" [size]="14" class="text-text-muted"></app-icon>
          <span>Operador PILA</span>
        </legend>
        <app-input
          label="Operador PILA"
          formControlName="pila_operator"
          placeholder="Ej: Aportes en Línea, SOI, Mi Planilla, Asopagos…"
          [helperText]="
            'Plataforma Integrada de Liquidación de Aportes. ' +
            'Opcional — Vendix puede precargarlo en futuras liquidaciones si lo registras aquí.'
          "
          tooltipText="Plataforma Integrada de Liquidación de Aportes (PILA) — sistema del Ministerio de Protección Social donde se pagan mensualmente salud, pensión, ARL y parafiscales."
          [maxlength]="60"
        ></app-input>
        @if (
          form.controls.pila_operator.invalid &&
          (form.controls.pila_operator.touched || form.controls.pila_operator.dirty)
        ) {
          <p class="text-xs text-[var(--color-destructive)]">
            El nombre del operador PILA no puede superar 60 caracteres.
          </p>
        }
      </fieldset>

      <!-- ─── 6. Resumen de la configuración ────────────────────────────── -->
      <section
        role="region"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Resumen de la configuración de nómina"
        class="rounded-lg border border-sky-200 bg-sky-50 p-3 space-y-2"
      >
        <header class="flex items-center gap-2">
          <app-icon
            name="info"
            [size]="16"
            class="text-sky-700 shrink-0"
          ></app-icon>
          <h4 class="text-sm font-semibold text-sky-900">
            Resumen de tu configuración
          </h4>
        </header>
        <ul class="text-xs text-sky-900 space-y-1 pl-1">
          <li class="flex items-start gap-2">
            <span class="font-medium min-w-[7.5rem]">Periodicidad:</span>
            <span>{{ frequencyHint() }}</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-medium min-w-[7.5rem]">Retención:</span>
            <span>
              {{
                form.controls.withholding_enabled.value
                  ? 'Activa — se calcula automáticamente sobre cada salario.'
                  : 'Inactiva — no se deducirá retención en la fuente.'
              }}
            </span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-medium min-w-[7.5rem]">Seguridad social:</span>
            <span>
              {{ enabledCount('seguridad') }} / 3 aportes activos
              ({{ enabledLabels('seguridad') || 'ninguno' }})
            </span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-medium min-w-[7.5rem]">Parafiscales:</span>
            <span>
              {{ enabledCount('parafiscales') }} / 3 aportes activos
              ({{ enabledLabels('parafiscales') || 'ninguno' }})
            </span>
          </li>
          <li class="flex items-start gap-2">
            <span class="font-medium min-w-[7.5rem]">Operador PILA:</span>
            <span>
              {{
                form.controls.pila_operator.value.trim() ||
                  'No registrado — puedes llenarlo más tarde.'
              }}
            </span>
          </li>
        </ul>
        <p class="text-[11px] text-sky-800 italic pt-1 border-t border-sky-200/60">
          Esta configuración se usa como base para la liquidación de nómina.
          Las tarifas reales (porcentajes) se consultan en la matriz de
          reglas del año vigente.
        </p>
      </section>
    </form>
  `,
  styles: [
    `
      .help-icon {
        color: var(--color-text-muted, #64748b);
        cursor: help;
        position: relative;
        display: inline-flex;
        transition: color 0.2s ease;
      }
      .help-icon:hover {
        color: var(--color-primary, #7ed7a5);
      }
    `,
  ],
})
export class PayrollSettingsFormComponent {
  readonly initialValue = input<Partial<PayrollSettingsValue> | null>(null);
  readonly disabled = input<boolean>(false);

  readonly valueChange = output<PayrollSettingsValue>();
  readonly validityChange = output<boolean>();

  readonly valid = signal(true);

  private readonly destroyRef = inject(DestroyRef);

  readonly form: FormGroup<PayrollSettingsControls> = new FormGroup<PayrollSettingsControls>(
    {
      payment_frequency: new FormControl<PaymentFrequency>('MENSUAL', {
        nonNullable: true,
      }),
      withholding_enabled: new FormControl(false, { nonNullable: true }),
      parafiscales: new FormGroup<ParafiscalesControls>({
        sena: new FormControl(true, { nonNullable: true }),
        icbf: new FormControl(true, { nonNullable: true }),
        caja_compensacion: new FormControl(true, { nonNullable: true }),
        eps: new FormControl(true, { nonNullable: true }),
        arl: new FormControl(true, { nonNullable: true }),
        pension: new FormControl(true, { nonNullable: true }),
      }),
      pila_operator: new FormControl('', {
        nonNullable: true,
        validators: [Validators.maxLength(60)],
      }),
    },
  );

  readonly frequencyOptions: SelectorOption[] = [
    { value: 'MENSUAL', label: 'Mensual' },
    { value: 'QUINCENAL', label: 'Quincenal' },
    { value: 'SEMANAL', label: 'Semanal' },
  ];

  readonly parafiscalesItems = PARAFISCALES_DESCRIPTORS;
  readonly seguridadSocialItems = SEGURIDAD_SOCIAL_DESCRIPTORS;

  /** Track the active frequency so the summary panel and tooltips update reactively. */
  readonly paymentFrequency = signal<PaymentFrequency>('MENSUAL');

  readonly frequencyHint = computed(
    () => FREQUENCY_DESCRIPTORS[this.paymentFrequency()].hint,
  );
  readonly frequencyLong = computed(
    () => FREQUENCY_DESCRIPTORS[this.paymentFrequency()].long,
  );

  /**
   * Returns the number of enabled items in the given category. Powers the
   * "X / 3 aportes activos" line of the summary panel.
   */
  enabledCount(category: 'seguridad' | 'parafiscales'): number {
    const items =
      category === 'seguridad'
        ? this.seguridadSocialItems
        : this.parafiscalesItems;
    const group = this.form.controls.parafiscales;
    return items.filter((i) => group.controls[i.key].value).length;
  }

  /** Comma-separated labels of currently-enabled items in the category. */
  enabledLabels(category: 'seguridad' | 'parafiscales'): string {
    const items =
      category === 'seguridad'
        ? this.seguridadSocialItems
        : this.parafiscalesItems;
    const group = this.form.controls.parafiscales;
    return items
      .filter((i) => group.controls[i.key].value)
      .map((i) => i.label)
      .join(', ');
  }

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.emitCurrent();
      }
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.paymentFrequency.set(this.form.controls.payment_frequency.value);
        this.emitCurrent();
      });
  }

  getValue(): PayrollSettingsValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.form.getRawValue());
  }
}
