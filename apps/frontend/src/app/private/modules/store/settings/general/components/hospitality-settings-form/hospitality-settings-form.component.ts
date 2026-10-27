import { Component, effect, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { HospitalitySettings } from '../../../../../../../core/models/store-settings.interface';

/** Same `HH:mm` rule the backend DTO enforces. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Hotelería (H0.5/H1.2/H1.6/H3.4/H3.7): check-in/check-out, no-show and night audit hours, the RNT
 * number and the overbooking new room types start with.
 */
@Component({
  selector: 'app-hospitality-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, ToggleComponent],
  template: `
    <form [formGroup]="form" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <app-input
        [formControl]="checkInControl"
        type="time"
        label="Hora de check-in"
        helperText="Desde esta hora el huésped puede ocupar la habitación."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="checkOutControl"
        type="time"
        label="Hora de check-out"
        helperText="Hasta esta hora el huésped debe entregar la habitación."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="noShowControl"
        type="time"
        label="Hora de no-show"
        helperText="El día siguiente a la llegada, a esta hora, la reserva sin llegada pasa a No-show y libera sus noches."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="nightAuditControl"
        type="time"
        label="Hora de auditoría nocturna"
        helperText="Hora de madrugada: desde ella se carga al folio de cada huésped en casa la noche que acaba de pasar."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="rntControl"
        label="Número RNT"
        placeholder="12345"
        helperText="Registro Nacional de Turismo del hotel."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="overbookingControl"
        type="number"
        [min]="0"
        [max]="99"
        label="Sobreventa por defecto"
        helperText="Reservas por encima de las habitaciones con las que empieza cada tipo nuevo. 0 = nunca sobrevender."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="holdMinutesControl"
        type="number"
        [min]="5"
        [max]="120"
        label="Minutos para pagar una reserva web"
        helperText="Tiempo que se guarda la habitación mientras el huésped paga en línea (5 a 120)."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="icalIntervalControl"
        type="number"
        [min]="5"
        [max]="1440"
        label="Minutos entre sincronizaciones iCal"
        helperText="Cada cuánto se leen los calendarios importados de Airbnb o Booking (5 a 1440)."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <app-input
        [formControl]="roomChargeOriginControl"
        label="Origen del cargo a habitación"
        placeholder="Restaurante"
        helperText="Cómo se ve en el folio un consumo cargado desde el POS o una mesa."
        size="sm"
        (inputChange)="onFieldChange()"
      ></app-input>
      <div class="md:col-span-2">
        <app-toggle
          [checked]="verification()"
          label="Verificar el folio antes de facturar"
          (changed)="onVerificationChange($event)"
        />
        <p class="mt-1 text-xs text-text-secondary">
          La factura del check-out espera la revisión de un usuario con el permiso «Verificar el folio».
        </p>
      </div>
    </form>
  `,
})
export class HospitalitySettingsForm {
  readonly settings = input.required<HospitalitySettings>();
  readonly settingsChange = output<HospitalitySettings>();

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
    validators: [Validators.required, Validators.min(0), Validators.max(99)],
  });

  readonly holdMinutesControl = new FormControl<number>(15, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(5), Validators.max(120)],
  });

  readonly icalIntervalControl = new FormControl<number>(15, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(5), Validators.max(1440)],
  });

  readonly roomChargeOriginControl = new FormControl('Restaurante', {
    nonNullable: true,
    validators: [Validators.maxLength(60)],
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
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
        this.verification.set(current.folio_invoice_verification ?? true);
      }
    });
  }

  onVerificationChange(checked: boolean): void {
    this.verification.set(checked);
    this.onFieldChange();
  }

  onFieldChange(): void {
    if (!this.form.valid) return;
    const value = this.form.getRawValue();
    this.settingsChange.emit({
      ...value,
      rnt_number: value.rnt_number.trim(),
      room_charge_origin: value.room_charge_origin.trim() || 'Restaurante',
      folio_invoice_verification: this.verification(),
      default_overbooking_allowance: Math.trunc(Number(value.default_overbooking_allowance)),
      booking_hold_minutes: Math.trunc(Number(value.booking_hold_minutes)),
      ical_import_interval_minutes: Math.trunc(Number(value.ical_import_interval_minutes)),
    });
  }
}
