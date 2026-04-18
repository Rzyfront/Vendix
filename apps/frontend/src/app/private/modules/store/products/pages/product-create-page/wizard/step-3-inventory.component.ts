import { Component, input, output, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InputComponent, SettingToggleComponent, IconComponent, ButtonComponent, QuantityControlComponent } from '../../../../../../shared/components';

@Component({
  selector: 'app-step-3-inventory',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SettingToggleComponent,
    IconComponent,
    ButtonComponent,
    QuantityControlComponent,
  ],
  template: `
    <div class="step-container">
      <div class="step-header">
        <h2 class="step-title">Inventario</h2>
        <p class="step-description">
          Configura el seguimiento de inventario y stock inicial.
        </p>
      </div>

      <form [formGroup]="form" class="step-form">
        <!-- Seguimiento de inventario -->
        <div class="form-field">
          <app-setting-toggle
            [formControl]="trackInventoryControl"
            label="Seguir inventario"
            description="Mantener registro del stock disponible para este producto"
          />
        </div>

        @if (trackInventoryControl.value) {
          <div class="inventory-fields animate-slide">
            <!-- Stock inicial -->
            <div class="form-field">
              <app-input
                [formControl]="stockQuantityControl"
                type="number"
                label="Stock inicial"
                placeholder="0"
                [min]="0"
                [error]="getError('stock_quantity')"
              />
            </div>

            <!-- Almacén/ubicación -->
            @if (showLocationInfo) {
              <div class="location-info">
                <app-icon name="map-pin" [size]="16" />
                <span>El stock se распределит automáticamente entre las ubicaciones activas.</span>
              </div>
            }
          </div>
        }

        <!-- Producto sin inventario -->
        <div class="info-card">
          <app-icon name="info" [size]="20" />
          <div class="info-content">
            <h4>¿Producto sin seguimiento?</h4>
            <p>
              Los productos sin seguimiento de inventario no tienen límite de stock.
              Útil para productos digitales o servicios.
            </p>
          </div>
        </div>

        <!-- Peso y dimensiones (solo para productos físicos) -->
        @if (isPhysicalProduct()) {
          <div class="dimensions-section">
            <h3 class="section-title">Peso y Dimensiones</h3>
            
            <div class="form-field">
              <app-input
                [formControl]="weightControl"
                type="number"
                label="Peso (kg)"
                placeholder="0.00"
                [min]="0"
                [step]="0.01"
              />
            </div>

            <div class="form-row three-cols">
              <div class="form-field">
                <app-input
                  [formControl]="lengthControl"
                  type="number"
                  label="Largo (cm)"
                  placeholder="0"
                  [min]="0"
                />
              </div>
              <div class="form-field">
                <app-input
                  [formControl]="widthControl"
                  type="number"
                  label="Ancho (cm)"
                  placeholder="0"
                  [min]="0"
                />
              </div>
              <div class="form-field">
                <app-input
                  [formControl]="heightControl"
                  type="number"
                  label="Alto (cm)"
                  placeholder="0"
                  [min]="0"
                />
              </div>
            </div>
          </div>
        }

        <!-- SKU -->
        <div class="form-field">
          <app-input
            [formControl]="skuControl"
            type="text"
            label="SKU"
            placeholder="PROD-001"
            [error]="getError('sku')"
          />
          <p class="field-hint">
            Código único de producto. Recomendado para gestión de inventario.
          </p>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .step-container {
      padding: 1rem;
    }

    .step-header {
      margin-bottom: 1.5rem;
    }

    .step-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 0.5rem 0;
    }

    .step-description {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
    }

    .step-form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .form-field {
      display: flex;
      flex-direction: column;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .form-row.three-cols {
      grid-template-columns: 1fr 1fr 1fr;
    }

    @media (max-width: 640px) {
      .form-row, .form-row.three-cols {
        grid-template-columns: 1fr;
      }
    }

    .field-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 0.5rem;
    }

    .field-hint {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      margin: 0.25rem 0 0 0;
    }

    .inventory-fields {
      padding: 1rem;
      background: var(--color-background);
      border-radius: 8px;
      border: 1px solid var(--color-border);
    }

    .animate-slide {
      animation: slideDown 0.2s ease-out;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .location-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding: 0.75rem;
      background: var(--color-surface);
      border-radius: 6px;
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }

    .info-card {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface));
      border: 1px solid color-mix(in srgb, var(--color-primary) 20%, var(--color-border));
      border-radius: 8px;
    }

    .info-card app-icon {
      color: var(--color-primary);
      flex-shrink: 0;
    }

    .info-content h4 {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 0.25rem 0;
    }

    .info-content p {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
      line-height: 1.4;
    }

    .dimensions-section {
      padding-top: 0.5rem;
      border-top: 1px solid var(--color-border);
    }

    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 1rem 0;
    }

    @media (min-width: 768px) {
      .step-container {
        padding: 1.5rem;
      }
    }
  `]
})
export class Step3InventoryComponent implements OnInit, OnDestroy {
  readonly form = input.required<FormGroup>();
  readonly showLocationInfo = input<boolean>(false);

  readonly validityChange = output<{ isValid: boolean; completionPercent: number; errors: string[] }>();

  ngOnInit(): void {
    this.form().statusChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateValidity());

    this.form().valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateValidity());

    this.updateValidity();
  }

  ngOnDestroy(): void {}

  get trackInventoryControl() {
    return this.form().get('track_inventory') as any;
  }

  get stockQuantityControl() {
    return this.form().get('stock_quantity') as any;
  }

  get skuControl() {
    return this.form().get('sku') as any;
  }

  get weightControl() {
    return this.form().get('weight') as any;
  }

  get lengthControl() {
    return this.form().get('dimensions.length') as any;
  }

  get widthControl() {
    return this.form().get('dimensions.width') as any;
  }

  get heightControl() {
    return this.form().get('dimensions.height') as any;
  }

  isPhysicalProduct(): boolean {
    return this.form().get('product_type')?.value !== 'service';
  }

  getError(fieldName: string): string {
    const field = this.form().get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Campo obligatorio';
    if (field.errors['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    return 'Valor inválido';
  }

  private updateValidity(): void {
    const form = this.form();
    const errors: string[] = [];
    
    // Stock quantity validation if tracking inventory
    if (this.trackInventoryControl.value) {
      const stock = Number(this.stockQuantityControl.value || 0);
      if (stock < 0) {
        errors.push('Stock no puede ser negativo');
      }
    }

    // SKU validation
    const sku = this.skuControl.value?.trim();
    if (sku && !/^[A-Z0-9-_]+$/.test(sku)) {
      errors.push('SKU debe contener solo letras, números, guiones y guiones bajos');
    }

    const isValid = errors.length === 0;

    // Calculate completion
    let completionPercent = 0;
    let filledFields = 0;
    const totalFields = 3; // track_inventory, stock_quantity, sku

    if (this.trackInventoryControl.value !== undefined) filledFields++;
    if (this.trackInventoryControl.value && this.stockQuantityControl.value !== undefined) filledFields++;
    if (sku) filledFields++;

    completionPercent = Math.round((filledFields / totalFields) * 100);

    this.validityChange.emit({ isValid, completionPercent, errors });
  }
}
