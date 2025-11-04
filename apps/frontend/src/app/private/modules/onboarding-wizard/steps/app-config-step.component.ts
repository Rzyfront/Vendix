import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-app-config-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="max-w-3xl mx-auto space-y-8">
      <div class="text-center mb-6">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">Personaliza tu app 🎨</h2>
        <p class="text-gray-600">Elige el tipo de aplicación y tu branding</p>
      </div>

      <form [formGroup]="configForm" (ngSubmit)="onSubmit()">
        <!-- Tipo de Aplicación -->
        <div class="mb-8">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Tipo de aplicación</h3>
          <div class="grid grid-cols-2 gap-6">
            <button
              type="button"
              (click)="selectAppType('ORGANIZATIONAL')"
              [class]="getAppTypeClass('ORGANIZATIONAL')"
            >
              <div class="text-3xl mb-3">🏢</div>
              <h4 class="font-semibold text-lg mb-2">Aplicación Organizacional</h4>
              <p class="text-sm text-gray-600">
                Gestiona múltiples tiendas, usuarios y sucursales desde un panel central
              </p>
              <div class="mt-4 text-xs text-blue-600">
                ✅ Ideal para empresas con varias ubicaciones
              </div>
            </button>

            <button
              type="button"
              (click)="selectAppType('SINGLE_STORE')"
              [class]="getAppTypeClass('SINGLE_STORE')"
            >
              <div class="text-3xl mb-3">🏪</div>
              <h4 class="font-semibold text-lg mb-2">Gestión de Tienda Única</h4>
              <p class="text-sm text-gray-600">
                Enfocado en la operación de una sola tienda con herramientas especializadas
              </p>
              <div class="mt-4 text-xs text-green-600">
                ✅ Perfecto para negocios individuales
              </div>
            </button>
          </div>
        </div>

        <!-- Colores -->
        <div class="mb-8">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Colores de tu marca</h3>
          <div class="grid grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Color primario
              </label>
              <div class="flex items-center space-x-3">
                <input
                  type="color"
                  formControlName="primary_color"
                  class="h-12 w-12 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  formControlName="primary_color"
                  class="flex-1 p-3 border border-gray-300 rounded-lg"
                  placeholder="#3B82F6"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Color secundario
              </label>
              <div class="flex items-center space-x-3">
                <input
                  type="color"
                  formControlName="secondary_color"
                  class="h-12 w-12 border border-gray-300 rounded cursor-pointer"
                />
                <input
                  type="text"
                  formControlName="secondary_color"
                  class="flex-1 p-3 border border-gray-300 rounded-lg"
                  placeholder="#10B981"
                />
              </div>
            </div>
          </div>

          <!-- Color Preview -->
          <div class="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 class="text-sm font-medium text-gray-700 mb-3">
              Vista previa de tu branding
            </h4>
            <div class="grid grid-cols-6 gap-2">
              <div
                *ngFor="let color of colorPalette"
                class="h-16 rounded border border-gray-200"
                [style.backgroundColor]="color"
                [title]="color"
              ></div>
            </div>
          </div>
        </div>

        <!-- Dominio -->
        <div class="mb-8">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Configuración de dominio</h3>

          <div class="bg-green-50 p-4 rounded-lg mb-4">
            <div class="flex items-center space-x-3">
              <div class="text-2xl">🌐</div>
              <div>
                <div class="font-semibold text-green-800">Dominio automático configurado</div>
                <div class="text-green-700">{{ generatedSubdomain }}</div>
              </div>
            </div>
          </div>

          <div class="flex items-center space-x-3 mb-4">
            <input
              type="checkbox"
              id="custom_domain"
              formControlName="use_custom_domain"
              class="h-4 w-4 text-blue-600"
            />
            <label for="custom_domain" class="text-sm font-medium text-gray-700">
              Quiero usar mi propio dominio
            </label>
          </div>

          <div *ngIf="configForm.get('use_custom_domain')?.value" class="space-y-4 p-4 border border-gray-200 rounded-lg">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Tu dominio personalizado
              </label>
              <input
                type="text"
                formControlName="custom_domain"
                class="w-full p-3 border border-gray-300 rounded-lg"
                placeholder="tienda.micomercio.com"
              />
            </div>

            <div class="text-sm text-gray-600">
              <p>📌 Después de completar el wizard, te ayudaremos a configurar:</p>
              <ul class="mt-2 space-y-1 ml-4">
                <li>• DNS records</li>
                <li>• Certificado SSL</li>
                <li>• Verificación de propiedad</li>
              </ul>
            </div>
          </div>
        </div>

        <div class="flex justify-end">
          <button
            type="submit"
            [disabled]="configForm.invalid || isSubmitting"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {{ isSubmitting ? 'Guardando...' : 'Continuar' }}
          </button>
        </div>
      </form>
    </div>
  `,
})
export class AppConfigStepComponent {
  configForm: FormGroup;
  isSubmitting = false;
  generatedSubdomain = 'mi-empresa-' + Date.now().toString(36) + '.vendix.com';
  colorPalette: string[] = [];

  constructor(
    private fb: FormBuilder,
    private wizardService: OnboardingWizardService,
  ) {
    this.configForm = this.fb.group({
      app_type: ['ORGANIZATIONAL', Validators.required],
      primary_color: ['#3B82F6', Validators.required],
      secondary_color: ['#10B981', Validators.required],
      use_custom_domain: [false],
      custom_domain: [''],
      subdomain: [this.generatedSubdomain],
    });

    // Watch for color changes to update palette
    this.configForm.get('primary_color')?.valueChanges.subscribe(() => this.updateColorPalette());
    this.configForm.get('secondary_color')?.valueChanges.subscribe(() => this.updateColorPalette());
    
    this.updateColorPalette();
  }

  selectAppType(type: string): void {
    this.configForm.patchValue({ app_type: type });
  }

  getAppTypeClass(type: string): string {
    const baseClass = 'p-6 rounded-lg border-2 transition-all text-left w-full ';
    const isSelected = this.configForm.get('app_type')?.value === type;
    return baseClass + (isSelected
      ? 'border-blue-500 bg-blue-50'
      : 'border-gray-200 hover:border-gray-300');
  }

  updateColorPalette(): void {
    const primary = this.configForm.get('primary_color')?.value || '#3B82F6';
    const secondary = this.configForm.get('secondary_color')?.value || '#10B981';
    
    this.colorPalette = [
      primary,
      secondary,
      this.lightenColor(primary, 20),
      this.darkenColor(primary, 20),
      this.lightenColor(secondary, 20),
      this.darkenColor(secondary, 20),
    ];
  }

  lightenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
    return `#${(0x1000000 + (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 + (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 + (B < 255 ? (B < 1 ? 0 : B) : 255)).toString(16).slice(1).toUpperCase()}`;
  }

  darkenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = ((num >> 8) & 0x00ff) - amt;
    const B = (num & 0x0000ff) - amt;
    return `#${(0x1000000 + (R > 0 ? R : 0) * 0x10000 + (G > 0 ? G : 0) * 0x100 + (B > 0 ? B : 0)).toString(16).slice(1).toUpperCase()}`;
  }

  onSubmit(): void {
    if (this.configForm.valid) {
      this.isSubmitting = true;
      this.wizardService.setupAppConfig(this.configForm.value).subscribe({
        next: () => {
          this.isSubmitting = false;
          this.wizardService.nextStep();
        },
        error: (error) => {
          this.isSubmitting = false;
          console.error('Error setting up app config:', error);
          alert('Error al guardar la configuración. Por favor intenta de nuevo.');
        },
      });
    }
  }
}
