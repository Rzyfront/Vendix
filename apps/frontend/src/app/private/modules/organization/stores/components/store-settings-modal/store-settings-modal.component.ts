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
  ModalComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-settings-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, ModalComponent],
  styles: [
    `
      :host {
        display: block;
      }

      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }

      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .slider {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #ccc;
        transition: 0.3s;
        border-radius: 24px;
      }

      .slider:before {
        position: absolute;
        content: '';
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s;
        border-radius: 50%;
      }

      input:checked + .slider {
        background-color: var(--color-primary, #4ade80);
      }

      input:checked + .slider:before {
        transform: translateX(20px);
      }
    `,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Configuración de la Tienda"
      subtitle="Administra las configuraciones de la tienda seleccionada"
    >
      <form [formGroup]="settingsForm" class="space-y-6">
        <!-- General Settings -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Configuración General
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Currency -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Moneda</label
              >
              <select
                formControlName="currency"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
              >
                <option
                  *ngFor="let option of getCurrencyOptions()"
                  [value]="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <!-- Timezone -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Zona Horaria</label
              >
              <select
                formControlName="timezone"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
              >
                <option
                  *ngFor="let option of getTimezoneOptions()"
                  [value]="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Notification Settings -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Notificaciones
          </h3>
          <div class="space-y-4">
            <!-- General Notifications -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Activar Notificaciones</label
                >
                <p class="text-xs text-text-secondary">
                  Recibir notificaciones sobre la actividad de la tienda
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="notifications"
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Email Notifications -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Notificaciones por Correo</label
                >
                <p class="text-xs text-text-secondary">
                  Recibir actualizaciones por correo
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="email_notifications"
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Inventory Alerts -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Alertas de Inventario</label
                >
                <p class="text-xs text-text-secondary">
                  Alertar cuando el stock sea bajo
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="inventory_alerts"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Inventory Settings -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Gestión de Inventario
          </h3>
          <div class="space-y-4">
            <!-- Enable Inventory Tracking -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Activar Seguimiento de Inventario</label
                >
                <p class="text-xs text-text-secondary">
                  Rastrear niveles de inventario de productos
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="enableInventoryTracking"
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Low Stock Threshold -->
            <div>
              <label
                class="block text-sm font-medium text-text-primary mb-2"
                >Umbral de Stock Bajo</label
              >
              <input
                type="number"
                formControlName="low_stock_threshold"
                [class]="
                  isFieldInvalid('low_stock_threshold')
                    ? 'border-destructive'
                    : 'border-border'
                "
                class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="10"
              />
              <div
                *ngIf="isFieldInvalid('low_stock_threshold')"
                class="mt-1 text-sm text-destructive"
              >
                {{ getErrorMessage("low_stock_threshold") }}
              </div>
            </div>
          </div>
        </div>

        <!-- Checkout Settings -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Configuración de Pago
          </h3>
          <div class="space-y-4">
            <!-- Guest Checkout -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Permitir Compra como Invitado</label
                >
                <p class="text-xs text-text-secondary">
                  Permitir que los clientes compren sin cuenta
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="allowGuestCheckout"
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Email Verification -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Requerir Verificación de Correo</label
                >
                <p class="text-xs text-text-secondary">
                  Verificar direcciones de correo de clientes
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="requireEmailVerification"
                />
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>

        <!-- Tax Settings -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Configuración de Impuestos
          </h3>
          <div class="space-y-4">
            <!-- Enable Tax Calculation -->
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-primary"
                  >Activar Cálculo de Impuestos</label
                >
                <p class="text-xs text-text-secondary">
                  Calcular impuestos automáticamente
                </p>
              </div>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  formControlName="enableTaxCalculation"
                />
                <span class="slider"></span>
              </label>
            </div>

            <!-- Tax Rate -->
            <div>
              <label
                class="block text-sm font-medium text-text-primary mb-2"
                >Tasa de Impuesto Predeterminada (%)</label
              >
              <input
                type="number"
                step="0.01"
                formControlName="taxRate"
                [class]="
                  isFieldInvalid('taxRate')
                    ? 'border-destructive'
                    : 'border-border'
                "
                class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="0.00"
              />
              <div
                *ngIf="isFieldInvalid('taxRate')"
                class="mt-1 text-sm text-destructive"
              >
                {{ getErrorMessage("taxRate") }}
              </div>
            </div>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button (clicked)="onCancel()" variant="outline">
          Cancelar
        </app-button>
        <app-button
          (clicked)="onSubmit()"
          [disabled]="!settingsForm.valid || isSubmitting"
          variant="primary"
          [loading]="isSubmitting"
        >
          Guardar Configuración
        </app-button>
      </div>
    </app-modal>
  `,
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

  // Currency options
  getCurrencyOptions() {
    return [
      { value: 'USD', label: 'USD - US Dollar' },
      { value: 'EUR', label: 'EUR - Euro' },
      { value: 'GBP', label: 'GBP - British Pound' },
      { value: 'CAD', label: 'CAD - Canadian Dollar' },
      { value: 'MXN', label: 'MXN - Mexican Peso' },
      { value: 'COP', label: 'COP - Peso Colombiano' },
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
      { value: 'America/Bogota', label: 'Bogotá' },
      { value: 'Europe/London', label: 'London' },
      { value: 'Europe/Paris', label: 'Paris' },
      { value: 'Asia/Tokyo', label: 'Tokyo' },
    ];
  }

  // Validación de formulario
  isFieldInvalid(fieldName: string): boolean {
    const field = this.settingsForm.get(fieldName);
    return field ? field.invalid && (field.dirty || field.touched) : false;
  }

  getErrorMessage(fieldName: string): string {
    const field = this.settingsForm.get(fieldName);

    if (!field) return '';

    if (field.errors?.['required']) return 'Este campo es requerido';
    if (field.errors?.['min'])
      return `Valor mínimo es ${field.errors['min'].min}`;
    if (field.errors?.['max'])
      return `Valor máximo es ${field.errors['max'].max}`;

    return 'Campo inválido';
  }
}
