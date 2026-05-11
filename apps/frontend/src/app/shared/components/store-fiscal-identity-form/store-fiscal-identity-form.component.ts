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
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';
import { InputComponent } from '../input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../selector/selector.component';
import type {
  StoreFiscalData,
  StoreFiscalNitType,
} from '../../../private/modules/store/settings/general/services/store-settings.service';

interface StoreFiscalIdentityControls {
  legal_name: FormControl<string>;
  nit_type: FormControl<StoreFiscalNitType>;
  tax_id: FormControl<string>;
  tax_id_dv: FormControl<string>;
}

const NIT_TYPES: StoreFiscalNitType[] = [
  'NIT',
  'CC',
  'CE',
  'TI',
  'PP',
  'NIT_EXTRANJERIA',
];

@Component({
  selector: 'app-store-fiscal-identity-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    ButtonComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" class="identity-form" (ngSubmit)="onSubmit()">
      <div class="identity-form__header">
        <span class="identity-form__icon">
          <app-icon name="building" [size]="18"></app-icon>
        </span>
        <div>
          <h3>Identidad legal</h3>
          <p>Datos fiscales propios de la tienda para documentos y reportes.</p>
        </div>
      </div>

      <div class="identity-form__grid">
        <div class="identity-form__wide">
          <app-input
            label="Razón social"
            [formControl]="legalNameControl"
            [control]="legalNameControl"
            [disabled]="disabled()"
            placeholder="Ej: Comercializadora ABC S.A.S."
            helperText="Máximo 255 caracteres"
          ></app-input>
          @if (fieldError('legal_name')) {
            <p class="field-error">{{ fieldError('legal_name') }}</p>
          }
        </div>

        <app-selector
          label="Tipo de documento"
          [formControl]="nitTypeControl"
          [options]="nitTypeOptions"
          [required]="true"
          [disabled]="disabled()"
          placeholder="Seleccionar"
        ></app-selector>

        <app-input
          label="Número"
          [formControl]="taxIdControl"
          [control]="taxIdControl"
          [required]="true"
          [disabled]="disabled()"
          placeholder="900123456"
          helperText="Solo números, 6 a 10 dígitos"
        ></app-input>

        <app-input
          label="DV"
          [formControl]="taxIdDvControl"
          [control]="taxIdDvControl"
          [disabled]="disabled()"
          placeholder="7"
          helperText="Opcional, 1 dígito"
        ></app-input>
      </div>

      @if (fieldError('tax_id')) {
        <p class="field-error">{{ fieldError('tax_id') }}</p>
      }
      @if (fieldError('tax_id_dv')) {
        <p class="field-error">{{ fieldError('tax_id_dv') }}</p>
      }

      <div class="identity-form__actions">
        <app-button
          type="button"
          variant="ghost"
          size="sm"
          [disabled]="disabled()"
          (clicked)="onCancel()"
        >
          Cancelar
        </app-button>
        <app-button
          type="submit"
          variant="primary"
          size="sm"
          [disabled]="disabled() || formInvalid()"
          [loading]="disabled()"
          [showTextWhileLoading]="true"
        >
          <app-icon name="save" [size]="15" slot="icon"></app-icon>
          Guardar
        </app-button>
      </div>
    </form>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .identity-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .identity-form__header {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
      }

      .identity-form__icon {
        width: 2.3rem;
        height: 2.3rem;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        border-radius: 0.5rem;
        background: color-mix(in srgb, var(--primary-color, #2563eb) 10%, transparent);
        color: var(--primary-color, #2563eb);
      }

      h3 {
        margin: 0;
        color: var(--text-primary, #111827);
        font-size: 1rem;
      }

      p {
        margin: 0.2rem 0 0;
        color: var(--text-secondary, #4b5563);
        font-size: 0.86rem;
        line-height: 1.3rem;
      }

      .identity-form__grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.85rem;
      }

      .field-error {
        margin: 0.25rem 0 0;
        color: var(--color-destructive, #b91c1c);
        font-size: 0.78rem;
      }

      .identity-form__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      @media (min-width: 768px) {
        .identity-form__grid {
          grid-template-columns: minmax(0, 1.4fr) minmax(10rem, 0.8fr) minmax(12rem, 0.9fr) minmax(6rem, 0.45fr);
          align-items: start;
        }

        .identity-form__wide {
          min-width: 0;
        }
      }
    `,
  ],
})
export class StoreFiscalIdentityFormComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly initialValue = input<StoreFiscalData | null>(null);
  readonly disabled = input<boolean>(false);
  readonly save = output<Partial<StoreFiscalData>>();
  readonly cancel = output<void>();
  readonly formInvalid = signal(true);

  readonly nitTypeOptions: SelectorOption[] = [
    { value: 'NIT', label: 'NIT' },
    { value: 'CC', label: 'Cédula de ciudadanía' },
    { value: 'CE', label: 'Cédula de extranjería' },
    { value: 'TI', label: 'Tarjeta de identidad' },
    { value: 'PP', label: 'Pasaporte' },
    { value: 'NIT_EXTRANJERIA', label: 'NIT extranjería' },
  ];

  readonly form = new FormGroup<StoreFiscalIdentityControls>({
    legal_name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(255)],
    }),
    nit_type: new FormControl<StoreFiscalNitType>('NIT', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    tax_id: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6,10}$/)],
    }),
    tax_id_dv: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^\d?$/)],
    }),
  });

  get legalNameControl(): FormControl<string> {
    return this.form.controls.legal_name;
  }

  get nitTypeControl(): FormControl<StoreFiscalNitType> {
    return this.form.controls.nit_type;
  }

  get taxIdControl(): FormControl<string> {
    return this.form.controls.tax_id;
  }

  get taxIdDvControl(): FormControl<string> {
    return this.form.controls.tax_id_dv;
  }

  constructor() {
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.formInvalid.set(this.form.invalid));

    effect(() => {
      const value = this.initialValue();
      this.form.patchValue(
        {
          legal_name: value?.legal_name ?? '',
          nit_type: this.parseNitType(value?.nit_type),
          tax_id: value?.tax_id ?? value?.nit ?? '',
          tax_id_dv: value?.tax_id_dv ?? value?.nit_dv ?? '',
        },
        { emitEvent: false },
      );
      this.form.markAsPristine();
      this.formInvalid.set(this.form.invalid);
    });

    effect(() => {
      if (this.disabled()) {
        this.form.disable({ emitEvent: false });
      } else {
        this.form.enable({ emitEvent: false });
      }
      this.formInvalid.set(this.form.invalid);
    });
  }

  fieldError(field: keyof StoreFiscalIdentityControls): string | null {
    const control = this.form.controls[field];
    if (!control.touched || control.valid) return null;

    if (control.hasError('required')) return 'Este campo es obligatorio.';
    if (control.hasError('maxlength')) return 'El texto supera la longitud permitida.';
    if (control.hasError('pattern') && field === 'tax_id') {
      return 'El número debe tener entre 6 y 10 dígitos.';
    }
    if (control.hasError('pattern') && field === 'tax_id_dv') {
      return 'El DV debe ser un solo dígito.';
    }

    return 'Valor inválido.';
  }

  onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    this.save.emit({
      legal_name: value.legal_name.trim() || null,
      nit_type: value.nit_type,
      tax_id: value.tax_id.trim(),
      nit: value.tax_id.trim(),
      tax_id_dv: value.tax_id_dv.trim() || null,
      nit_dv: value.tax_id_dv.trim() || null,
    });
  }

  onCancel(): void {
    this.cancel.emit();
  }

  private parseNitType(value: unknown): StoreFiscalNitType {
    return typeof value === 'string' &&
      NIT_TYPES.includes(value as StoreFiscalNitType)
      ? (value as StoreFiscalNitType)
      : 'NIT';
  }
}
