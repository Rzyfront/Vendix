import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-user-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Tus datos 👤</h2>
        <p class="text-gray-600">
          Cuéntanos sobre ti (todos los campos son opcionales)
        </p>
      </div>

      <form [formGroup]="userForm" (ngSubmit)="onSubmit()" class="space-y-6">
        <div class="grid grid-cols-2 gap-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Nombre
            </label>
            <input
              type="text"
              formControlName="first_name"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Tu nombre"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Apellido
            </label>
            <input
              type="text"
              formControlName="last_name"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Tu apellido"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Teléfono (opcional)
          </label>
          <input
            type="tel"
            formControlName="phone"
            class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="+52 123 456 7890"
          />
        </div>

        <div class="border-t pt-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            Tu dirección (opcional)
          </h3>

          <div class="space-y-4">
            <input
              type="text"
              formControlName="address_line1"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Calle y número"
            />

            <input
              type="text"
              formControlName="address_line2"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Apartamento, suite, etc (opcional)"
            />

            <div class="grid grid-cols-2 gap-4">
              <input
                type="text"
                formControlName="city"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Ciudad"
              />

              <input
                type="text"
                formControlName="state_province"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Estado"
              />
            </div>

            <div class="grid grid-cols-2 gap-4">
              <input
                type="text"
                formControlName="postal_code"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Código postal"
              />

              <select
                formControlName="country_code"
                class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="MX">México</option>
                <option value="CO">Colombia</option>
                <option value="US">Estados Unidos</option>
                <option value="ES">España</option>
              </select>
            </div>
          </div>
        </div>

        <div class="flex justify-end space-x-3">
          <button
            type="button"
            (click)="skip()"
            class="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Saltar
          </button>
          <button
            type="submit"
            [disabled]="isSubmitting"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {{ isSubmitting ? 'Guardando...' : 'Continuar' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class UserSetupStepComponent {
  userForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
  ) {
    this.userForm = this.fb.group({
      first_name: [''],
      last_name: [''],
      phone: [''],
      address_line1: [''],
      address_line2: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['MX'],
    });
  }

  onSubmit(): void {
    if (this.userForm.valid) {
      this.isSubmitting = true;
      this.wizardService.setupUser(this.userForm.value).subscribe({
        next: () => {
          this.isSubmitting = false;
          this.wizardService.nextStep();
        },
        error: (error) => {
          this.isSubmitting = false;
          console.error('Error setting up user:', error);
          alert('Error al guardar los datos. Por favor intenta de nuevo.');
        },
      });
    }
  }

  skip(): void {
    this.wizardService.nextStep();
  }
}
