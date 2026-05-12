import { Component, effect, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { InputComponent } from '../../../../../../../shared/components/input/input.component';

export interface OperationsSettings {
  default_preparation_time_minutes: number;
}

@Component({
  selector: 'app-operations-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, InputComponent],
  templateUrl: './operations-settings-form.component.html',
})
export class OperationsSettingsForm {
  readonly settings = input.required<OperationsSettings>();
  readonly settingsChange = output<OperationsSettings>();

  form: FormGroup = new FormGroup({
    default_preparation_time_minutes: new FormControl<number>(15, {
      nonNullable: true,
    }),
  });

  get defaultPrepTimeControl(): FormControl<number> {
    return this.form.get('default_preparation_time_minutes') as FormControl<number>;
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
      this.settingsChange.emit(this.form.value as OperationsSettings);
    }
  }
}
