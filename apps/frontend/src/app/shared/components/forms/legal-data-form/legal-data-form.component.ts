import {
  Component,
  computed,
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
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../selector/selector.component';
import { computeNitDv, nitDvValidator } from '../../../utils/nit.util';

export type PersonType = 'NATURAL' | 'JURIDICA';
export type TaxRegime = 'COMUN' | 'SIMPLIFICADO' | 'GRAN_CONTRIBUYENTE';

export interface LegalDataValue {
  nit: string;
  nit_dv: string;
  legal_name: string;
  person_type: PersonType;
  tax_regime: TaxRegime;
  ciiu: string;
  fiscal_address: string;
  country: string;
  department: string;
  city: string;
  tax_responsibilities: string[];
}

interface LegalDataControls {
  nit: FormControl<string>;
  nit_dv: FormControl<string>;
  legal_name: FormControl<string>;
  person_type: FormControl<PersonType>;
  tax_regime: FormControl<TaxRegime>;
  ciiu: FormControl<string>;
  fiscal_address: FormControl<string>;
  country: FormControl<string>;
  department: FormControl<string>;
  city: FormControl<string>;
  tax_responsibilities: FormControl<string[]>;
}

const TAX_RESPONSIBILITY_CODES: { code: string; label: string }[] = [
  { code: 'R-99-PN', label: 'R-99-PN - No aplica - Persona natural' },
  { code: 'O-13', label: 'O-13 - Gran contribuyente' },
  { code: 'O-15', label: 'O-15 - Autorretenedor' },
  { code: 'O-23', label: 'O-23 - Agente retención IVA' },
  { code: 'O-47', label: 'O-47 - Régimen simple de tributación' },
  { code: 'R-99-PJ', label: 'R-99-PJ - No aplica - Persona jurídica' },
];

@Component({
  selector: 'app-legal-data-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, SelectorComponent],
  template: `
    <form [formGroup]="form" class="space-y-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="md:col-span-2">
          <app-input
            label="NIT / Documento"
            formControlName="nit"
            [required]="true"
            placeholder="Ej: 900123456"
            (inputChange)="onNitChange($event)"
          ></app-input>
        </div>
        <app-input
          label="Dígito de verificación"
          formControlName="nit_dv"
          [required]="true"
          [suffixIcon]="true"
          placeholder="DV"
          [helperText]="dvHint()"
        ></app-input>
      </div>

      @if (form.errors?.['nitDv']) {
        <p class="text-xs text-[var(--color-destructive)] -mt-2">
          El dígito de verificación no coincide con el NIT.
        </p>
      }

      <app-input
        label="Razón social"
        formControlName="legal_name"
        [required]="true"
        placeholder="Ej: Comercializadora ABC S.A.S."
      ></app-input>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <app-selector
          label="Tipo de persona"
          formControlName="person_type"
          [options]="personTypeOptions"
          [required]="true"
          placeholder="Seleccione tipo"
        ></app-selector>
        <app-selector
          label="Régimen tributario"
          formControlName="tax_regime"
          [options]="taxRegimeOptions"
          [required]="true"
          placeholder="Seleccione régimen"
        ></app-selector>
      </div>

      <app-input
        label="Código CIIU (Actividad económica)"
        formControlName="ciiu"
        placeholder="Ej: 4711"
        helperText="Clasificación Industrial Internacional Uniforme"
      ></app-input>

      <app-input
        label="Dirección fiscal"
        formControlName="fiscal_address"
        [required]="true"
        placeholder="Ej: Calle 100 # 15 - 20"
      ></app-input>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <app-selector
          label="País"
          formControlName="country"
          [options]="countryOptions()"
          [required]="true"
          placeholder="Seleccione país"
        ></app-selector>
        <app-input
          label="Departamento"
          formControlName="department"
          [required]="true"
          placeholder="Ej: Cundinamarca"
        ></app-input>
        <app-input
          label="Ciudad / Municipio"
          formControlName="city"
          [required]="true"
          placeholder="Ej: Bogotá"
        ></app-input>
      </div>

      <fieldset class="space-y-2">
        <legend class="text-sm font-medium text-text-primary mb-2">
          Responsabilidades tributarias
        </legend>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
          @for (resp of taxResponsibilities; track resp.code) {
            <label
              class="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border border-border hover:bg-gray-50"
            >
              <input
                type="checkbox"
                class="mt-0.5"
                [checked]="isResponsibilityChecked(resp.code)"
                [disabled]="disabled()"
                (change)="onResponsibilityToggle(resp.code, $event)"
              />
              <span class="text-text-secondary">{{ resp.label }}</span>
            </label>
          }
        </div>
      </fieldset>
    </form>
  `,
})
export class LegalDataFormComponent {
  // ── Inputs / Outputs ──────────────────────────────────────
  readonly initialValue = input<Partial<LegalDataValue> | null>(null);
  readonly disabled = input<boolean>(false);
  readonly countries = input<SelectorOption[]>([
    { value: 'CO', label: 'Colombia' },
    { value: 'MX', label: 'México' },
    { value: 'EC', label: 'Ecuador' },
    { value: 'PE', label: 'Perú' },
    { value: 'AR', label: 'Argentina' },
    { value: 'CL', label: 'Chile' },
  ]);

  readonly valueChange = output<LegalDataValue>();
  readonly validityChange = output<boolean>();

  // ── State ─────────────────────────────────────────────────
  readonly valid = signal(false);
  readonly countryOptions = computed(() => this.countries());
  readonly dvHint = signal<string>('');

  private readonly destroyRef = inject(DestroyRef);

  // ── Typed form ────────────────────────────────────────────
  readonly form: FormGroup<LegalDataControls> = new FormGroup<LegalDataControls>(
    {
      nit: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d+$/)],
      }),
      nit_dv: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.pattern(/^\d$/)],
      }),
      legal_name: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2)],
      }),
      person_type: new FormControl<PersonType>('JURIDICA', { nonNullable: true }),
      tax_regime: new FormControl<TaxRegime>('COMUN', { nonNullable: true }),
      ciiu: new FormControl('', { nonNullable: true }),
      fiscal_address: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      country: new FormControl('CO', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      department: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      city: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      tax_responsibilities: new FormControl<string[]>([], { nonNullable: true }),
    },
    { validators: nitDvValidator },
  );

  readonly taxResponsibilities = TAX_RESPONSIBILITY_CODES;

  readonly personTypeOptions: SelectorOption[] = [
    { value: 'NATURAL', label: 'Persona Natural' },
    { value: 'JURIDICA', label: 'Persona Jurídica' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: 'COMUN', label: 'Común' },
    { value: 'SIMPLIFICADO', label: 'Simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
  ];

  constructor() {
    // Prefill from initial value
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.emitCurrent();
      }
    });

    // Disabled state
    effect(() => {
      if (this.disabled()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });

    // Emit on every form change
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emitCurrent());
  }

  // ── Public API for parent ─────────────────────────────────
  getValue(): LegalDataValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── Template helpers ──────────────────────────────────────
  onNitChange(nit: string): void {
    const expected = computeNitDv(nit);
    this.dvHint.set(expected ? `DV sugerido: ${expected}` : '');
  }

  isResponsibilityChecked(code: string): boolean {
    return this.form.controls.tax_responsibilities.value.includes(code);
  }

  onResponsibilityToggle(code: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.form.controls.tax_responsibilities.value;
    const next = checked
      ? Array.from(new Set([...current, code]))
      : current.filter((c) => c !== code);
    this.form.controls.tax_responsibilities.setValue(next);
  }

  private emitCurrent(): void {
    const isValid = this.form.valid;
    this.valid.set(isValid);
    this.validityChange.emit(isValid);
    this.valueChange.emit(this.form.getRawValue());
  }
}
