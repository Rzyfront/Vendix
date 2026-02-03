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
      /* ============================================
         MOBILE-FIRST ORGANIZATION SETUP STEP
         Inspired by modern mobile onboarding patterns
         ============================================ */

      :host {
        display: block;
        height: 100%;
      }

      .organization-step {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 70vh;
        overflow: hidden;
      }

      /* Scrollable content area */
      .organization-content {
        flex: 1;
        overflow-y: auto;
        padding: 0 0.5rem;
        -webkit-overflow-scrolling: touch;
      }

      /* Custom scrollbar for webkit browsers */
      .organization-content::-webkit-scrollbar {
        width: 4px;
      }

      .organization-content::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 10px;
      }

      /* ============================================
         HEADER SECTION
         ============================================ */

      .organization-header {
        text-align: center;
        padding: 0.75rem 0;
      }

      .org-icon-wrapper {
        margin-bottom: 0.5rem;
      }

      .org-icon-bg {
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, var(--color-success) 0%, #16a34a 100%);
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
        animation: orgPop 0.6s ease-out;
      }

      @keyframes orgPop {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        50% {
          transform: scale(1.1);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .org-icon {
        color: var(--color-text-on-primary);
      }

      .org-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.25rem 0;
      }

      .org-subtitle {
        font-size: 0.75rem;
        color: var(--color-text-muted);
        line-height: 1.5;
        margin: 0;
        padding: 0 0.5rem;
      }

      /* ============================================
         PREFILLED BADGE
         ============================================ */

      .prefilled-badge {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        background: var(--color-warning-light);
        border: 1px solid rgba(251, 146, 60, 0.3);
        border-radius: 0.75rem;
        padding: 0.625rem 0.75rem;
        margin: 0.75rem 0;
      }

      .prefilled-icon {
        color: var(--color-warning);
        flex-shrink: 0;
        margin-top: 1px;
      }

      .prefilled-text {
        color: var(--color-warning);
        font-size: 0.6875rem;
        font-weight: 500;
        line-height: 1.4;
      }

      /* ============================================
         FORM SECTIONS
         ============================================ */

      .organization-form {
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
      }

      .form-section {
        background: var(--color-surface);
        padding: 0.875rem;
        border-radius: 0.875rem;
        border: 1px solid var(--color-border);
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
        padding-bottom: 0.625rem;
        border-bottom: 1px solid var(--color-border);
      }

      .section-icon {
        width: 28px;
        height: 28px;
        background: var(--color-success-light);
        border-radius: 0.375rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .section-icon-element {
        color: var(--color-success);
      }

      .section-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-text-primary);
        margin: 0;
      }

      /* ============================================
         FORM GRID - MOBILE FIRST
         ============================================ */

      .form-grid {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
      }

      .field-label {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--color-text-secondary);
        margin-bottom: 0.375rem;
      }

      .field-required {
        color: var(--color-error);
        font-size: 0.6875rem;
        font-weight: 700;
      }

      .field-optional {
        color: var(--color-text-muted);
        font-size: 0.625rem;
        font-style: italic;
      }

      /* Input fields with compact sizing */
      .field-input {
        height: 40px;
        min-height: 40px;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        font-size: var(--fs-sm);
        transition: all 0.2s ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        width: 100%;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-success);
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
      }

      .field-input::placeholder {
        color: var(--color-text-muted);
        font-size: 0.8125rem;
      }

      /* Textarea with compact sizing */
      .field-textarea {
        min-height: 72px;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        font-size: var(--fs-sm);
        transition: all 0.2s ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        width: 100%;
      }

      .field-textarea:focus {
        outline: none;
        border-color: var(--color-success);
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15);
      }

      .field-textarea::placeholder {
        color: var(--color-text-muted);
        font-size: 0.8125rem;
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        margin-top: 0.375rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: 0.625rem;
        line-height: 1.4;
      }

      /* ============================================
         DESKTOP RESPONSIVE ADJUSTMENTS
         ============================================ */

      @media (min-width: 768px) {
        .organization-step {
          max-height: none;
        }

        .organization-content {
          padding: 0 1rem;
        }

        .organization-header {
          padding: 1rem 0;
        }

        .org-icon-bg {
          width: 56px;
          height: 56px;
        }

        .org-title {
          font-size: 1.5rem;
        }

        .org-subtitle {
          font-size: 0.875rem;
          max-width: 400px;
          margin: 0 auto;
          padding: 0;
        }

        .prefilled-badge {
          max-width: 500px;
          margin: 1rem auto;
          padding: 0.75rem 1rem;
        }

        .prefilled-text {
          font-size: 0.75rem;
        }

        .organization-form {
          max-width: 600px;
          margin: 0 auto;
          gap: 1rem;
        }

        .form-section {
          padding: 1rem 1.25rem;
        }

        .section-header {
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
        }

        .section-title {
          font-size: 1rem;
        }

        /* Grid layout for desktop */
        .form-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }

        .field-label {
          font-size: 0.75rem;
        }

        .field-optional {
          font-size: 0.6875rem;
        }

        .field-input {
          height: 40px;
          min-height: 40px;
          padding: 0.5rem 0.75rem;
          font-size: var(--fs-sm);
        }

        .field-textarea {
          min-height: 72px;
          padding: 0.5rem 0.75rem;
        }

        .hint-text {
          font-size: 0.6875rem;
        }

      }
    `,
  ],
  template: `
    <div class="organization-step">
      <!-- Scrollable Content -->
      <div class="organization-content">
        <!-- Header -->
        <div class="organization-header">
          <div class="org-icon-wrapper">
            <div class="org-icon-bg">
              <app-icon name="building" size="28" class="org-icon"></app-icon>
            </div>
          </div>
          <h2 class="org-title">Configura tu organización</h2>
          <p class="org-subtitle">
            Cuéntanos sobre tu empresa para personalizar tu experiencia
          </p>
        </div>

        <!-- Pre-filled Badge -->
        <div class="prefilled-badge" *ngIf="isAutoGenerated">
          <app-icon name="sparkles" size="16" class="prefilled-icon"></app-icon>
          <span class="prefilled-text">
            Organización autogenerada desde "{{ storeName }}". Puedes editarla si lo deseas.
          </span>
        </div>

        <div class="prefilled-badge" *ngIf="!isAutoGenerated">
          <app-icon name="info" size="16" class="prefilled-icon"></app-icon>
          <span class="prefilled-text">
            Algunos campos están precargados con tu información
          </span>
        </div>

        <!-- Organization Form -->
        <form class="organization-form" [formGroup]="formGroup">
          <!-- Basic Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="building-2"
                  size="18"
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
                  size="18"
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
                  size="18"
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
                rows="3"
              ></textarea>
              <div class="field-hint">
                <app-icon name="info" size="12" class="hint-icon"></app-icon>
                <span class="hint-text">
                  Esto nos ayudará a personalizar mejor tu experiencia
                </span>
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
