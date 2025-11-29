import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '../../index';
import { InputComponent } from '../../input/input.component';

@Component({
  selector: 'app-organization-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent, InputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .organization-step {
      padding: 1.5rem 0;
      background: #FAFBFC;
      border-radius: 1rem;
      margin: -1rem;
    }

    .organization-container {
      max-width: 720px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .organization-header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .org-icon-wrapper {
      margin-bottom: 1.5rem;
    }

    .org-icon-bg {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #10B981 0%, #059669 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.24);
    }

    .org-icon {
      color: white;
    }

    .org-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 0.5rem;
    }

    .org-subtitle {
      color: #6B7280;
      font-size: 1rem;
      line-height: 1.6;
    }

    .prefilled-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: #FEF3C7;
      border: 1px solid #FDE68A;
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      margin-bottom: 2rem;
    }

    .prefilled-icon {
      color: #D97706;
    }

    .prefilled-text {
      color: #92400E;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .organization-form {
      background: white;
      border-radius: 0.75rem;
      padding: 2rem;
      border: 1px solid #E5E7EB;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .form-section {
      margin-bottom: 2rem;
    }

    .form-section:last-child {
      margin-bottom: 0;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #F3F4F6;
    }

    .section-icon {
      width: 40px;
      height: 40px;
      background: #F0FDF4;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .section-icon-element {
      color: #10B981;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #1F2937;
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .form-field {
      display: flex;
      flex-direction: column;
    }

    .field-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
      margin-bottom: 0.5rem;
    }

    .field-required {
      color: #EF4444;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .field-optional {
      color: #9CA3AF;
      font-size: 0.75rem;
      font-weight: 400;
    }

    .field-input {
      padding: 0.75rem 1rem;
      border: 2px solid #E5E7EB;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      transition: all 0.2s ease;
      background: white;
    }

    .field-input:focus {
      outline: none;
      border-color: #10B981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }

    .field-input::placeholder {
      color: #9CA3AF;
    }

    .field-textarea {
      padding: 0.75rem 1rem;
      border: 2px solid #E5E7EB;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      transition: all 0.2s ease;
      background: white;
      resize: vertical;
      min-height: 100px;
      font-family: inherit;
      line-height: 1.5;
    }

    .field-textarea:focus {
      outline: none;
      border-color: #10B981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }

    .field-textarea::placeholder {
      color: #9CA3AF;
    }

    .field-hint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .hint-icon {
      color: #9CA3AF;
    }

    .hint-text {
      color: #6B7280;
      font-size: 0.75rem;
      line-height: 1.4;
    }

    @media (max-width: 640px) {
      .organization-container {
        padding: 0 1rem;
      }

      .form-grid {
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .organization-form {
        padding: 1.5rem;
      }

      .org-title {
        font-size: 1.5rem;
      }

      .section-header {
        flex-direction: column;
        text-align: center;
        gap: 0.5rem;
      }

      .form-section {
        margin-bottom: 1.5rem;
      }
    }
  `],
  template: `
    <div class="step-content organization-step">
      <div class="organization-container">
        <!-- Header -->
        <div class="organization-header">
          <div class="org-icon-wrapper">
            <div class="org-icon-bg">
              <app-icon name="building" size="48" class="org-icon"></app-icon>
            </div>
          </div>
          <div class="org-header-content">
            <h2 class="org-title">Configura tu organización</h2>
            <p class="org-subtitle">
              Cuéntanos sobre tu empresa para personalizar tu experiencia
            </p>
          </div>
        </div>

        <!-- Pre-filled Badge -->
        <div class="prefilled-badge" *ngIf="isAutoGenerated">
          <app-icon name="sparkles" size="16" class="prefilled-icon"></app-icon>
          <span class="prefilled-text">Organización autogenerada desde "{{ storeName }}". Puedes editarla si lo deseas.</span>
        </div>

        <div class="prefilled-badge" *ngIf="!isAutoGenerated">
          <app-icon name="info" size="16" class="prefilled-icon"></app-icon>
          <span class="prefilled-text">Algunos campos están precargados con tu información</span>
        </div>

        <!-- Organization Form -->
        <form class="organization-form" [formGroup]="formGroup">
          <!-- Basic Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="building-2" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Información básica</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">
                  Nombre de la empresa
                  <span class="field-required">*</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="name"
                  placeholder="Mi Empresa S.A. de C.V."
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Email de contacto
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="email"
                  class="field-input"
                  formControlName="email"
                  placeholder="contacto@miempresa.com"
                />
              </div>

              <div class="form-field">
                <app-input
                  label="Teléfono"
                  formControlName="phone"
                  type="tel"
                  placeholder="+57 123 456 7890"
                  customInputClass="!p-3 !border-2 !border-gray-300 !rounded-md focus:!border-green-500 focus:!ring-green-500/20"
                ></app-input>
              </div>

              <div class="form-field">
                <label class="field-label">
                  Sitio web
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="url"
                  class="field-input"
                  formControlName="website"
                  placeholder="https://miempresa.com"
                />
              </div>
            </div>
          </div>

          <!-- Legal Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="file-text" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Información legal</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">
                  Razón social
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="legal_name"
                  placeholder="Nombre legal de la empresa"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  RFC o Tax ID
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  formControlName="tax_id"
                  placeholder="RFC000000000"
                />
              </div>
            </div>
          </div>

          <!-- Description Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="align-left" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Descripción</h3>
            </div>

            <div class="form-field">
              <label class="field-label">
                ¿Qué hace tu empresa?
                <span class="field-optional">(opcional)</span>
              </label>
              <textarea
                class="field-textarea"
                formControlName="description"
                placeholder="Describe brevemente qué hace tu empresa, tus productos o servicios..."
                rows="4"
              ></textarea>
              <div class="field-hint">
                <app-icon name="info" size="14" class="hint-icon"></app-icon>
                <span class="hint-text">Esto nos ayudará a personalizar mejor tu experiencia</span>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class OrganizationSetupStepComponent {
  @Input() formGroup: any;
  @Input() isAutoGenerated = false;
  @Input() storeName = '';
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();
}