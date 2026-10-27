import { Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { HospitalitySettings } from '../../../../../../../core/models/store-settings.interface';

/** Same `HH:mm` rule the backend DTO enforces. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hotelería (H0.5): check-in/check-out hours and the RNT number. */
@Component({
  selector: 'app-hospitality-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent],
  template: `
    <form [formGroup]="form" class="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        [formControl]="rntControl"
        label="Número RNT"
        placeholder="12345"
        helperText="Registro Nacional de Turismo del hotel."
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
  readonly rntControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(20)],
  });

  readonly form = new FormGroup({
    check_in_time: this.checkInControl,
    check_out_time: this.checkOutControl,
    rnt_number: this.rntControl,
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
    this.settingsChange.emit({ ...value, rnt_number: value.rnt_number.trim() });
  }
}
