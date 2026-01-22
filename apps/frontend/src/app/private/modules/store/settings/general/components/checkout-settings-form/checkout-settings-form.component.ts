import { Component, Input, Output, EventEmitter, OnInit, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl } from '@angular/forms';
import { ToggleComponent } from '../../../../../../../shared/components/toggle/toggle.component';

export interface CheckoutSettings {
  require_customer_data: boolean;
  allow_guest_checkout: boolean;
  allow_partial_payments: boolean;
  require_payment_confirmation: boolean;
}

@Component({
  selector: 'app-checkout-settings-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ToggleComponent],
  templateUrl: './checkout-settings-form.component.html',
  styleUrls: ['./checkout-settings-form.component.scss'],
})
export class CheckoutSettingsForm implements OnInit, OnChanges {
  @Input() settings!: CheckoutSettings;
  @Output() settingsChange = new EventEmitter<CheckoutSettings>();

  form: FormGroup = new FormGroup({
    require_customer_data: new FormControl(true),
    allow_guest_checkout: new FormControl(false),
    allow_partial_payments: new FormControl(false),
    require_payment_confirmation: new FormControl(true),
  });

  ngOnInit() {
    this.patchForm();
  }

  ngOnChanges() {
    this.patchForm();
  }

  patchForm() {
    if (this.settings) {
      this.form.patchValue(this.settings);
    }
  }

  onFieldChange() {
    if (this.form.valid) {
      this.settingsChange.emit(this.form.value);
    }
  }

  // Getters para formControls
  get requireCustomerDataControl() {
    return this.form.get('require_customer_data') as FormControl;
  }

  get allowGuestCheckoutControl() {
    return this.form.get('allow_guest_checkout') as FormControl;
  }

  get allowPartialPaymentsControl() {
    return this.form.get('allow_partial_payments') as FormControl;
  }

  get requirePaymentConfirmationControl() {
    return this.form.get('require_payment_confirmation') as FormControl;
  }
}
