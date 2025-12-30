import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent, IconComponent } from '../../index';

@Component({
  selector: 'app-app-config-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .app-config-step {
        padding: 0;
        background: transparent;
      }

      .app-config-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      .app-config-header {
        text-align: center;
        margin-bottom: 1rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .config-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .config-icon-bg {
        width: 56px;
        height: 56px;
        background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-md);
      }

      .config-icon {
        color: var(--color-text-on-primary);
      }

      .config-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .config-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.5;
      }

      .config-form {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1rem;
      }

      .form-section {
        background: var(--color-surface);
        padding: 1rem;
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
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
        background: var(--color-primary-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .section-icon-element {
        color: var(--color-primary);
      }

      .section-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .color-selector {
        flex: 1;
      }

      .color-inputs-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .color-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .color-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
      }

      .help-icon {
        color: var(--color-text-muted);
        cursor: help;
      }

      .help-icon:hover {
        color: var(--color-primary);
      }

      .color-preview {
        width: 18px;
        height: 18px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
      }

      .color-input-wrapper {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .color-picker {
        width: 36px;
        height: 36px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast) ease;
        flex-shrink: 0;
      }

      .color-picker:hover {
        border-color: var(--color-primary);
      }

      .color-text {
        flex: 1;
        padding: 0.5rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        font-size: var(--fs-xs);
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        transition: all var(--transition-fast) ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        height: 36px;
      }

      .color-text:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-ring);
      }

      .palette-preview {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 0.75rem;
        margin-top: auto;
      }

      .palette-title {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .palette-colors {
        display: flex;
        gap: 0.375rem;
        flex-wrap: wrap;
      }

      .palette-color {
        width: 28px;
        height: 28px;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        cursor: pointer;
        transition: all var(--transition-fast) ease;
      }

      .palette-color:hover {
        transform: scale(1.1);
        border-color: var(--color-primary);
      }

      .domain-card {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        margin-bottom: 1rem;
      }

      .domain-card.auto-domain {
        background: var(--color-success-light);
        border: 1px solid rgba(34, 197, 94, 0.3);
      }

      .domain-icon {
        width: 40px;
        height: 40px;
        background: var(--color-surface);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: var(--shadow-sm);
      }

      .domain-check-icon {
        color: var(--color-success);
      }

      .domain-content h4 {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-success);
        margin-bottom: 0.125rem;
      }

      .domain-url {
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-success);
        background: var(--color-surface);
        padding: 0.125rem 0.375rem;
        border-radius: var(--radius-sm);
        display: inline-block;
        margin-bottom: 0.25rem;
      }

      .domain-description {
        color: var(--color-text-secondary);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      .custom-domain-toggle {
        margin-bottom: 0.75rem;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
      }

      .toggle-input {
        display: none;
      }

      .toggle-slider {
        width: 36px;
        height: 20px;
        background: var(--color-border);
        border-radius: var(--radius-pill);
        position: relative;
        transition: all var(--transition-fast) ease;
      }

      .toggle-slider::before {
        content: '';
        position: absolute;
        width: 16px;
        height: 16px;
        background: var(--color-surface);
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: all var(--transition-fast) ease;
        box-shadow: var(--shadow-sm);
      }

      .toggle-input:checked + .toggle-slider {
        background: var(--color-primary);
      }

      .toggle-input:checked + .toggle-slider::before {
        transform: translateX(16px);
      }

      .custom-domain-section {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 0.75rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .field-label {
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
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
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-ring);
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.25rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.3;
      }

      @media (max-width: 1024px) {
        .config-form {
          grid-template-columns: 1fr;
        }
        .color-inputs-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
  template: `
    <div class="step-content app-config-step" [formGroup]="formGroup">
      <div class="app-config-container">
        <!-- Header -->
        <div class="app-config-header">
          <div class="config-icon-wrapper">
            <div class="config-icon-bg">
              <app-icon name="palette" size="40" class="config-icon"></app-icon>
            </div>
          </div>
          <div class="config-header-content">
            <h2 class="config-title">Personaliza tu aplicación</h2>
            <p class="config-subtitle">
              Elige los colores y dominio que representarán tu marca
            </p>
          </div>
        </div>

        <!-- App Configuration Form -->
        <div class="config-form">
          <!-- Color Palette Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="droplet"
                  size="16"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Colores de tu marca</h3>
            </div>

            <div class="color-selector">
              <div class="color-inputs-grid">
                <div class="color-input-group">
                  <label class="color-label">
                    Color primario
                    <span
                      class="color-preview"
                      [style.background-color]="primaryColor"
                    ></span>
                  </label>
                  <div class="color-input-wrapper">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="primaryColor"
                      (input)="onPrimaryColorChange($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="primaryColor"
                      (input)="onPrimaryColorChange($event)"
                      placeholder="#7ed7a5"
                    />
                  </div>
                </div>

                <div class="color-input-group">
                  <label class="color-label">
                    Color secundario
                    <span
                      class="color-preview"
                      [style.background-color]="secondaryColor"
                    ></span>
                  </label>
                  <div class="color-input-wrapper">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="secondaryColor"
                      (input)="onSecondaryColorChange($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="secondaryColor"
                      (input)="onSecondaryColorChange($event)"
                      placeholder="#2f6f4e"
                    />
                  </div>
                </div>

                <div class="color-input-group">
                  <label class="color-label">
                    Color terciario
                    <span
                      class="color-preview"
                      [style.background-color]="tertiaryColor"
                    ></span>
                  </label>
                  <div class="color-input-wrapper">
                    <input
                      type="color"
                      class="color-picker"
                      [value]="tertiaryColor"
                      (input)="onTertiaryColorChange($event)"
                    />
                    <input
                      type="text"
                      class="color-text"
                      [value]="tertiaryColor"
                      (input)="onTertiaryColorChange($event)"
                      placeholder="#f59e0b"
                    />
                  </div>
                </div>
              </div>

              <!-- Color Palette Preview -->
              <div class="palette-preview">
                <h4 class="palette-title">Paleta rápida</h4>
                <div class="palette-colors">
                  @for (color of suggestedColors; track color) {
                  <button
                    type="button"
                    class="palette-color"
                    [style.background-color]="color"
                    (click)="selectColor(color)"
                    [attr.aria-label]="'Seleccionar color ' + color"
                  ></button>
                  }
                </div>
              </div>
            </div>
          </div>

          <!-- Domain Configuration Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="globe"
                  size="16"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Dominio de tu tienda</h3>
            </div>

            <!-- Auto-generated Domain -->
            <div class="domain-card auto-domain">
              <div class="domain-icon">
                <app-icon
                  name="check-circle"
                  size="20"
                  class="domain-check-icon"
                ></app-icon>
              </div>
              <div class="domain-content">
                <h4>Dominio automático</h4>
                <span class="domain-url">{{ generatedDomain }}</span>
                <p class="domain-description">
                  Tu tienda estará disponible en este dominio gratuito
                </p>
              </div>
            </div>

            <!-- Custom Domain Toggle -->
            <div class="custom-domain-toggle">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  class="toggle-input"
                  [checked]="useCustomDomain"
                  (change)="toggleCustomDomain()"
                />
                <span class="toggle-slider"></span>
                Usar dominio personalizado (opcional)
              </label>
            </div>

            <!-- Custom Domain Input -->
            @if (useCustomDomain) {
            <div class="custom-domain-section">
              <div class="form-field">
                <label class="field-label">Tu dominio personalizado</label>
                <input
                  type="text"
                  class="field-input"
                  placeholder="mitienda.com"
                  formControlName="customDomain"
                />
                <div class="field-hint">
                  <app-icon
                    name="info"
                    size="12"
                    class="hint-icon"
                  ></app-icon>
                  <span class="hint-text"
                    >Requiere configuración DNS adicional</span
                  >
                </div>
              </div>
            </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AppConfigStepComponent {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  // Color properties
  primaryColor: string = '#7ed7a5';
  secondaryColor: string = '#2f6f4e';
  tertiaryColor: string = '#f59e0b';
  suggestedColors: string[] = [
    '#7ed7a5',
    '#2f6f4e',
    '#f59e0b',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#ef4444',
    '#22c55e',
    '#14b8a6',
  ];

  // Domain properties
  generatedDomain: string = 'mi-tienda.vendix.app';
  useCustomDomain: boolean = false;

  onPrimaryColorChange(event: any): void {
    this.primaryColor = event.target.value;
    this.updateFormColors();
  }

  onSecondaryColorChange(event: any): void {
    this.secondaryColor = event.target.value;
    this.updateFormColors();
  }

  onTertiaryColorChange(event: any): void {
    this.tertiaryColor = event.target.value;
    this.updateFormColors();
  }

  selectColor(color: string): void {
    this.primaryColor = color;
    this.updateFormColors();
  }

  toggleCustomDomain(): void {
    this.useCustomDomain = !this.useCustomDomain;
  }

  private updateFormColors(): void {
    if (this.formGroup) {
      if (this.formGroup.get('primary_color')) {
        this.formGroup.get('primary_color').setValue(this.primaryColor);
      }
      if (this.formGroup.get('secondary_color')) {
        this.formGroup.get('secondary_color').setValue(this.secondaryColor);
      }
      if (this.formGroup.get('accent_color')) {
        this.formGroup.get('accent_color').setValue(this.tertiaryColor);
      }
    }
  }
}

