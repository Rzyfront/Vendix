import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent, IconComponent } from '../../index';

@Component({
  selector: 'app-store-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .store-step {
      padding: 1.5rem 0;
      background: #FAFBFC;
      border-radius: 1rem;
      margin: -1rem;
    }

    .store-container {
      max-width: 780px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .store-header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .store-icon-wrapper {
      margin-bottom: 1.5rem;
    }

    .store-icon-bg {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.24);
    }

    .store-icon {
      color: white;
    }

    .store-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 0.5rem;
    }

    .store-subtitle {
      color: #6B7280;
      font-size: 1rem;
      line-height: 1.6;
    }

    .store-form {
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
      background: #FEF3C7;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .section-icon-element {
      color: #F59E0B;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #1F2937;
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
    }

    .form-field {
      display: flex;
      flex-direction: column;
    }

    .form-field.full-width {
      grid-column: 1 / -1;
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
      border-color: #F59E0B;
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
    }

    .field-input::placeholder {
      color: #9CA3AF;
    }

    .store-type-selector {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .store-type-option {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      border: 2px solid #E5E7EB;
      border-radius: 0.75rem;
      cursor: pointer;
      transition: all 0.2s ease;
      background: white;
      position: relative;
    }

    .store-type-option:hover {
      border-color: #F59E0B;
      background: #FFFBEB;
    }

    .store-type-option.active {
      border-color: #F59E0B;
      background: #FFFBEB;
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
    }

    .store-type-icon {
      width: 56px;
      height: 56px;
      background: #FEF3C7;
      border-radius: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .type-icon-element {
      color: #F59E0B;
    }

    .store-type-content {
      flex: 1;
    }

    .store-type-title {
      font-size: 1rem;
      font-weight: 600;
      color: #1F2937;
      margin-bottom: 0.25rem;
    }

    .store-type-description {
      font-size: 0.875rem;
      color: #6B7280;
      line-height: 1.4;
    }

    .store-type-check {
      position: absolute;
      top: 1rem;
      right: 1rem;
    }

    .check-icon {
      color: #F59E0B;
    }

    @media (max-width: 640px) {
      .store-container {
        padding: 0 1rem;
      }

      .form-grid {
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .store-form {
        padding: 1.5rem;
      }

      .store-title {
        font-size: 1.5rem;
      }

      .section-header {
        flex-direction: column;
        text-align: center;
        gap: 0.5rem;
      }

      .store-type-option {
        flex-direction: column;
        text-align: center;
        gap: 0.75rem;
      }

      .store-type-check {
        position: static;
        margin-top: 0.5rem;
      }

      .form-section {
        margin-bottom: 1.5rem;
      }
    }
  `],
  template: `
    <div class="step-content store-step">
      <div class="store-container">
        <!-- Header -->
        <div class="store-header">
          <div class="store-icon-wrapper">
            <div class="store-icon-bg">
              <app-icon name="store" size="48" class="store-icon"></app-icon>
            </div>
          </div>
          <div class="store-header-content">
            <h2 class="store-title">Configura tu tienda</h2>
            <p class="store-subtitle">
              Prepara tu punto de venta para empezar a vender
            </p>
          </div>
        </div>

        <!-- Store Form -->
        <div class="store-form">
          <!-- Basic Information Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="shopping-bag" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Información básica</h3>
            </div>

            <div class="form-grid">
              <div class="form-field">
                <label class="field-label">
                  Nombre de la tienda
                  <span class="field-required">*</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('name')"
                  placeholder="Tienda Principal"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Zona horaria
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" [formControl]="formGroup.get('timezone')">
                  <option value="America/Mexico_City">Ciudad de México</option>
                  <option value="America/Tijuana">Tijuana</option>
                  <option value="America/Monterrey">Monterrey</option>
                  <option value="America/Guadalajara">Guadalajara</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Store Type Selection Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="layout" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Tipo de tienda</h3>
            </div>

            <div class="store-type-selector">
              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'physical'"
                (click)="formGroup.get('store_type')?.setValue('physical')"
              >
                <div class="store-type-icon">
                  <app-icon name="building" size="32" class="type-icon-element"></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Física</h4>
                  <p class="store-type-description">
                    Ventas en persona con caja física
                  </p>
                </div>
                <div class="store-type-check" *ngIf="formGroup.get('store_type')?.value === 'physical'">
                  <app-icon name="check-circle" size="20" class="check-icon"></app-icon>
                </div>
              </div>

              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'online'"
                (click)="formGroup.get('store_type')?.setValue('online')"
              >
                <div class="store-type-icon">
                  <app-icon name="globe" size="32" class="type-icon-element"></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Online</h4>
                  <p class="store-type-description">
                    Ventas por internet y delivery
                  </p>
                </div>
                <div class="store-type-check" *ngIf="formGroup.get('store_type')?.value === 'online'">
                  <app-icon name="check-circle" size="20" class="check-icon"></app-icon>
                </div>
              </div>

              <div
                class="store-type-option"
                [class.active]="formGroup.get('store_type')?.value === 'hybrid'"
                (click)="formGroup.get('store_type')?.setValue('hybrid')"
              >
                <div class="store-type-icon">
                  <app-icon name="refresh-cw" size="32" class="type-icon-element"></app-icon>
                </div>
                <div class="store-type-content">
                  <h4 class="store-type-title">Tienda Híbrida</h4>
                  <p class="store-type-description">
                    Ventas en persona y online
                  </p>
                </div>
                <div class="store-type-check" *ngIf="formGroup.get('store_type')?.value === 'hybrid'">
                  <app-icon name="check-circle" size="20" class="check-icon"></app-icon>
                </div>
              </div>
            </div>
          </div>

          <!-- Location Section -->
          <div class="form-section">
            <div class="section-header">
              <div class="section-icon">
                <app-icon name="map-pin" size="20" class="section-icon-element"></app-icon>
              </div>
              <h3 class="section-title">Ubicación</h3>
            </div>

            <div class="form-grid">
              <div class="form-field full-width">
                <label class="field-label">
                  Calle y número
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('address_line1')"
                  placeholder="Calle Principal #123"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Ciudad
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('city')"
                  placeholder="Ciudad de México"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Estado
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('state_province')"
                  placeholder="CDMX"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  Código postal
                  <span class="field-optional">(opcional)</span>
                </label>
                <input
                  type="text"
                  class="field-input"
                  [formControl]="formGroup.get('postal_code')"
                  placeholder="06000"
                />
              </div>

              <div class="form-field">
                <label class="field-label">
                  País
                  <span class="field-optional">(opcional)</span>
                </label>
                <select class="field-input" [formControl]="formGroup.get('country_code')">
                  <option value="MX">México</option>
                  <option value="US">Estados Unidos</option>
                  <option value="ES">España</option>
                  <option value="CO">Colombia</option>
                </select>
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