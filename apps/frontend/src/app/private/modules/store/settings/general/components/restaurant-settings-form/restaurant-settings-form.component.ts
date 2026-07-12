import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';

export type QrScanBehavior = 'menu_only' | 'mark_occupied' | 'open_tab' | 'require_staff';

export interface RestaurantSettings {
  enable_table_checkout: boolean;
  qr_scan_behavior?: QrScanBehavior;
  qr_auto_fire?: boolean;
}

@Component({
  selector: 'app-restaurant-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, ToggleComponent, SelectorComponent],
  templateUrl: './restaurant-settings-form.component.html',
})
export class RestaurantSettingsForm {
  readonly settings = input.required<RestaurantSettings>();
  readonly settingsChange = output<RestaurantSettings>();

  form: FormGroup = new FormGroup({
    enable_table_checkout: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
    qr_scan_behavior: new FormControl<QrScanBehavior>('menu_only', {
      nonNullable: true,
    }),
    qr_auto_fire: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
  });

  qrScanBehaviors: SelectorOption[] = [
    { value: 'menu_only', label: 'Solo carta' },
    { value: 'mark_occupied', label: 'Marcar mesa ocupada' },
    { value: 'open_tab', label: 'Abrir cuenta' },
    { value: 'require_staff', label: 'Requiere mesero' },
  ];

  get enableTableCheckoutControl(): FormControl<boolean> {
    return this.form.get('enable_table_checkout') as FormControl<boolean>;
  }

  get qrScanBehaviorControl(): FormControl<QrScanBehavior> {
    return this.form.get('qr_scan_behavior') as FormControl<QrScanBehavior>;
  }

  get qrAutoFireControl(): FormControl<boolean> {
    return this.form.get('qr_auto_fire') as FormControl<boolean>;
  }

  constructor() {
    effect(() => {
      const current = this.settings();
      if (current) {
        this.form.patchValue(current, { emitEvent: false });
      }
    });
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as RestaurantSettings);
    }
  }
}
