import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  selector: 'app-store-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-content form-step">
      <div class="step-container">
        <div class="form-section">
          <h3 class="section-title">
            <app-icon name="store" size="20"></app-icon>
            Información de la tienda
          </h3>
          <p class="section-description">
            Configura los datos de tu punto de venta
          </p>

          <div class="form-grid">
            <div class="form-field">
              <label class="field-label">Nombre de la tienda</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('name')"
                placeholder="Tienda Principal"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Tipo de tienda</label>
              <select class="field-input" [formControl]="formGroup.get('store_type')">
                <option value="physical">Tienda física</option>
                <option value="online">Tienda online</option>
                <option value="hybrid">Híbrida</option>
              </select>
            </div>

            <div class="form-field">
              <label class="field-label">Zona horaria</label>
              <select class="field-input" [formControl]="formGroup.get('timezone')">
                <option value="America/Mexico_City">Ciudad de México</option>
                <option value="America/Tijuana">Tijuana</option>
                <option value="America/Monterrey">Monterrey</option>
                <option value="America/Guadalajara">Guadalajara</option>
              </select>
            </div>

            <div class="form-field">
              <label class="field-label">País</label>
              <select class="field-input" [formControl]="formGroup.get('country_code')">
                <option value="MX">México</option>
                <option value="US">Estados Unidos</option>
                <option value="ES">España</option>
                <option value="CO">Colombia</option>
              </select>
            </div>
          </div>

          <div class="form-section mt-6">
            <h4 class="section-title">
              <app-icon name="map-pin" size="18"></app-icon>
              Dirección
            </h4>

            <div class="form-grid">
              <div class="form-field col-span-2">
                <label class="field-label">Calle y número</label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('address_line1')"
                  placeholder="Calle Principal #123"
                />
              </div>

              <div class="form-field">
                <label class="field-label">Ciudad</label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('city')"
                  placeholder="Ciudad de México"
                />
              </div>

              <div class="form-field">
                <label class="field-label">Estado</label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('state_province')"
                  placeholder="CDMX"
                />
              </div>

              <div class="form-field">
                <label class="field-label">Código postal</label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('postal_code')"
                  placeholder="06000"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class StoreSetupStepComponent {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();
}