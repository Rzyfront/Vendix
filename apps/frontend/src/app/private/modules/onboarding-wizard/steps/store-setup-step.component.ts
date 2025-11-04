import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-store-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Tu tienda 🏪</h2>
        <p class="text-gray-600">Configura tu punto de venta principal</p>
      </div>

      <div class="bg-green-50 p-4 rounded-lg mb-6">
        <p class="text-sm text-green-700">
          💡 Hemos prellenado los datos con los de tu organización. Edítalos si lo necesitas.
        </p>
      </div>

      <form [formGroup]="storeForm" (ngSubmit)="onSubmit()" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Nombre de la tienda <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            formControlName="name"
            class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="Tienda Principal"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Tipo de tienda
          </label>
          <div class="grid grid-cols-3 gap-4">
            <button
              type="button"
              *ngFor="let type of storeTypes"
              (click)="selectStoreType(type.value)"
              [class]="getStoreTypeClass(type.value)"
            >
              <div class="text-2xl mb-2">{{ type.icon }}</div>
              <div class="font-medium">{{ type.label }}</div>
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Descripción (opcional)
          </label>
          <textarea
            formControlName="description"
            class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            rows="3"
            placeholder="Describe tu tienda..."
          ></textarea>
        </div>

        <div class="border-t pt-4">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            Dirección de la tienda
          </h3>

          <div class="space-y-4">
            <input
              type="text"
              formControlName="address_line1"
              class="w-full p-3 border border-gray-300 rounded-lg bg-green-50"
              placeholder="Calle y número"
            />

            <div class="grid grid-cols-2 gap-4">
              <input
                type="text"
                formControlName="city"
                class="w-full p-3 border border-gray-300 rounded-lg"
                placeholder="Ciudad"
              />

              <input
                type="text"
                formControlName="state_province"
                class="w-full p-3 border border-gray-300 rounded-lg"
                placeholder="Estado"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <input
                type="text"
                formControlName="postal_code"
                class="w-full p-3 border border-gray-300 rounded-lg"
                placeholder="Código postal"
              />

              <select
                formControlName="country_code"
                class="w-full p-3 border border-gray-300 rounded-lg"
              >
                <option value="MX">México</option>
                <option value="CO">Colombia</option>
                <option value="US">Estados Unidos</option>
              </select>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button
            type="submit"
            [disabled]="storeForm.invalid || isSubmitting"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {{ isSubmitting ? 'Guardando...' : 'Continuar' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class StoreSetupStepComponent implements OnInit {
  storeForm: FormGroup;
  isSubmitting = false;

  storeTypes = [
    { value: 'physical', label: 'Física', icon: '🏪' },
    { value: 'online', label: 'Online', icon: '🌐' },
    { value: 'hybrid', label: 'Híbrida', icon: '🔄' },
  ];

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
  ) {
    this.storeForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      store_type: ['physical'],
      timezone: ['America/Mexico_City'],
      address_line1: [''],
      address_line2: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['MX'],
    });
  }

  ngOnInit(): void {
    // Pre-populate with organization data
    const wizardData = this.wizardService.getWizardData();
    if (wizardData.organization) {
      this.storeForm.patchValue({
        address_line1: wizardData.organization.address_line1,
        address_line2: wizardData.organization.address_line2,
        city: wizardData.organization.city,
        state_province: wizardData.organization.state_province,
        postal_code: wizardData.organization.postal_code,
        country_code: wizardData.organization.country_code,
      });
    }
  }

  selectStoreType(type: string): void {
    this.storeForm.patchValue({ store_type: type });
  }

  getStoreTypeClass(type: string): string {
    const baseClass = 'p-4 rounded-lg border-2 transition-all cursor-pointer ';
    const isSelected = this.storeForm.get('store_type')?.value === type;
    return baseClass + (isSelected
      ? 'border-blue-500 bg-blue-50'
      : 'border-gray-200 hover:border-gray-300');
  }

  onSubmit(): void {
    if (this.storeForm.valid) {
      this.isSubmitting = true;
      this.wizardService.setupStore(this.storeForm.value).subscribe({
        next: () => {
          this.isSubmitting = false;
          this.wizardService.nextStep();
        },
        error: (error) => {
          this.isSubmitting = false;
          console.error('Error setting up store:', error);
          alert('Error al guardar la tienda. Por favor intenta de nuevo.');
        },
      });
    }
  }
}
