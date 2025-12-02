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
        padding: 1.5rem 0;
        background: #fafbfc;
        border-radius: 1rem;
        margin: -1rem;
      }

      .app-config-container {
        max-width: 820px;
        margin: 0 auto;
        padding: 0 1.5rem;
      }

      .app-config-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .config-icon-wrapper {
        margin-bottom: 1.5rem;
      }

      .config-icon-bg {
        width: 80px;
        height: 80px;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto;
        box-shadow: 0 8px 24px rgba(139, 92, 246, 0.24);
      }

      .config-icon {
        color: white;
      }

      .config-title {
        font-size: 1.75rem;
        font-weight: 700;
        color: #1f2937;
        margin-bottom: 0.5rem;
      }

      .config-subtitle {
        color: #6b7280;
        font-size: 1rem;
        line-height: 1.6;
      }

      .config-form {
        background: white;
        border-radius: 0.75rem;
        padding: 2rem;
        border: 1px solid #e5e7eb;
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
        border-bottom: 1px solid #f3f4f6;
      }

      .section-icon {
        width: 40px;
        height: 40px;
        background: #f3e8ff;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .section-icon-element {
        color: #8b5cf6;
      }

      .section-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: #1f2937;
        margin: 0;
      }

      /* Color Selector */
      .color-selector {
        space-y: 1.5rem;
      }

      .color-inputs-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
        margin-bottom: 2rem;
      }

      .color-input-group {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .color-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
      }

      .color-preview {
        width: 24px;
        height: 24px;
        border-radius: 0.375rem;
        border: 2px solid #e5e7eb;
      }

      .color-input-wrapper {
        display: flex;
        gap: 0.75rem;
        align-items: center;
      }

      .color-picker {
        width: 48px;
        height: 48px;
        border: 2px solid #e5e7eb;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .color-picker:hover {
        border-color: #8b5cf6;
      }

      .color-text {
        flex: 1;
        padding: 0.75rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        font-family:
          'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
        transition: all 0.2s ease;
      }

      .color-text:focus {
        outline: none;
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .palette-preview {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .palette-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: #1f2937;
        margin-bottom: 1rem;
      }

      .palette-colors {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .palette-color {
        width: 40px;
        height: 40px;
        border-radius: 0.5rem;
        border: 2px solid #e5e7eb;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .palette-color:hover {
        transform: scale(1.05);
        border-color: #8b5cf6;
      }

      /* Domain Configuration */
      .domain-card {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1.5rem;
        border-radius: 0.75rem;
        margin-bottom: 1.5rem;
      }

      .domain-card.auto-domain {
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        border: 1px solid #bbf7d0;
      }

      .domain-icon {
        width: 48px;
        height: 48px;
        background: white;
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(34, 197, 94, 0.2);
      }

      .domain-check-icon {
        color: #22c55e;
      }

      .domain-content h4 {
        font-size: 1rem;
        font-weight: 600;
        color: #166534;
        margin-bottom: 0.25rem;
      }

      .domain-url {
        font-family:
          'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace;
        font-size: 0.875rem;
        font-weight: 600;
        color: #15803d;
        background: white;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        display: inline-block;
        margin-bottom: 0.5rem;
      }

      .domain-description {
        color: #166534;
        font-size: 0.875rem;
        line-height: 1.4;
      }

      .custom-domain-toggle {
        margin-bottom: 1.5rem;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
      }

      .toggle-input {
        display: none;
      }

      .toggle-slider {
        width: 44px;
        height: 24px;
        background: #e5e7eb;
        border-radius: 12px;
        position: relative;
        transition: all 0.2s ease;
      }

      .toggle-slider::before {
        content: '';
        position: absolute;
        width: 18px;
        height: 18px;
        background: white;
        border-radius: 50%;
        top: 3px;
        left: 3px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }

      .toggle-input:checked + .toggle-slider {
        background: #8b5cf6;
      }

      .toggle-input:checked + .toggle-slider::before {
        transform: translateX(20px);
      }

      .custom-domain-section {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 0.75rem;
        padding: 1.5rem;
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .field-label {
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
      }

      .field-input {
        padding: 0.75rem 1rem;
        border: 2px solid #e5e7eb;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        transition: all 0.2s ease;
        background: white;
      }

      .field-input:focus {
        outline: none;
        border-color: #8b5cf6;
        box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
      }

      .field-hint {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .hint-icon {
        color: #9ca3af;
        flex-shrink: 0;
      }

      .hint-text {
        color: #6b7280;
        font-size: 0.75rem;
        line-height: 1.4;
      }

      @media (max-width: 640px) {
        .app-config-container {
          padding: 0 1rem;
        }

        .config-form {
          padding: 1.5rem;
        }

        .config-title {
          font-size: 1.5rem;
        }

        .section-header {
          flex-direction: column;
          text-align: center;
          gap: 0.5rem;
        }

        .color-inputs-grid {
          grid-template-columns: 1fr;
          gap: 1rem;
        }

        .domain-card {
          flex-direction: column;
          text-align: center;
          gap: 0.75rem;
        }

        .form-section {
          margin-bottom: 1.5rem;
        }
      }
    `,
  ],
  template: `
    <div class="step-content app-config-step">
      <div class="app-config-container">
        <!-- Header -->
        <div class="app-config-header">
          <div class="config-icon-wrapper">
            <div class="config-icon-bg">
              <app-icon name="palette" size="48" class="config-icon"></app-icon>
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
                  size="20"
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
                      (input)="onPrimaryColorTextChange($event)"
                      placeholder="#3B82F6"
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
                      (input)="onSecondaryColorTextChange($event)"
                      placeholder="#10B981"
                    />
                  </div>
                </div>
              </div>

              <!-- Color Palette Preview -->
              <div class="palette-preview">
                <h4 class="palette-title">Vista previa de paleta</h4>
                <div class="palette-colors">
                  <div
                    *ngFor="let color of colorPalette"
                    class="palette-color"
                    [style.background-color]="color"
                    [title]="color"
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Domain Configuration -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon
                  name="globe"
                  size="20"
                  class="section-icon-element"
                ></app-icon>
              </div>
              <h3 class="section-title">Configuración de dominio</h3>
            </div>

            <!-- Auto-generated Domain -->
            <div class="domain-card auto-domain">
              <div class="domain-icon">
                <app-icon
                  name="check-circle"
                  size="24"
                  class="domain-check-icon"
                ></app-icon>
              </div>
              <div class="domain-content">
                <h4 class="domain-title">Dominio automático configurado</h4>
                <p class="domain-url">{{ generatedSubdomain }}</p>
                <p class="domain-description">
                  Tu aplicación estará disponible inmediatamente en esta
                  dirección
                </p>
              </div>
            </div>

            <!-- Custom Domain Toggle -->
            <div class="custom-domain-toggle">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  class="toggle-input"
                  [(ngModel)]="useCustomDomain"
                  (change)="onCustomDomainToggle()"
                />
                <span class="toggle-slider"></span>
                <span class="toggle-text">Quiero usar mi propio dominio</span>
              </label>
            </div>

            <!-- Custom Domain Input -->
            <div class="custom-domain-section" *ngIf="useCustomDomain">
              <div class="form-field">
                <label class="field-label">Tu dominio personalizado</label>
                <input
                  type="text"
                  class="field-input"
                  [(ngModel)]="customDomain"
                  placeholder="tienda.micomercio.com"
                />
                <div class="field-hint">
                  <app-icon name="info" size="14" class="hint-icon"></app-icon>
                  <span class="hint-text">
                    Después de completar el wizard, te ayudaremos a configurar
                    DNS y SSL
                  </span>
                </div>
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
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();

  // Color properties
  primaryColor: string = '#3B82F6';
  secondaryColor: string = '#10B981';
  colorPalette: string[] = [];

  // Domain properties
  useCustomDomain: boolean = false;
  customDomain: string = '';
  generatedSubdomain: string = 'mi-tienda.vendix.com';

  constructor() {
    this.generateColorPalette();
  }

  onPrimaryColorChange(event: any): void {
    this.primaryColor = event.target.value;
    this.generateColorPalette();
    this.updateFormColors();
  }

  onPrimaryColorTextChange(event: any): void {
    const value = event.target.value;
    if (this.isValidHexColor(value)) {
      this.primaryColor = value;
      this.generateColorPalette();
      this.updateFormColors();
    }
  }

  onSecondaryColorChange(event: any): void {
    this.secondaryColor = event.target.value;
    this.generateColorPalette();
    this.updateFormColors();
  }

  onSecondaryColorTextChange(event: any): void {
    const value = event.target.value;
    if (this.isValidHexColor(value)) {
      this.secondaryColor = value;
      this.generateColorPalette();
      this.updateFormColors();
    }
  }

  onCustomDomainToggle(): void {
    // Logic for custom domain toggle
  }

  private isValidHexColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }

  private generateColorPalette(): void {
    this.colorPalette = [
      this.primaryColor,
      this.secondaryColor,
      this.lightenColor(this.primaryColor, 20),
      this.darkenColor(this.primaryColor, 20),
      this.lightenColor(this.secondaryColor, 20),
      this.darkenColor(this.secondaryColor, 20),
      this.generateAccentColor(),
      '#FFFFFF',
      '#F9FAFB',
      '#1F2937',
    ];
  }

  private lightenColor(color: string, percent: number): string {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
    return (
      '#' +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
        .toUpperCase()
    );
  }

  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = ((num >> 8) & 0x00ff) - amt;
    const B = (num & 0x0000ff) - amt;
    return (
      '#' +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
        .toUpperCase()
    );
  }

  private generateAccentColor(): string {
    const r1 = parseInt(this.primaryColor.slice(1, 3), 16);
    const g1 = parseInt(this.primaryColor.slice(3, 5), 16);
    const b1 = parseInt(this.primaryColor.slice(5, 7), 16);

    const r2 = parseInt(this.secondaryColor.slice(1, 3), 16);
    const g2 = parseInt(this.secondaryColor.slice(3, 5), 16);
    const b2 = parseInt(this.secondaryColor.slice(5, 7), 16);

    const r = Math.round((r1 + r2) / 2);
    const g = Math.round((g1 + g2) / 2);
    const b = Math.round((b1 + b2) / 2);

    return (
      '#' +
      [r, g, b]
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
        .toUpperCase()
    );
  }

  private updateFormColors(): void {
    if (this.formGroup) {
      if (this.formGroup.get('primary_color')) {
        this.formGroup.get('primary_color').setValue(this.primaryColor);
      }
      if (this.formGroup.get('secondary_color')) {
        this.formGroup.get('secondary_color').setValue(this.secondaryColor);
      }
    }
  }
}
