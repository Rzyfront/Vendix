import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  selector: 'app-app-config-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-content app-config-step">
      <div class="step-container">
        <div class="form-section">
          <h3 class="section-title">
            <app-icon name="palette" size="20"></app-icon>
            Personaliza tu app
          </h3>
          <p class="section-description">
            Elige el tipo de aplicación y tu branding
          </p>

          <!-- Tipo de Aplicación -->
          <div class="mb-6">
            <div class="app-type-selection">
              <button
                type="button"
                class="app-type-option"
                [class.selected]="formGroup.get('app_type')?.value === 'ORG_ADMIN'"
                (click)="selectAppType('ORG_ADMIN')"
              >
                <div class="option-icon">
                  <app-icon name="building" size="24"></app-icon>
                </div>
                <div class="option-title">Aplicación Organizacional</div>
                <div class="option-description">
                  Gestiona múltiples tiendas, usuarios y sucursales desde un panel central
                </div>
                <div class="mt-2 text-xs text-[var(--color-primary)]">
                  ✅ Ideal para empresas con varias ubicaciones
                </div>
              </button>

              <button
                type="button"
                class="app-type-option"
                [class.selected]="formGroup.get('app_type')?.value === 'STORE_ADMIN'"
                (click)="selectAppType('STORE_ADMIN')"
              >
                <div class="option-icon">
                  <app-icon name="store" size="24"></app-icon>
                </div>
                <div class="option-title">Gestión de Tienda Única</div>
                <div class="option-description">
                  Enfocado en la operación de una sola tienda con herramientas especializadas
                </div>
                <div class="mt-2 text-xs text-[var(--color-secondary)]">
                  ✅ Perfecto para negocios individuales
                </div>
              </button>
            </div>
          </div>

          <!-- Colores -->
          <div class="form-section">
            <h4 class="section-title">
              <app-icon name="droplet" size="18"></app-icon>
              Colores de tu marca
            </h4>

            <div class="color-picker-section">
              <div class="color-input-group">
                <label class="field-label">Color primario</label>
                <div class="color-preview">
                  <input
                    type="color"
                    class="color-input"
                    [formControl]="formGroup.get('primary_color')"
                  />
                  <input
                    type="text"
                    class="color-value"
                    [formControl]="formGroup.get('primary_color')"
                    placeholder="#3B82F6"
                  />
                </div>
              </div>

              <div class="color-input-group">
                <label class="field-label">Color secundario</label>
                <div class="color-preview">
                  <input
                    type="color"
                    class="color-input"
                    [formControl]="formGroup.get('secondary_color')"
                  />
                  <input
                    type="text"
                    class="color-value"
                    [formControl]="formGroup.get('secondary_color')"
                    placeholder="#10B981"
                  />
                </div>
              </div>
            </div>

            <!-- Vista previa -->
            <div class="mt-4 p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-[var(--radius-lg)]">
              <h5 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                Vista previa de tu branding
              </h5>
              <div class="flex space-x-2">
                <div
                  class="h-12 rounded-md border border-[var(--color-border)] flex items-center justify-center text-white text-sm font-medium"
                  [style.backgroundColor]="formGroup.get('primary_color')?.value || '#3B82F6'"
                >
                  Botón primario
                </div>
                <div
                  class="h-12 rounded-md border border-[var(--color-border)] flex items-center justify-center text-white text-sm font-medium"
                  [style.backgroundColor]="formGroup.get('secondary_color')?.value || '#10B981'"
                >
                  Botón secundario
                </div>
              </div>
            </div>
          </div>

          <!-- Dominio -->
          <div class="form-section">
            <h4 class="section-title">
              <app-icon name="globe" size="18"></app-icon>
              Configuración de dominio
            </h4>

            <div class="bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-[var(--radius-lg)] p-4 mb-4">
              <div class="flex items-center space-x-3">
                <app-icon name="check-circle" class="text-[var(--color-success)]" size="20"></app-icon>
                <div>
                  <div class="font-medium text-[var(--color-text-primary)]">Dominio automático configurado</div>
                  <div class="text-sm text-[var(--color-text-secondary)]">{{ generatedSubdomain }}</div>
                </div>
              </div>
            </div>

            <div class="flex items-center space-x-3 mb-4">
              <input
                type="checkbox"
                id="custom_domain"
                class="h-4 w-4 text-[var(--color-primary)]"
                [formControl]="formGroup.get('use_custom_domain')"
              />
              <label for="custom_domain" class="text-sm font-medium text-[var(--color-text-primary)]">
                Quiero usar mi propio dominio
              </label>
            </div>

            <div *ngIf="formGroup.get('use_custom_domain')?.value" class="space-y-4 p-4 border border-[var(--color-border)] rounded-[var(--radius-lg)]">
              <div>
                <label class="field-label">Tu dominio personalizado</label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('custom_domain')"
                  placeholder="tienda.micomercio.com"
                />
              </div>

              <div class="text-sm text-[var(--color-text-secondary)]">
                <p>📌 Después de completar el wizard, te ayudaremos a configurar:</p>
                <ul class="mt-2 space-y-1 ml-4">
                  <li>• DNS records</li>
                  <li>• Certificado SSL</li>
                  <li>• Verificación de propiedad</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AppConfigStepComponent {
  @Input() formGroup: any;
  @Input() generatedSubdomain: string = '';
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  constructor() {
    this.generatedSubdomain = 'mi-empresa-' + Date.now().toString(36) + '.vendix.com';
  }

  selectAppType(type: string): void {
    this.formGroup.patchValue({ app_type: type });
  }
}