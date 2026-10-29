import { Component, effect, input, output, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { InputComponent } from '../../../../../../../shared/components/input/input.component';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import { HospitalitySettings } from '../../../../../../../core/models/store-settings.interface';

/** The backend takes the hours as an integer (`@IsInt()`); empty is left to `required`. */
const wholeNumber = (control: AbstractControl): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();
  return value === '' || /^\d+$/.test(value) ? null : { wholeNumber: true };
};

type GuestEmailFlag = 'guest_email_confirmation' | 'guest_email_pre_arrival' | 'guest_email_post_stay';

/**
 * Hotelería → «Correos al huésped» (H8.2): which automatic emails the guest
 * gets and how many hours before arrival the pre-registration reminder goes
 * out. Autosaved like the rest of the tab (U17): only valid fields are emitted.
 */
@Component({
  selector: 'app-hospitality-guest-messages-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent, ToggleComponent],
  template: `
    <div class="grid grid-cols-1 gap-4">
      <div>
        <app-toggle
          [checked]="confirmation()"
          label="Confirmación de la reserva"
          (changed)="onFlagChange('guest_email_confirmation', $event)"
        />
        <p class="mt-1 text-xs text-text-secondary">
          Al confirmar una reserva en recepción, el huésped recibe las fechas, la habitación y las horas
          de llegada y salida. Las reservas pagadas en la tienda en línea ya reciben su confirmación.
        </p>
      </div>
      <div>
        <app-toggle
          [checked]="preArrival()"
          label="Recordatorio antes de llegar, con el pre-registro"
          (changed)="onFlagChange('guest_email_pre_arrival', $event)"
        />
        <p class="mt-1 text-xs text-text-secondary">
          Incluye el enlace para que el huésped registre sus datos y los de sus acompañantes antes de llegar.
        </p>
      </div>
      @if (preArrival()) {
        <div class="md:max-w-xs">
          <app-input
            [formControl]="hoursControl"
            [control]="hoursControl"
            [error]="hoursError()"
            [required]="true"
            type="number"
            [min]="12"
            [max]="168"
            label="Horas antes de la llegada"
            helperText="Cuántas horas antes de la hora de llegada sale el recordatorio (12 a 168)."
            size="sm"
            (inputChange)="emit()"
          ></app-input>
        </div>
      }
      <div>
        <app-toggle
          [checked]="postStay()"
          label="Agradecimiento al salir"
          (changed)="onFlagChange('guest_email_post_stay', $event)"
        />
        <p class="mt-1 text-xs text-text-secondary">
          Después del check-out, el huésped recibe un mensaje de gracias por su estadía.
        </p>
      </div>
    </div>
  `,
})
export class HospitalityGuestMessagesForm {
  readonly settings = input.required<HospitalitySettings>();
  readonly settingsChange = output<Partial<HospitalitySettings>>();

  /** Signals, so the toggles re-render zoneless. */
  protected readonly confirmation = signal(true);
  protected readonly preArrival = signal(true);
  protected readonly postStay = signal(true);

  readonly hoursControl = new FormControl<number>(48, {
    nonNullable: true,
    validators: [Validators.required, Validators.min(12), Validators.max(168), wholeNumber],
  });

  constructor() {
    effect(() => {
      const current = this.settings();
      if (!current) return;
      this.confirmation.set(current.guest_email_confirmation ?? true);
      this.preArrival.set(current.guest_email_pre_arrival ?? true);
      this.postStay.set(current.guest_email_post_stay ?? true);
      // A value the user left invalid keeps what they typed (and its error).
      if (!(this.hoursControl.dirty && this.hoursControl.invalid)) {
        this.hoursControl.setValue(current.guest_email_pre_arrival_hours ?? 48, { emitEvent: false });
      }
    });
  }

  onFlagChange(flag: GuestEmailFlag, checked: boolean): void {
    const target = {
      guest_email_confirmation: this.confirmation,
      guest_email_pre_arrival: this.preArrival,
      guest_email_post_stay: this.postStay,
    }[flag];
    target.set(checked);
    this.emit();
  }

  /** The decimal error under the field; the other errors keep `app-input`'s own message. */
  protected hoursError(): string | undefined {
    return this.hoursControl.touched && this.hoursControl.hasError('wholeNumber')
      ? 'Escribe un número entero, sin decimales.'
      : undefined;
  }

  emit(): void {
    const patch: Partial<HospitalitySettings> = {
      guest_email_confirmation: this.confirmation(),
      guest_email_pre_arrival: this.preArrival(),
      guest_email_post_stay: this.postStay(),
    };
    const hours = this.hoursControl;
    if (hours.dirty) hours.markAsTouched();
    if (hours.valid) patch.guest_email_pre_arrival_hours = Number(hours.value);
    this.settingsChange.emit(patch);
  }
}
