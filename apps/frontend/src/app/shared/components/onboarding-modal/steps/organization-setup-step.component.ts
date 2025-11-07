import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  selector: 'app-organization-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-content form-step">
      <div class="step-container">
        <div class="form-section">
          <h3 class="section-title">
            <app-icon name="building" size="20"></app-icon>
            Información de la empresa
          </h3>
          <p class="section-description">
            Configura los datos de tu organización
          </p>

          <div class="form-grid">
            <div class="form-field">
              <label class="field-label">Nombre de la empresa</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('name')"
                placeholder="Mi Empresa S.A. de C.V."
              />
            </div>

            <div class="form-field">
              <label class="field-label">Email de contacto</label>
              <input
                type="email"
                class="field-input"
                [formControl]="formGroup.get('email')"
                placeholder="contacto@miempresa.com"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Teléfono</label>
              <input
                type="tel"
                class="field-input"
                [formControl]="formGroup.get('phone')"
                placeholder="+52 (555) 123-4567"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Sitio web</label>
              <input
                type="url"
                class="field-input"
                [formControl]="formGroup.get('website')"
                placeholder="https://miempresa.com"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Razón social</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('legal_name')"
                placeholder="Nombre legal de la empresa"
              />
            </div>

            <div class="form-field">
              <label class="field-label">RFC o Tax ID</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('tax_id')"
                placeholder="RFC000000000"
              />
            </div>
          </div>

          <div class="form-field mt-4">
            <label class="field-label">Descripción</label>
            <textarea
              class="field-input"
              [formControl]="formGroup.get('description')"
              placeholder="Describe brevemente qué hace tu empresa..."
              rows="3"
            ></textarea>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class OrganizationSetupStepComponent {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();
}