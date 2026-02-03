import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
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
      /* ═══════════════════════════════════════════════════════════════
         Mobile-First iOS-Style Design for App Config Step
         Base: Mobile (<640px) | Tablet: 640px+ | Desktop: 1024px+
         ═══════════════════════════════════════════════════════════════ */

      .app-config-step {
        padding: 0;
        background: transparent;
      }

      .app-config-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
      }

      /* ─────────────────────────────────────────────────────────────────
         Header - iOS Style
         ───────────────────────────────────────────────────────────────── */
      .app-config-header {
        text-align: center;
        margin-bottom: 1.25rem;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .config-icon-wrapper {
        margin-bottom: 0.75rem;
      }

      .config-icon-bg {
        width: 64px;
        height: 64px;
        background: var(--color-primary-light);
        border-radius: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .config-icon {
        color: var(--color-primary);
      }

      .config-title {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.25rem;
      }

      .config-subtitle {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        line-height: 1.4;
        max-width: 280px;
      }

      /* ─────────────────────────────────────────────────────────────────
         Form Layout - Mobile First (1 column)
         ───────────────────────────────────────────────────────────────── */
      .config-form {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      /* ─────────────────────────────────────────────────────────────────
         Section Cards - iOS Style
         ───────────────────────────────────────────────────────────────── */
      .form-section {
        background: var(--color-surface);
        padding: 1.25rem;
        border-radius: 1.25rem;
        border: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 0.625rem;
        margin-bottom: 1rem;
      }

      .section-icon {
        width: 32px;
        height: 32px;
        background: var(--color-primary-light);
        border-radius: 0.625rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
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

      /* ─────────────────────────────────────────────────────────────────
         Color Selector
         ───────────────────────────────────────────────────────────────── */
      .color-selector {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .color-inputs-grid {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1.25rem;
      }

      .color-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .color-label {
        font-size: 11px;
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .color-input-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .color-preview-box {
        width: 36px;
        height: 36px;
        border-radius: 0.5rem;
        border: 2px solid var(--color-border);
        flex-shrink: 0;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }

      .color-preview-box:hover {
        border-color: var(--color-primary);
        transform: scale(1.02);
      }

      .color-preview-box:active {
        transform: scale(0.98);
      }

      .color-picker-hidden {
        position: absolute;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }

      .color-hex-input {
        flex: 1;
        min-width: 0;
        max-width: 100px;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        font-size: 0.75rem;
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        background: var(--color-background);
        color: var(--color-text-primary);
        transition: all 0.2s ease;
        height: 36px;
        text-transform: uppercase;
      }

      .color-hex-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px var(--color-ring);
        background: var(--color-surface);
      }

      /* ─────────────────────────────────────────────────────────────────
         Palette Preview - iOS Style
         ───────────────────────────────────────────────────────────────── */
      .palette-preview {
        background: var(--color-background);
        border-radius: 0.875rem;
        padding: 1rem;
        margin-top: auto;
      }

      .palette-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 0.875rem;
      }

      .palette-title {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .random-btn {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.2s ease;
        height: 32px;
      }

      .random-btn:hover {
        border-color: var(--color-primary);
        color: var(--color-primary);
        background: var(--color-primary-light);
      }

      .random-btn:active {
        transform: scale(0.96);
      }

      .random-icon {
        color: inherit;
      }

      .palette-colors {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .palette-color {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      }

      .palette-color:hover {
        transform: scale(1.15);
        border-color: var(--color-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      }

      .palette-color:active {
        transform: scale(1.05);
      }

      /* ─────────────────────────────────────────────────────────────────
         Domain Card - iOS Success Style
         ───────────────────────────────────────────────────────────────── */
      .domain-card {
        display: flex;
        align-items: flex-start;
        gap: 0.875rem;
        padding: 1rem;
        border-radius: 0.875rem;
        margin-bottom: 1rem;
      }

      .domain-card.auto-domain {
        background: color-mix(in srgb, var(--color-success) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
      }

      .domain-icon {
        width: 36px;
        height: 36px;
        background: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .domain-check-icon {
        color: var(--color-success);
      }

      .domain-content {
        flex: 1;
        min-width: 0;
      }

      .domain-content h4 {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-success);
        margin: 0 0 0.375rem 0;
      }

      .domain-url {
        font-family: 'SF Mono', 'Monaco', 'Roboto Mono', monospace;
        font-size: var(--fs-sm);
        font-weight: var(--fw-bold);
        color: var(--color-success);
        display: block;
        margin-bottom: 0.375rem;
        word-break: break-all;
      }

      .domain-description {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.4;
        margin: 0;
      }

      /* ─────────────────────────────────────────────────────────────────
         Toggle - iOS Style (44x24)
         ───────────────────────────────────────────────────────────────── */
      .custom-domain-toggle {
        margin-bottom: 1rem;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
        padding: 0.5rem 0;
      }

      .toggle-text {
        flex: 1;
        padding-right: 1rem;
      }

      .toggle-input {
        display: none;
      }

      .toggle-slider {
        width: 44px;
        height: 24px;
        background: var(--color-border);
        border-radius: 12px;
        position: relative;
        transition: background-color 0.3s ease;
        flex-shrink: 0;
      }

      .toggle-slider::before {
        content: '';
        position: absolute;
        width: 20px;
        height: 20px;
        background: white;
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .toggle-input:checked + .toggle-slider {
        background: var(--color-primary);
      }

      .toggle-input:checked + .toggle-slider::before {
        transform: translateX(20px);
      }

      /* ─────────────────────────────────────────────────────────────────
         Custom Domain Section
         ───────────────────────────────────────────────────────────────── */
      .custom-domain-section {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 0.875rem;
        padding: 1rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .field-label {
        font-size: 11px;
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .field-input {
        padding: 0.875rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        font-size: var(--fs-base);
        transition: all 0.2s ease;
        background: var(--color-surface);
        color: var(--color-text-primary);
        height: 48px;
      }

      .field-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-ring);
      }

      .field-hint {
        display: flex;
        align-items: flex-start;
        gap: 0.375rem;
        margin-top: 0.25rem;
      }

      .hint-icon {
        color: var(--color-text-muted);
        flex-shrink: 0;
        margin-top: 1px;
      }

      .hint-text {
        color: var(--color-text-muted);
        font-size: var(--fs-xs);
        line-height: 1.4;
      }

      /* ═══════════════════════════════════════════════════════════════
         Desktop (1024px+) - 2 columns layout
         ═══════════════════════════════════════════════════════════════ */
      @media (min-width: 1024px) {
        .config-form {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1.25rem;
        }

        .config-subtitle {
          max-width: 400px;
        }

        .color-inputs-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
        }

        .palette-color {
          width: 32px;
          height: 32px;
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
                <!-- Primary Color -->
                <div class="color-input-group">
                  <label class="color-label">Color primario</label>
                  <div class="color-input-row">
                    <div
                      class="color-preview-box"
                      [style.background-color]="primaryColor"
                    >
                      <input
                        type="color"
                        class="color-picker-hidden"
                        [value]="primaryColor"
                        (input)="onPrimaryColorChange($event)"
                      />
                    </div>
                    <input
                      type="text"
                      class="color-hex-input"
                      [value]="primaryColor"
                      (input)="onPrimaryColorChange($event)"
                      placeholder="#7ed7a5"
                    />
                  </div>
                </div>

                <!-- Secondary Color -->
                <div class="color-input-group">
                  <label class="color-label">Color secundario</label>
                  <div class="color-input-row">
                    <div
                      class="color-preview-box"
                      [style.background-color]="secondaryColor"
                    >
                      <input
                        type="color"
                        class="color-picker-hidden"
                        [value]="secondaryColor"
                        (input)="onSecondaryColorChange($event)"
                      />
                    </div>
                    <input
                      type="text"
                      class="color-hex-input"
                      [value]="secondaryColor"
                      (input)="onSecondaryColorChange($event)"
                      placeholder="#2f6f4e"
                    />
                  </div>
                </div>

                <!-- Tertiary Color -->
                <div class="color-input-group">
                  <label class="color-label">Color terciario</label>
                  <div class="color-input-row">
                    <div
                      class="color-preview-box"
                      [style.background-color]="tertiaryColor"
                    >
                      <input
                        type="color"
                        class="color-picker-hidden"
                        [value]="tertiaryColor"
                        (input)="onTertiaryColorChange($event)"
                      />
                    </div>
                    <input
                      type="text"
                      class="color-hex-input"
                      [value]="tertiaryColor"
                      (input)="onTertiaryColorChange($event)"
                      placeholder="#f59e0b"
                    />
                  </div>
                </div>
              </div>

              <!-- Color Palette Generator -->
              <div class="palette-preview">
                <div class="palette-header">
                  <h4 class="palette-title">Autogenerador de Paletas</h4>
                  <button type="button" class="random-btn" (click)="generateRandomPalette()">
                    <app-icon name="refresh" size="14" class="random-icon"></app-icon>
                    <span>Aleatorio</span>
                  </button>
                </div>
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

            <!-- Custom Domain Toggle - iOS Style -->
            <div class="custom-domain-toggle">
              <label class="toggle-label">
                <span class="toggle-text">Usar dominio personalizado</span>
                <input
                  type="checkbox"
                  class="toggle-input"
                  [checked]="useCustomDomain"
                  (change)="toggleCustomDomain()"
                />
                <span class="toggle-slider"></span>
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
export class AppConfigStepComponent implements OnInit {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  // Color properties
  primaryColor: string = '#7ed7a5';
  secondaryColor: string = '#2f6f4e';
  tertiaryColor: string = '#f59e0b';

  ngOnInit(): void {
    if (this.formGroup) {
      if (this.formGroup.get('primary_color')?.value) {
        this.primaryColor = this.formGroup.get('primary_color').value;
      }
      if (this.formGroup.get('secondary_color')?.value) {
        this.secondaryColor = this.formGroup.get('secondary_color').value;
      }
      if (this.formGroup.get('accent_color')?.value) {
        this.tertiaryColor = this.formGroup.get('accent_color').value;
      }
    }
  }
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
    // Generate harmonious secondary and tertiary based on primary
    this.secondaryColor = this.adjustBrightness(color, -20);
    this.tertiaryColor = this.adjustBrightness(color, 20);
    this.updateFormColors();
  }

  generateRandomPalette(): void {
    const randomHex = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    this.primaryColor = randomHex();
    this.secondaryColor = randomHex();
    this.tertiaryColor = randomHex();
    this.updateFormColors();
  }

  private adjustBrightness(hex: string, percent: number): string {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.min(255, Math.max(0, Math.round(r * (1 + percent / 100))));
    g = Math.min(255, Math.max(0, Math.round(g * (1 + percent / 100))));
    b = Math.min(255, Math.max(0, Math.round(b * (1 + percent / 100))));

    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
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

