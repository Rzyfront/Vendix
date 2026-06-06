import {
  ChangeDetectionStrategy,
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
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../selector/selector.component';
import {
  NitType,
  TaxRegime,
} from '../../../forms/legal-data-form/legal-data-form.component';
import { computeNitDv, nitDvValidator } from '../../../../utils/nit.util';

/**
 * Lightweight fiscal data captured during onboarding. Every field is
 * optional for the user, but the shape is aligned with the backend
 * `fiscal_data` payload so the parent step can forward it directly.
 */
export interface OnboardingFiscalValue {
  legal_name: string;
  nit: string;
  nit_dv: string;
  nit_type: NitType;
  tax_regime: TaxRegime;
}

interface OnboardingFiscalControls {
  legal_name: FormControl<string>;
  nit: FormControl<string>;
  nit_dv: FormControl<string>;
  nit_type: FormControl<NitType>;
  tax_regime: FormControl<TaxRegime>;
}

/**
 * Reusable, lightweight fiscal section for the onboarding wizard.
 *
 * Unlike `LegalDataFormComponent`, this component does NOT require address,
 * city, CIIU, or tax responsibilities — it keeps onboarding friction low.
 * All fields are optional, but the NIT + DV pair is validated together via
 * the shared `nitDvValidator` (DIAN módulo-11) so an inconsistent DV is
 * surfaced before submission.
 *
 * Public API for the parent step:
 * - `valueChange`     emits a partial fiscal payload on every change.
 * - `validityChange`  emits whether the current value is consistent.
 * - `getValue()`      returns the current (raw) value.
 * - `markAllTouched()` forces validation display.
 */
@Component({
  selector: 'app-onboarding-fiscal-section',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputComponent, SelectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      padding: 0.75rem 1rem 1rem;
    }

    @media (min-width: 768px) {
      :host {
        padding: 1rem 1.25rem 1.25rem;
      }
    }
  `,
  template: `
    <form [formGroup]="form" class="space-y-4">
      <app-input
        label="Razón social"
        formControlName="legal_name"
        placeholder="Ej: Comercializadora ABC S.A.S."
      ></app-input>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <app-selector
          label="Tipo de documento"
          formControlName="nit_type"
          [options]="nitTypeOptions"
          placeholder="Seleccione tipo"
        ></app-selector>
        <div class="md:col-span-1">
          <app-input
            label="NIT / Documento"
            formControlName="nit"
            placeholder="Ej: 900123456"
            (inputChange)="onNitChange($event)"
          ></app-input>
        </div>
        <app-input
          label="Dígito de verificación"
          formControlName="nit_dv"
          placeholder="DV"
          [helperText]="dvHint()"
        ></app-input>
      </div>

      @if (form.errors?.['nitDv']) {
        <p class="text-xs text-[var(--color-destructive)] -mt-2">
          El dígito de verificación no coincide con el NIT.
        </p>
      }

      <app-selector
        label="Régimen tributario"
        formControlName="tax_regime"
        [options]="taxRegimeOptions"
        placeholder="Seleccione régimen"
      ></app-selector>
    </form>
  `,
})
export class OnboardingFiscalSectionComponent {
  // ── Inputs / Outputs ──────────────────────────────────────
  readonly initialValue = input<Partial<OnboardingFiscalValue> | null>(null);

  readonly valueChange = output<Partial<OnboardingFiscalValue>>();
  readonly validityChange = output<boolean>();

  // ── State (signals for zoneless templates) ────────────────
  readonly dvHint = signal<string>('');

  private readonly destroyRef = inject(DestroyRef);

  // ── Typed form ────────────────────────────────────────────
  readonly form: FormGroup<OnboardingFiscalControls> =
    new FormGroup<OnboardingFiscalControls>(
      {
        legal_name: new FormControl('', { nonNullable: true }),
        nit: new FormControl('', {
          nonNullable: true,
          validators: [Validators.pattern(/^\d*$/)],
        }),
        nit_dv: new FormControl('', {
          nonNullable: true,
          validators: [Validators.pattern(/^\d?$/)],
        }),
        nit_type: new FormControl<NitType>('NIT', { nonNullable: true }),
        tax_regime: new FormControl<TaxRegime>('COMUN', { nonNullable: true }),
      },
      // Reuse shared DIAN módulo-11 validator at group level.
      { validators: nitDvValidator },
    );

  // ── Selector options ──────────────────────────────────────
  readonly nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cédula de ciudadanía' },
    { value: 'CE', label: 'Cédula de extranjería' },
    { value: 'TI', label: 'Tarjeta de identidad' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT extranjería' },
  ];

  readonly taxRegimeOptions: SelectorOption[] = [
    { value: 'COMUN', label: 'Común' },
    { value: 'SIMPLIFICADO', label: 'Simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
  ];

  constructor() {
    // Prefill from the bound initial value. Inputs are set after
    // construction, so this must run in an effect (not the constructor body).
    effect(() => {
      const v = this.initialValue();
      if (v) {
        this.form.patchValue(v, { emitEvent: false });
        this.refreshDvHint(this.form.controls.nit.value);
        this.emitCurrent();
      }
    });

    // Emit current state on every change.
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.emitCurrent());
  }

  // ── Public API for parent step ────────────────────────────
  getValue(): OnboardingFiscalValue {
    return this.form.getRawValue();
  }

  markAllTouched(): void {
    this.form.markAllAsTouched();
  }

  // ── Template helpers ──────────────────────────────────────
  onNitChange(nit: string): void {
    this.refreshDvHint(nit);
  }

  private refreshDvHint(nit: string): void {
    const expected = computeNitDv(nit);
    this.dvHint.set(expected ? `DV sugerido: ${expected}` : '');
  }

  private emitCurrent(): void {
    this.validityChange.emit(this.form.valid);
    this.valueChange.emit(this.form.getRawValue());
  }
}
