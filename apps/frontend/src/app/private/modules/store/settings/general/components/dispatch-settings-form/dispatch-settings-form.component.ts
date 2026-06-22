import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';

export type OrderStateUpdateMode = 'live' | 'on_close';

export interface DispatchSettings {
  order_state_update_mode: OrderStateUpdateMode;
}

const DEFAULT_ORDER_STATE_UPDATE_MODE: OrderStateUpdateMode = 'on_close';

@Component({
  selector: 'app-dispatch-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, SettingToggleComponent],
  templateUrl: './dispatch-settings-form.component.html',
})
export class DispatchSettingsForm {
  readonly settings = input.required<DispatchSettings>();
  readonly settingsChange = output<DispatchSettings>();

  // The toggle is boolean (ON ⇒ 'live', OFF ⇒ 'on_close'); the persisted value
  // is the enum. We keep a boolean control and map to/from the enum.
  form: FormGroup = new FormGroup({
    live_state_update: new FormControl<boolean>(false, { nonNullable: true }),
  });

  get liveStateUpdateControl(): FormControl<boolean> {
    return this.form.get('live_state_update') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      const mode = current?.order_state_update_mode ?? DEFAULT_ORDER_STATE_UPDATE_MODE;
      this.form.patchValue({ live_state_update: mode === 'live' }, { emitEvent: false });
    });
  }

  onFieldChange(): void {
    const mode: OrderStateUpdateMode = this.liveStateUpdateControl.value
      ? 'live'
      : 'on_close';
    this.settingsChange.emit({ order_state_update_mode: mode });
  }
}
