import {
  Component,
  DestroyRef,
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
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { ToggleComponent } from '../../toggle/toggle.component';

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

@Component({
  selector: 'app-payroll-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-5">
      <app-selector
        label="Periodicidad de pago"
        formControlName="payment_frequency"
        [options]="frequencyOptions"
        [required]="true"
      ></app-selector>

      <div class="flex items-center justify-between p-3 border border-border rounded-lg">
        <div>
          <div class="text-sm font-medium text-text-primary">
            Retención en la fuente
          </div>
          <div class="text-xs text-text-secondary mt-0.5">
            Activar cálculo automático de retención sobre salarios.
          </div>
        </div>
        <app-toggle formControlName="withholding_enabled"></app-toggle>
      </div>

      <fieldset formGroupName="parafiscales" class="space-y-2">
        <legend class="text-sm font-medium text-text-primary mb-2">
          Parafiscales y seguridad social
        </legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">SENA</span>
            <app-toggle formControlName="sena"></app-toggle>
          </div>
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">ICBF</span>
            <app-toggle formControlName="icbf"></app-toggle>
          </div>
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">Caja de Compensación</span>
            <app-toggle formControlName="caja_compensacion"></app-toggle>
          </div>
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">EPS</span>
            <app-toggle formControlName="eps"></app-toggle>
          </div>
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">ARL</span>
            <app-toggle formControlName="arl"></app-toggle>
          </div>
          <div class="flex items-center justify-between p-2 border border-border rounded">
            <span class="text-sm text-text-primary">Pensión</span>
            <app-toggle formControlName="pension"></app-toggle>
          </div>
        </div>
      </fieldset>

      <app-input
        label="Operador PILA"
        formControlName="pila_operator"
        placeholder="Ej: Aportes en Línea, SOI, etc. (opcional)"
        helperText="Plataforma Integrada de Liquidación de Aportes."
      ></app-input>
    </form>
  `,
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
      pila_operator: new FormControl('', { nonNullable: true }),
    },
  );

  readonly frequencyOptions: SelectorOption[] = [
    { value: 'MENSUAL', label: 'Mensual' },
    { value: 'QUINCENAL', label: 'Quincenal' },
    { value: 'SEMANAL', label: 'Semanal' },
  ];

  constructor() {
    effect(() => {
      const v = this.initialValue();
      if (v) this.form.patchValue(v, { emitEvent: false });
    });

    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const isValid = this.form.valid;
        this.valid.set(isValid);
        this.validityChange.emit(isValid);
        this.valueChange.emit(this.form.getRawValue());
      });
  }

  getValue(): PayrollSettingsValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }
}
