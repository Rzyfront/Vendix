import { Component, computed, effect, input, output, signal } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import {
  AlertBannerComponent,
  BadgeComponent,
  ExpandableCardComponent,
  IconComponent,
} from '../../../../../../../shared/components/index';

export type OrderStateUpdateMode = 'live' | 'on_close';

export interface DispatchSettings {
  order_state_update_mode: OrderStateUpdateMode;
}

const DEFAULT_ORDER_STATE_UPDATE_MODE: OrderStateUpdateMode = 'on_close';

@Component({
  selector: 'app-dispatch-settings-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SettingToggleComponent,
    AlertBannerComponent,
    BadgeComponent,
    ExpandableCardComponent,
    IconComponent,
  ],
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

  /**
   * Signal mirror of the mode the form is currently showing. `FormControl.value`
   * is a plain getter (never reactive inside `computed`), so both write paths —
   * the `settings` effect and `onFieldChange` — refresh this signal, and the
   * comparison panel derives from it.
   */
  private readonly activeMode = signal<OrderStateUpdateMode>(
    DEFAULT_ORDER_STATE_UPDATE_MODE,
  );

  readonly isLive = computed(() => this.activeMode() === 'live');

  get liveStateUpdateControl(): FormControl<boolean> {
    return this.form.get('live_state_update') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      const mode = current?.order_state_update_mode ?? DEFAULT_ORDER_STATE_UPDATE_MODE;
      this.form.patchValue({ live_state_update: mode === 'live' }, { emitEvent: false });
      this.activeMode.set(mode);
    });
  }

  onFieldChange(): void {
    const mode: OrderStateUpdateMode = this.liveStateUpdateControl.value
      ? 'live'
      : 'on_close';
    this.activeMode.set(mode);
    this.settingsChange.emit({ order_state_update_mode: mode });
  }
}
