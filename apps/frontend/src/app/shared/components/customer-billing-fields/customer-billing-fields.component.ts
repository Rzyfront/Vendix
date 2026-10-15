import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { startWith } from 'rxjs';
import { DOCUMENT_TYPES } from '../../constants/document-types';
import { nitDvGroupValidator } from '../../utils/nit.util';

export interface CustomerBillingData {
  person_type: 'NATURAL' | 'JURIDICA';
  document_type: string;
  document_number: string;
  verification_digit: string;
  first_name: string;
  last_name: string;
  legal_name: string;
  email: string;
  phone: string;
}
const identityValidator: ValidatorFn = (group): ValidationErrors | null => {
  const data = group.getRawValue() as CustomerBillingData;
  if (data.document_number === '222222222222') return { consumerFinal: true };
  if (
    data.person_type === 'JURIDICA' &&
    (data.document_type !== 'NIT' || !data.legal_name?.trim())
  )
    return { identity: true };
  if (
    data.person_type === 'NATURAL' &&
    (!data.first_name?.trim() || !data.last_name?.trim())
  )
    return { identity: true };
  const type = DOCUMENT_TYPES.find((item) => item.code === data.document_type);
  if (!type || !type.regex.test(data.document_number || ''))
    return { document: true };
  if (data.document_type === 'NIT') {
    if (!/^\d$/.test(data.verification_digit))
      return { verificationDigit: true };
    return nitDvGroupValidator('document_number', 'verification_digit')(group);
  }
  return null;
};
export function createCustomerBillingForm() {
  return new FormGroup(
    {
      person_type: new FormControl<'NATURAL' | 'JURIDICA'>('NATURAL', {
        nonNullable: true,
      }),
      document_type: new FormControl('CC', {
        nonNullable: true,
        validators: Validators.required,
      }),
      document_number: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.maxLength(20)],
      }),
      verification_digit: new FormControl('', { nonNullable: true }),
      first_name: new FormControl('', {
        nonNullable: true,
        validators: Validators.maxLength(100),
      }),
      last_name: new FormControl('', {
        nonNullable: true,
        validators: Validators.maxLength(100),
      }),
      legal_name: new FormControl('', {
        nonNullable: true,
        validators: Validators.maxLength(255),
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.email,
          Validators.maxLength(255),
        ],
      }),
      phone: new FormControl('', {
        nonNullable: true,
        validators: Validators.maxLength(30),
      }),
    },
    { validators: identityValidator },
  );
}
/** Pure fiscal identity capture: no HTTP, customer persistence or tenant/session dependencies. */
@Component({
  selector: 'app-customer-billing-fields',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <fieldset [formGroup]="form" class="billing-fields">
    <legend>Datos del titular de la factura</legend>
    <label
      >Tipo de persona<select formControlName="person_type">
        <option value="NATURAL">Persona natural</option>
        <option value="JURIDICA">Persona jurídica</option>
      </select></label
    >
    <label
      >Tipo de documento<select formControlName="document_type">
        @for (type of documentTypes; track type.code) {
          <option [value]="type.code">{{ type.label }}</option>
        }
      </select></label
    >
    <label
      >Número de documento *<input
        formControlName="document_number"
        autocomplete="off"
        maxlength="20"
    /></label>
    @if (values().document_type === 'NIT') {
      <label
        >Dígito de verificación *<input
          formControlName="verification_digit"
          inputmode="numeric"
          maxlength="1"
      /></label>
    }
    @if (values().person_type === 'JURIDICA') {
      <label
        >Razón social *<input
          formControlName="legal_name"
          autocomplete="organization"
          maxlength="255"
      /></label>
    } @else {
      <label
        >Nombres *<input
          formControlName="first_name"
          autocomplete="given-name"
          maxlength="100"
      /></label>
      <label
        >Apellidos *<input
          formControlName="last_name"
          autocomplete="family-name"
          maxlength="100"
      /></label>
    }
    <label
      >Correo para recibir la factura *<input
        formControlName="email"
        type="email"
        autocomplete="email"
        required
        aria-describedby="billing-email-help"
    /></label>
    <small id="billing-email-help"
      >Obligatorio. Enviaremos la factura cuando la DIAN la acepte.</small
    >
    <label
      >Teléfono (opcional)<input
        formControlName="phone"
        type="tel"
        autocomplete="tel"
        maxlength="30"
    /></label>
    @if (form.touched && status() === 'INVALID') {
      <p role="alert">
        Completa los campos obligatorios y revisa el documento, su dígito de
        verificación y el correo.
      </p>
    }
  </fieldset>`,
  styles: [
    `
      :host {
        display: block;
      }
      .billing-fields {
        border: 0;
        padding: 0;
        display: grid;
        gap: 1rem;
        min-width: 0;
      }
      legend {
        font-weight: 600;
        margin-bottom: 1rem;
      }
      label {
        display: grid;
        gap: 0.4rem;
        font-size: 0.9rem;
      }
      input,
      select {
        font: inherit;
        min-height: 44px;
        width: 100%;
        box-sizing: border-box;
        padding: 0.6rem;
        border: 1px solid var(--color-border, #bbb);
        border-radius: 0.5rem;
        background: var(--color-surface, #fff);
        color: var(--color-text-primary, #222);
      }
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--color-primary, #2563eb);
        outline-offset: 2px;
      }
      small {
        color: var(--color-text-secondary, #555);
      }
      p {
        color: var(--color-text-primary, #222);
      }
    `,
  ],
})
export class CustomerBillingFieldsComponent {
  readonly initialValue = input<Partial<CustomerBillingData> | null>(null);
  readonly changed = output<CustomerBillingData>();
  readonly validChange = output<boolean>();
  readonly form = createCustomerBillingForm();
  readonly documentTypes = DOCUMENT_TYPES;
  readonly values = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );
  readonly status = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );
  readonly valid = computed(() => this.status() === 'VALID');
  private readonly destroyRef = inject(DestroyRef);
  constructor() {
    effect(() => {
      const value = this.initialValue();
      if (value) this.form.patchValue(value);
    });
    this.form.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.changed.emit(this.form.getRawValue()));
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.validChange.emit(status === 'VALID'));
    this.form.controls.person_type.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((type) => {
        if (type === 'JURIDICA')
          this.form.controls.document_type.setValue('NIT');
      });
  }
}
