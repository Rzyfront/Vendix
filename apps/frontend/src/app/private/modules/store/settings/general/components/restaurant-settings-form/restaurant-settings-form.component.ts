import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';

export interface RestaurantSettings {
  enable_table_checkout: boolean;
}

@Component({
  selector: 'app-restaurant-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, ToggleComponent],
  templateUrl: './restaurant-settings-form.component.html',
})
export class RestaurantSettingsForm {
  readonly settings = input.required<RestaurantSettings>();
  readonly settingsChange = output<RestaurantSettings>();

  form: FormGroup = new FormGroup({
    enable_table_checkout: new FormControl<boolean>(false, {
      nonNullable: true,
    }),
  });

  get enableTableCheckoutControl(): FormControl<boolean> {
    return this.form.get('enable_table_checkout') as FormControl<boolean>;
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
