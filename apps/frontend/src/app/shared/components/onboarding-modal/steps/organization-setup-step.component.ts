import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { IconComponent } from '../../index';

@Component({
  selector: 'app-organization-setup-step',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .organization-step {
        padding: 0;
        background: transparent;
      }

      .organization-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      .organization-header {
        text-align: center;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .org-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .org-icon-bg {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, var(--color-success) 0%, #16a34a 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
      }

      .org-icon {
        color: var(--color-text-on-primary);
      }

      .org-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .org-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      .prefilled-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        background: var(--color-warning-light);
        border: 1px solid rgba(251, 146, 60, 0.3);
        border-radius: var(--radius-md);
        padding: 0.5rem 0.75rem;
        margin-bottom: 1rem;
      }

      .prefilled-icon {
        color: var(--color-warning);
      }

      .prefilled-text {
        color: var(--color-warning);
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
      }

      .organization-form {
        background: transparent;
        padding: 0;
        border: none;
        box-shadow: none;
      }

      .form-section {
        margin-bottom: 1.25rem;
        background: var(--color-surface);
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
      }

      .form-section:last-child {
        margin-bottom: 0;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
        padding-bottom: 0.75rem;
        border-bottom: 1px solid var(--color-border);
      }

      .section-icon {
        width: 28px;
        height: 28px;
        background: var(--color-success-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .section-icon-element {
        color: var(--color-success);
      }

      .section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .form-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
      }

      .field-label {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        margin-bottom: 0.375rem;
      }

      .field-required {
        color: var(--color-error);
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
      }

      .field-optional {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        font-style: italic;
      }

      .field-input {
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--fs-sm);
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        height: 2.25rem;
        width: 100%;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-success);
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.15);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
      }

      .field-textarea {
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--fs-sm);
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        resize: vertical;
        min-height: 80px;
        font-family: inherit;
        line-height: 1.5;
      }

      .field-textarea:focus {
        outline: none;
        border-color: var(--color-success);
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.15);
      }

      .field-textarea::placeholder {
        color: var(--color-text-muted);
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.25rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      @media (max-width: 1024px) {
        .form-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      @media (max-width: 640px) {
        .form-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
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
          <span class="prefilled-text"
            >Organización autogenerada desde "{{ storeName }}". Puedes editarla
            si lo deseas.</span
          >
        </div>

        <div class="prefilled-badge" *ngIf="!isAutoGenerated">
          <app-icon name="info" size="16" class="prefilled-icon"></app-icon>
          <span class="prefilled-text"
            >Algunos campos están precargados con tu información</span
          >
        </div>

        <!-- Organization Form -->
        <form class="organization-form" [formGroup]="formGroup">
          <!-- Basic Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="building-2"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
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
                  <span class="field-required">*</span>
                </label>
                <input
                  type="email"
                  class="field-input"
                  formControlName="email"
                  placeholder="contacto@miempresa.com"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Teléfono
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="tel"
                  class="field-input"
                  formControlName="phone"
                  placeholder="+57 123 456 7890"
                />
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
                <app-icon
                  name="file-text"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
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
                <app-icon
                  name="align-left"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
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
                <span class="hint-text"
                  >Esto nos ayudará a personalizar mejor tu experiencia</span
                >
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
