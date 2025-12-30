import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  FormBuilder,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { StoreSettings } from '../../interfaces/store.interface';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-settings-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  templateUrl: './store-settings-modal.component.html',
  styleUrls: ['./store-settings-modal.component.scss'],
})
export class StoreSettingsModalComponent {
  @Input() isOpen: boolean = false;
  @Input() isSubmitting: boolean = false;
  @Input() settings: StoreSettings | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<StoreSettings>();
  @Output() cancel = new EventEmitter<void>();

  settingsForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.settingsForm = this.fb.group({
      // General Settings
      theme: ['light'],
      language: ['en'],
      currency: ['USD'],
      currency_format: ['${{amount}}'],
      timezone: ['UTC'],

      // Notification Settings
      notifications: [true],
      email_notifications: [true],
      sms_notifications: [false],
      inventory_alerts: [true],

      // Inventory Settings
      enableInventoryTracking: [true],
      low_stock_threshold: [10, [Validators.required, Validators.min(0)]],

      // Checkout Settings
      allowGuestCheckout: [true],
      requireEmailVerification: [false],

      // Tax Settings
      enableTaxCalculation: [true],
      taxRate: [0, [Validators.min(0), Validators.max(100)]],

      // Shipping Settings
      enableShipping: [true],
      freeShippingThreshold: [0, [Validators.min(0)]],
    });
  }

  ngOnChanges(): void {
    if (this.settings) {
      this.settingsForm.patchValue({
        ...this.settings,
        enableInventoryTracking: this.settings.inventory_alerts,
        allowGuestCheckout: this.settings.allowGuestCheckout,
        requireEmailVerification: this.settings.requireEmailVerification,
        enableTaxCalculation: this.settings.enableTaxCalculation,
        taxRate: this.settings.taxRate || 0,
        enableShipping: this.settings.enableShipping,
        freeShippingThreshold: this.settings.freeShippingThreshold || 0,
      });
    }
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.settingsForm.valid) {
      const formValue = this.settingsForm.value;

      const updatedSettings: StoreSettings = {
        ...this.settings,
        ...formValue,
        inventory_alerts: formValue.enableInventoryTracking,
        allowGuestCheckout: formValue.allowGuestCheckout,
        requireEmailVerification: formValue.requireEmailVerification,
        enableTaxCalculation: formValue.enableTaxCalculation,
        taxRate: formValue.taxRate,
        enableShipping: formValue.enableShipping,
        freeShippingThreshold: formValue.freeShippingThreshold,
      };

      this.submit.emit(updatedSettings);
    }
  }

  private resetForm(): void {
    this.settingsForm.reset();
  }

  // Theme options
  getThemeOptions() {
    return [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'auto', label: 'Auto' },
    ];
  }

  // Language options
  getLanguageOptions() {
    return [
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' },
      { value: 'fr', label: 'Français' },
      { value: 'de', label: 'Deutsch' },
    ];
  }

  // Currency options
  getCurrencyOptions() {
    return [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
      { value: 'GBP', label: 'GBP - British Pound' },
      { value: 'CAD', label: 'CAD - Canadian Dollar' },
      { value: 'MXN', label: 'MXN - Mexican Peso' },
    ];
  }

  // Currency format options
  getCurrencyFormatOptions() {
    return [
      { value: '${{amount}}', label: '$100.00' },
      { value: '€{{amount}}', label: '€100.00' },
      { value: '£{{amount}}', label: '£100.00' },
      { value: '${{amount}} CAD', label: '$100.00 CAD' },
      { value: '${{amount}} MXN', label: '$100.00 MXN' },
    ];
  }

  // Timezone options
  getTimezoneOptions() {
    return [
      { value: 'UTC', label: 'UTC' },
      { value: 'America/New_York', label: 'Eastern Time (ET)' },
      { value: 'America/Chicago', label: 'Central Time (CT)' },
      { value: 'America/Denver', label: 'Mountain Time (MT)' },
      { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
      { value: 'America/Mexico_City', label: 'Mexico City' },
      { value: 'Europe/London', label: 'London' },
      { value: 'Europe/Paris', label: 'Paris' },
      { value: 'Asia/Tokyo', label: 'Tokyo' },
    ];
  }

  // Getters para validación
  get f() {
    return this.settingsForm.controls;
  }

  // Validación de formulario
  isFieldInvalid(fieldName: string): boolean {
    const field = this.settingsForm.get(fieldName);
    return field ? field.invalid && (field.dirty || field.touched) : false;
  }

  getErrorMessage(fieldName: string): string {
    const field = this.settingsForm.get(fieldName);

    if (!field) return '';

    if (field.errors?.['required']) return 'This field is required';
    if (field.errors?.['min'])
      return `Minimum value is ${field.errors['min'].min}`;
    if (field.errors?.['max'])
      return `Maximum value is ${field.errors['max'].max}`;

    return 'Invalid field';
  }
}
