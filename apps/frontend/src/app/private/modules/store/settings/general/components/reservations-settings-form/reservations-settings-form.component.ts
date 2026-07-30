import { Component, effect, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';

/**
 * Local mirror of `ReservationsSettings`. Kept separate from the
 * `core/models/store-settings.interface.ts` declaration so this
 * component stays self-contained — the parent's `settingsChange`
 * handler already coerces the shape.
 */
export interface ReservationsSettings {
  /**
   * When true (default), customers reschedule a booking with a single
   * click — the booking moves to the new slot immediately and the
   * admin gets an in-app broadcast. When false, the customer's
   * reschedule becomes a PENDING REQUEST routed through
   * `booking_reschedule_requests` and the booking stays at its current
   * slot until an admin approves or rejects it.
   */
  allow_direct_reschedule: boolean;
}

/**
 * ReservationsSettingsForm
 *
 * Standalone card for the 'Reservas' policy. Renders the toggle
 * `¿Permitir reagendamiento directo?`.
 *
 * Pattern: same as OperationsSettingsForm — receives the settings
 * object as a signal input, mirrors it into an internal FormGroup,
 * and emits the fresh value on `settingsChange` whenever the user
 * toggles the switch. The parent (GeneralSettingsComponent) is
 * responsible for plumbing the value into the persisted settings
 * payload.
 *
 * Mobile-first: iOS-style toggle, 44px+ touch target.
 */
@Component({
  selector: 'app-reservations-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent, SettingToggleComponent],
  templateUrl: './reservations-settings-form.component.html',
  styleUrls: ['./reservations-settings-form.component.scss'],
})
export class ReservationsSettingsForm {
  readonly settings = input.required<ReservationsSettings>();
  readonly settingsChange = output<ReservationsSettings>();

  /**
   * Internal FormGroup. We seed the toggle with the legacy default
   * (true) so the form is never "undefined" before the parent
   * dispatches the first settings payload. The effect below patches
   * the real value as soon as `settings()` emits.
   */
  form: FormGroup = new FormGroup({
    allow_direct_reschedule: new FormControl<boolean>(true, {
      nonNullable: true,
    }),
  });

  /** Typed accessor for the FormControl. */
  get allowDirectRescheduleControl(): FormControl<boolean> {
    return this.form.get('allow_direct_reschedule') as FormControl<boolean>;
  }

  constructor() {
    // Sync the FormGroup whenever the parent dispatches a new
    // settings payload. emitEvent: false so we don't bounce the
    // value back through settingsChange.
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });
  }

  onFieldChange(): void {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as ReservationsSettings);
    }
  }
}