import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
} from '../../../../../shared/components/index';
import {
  StoreSettings,
  StoreSettingsUpdateDto,
} from '../interfaces/store.interface';

@Component({
  selector: 'app-store-settings-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Configuración de Tienda"
      subtitle="Configurar preferencias y notificaciones de la tienda"
      (isOpenChange)="onModalChange($event)"
    >
      <form [formGroup]="settingsForm" class="space-y-6">
        <!-- General Settings -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            General Settings
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label
                for="theme"
                class="block text-sm font-medium text-text-primary"
              >
                Theme
              </label>
              <select
                id="theme"
                formControlName="theme"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              >
                <option value="">Default</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>

            <div class="space-y-2">
              <label
                for="language"
                class="block text-sm font-medium text-text-primary"
              >
                Language
              </label>
              <select
                id="language"
                formControlName="language"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              >
                <option value="">Default</option>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="currency_format"
              label="Currency Format"
              placeholder="COP $"
            ></app-input>

            <app-input
              formControlName="low_stock_threshold"
              label="Low Stock Threshold"
              type="number"
              placeholder="10"
            ></app-input>
          </div>
        </div>

        <!-- Notification Settings -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Notifications
          </h3>

          <div class="space-y-3">
            <label class="flex items-center space-x-3">
              <input
                type="checkbox"
                formControlName="notifications"
                class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
              />
              <span class="text-sm font-medium text-text-primary"
                >Enable Notifications</span
              >
            </label>

            <label class="flex items-center space-x-3">
              <input
                type="checkbox"
                formControlName="email_notifications"
                class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
              />
              <span class="text-sm font-medium text-text-primary"
                >Email Notifications</span
              >
            </label>

            <label class="flex items-center space-x-3">
              <input
                type="checkbox"
                formControlName="sms_notifications"
                class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
              />
              <span class="text-sm font-medium text-text-primary"
                >SMS Notifications</span
              >
            </label>

            <label class="flex items-center space-x-3">
              <input
                type="checkbox"
                formControlName="inventory_alerts"
                class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
              />
              <span class="text-sm font-medium text-text-primary"
                >Inventory Alerts</span
              >
            </label>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-text-secondary">
          <span class="text-red-500">*</span> Required fields
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="settingsForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            Save Settings
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class StoreSettingsModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() settings?: StoreSettings;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<StoreSettingsUpdateDto>();
  @Output() cancel = new EventEmitter<void>();

  settingsForm!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.settingsForm = this.fb.group({
      theme: [''],
      notifications: [true],
      language: [''],
      currency_format: [''],
      email_notifications: [true],
      sms_notifications: [false],
      inventory_alerts: [true],
      low_stock_threshold: [10],
    });
  }

  ngOnChanges(): void {
    if (this.settings && this.isOpen) {
      this.populateForm();
    }
  }

  private populateForm(): void {
    if (!this.settings) return;

    this.settingsForm.patchValue({
      theme: this.settings.theme || '',
      notifications:
        this.settings.notifications !== undefined
          ? this.settings.notifications
          : true,
      language: this.settings.language || '',
      currency_format: this.settings.currency_format || '',
      email_notifications:
        this.settings.email_notifications !== undefined
          ? this.settings.email_notifications
          : true,
      sms_notifications:
        this.settings.sms_notifications !== undefined
          ? this.settings.sms_notifications
          : false,
      inventory_alerts:
        this.settings.inventory_alerts !== undefined
          ? this.settings.inventory_alerts
          : true,
      low_stock_threshold:
        this.settings.low_stock_threshold !== undefined
          ? this.settings.low_stock_threshold
          : 10,
    });
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.settingsForm.invalid) {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.settingsForm.controls).forEach((key) => {
        this.settingsForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formData = this.settingsForm.value;
    const settingsData: StoreSettingsUpdateDto = {
      settings: {
        theme: formData.theme || undefined,
        notifications: formData.notifications,
        language: formData.language || undefined,
        currency_format: formData.currency_format || undefined,
        email_notifications: formData.email_notifications,
        sms_notifications: formData.sms_notifications,
        inventory_alerts: formData.inventory_alerts,
        low_stock_threshold: formData.low_stock_threshold,
      },
    };

    this.submit.emit(settingsData);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  resetForm(): void {
    this.settingsForm.reset({
      theme: '',
      notifications: true,
      language: '',
      currency_format: '',
      email_notifications: true,
      sms_notifications: false,
      inventory_alerts: true,
      low_stock_threshold: 10,
    });
  }
}
