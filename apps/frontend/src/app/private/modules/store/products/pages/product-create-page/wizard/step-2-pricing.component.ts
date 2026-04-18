import { Component, input, output, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InputComponent, SelectorComponent, MultiSelectorComponent, SettingToggleComponent, BadgeComponent, IconComponent } from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { TaxCategory } from '../../interfaces';

@Component({
  selector: 'app-step-2-pricing',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    SelectorComponent,
    MultiSelectorComponent,
    SettingToggleComponent,
    BadgeComponent,
    IconComponent,
  ],
  template: `
    <div class="step-container">
      <div class="step-header">
        <h2 class="step-title">Precios</h2>
        <p class="step-description">
          Configura el precio base, costos y márgenes de ganancia.
        </p>
      </div>

      <form [formGroup]="form" class="step-form">
        <!-- Precio Base -->
        <div class="form-field">
          <app-input
            [formControl]="basePriceControl"
            type="currency"
            label="Precio base"
            placeholder="0.00"
            [prefix]="currencySymbol()"
            [error]="getError('base_price')"
            required
          />
        </div>

        <!-- Costo y Margen ( lado a lado en desktop) -->
        <div class="form-row">
          <div class="form-field">
            <app-input
              [formControl]="costPriceControl"
              type="currency"
              label="Costo"
              placeholder="0.00"
              [prefix]="currencySymbol()"
              [error]="getError('cost_price')"
            />
          </div>
          <div class="form-field">
            <app-input
              [formControl]="profitMarginControl"
              type="number"
              label="Margen (%)"
              placeholder="0"
              suffix="%"
              [error]="getError('profit_margin')"
            />
          </div>
        </div>

        <!-- Precio con impuestos -->
        @if (priceWithTax() > 0) {
          <div class="price-summary">
            <div class="price-row">
              <span class="price-label">Precio base</span>
              <span class="price-value">{{ basePriceControl.value | currency:currencyCode() }}</span>
            </div>
            <div class="price-row">
              <span class="price-label">Impuestos</span>
              <span class="price-value">+ {{ taxAmount() | currency:currencyCode() }}</span>
            </div>
            <div class="price-row total">
              <span class="price-label">Precio con impuestos</span>
              <span class="price-value">{{ priceWithTax() | currency:currencyCode() }}</span>
            </div>
          </div>
        }

        <!-- Impuestos -->
        <div class="form-field">
          <app-multi-selector
            [formControl]="taxCategoryIdsControl"
            [options]="taxCategoryOptions()"
            label="Impuestos"
            placeholder="Seleccionar impuestos"
          />
        </div>

        <!-- Oferta -->
        <div class="sale-section">
          <div class="sale-toggle">
            <app-setting-toggle
              [formControl]="isOnSaleControl"
              label="Producto en oferta"
              description="Activa para configurar un precio de venta especial"
            />
          </div>

          @if (isOnSaleControl.value) {
            <div class="sale-fields animate-slide">
              <app-input
                [formControl]="salePriceControl"
                type="currency"
                label="Precio de venta"
                placeholder="0.00"
                [prefix]="currencySymbol()"
                [error]="getSalePriceError()"
              />
              <p class="sale-hint">
                El precio de venta debe ser menor al precio base.
              </p>
            </div>
          }
        </div>

        <!-- Disponibilidad ecommerce -->
        <div class="form-field">
          <app-setting-toggle
            [formControl]="availableForEcommerceControl"
            label="Disponible en ecommerce"
            description="Permitir que este producto se muestre en la tienda online"
          />
        </div>

        <!-- Tipo de precio -->
        <div class="form-field">
          <label class="field-label">Tipo de precio</label>
          <div class="radio-group horizontal">
            @for (option of pricingTypeOptions; track option.value) {
              <label class="radio-option">
                <input
                  type="radio"
                  formControlName="pricing_type"
                  [value]="option.value"
                />
                <span class="radio-label">{{ option.label }}</span>
              </label>
            }
          </div>
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

    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    .field-label {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
      margin-bottom: 0.5rem;
    }

    .price-summary {
      background: var(--color-background);
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid var(--color-border);
    }

    .price-row {
      display: flex;
      justify-content: space-between;
      padding: 0.375rem 0;
    }

    .price-row.total {
      border-top: 1px solid var(--color-border);
      margin-top: 0.5rem;
      padding-top: 0.75rem;
      font-weight: 600;
    }

    .price-label {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
    }

    .price-value {
      font-size: 0.875rem;
      color: var(--color-text-primary);
    }

    .price-row.total .price-label,
    .price-row.total .price-value {
      font-size: 1rem;
      color: var(--color-primary);
    }

    .sale-section {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 1rem;
      background: var(--color-surface);
    }

    .sale-fields {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--color-border);
    }

    .sale-hint {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      margin: 0.25rem 0 0 0;
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

    .radio-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .radio-group.horizontal {
      flex-direction: row;
      gap: 1rem;
    }

    .radio-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
    }

    .radio-option input {
      width: 18px;
      height: 18px;
      accent-color: var(--color-primary);
    }

    .radio-label {
      font-size: 0.875rem;
      color: var(--color-text-primary);
    }

    @media (min-width: 768px) {
      .step-container {
        padding: 1.5rem;
      }
    }
  `]
})
export class Step2PricingComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);

  readonly form = input.required<FormGroup>();
  readonly taxCategories = input<TaxCategory[]>([]);

  readonly validityChange = output<{ isValid: boolean; completionPercent: number; errors: string[] }>();

  readonly currencySymbol = computed(() => this.currencyService.getCurrency().symbol || '$');
  readonly currencyCode = computed(() => this.currencyService.getCurrency().code || 'USD');

  readonly taxCategoryOptions = computed<MultiSelectorOption[]>(() =>
    this.taxCategories().map((tc) => {
      const rate = tc.rate ?? tc.tax_rates?.[0]?.rate ?? 0;
      return {
        value: tc.id,
        label: `${tc.name} (${(Number(rate) * 100).toFixed(0)}%)`,
        description: tc.description,
      };
    })
  );

  readonly pricingTypeOptions = [
    { value: 'unit', label: 'Por unidad' },
    { value: 'weight', label: 'Por peso (kg)' },
  ];

  readonly priceWithTax = computed(() => {
    const basePrice = Number(this.basePriceControl.value || 0);
    const taxRate = this.effectiveTaxRate();
    return basePrice * (1 + taxRate);
  });

  readonly taxAmount = computed(() => {
    const basePrice = Number(this.basePriceControl.value || 0);
    const taxRate = this.effectiveTaxRate();
    return basePrice * taxRate;
  });

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

  get basePriceControl() {
    return this.form().get('base_price') as any;
  }

  get costPriceControl() {
    return this.form().get('cost_price') as any;
  }

  get profitMarginControl() {
    return this.form().get('profit_margin') as any;
  }

  get taxCategoryIdsControl() {
    return this.form().get('tax_category_ids') as any;
  }

  get isOnSaleControl() {
    return this.form().get('is_on_sale') as any;
  }

  get salePriceControl() {
    return this.form().get('sale_price') as any;
  }

  get availableForEcommerceControl() {
    return this.form().get('available_for_ecommerce') as any;
  }

  getError(fieldName: string): string {
    const field = this.form().get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Campo obligatorio';
    if (field.errors['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    return 'Valor inválido';
  }

  getSalePriceError(): string {
    const field = this.salePriceControl;
    const basePrice = Number(this.basePriceControl.value || 0);
    const salePrice = Number(field?.value || 0);

    if (!field || !field.touched) return '';
    if (field.errors?.['required']) return 'Precio de venta requerido';
    if (field.errors?.['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    if (salePrice >= basePrice && salePrice > 0) {
      return 'Debe ser menor al precio base';
    }
    return '';
  }

  private effectiveTaxRate(): number {
    const selectedIds = (this.taxCategoryIdsControl.value as number[]) || [];
    let totalRate = 0;
    for (const tc of this.taxCategories()) {
      if (selectedIds.includes(tc.id)) {
        const rate = tc.rate ?? tc.tax_rates?.[0]?.rate ?? 0;
        totalRate += Number(rate);
      }
    }
    return totalRate;
  }

  private updateValidity(): void {
    const form = this.form();
    const basePrice = Number(this.basePriceControl.value || 0);
    
    const errors: string[] = [];

    if (!basePrice || basePrice <= 0) {
      errors.push('Precio base es requerido');
    }

    if (this.isOnSaleControl.value) {
      const salePrice = Number(this.salePriceControl.value || 0);
      if (salePrice >= basePrice && salePrice > 0) {
        errors.push('Precio de venta debe ser menor al base');
      }
    }

    const isValid = errors.length === 0;

    // Calculate completion
    let completionPercent = 0;
    let filledFields = 0;
    const totalFields = 4; // base_price, cost, margin, tax

    if (basePrice > 0) filledFields++;
    if (this.costPriceControl.value) filledFields++;
    if (this.profitMarginControl.value) filledFields++;
    if ((this.taxCategoryIdsControl.value as number[])?.length > 0) filledFields++;

    completionPercent = Math.round((filledFields / totalFields) * 100);

    this.validityChange.emit({ isValid, completionPercent, errors });
  }
}
