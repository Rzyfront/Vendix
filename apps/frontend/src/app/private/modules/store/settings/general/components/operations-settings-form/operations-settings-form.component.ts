import { Component, OnInit, OnChanges, input, output } from '@angular/core';

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
export class OperationsSettingsForm implements OnInit, OnChanges {
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

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    const currentSettings = this.settings();
    if (currentSettings) {
      this.form.patchValue(currentSettings);
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value as OperationsSettings);
    }
  }
}
