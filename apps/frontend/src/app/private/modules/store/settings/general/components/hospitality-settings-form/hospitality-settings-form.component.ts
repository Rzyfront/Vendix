import { Component, effect, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { HospitalitySettings } from '../../../../../../../core/models/store-settings.interface';

/** Same `HH:mm` rule the backend DTO enforces. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The backend takes these as integers (`@IsInt()`): `app-input` emits the typed text, so «20.5»
 * would pass `min/max` and reject the whole PATCH. Empty is left to `required`.
 */
const wholeNumber = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  return value === '' || /^\d+$/.test(value) ? null : { wholeNumber: true };
};
const WHOLE_NUMBER_ERROR = 'Escribe un número entero, sin decimales.';
const NUMERIC_FIELDS = new Set([
  'default_overbooking_allowance',
  'booking_hold_minutes',
  'ical_import_interval_minutes',
]);

/** Usual room-charge origins; «Otro» keeps the setting free text (U17). */
const ROOM_CHARGE_ORIGINS = ['Restaurante', 'Bar', 'Cafetería', 'Minibar', 'Servicio a la habitación'];
const OTHER_ORIGIN = '__other__';

/**
 * Hotelería (H0.5/H1.2/H1.6/H3.4/H3.7): check-in/check-out, no-show and night audit hours, the RNT
 * number and the overbooking new room types start with.
 *
 * U17 — autosaved: every change emits a partial patch with the VALID fields only, so an invalid
 * field shows its error under itself without blocking the others.
 */
@Component({
  selector: 'app-hospitality-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, SelectorComponent, ToggleComponent],
  template: `
    <form [formGroup]="form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <app-input
        [formControl]="checkInControl"
        [control]="checkInControl"
        [required]="true"
        type="time"
        label="Hora de llegada (check-in)"
        helperText="Desde esta hora el huésped puede entrar a la habitación."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="checkOutControl"
        [control]="checkOutControl"
        [required]="true"
        type="time"
        label="Hora de salida (check-out)"
        helperText="Hasta esta hora el huésped debe entregar la habitación."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="noShowControl"
        [control]="noShowControl"
        [required]="true"
        type="time"
        label="Hora para marcar «No se presentó»"
        helperText="Al día siguiente de la llegada, a esta hora, la reserva del huésped que no llegó pasa a «No se presentó» y deja libres sus noches."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="nightAuditControl"
        [control]="nightAuditControl"
        [required]="true"
        type="time"
        label="Hora del cierre del día"
        helperText="Hora de madrugada: desde ella se suma a la cuenta de cada huésped hospedado la noche que acaba de pasar."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="rntControl"
        [control]="rntControl"
        label="Registro Nacional de Turismo (RNT)"
        placeholder="12345"
        helperText="Número de registro del hotel ante el Ministerio de Comercio. Sale en los documentos del huésped."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="overbookingControl"
        [control]="overbookingControl"
        [error]="wholeNumberError(overbookingControl)"
        [required]="true"
        type="number"
        [min]="0"
        [max]="99"
        label="Reservas de más por tipo de habitación"
        helperText="Cuántas reservas por encima de las habitaciones disponibles acepta cada tipo nuevo. 0 = nunca vender de más."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="holdMinutesControl"
        [control]="holdMinutesControl"
        [error]="wholeNumberError(holdMinutesControl)"
        [required]="true"
        type="number"
        [min]="5"
        [max]="120"
        label="Minutos para pagar una reserva en línea"
        helperText="Tiempo que se aparta la habitación mientras el huésped paga en la tienda en línea (5 a 120)."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="icalIntervalControl"
        [control]="icalIntervalControl"
        [error]="wholeNumberError(icalIntervalControl)"
        [required]="true"
        type="number"
        [min]="5"
        [max]="1440"
        label="Minutos entre lecturas de calendarios externos"
        helperText="Cada cuánto se revisan los calendarios de Airbnb o Booking para bloquear sus fechas (5 a 1440)."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-selector
        [options]="originOptions"
        [value]="originChoice()"
        [required]="true"
        label="Origen de cargos"
        helpText="Cómo aparece en la cuenta del huésped un consumo cargado a la habitación desde el POS o una mesa."
        size="sm"
        (valueChange)="onOriginChoice($event)"
      ></app-selector>
      @if (originChoice() === OTHER_ORIGIN) {
        <app-input
          [formControl]="roomChargeOriginControl"
          [control]="roomChargeOriginControl"
          [required]="true"
          label="Nombre del origen"
          placeholder="Spa"
          helperText="El nombre que verá el huésped en su cuenta."
          size="sm"
          (inputChange)="onFieldChange()"
        ></app-input>
      }
      <div class="md:col-span-2">
        <app-toggle
          [checked]="verification()"
          label="Revisar la cuenta antes de facturar"
          (changed)="onVerificationChange($event)"
        />
        <p class="mt-1 text-xs text-text-secondary">
          La factura de salida espera a que alguien con permiso para revisar cuentas la apruebe.
        </p>
      </div>
    </form>
  `,
})
export class HospitalitySettingsForm {
  readonly settings = input.required<HospitalitySettings>();
  readonly settingsChange = output<Partial<HospitalitySettings>>();

  protected readonly OTHER_ORIGIN = OTHER_ORIGIN;
  protected readonly originOptions: SelectorOption[] = [
    ...ROOM_CHARGE_ORIGINS.map((origin) => ({ value: origin, label: origin })),
    { value: OTHER_ORIGIN, label: 'Otro' },
  ];
  /** Selected option of «Origen de cargos»; `OTHER_ORIGIN` shows the free-text field. */
  protected readonly originChoice = signal<string>('Restaurante');

  readonly checkInControl = new FormControl('15:00', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(HH_MM)],
  });
  readonly checkOutControl = new FormControl('12:00', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(HH_MM)],
  });
  readonly noShowControl = new FormControl('06:00', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(HH_MM)],
  });
  readonly nightAuditControl = new FormControl('02:00', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(HH_MM)],
  });
  readonly rntControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(20)],
  });

  readonly overbookingControl = new FormControl<number>(0, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(0), Validators.max(99), wholeNumber],
  });

  readonly holdMinutesControl = new FormControl<number>(15, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(5), Validators.max(120), wholeNumber],
  });

  readonly icalIntervalControl = new FormControl<number>(15, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(5), Validators.max(1440), wholeNumber],
  });

  readonly roomChargeOriginControl = new FormControl('Restaurante', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(60)],
  });

  /** H3.7 / D11 — signal, so the toggle re-renders zoneless. */
  readonly verification = signal(true);

  readonly form = new FormGroup({
    check_in_time: this.checkInControl,
    check_out_time: this.checkOutControl,
    no_show_time: this.noShowControl,
    night_audit_time: this.nightAuditControl,
    rnt_number: this.rntControl,
    default_overbooking_allowance: this.overbookingControl,
    booking_hold_minutes: this.holdMinutesControl,
    ical_import_interval_minutes: this.icalIntervalControl,
    room_charge_origin: this.roomChargeOriginControl,
  });

  constructor() {
    effect(() => {
      const current = this.settings();
      if (!current) return;
      for (const [key, control] of Object.entries(this.form.controls)) {
        // A field the user left invalid keeps what they typed (and its error) instead of being
        // silently rewritten with the last saved value.
        if (control.dirty && control.invalid) continue;
        const value = current[key as keyof HospitalitySettings];
        if (value !== undefined) (control as FormControl<unknown>).setValue(value, { emitEvent: false });
        if (key === 'room_charge_origin') {
          const origin = this.roomChargeOriginControl.value;
          this.originChoice.set(ROOM_CHARGE_ORIGINS.includes(origin) ? origin : OTHER_ORIGIN);
        }
      }
      this.verification.set(current.folio_invoice_verification ?? true);
    });
  }

  onVerificationChange(checked: boolean): void {
    this.verification.set(checked);
    this.onFieldChange();
  }

  onOriginChoice(choice: string | number | null): void {
    const origin = String(choice ?? '');
    this.originChoice.set(origin);
    const control = this.roomChargeOriginControl;
    control.setValue(origin === OTHER_ORIGIN ? '' : origin);
    control.markAsDirty();
    this.onFieldChange();
  }

  /** The decimal error under the field; the other errors keep `app-input`'s own message. */
  wholeNumberError(control: FormControl<number>): string | null {
    return control.touched && control.hasError('wholeNumber') ? WHOLE_NUMBER_ERROR : null;
  }

  /** Emits the valid fields only; the invalid ones show «Este campo es requerido» & co. */
  onFieldChange(): void {
    const patch: Record<string, unknown> = { folio_invoice_verification: this.verification() };
    for (const [key, control] of Object.entries(this.form.controls)) {
      if (control.dirty) control.markAsTouched();
      if (control.invalid) continue;
      const value: unknown = control.value;
      // `app-input` emits text even with type="number": numeric fields go out as numbers.
      patch[key] = NUMERIC_FIELDS.has(key) ? Number(value) : String(value ?? '').trim();
    }
    this.settingsChange.emit(patch as Partial<HospitalitySettings>);
  }
}
