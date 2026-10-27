import { Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { HospitalitySettings } from '../../../../../../../core/models/store-settings.interface';

/** Same `HH:mm` rule the backend DTO enforces. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Hotelería (H0.5/H1.2/H1.6): check-in/check-out and no-show hours, the RNT
 * number and the overbooking new room types start with.
 */
@Component({
  selector: 'app-hospitality-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent],
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
  readonly rntControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(20)],
  });

  readonly overbookingControl = new FormControl<number>(0, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(0), Validators.max(99)],
  });

  readonly form = new FormGroup({
    check_in_time: this.checkInControl,
    check_out_time: this.checkOutControl,
    no_show_time: this.noShowControl,
    rnt_number: this.rntControl,
    default_overbooking_allowance: this.overbookingControl,
  });

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) this.form.patchValue(current, { emitEvent: false });
    });
  }

  onFieldChange(): void {
    if (!this.form.valid) return;
    const value = this.form.getRawValue();
    this.settingsChange.emit({
      ...value,
      rnt_number: value.rnt_number.trim(),
      default_overbooking_allowance: Math.trunc(Number(value.default_overbooking_allowance)),
    });
  }
}
