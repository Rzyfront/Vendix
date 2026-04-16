import { Component, OnInit, OnChanges, input, output } from '@angular/core';

import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { TextareaComponent } from '../../../../../../../shared/components';

export interface ReceiptsSettings {
  print_receipt: boolean;
  email_receipt: boolean;
  receipt_header?: string;
  receipt_footer: string;
}

@Component({
  selector: 'app-receipts-settings-form',
  standalone: true,
  imports: [ReactiveFormsModule, SettingToggleComponent, TextareaComponent],
  templateUrl: './receipts-settings-form.component.html',
  styleUrls: ['./receipts-settings-form.component.scss'],
})
export class ReceiptsSettingsForm implements OnInit, OnChanges {
  readonly settings = input.required<ReceiptsSettings>();
  readonly settingsChange = output<ReceiptsSettings>();

  form: FormGroup = new FormGroup({
    print_receipt: new FormControl(true),
    email_receipt: new FormControl(false),
    receipt_header: new FormControl(''),
    receipt_footer: new FormControl('¡Gracias por su compra!'),
  });

  // Getters for form controls
  get printReceiptControl() {
    return this.form.get('print_receipt') as FormControl;
  }
  get emailReceiptControl() {
    return this.form.get('email_receipt') as FormControl;
  }
  get receiptHeaderControl() {
    return this.form.get('receipt_header') as FormControl;
  }
  get receiptFooterControl() {
    return this.form.get('receipt_footer') as FormControl;
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
      this.settingsChange.emit(this.form.value);
    }
  }
}
