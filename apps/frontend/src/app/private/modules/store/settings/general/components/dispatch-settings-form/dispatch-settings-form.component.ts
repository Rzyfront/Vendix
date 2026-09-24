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
  enable_dispatch_with_remision?: boolean;
  enable_dispatch_direct_delivery?: boolean;
  enable_dispatch_to_pool?: boolean;
}

const DEFAULT_ORDER_STATE_UPDATE_MODE: OrderStateUpdateMode = 'on_close';

type DispatchMethodKey =
  | 'enable_dispatch_with_remision'
  | 'enable_dispatch_direct_delivery'
  | 'enable_dispatch_to_pool';

const DISPATCH_METHOD_KEYS: DispatchMethodKey[] = [
  'enable_dispatch_with_remision',
  'enable_dispatch_direct_delivery',
  'enable_dispatch_to_pool',
];

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
    enable_dispatch_with_remision: new FormControl<boolean>(true, { nonNullable: true }),
    enable_dispatch_direct_delivery: new FormControl<boolean>(true, { nonNullable: true }),
    enable_dispatch_to_pool: new FormControl<boolean>(true, { nonNullable: true }),
  });

  /** Visible when the operator tries to switch off all three methods. */
  readonly methodsError = signal<string | null>(null);

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

  get withRemisionControl(): FormControl<boolean> {
    return this.form.get('enable_dispatch_with_remision') as FormControl<boolean>;
  }

  get directDeliveryControl(): FormControl<boolean> {
    return this.form.get('enable_dispatch_direct_delivery') as FormControl<boolean>;
  }

  get toPoolControl(): FormControl<boolean> {
    return this.form.get('enable_dispatch_to_pool') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      const mode = current?.order_state_update_mode ?? DEFAULT_ORDER_STATE_UPDATE_MODE;
      this.form.patchValue(
        {
          live_state_update: mode === 'live',
          enable_dispatch_with_remision: current?.enable_dispatch_with_remision ?? true,
          enable_dispatch_direct_delivery: current?.enable_dispatch_direct_delivery ?? true,
          enable_dispatch_to_pool: current?.enable_dispatch_to_pool ?? true,
        },
        { emitEvent: false },
      );
      this.activeMode.set(mode);
      this.methodsError.set(null);
    });
  }

  onFieldChange(): void {
    const mode: OrderStateUpdateMode = this.liveStateUpdateControl.value
      ? 'live'
      : 'on_close';
    this.activeMode.set(mode);
    this.settingsChange.emit({
      ...(this.settings() ?? {}),
      ...this.methodFlags(),
      order_state_update_mode: mode,
    });
  }

  private methodFlags(): Pick<
    DispatchSettings,
    'enable_dispatch_with_remision' | 'enable_dispatch_direct_delivery' | 'enable_dispatch_to_pool'
  > {
    const value = this.form.value as Record<DispatchMethodKey, boolean>;
    return {
      enable_dispatch_with_remision: value.enable_dispatch_with_remision,
      enable_dispatch_direct_delivery: value.enable_dispatch_direct_delivery,
      enable_dispatch_to_pool: value.enable_dispatch_to_pool,
    };
  }

  /**
   * QUI-844 — at least one dispatch method must stay enabled, otherwise an
   * order would have no way to be dispatched. When the operator switches off
   * the last one, the toggle reverts and nothing is emitted.
   */
  onMethodToggle(key: DispatchMethodKey, value: boolean): void {
    this.form.get(key)?.setValue(value, { emitEvent: false });
    const flags = this.methodFlags();
    if (!DISPATCH_METHOD_KEYS.some((k) => flags[k])) {
      this.form.get(key)?.setValue(true, { emitEvent: false });
      this.methodsError.set(
        'Debe quedar al menos un método de despacho activo.',
      );
      return;
    }
    this.methodsError.set(null);
    this.settingsChange.emit({
      ...(this.settings() ?? {}),
      ...flags,
      order_state_update_mode: this.activeMode(),
    });
  }
}
