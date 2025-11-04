import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-organization-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="max-w-2xl mx-auto space-y-6">
      <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Tu organización 🏢</h2>
        <p class="text-gray-600">Configura los datos de tu empresa</p>
      </div>

      <div class="bg-blue-50 p-4 rounded-lg mb-6">
        <p class="text-sm text-blue-700">
          💡 Hemos prellenado algunos datos con tu información. Puedes editarlos si lo necesitas.
        </p>
      </div>

      <form [formGroup]="orgForm" (ngSubmit)="onSubmit()" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Nombre de la organización <span class="text-red-500">*</span>
          </label>
          <input
            type="text"
            formControlName="name"
            class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="Mi Empresa S.A. de C.V."
            required
          />
          <div *ngIf="orgForm.get('name')?.invalid && orgForm.get('name')?.touched" class="text-red-500 text-sm mt-1">
            El nombre de la organización es requerido
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
            placeholder="Describe tu negocio..."
          ></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Email</label>
            <input
              type="email"
              formControlName="email"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="contacto@empresa.com"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input
              type="tel"
              formControlName="phone"
              class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="+52 123 456 7890"
            />
          </div>
        </div>

        <div class="border-t pt-4">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">
            Dirección de la organización
          </h3>

          <div class="space-y-4">
            <input
              type="text"
              formControlName="address_line1"
              class="w-full p-3 border border-gray-300 rounded-lg bg-blue-50"
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
            [disabled]="orgForm.invalid || isSubmitting"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {{ isSubmitting ? 'Guardando...' : 'Continuar' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class OrganizationSetupStepComponent implements OnInit {
  orgForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
  ) {
    this.orgForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      email: [''],
      phone: [''],
      website: [''],
      tax_id: [''],
      address_line1: [''],
      address_line2: [''],
      city: [''],
      state_province: [''],
      postal_code: [''],
      country_code: ['MX'],
    });
  }

  ngOnInit(): void {
    // Pre-populate with user data if available
    const wizardData = this.wizardService.getWizardData();
    if (wizardData.user) {
      this.orgForm.patchValue({
        address_line1: wizardData.user.address_line1,
        address_line2: wizardData.user.address_line2,
        city: wizardData.user.city,
        state_province: wizardData.user.state_province,
        postal_code: wizardData.user.postal_code,
        country_code: wizardData.user.country_code,
      });
    }
  }

  onSubmit(): void {
    if (this.orgForm.valid) {
      this.isSubmitting = true;
      this.wizardService.setupOrganization(this.orgForm.value).subscribe({
        next: () => {
          this.isSubmitting = false;
          this.wizardService.nextStep();
        },
        error: (error) => {
          this.isSubmitting = false;
          console.error('Error setting up organization:', error);
          alert('Error al guardar la organización. Por favor intenta de nuevo.');
        },
      });
    }
  }
}
