import { Component, input, output, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ProductFormWizardService } from '../../../services/product-form-wizard.service';
import { InputComponent, TextareaComponent, SelectorComponent, MultiSelectorComponent, IconComponent } from '../../../../../../../shared/components';
import type { SelectorOption, MultiSelectorOption } from '../../../../../../../shared/components';
import { ProductCategory, Brand, TaxCategory } from '../../../interfaces';
import { CategoriesService } from '../../../services/categories.service';
import { BrandsService } from '../../../services/brands.service';
import { TaxesService } from '../../../services/taxes.service';

@Component({
  selector: 'app-step-1-info',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
    MultiSelectorComponent,
    IconComponent,
  ],
  template: `
    <div class="step-container">
      <div class="step-header">
        <h2 class="step-title">Información del Producto</h2>
        <p class="step-description">
          Define el nombre, descripción y categoría de tu producto.
        </p>
      </div>

      <form [formGroup]="form()" class="step-form">
        <!-- Nombre -->
        <div class="form-field">
          <app-input
            [formControl]="nameControl"
            type="text"
            label="Nombre del producto"
            placeholder="Ej: Camisa de algodón básica"
            [error]="getError('name')"
            [required]="true"
          />
        </div>

        <!-- Slug -->
        <div class="form-field">
          <app-input
            [formControl]="slugControl"
            type="text"
            label="Slug (URL)"
            placeholder="camisa Algodón-básica"
            helperText="/products/"
            [error]="getError('slug')"
          />
          <p class="field-hint">Se genera automáticamente si está vacío.</p>
        </div>

        <!-- Descripción -->
        <div class="form-field">
          <app-textarea
            [formControl]="descriptionControl"
            label="Descripción"
            placeholder="Describe tu producto..."
            [rows]="4"
          />
        </div>

        <!-- Categorías -->
        <div class="form-field">
          <app-multi-selector
            [formControl]="categoryIdsControl"
            [options]="categoryOptions()"
            label="Categorías"
            placeholder="Seleccionar categorías"
          />
        </div>

        <!-- Marcas -->
        <div class="form-field">
          <app-selector
            [formControl]="brandIdsControl"
            [options]="brandOptions()"
            label="Marca"
            placeholder="Seleccionar marca (opcional)"
          />
        </div>

        <!-- Tipo de producto -->
        <div class="form-field">
          <label class="field-label">Tipo de producto</label>
          <div class="radio-group">
            <label class="radio-option">
              <input
                type="radio"
                formControlName="product_type"
                value="physical"
              />
              <span class="radio-label">
                <app-icon name="box" [size]="16" />
                Producto Físico
              </span>
            </label>
            <label class="radio-option">
              <input
                type="radio"
                formControlName="product_type"
                value="service"
              />
              <span class="radio-label">
                <app-icon name="briefcase" [size]="16" />
                Servicio
              </span>
            </label>
          </div>
        </div>

        <!-- Estado -->
        <div class="form-field">
          <label class="field-label">Estado</label>
          <div class="radio-group horizontal">
            @for (option of stateOptions; track option.value) {
              <label class="radio-option">
                <input
                  type="radio"
                  formControlName="state"
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
      display: flex;
      align-items: center;
      gap: 0.375rem;
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
export class Step1InfoComponent implements OnInit, OnDestroy {
  private wizardService = inject(ProductFormWizardService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private taxesService = inject(TaxesService);

  readonly form = input.required<FormGroup>();
  readonly categories = input<ProductCategory[]>([]);
  readonly brands = input<Brand[]>([]);
  readonly taxCategories = input<TaxCategory[]>([]);

  readonly validityChange = output<{ isValid: boolean; completionPercent: number; errors: string[] }>();

  readonly categoryOptions = computed<MultiSelectorOption[]>(() =>
    this.categories().map((c) => ({
      value: c.id,
      label: c.name,
      description: c.description,
    }))
  );

  readonly brandOptions = computed<SelectorOption[]>(() =>
    this.brands().map((b) => ({
      value: b.id,
      label: b.name,
      description: b.description,
    }))
  );

  readonly stateOptions = [
    { value: 'active', label: 'Activo' },
    { value: 'inactive', label: 'Inactivo' },
    { value: 'archived', label: 'Archivado' },
  ];

  ngOnInit(): void {
    this.form().statusChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateValidity());

    this.form().valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateValidity());

    // Initial validation
    this.updateValidity();
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  get nameControl() {
    return this.form().get('name') as any;
  }

  get slugControl() {
    return this.form().get('slug') as any;
  }

  get descriptionControl() {
    return this.form().get('description') as any;
  }

  get categoryIdsControl() {
    return this.form().get('category_ids') as any;
  }

  get brandIdsControl() {
    return this.form().get('brand_ids') as any;
  }

  getError(fieldName: string): string {
    const field = this.form().get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Campo obligatorio';
    if (field.errors['minlength']) return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
    if (field.errors['maxlength']) return `Máximo ${field.errors['maxlength'].requiredLength} caracteres`;
    if (field.errors['invalidSlug']) return 'Slug inválido (solo letras minúsculas, números y guiones)';
    return 'Valor inválido';
  }

  private updateValidity(): void {
    const form = this.form();
    const nameControl = form.get('name');
    
    const isValid = form.valid && !!nameControl?.value?.trim();
    const errors: string[] = [];

    if (nameControl?.errors) {
      if (nameControl.errors['required']) errors.push('Nombre es requerido');
      if (nameControl.errors['minlength']) errors.push('Nombre muy corto');
    }

    // Calculate completion based on filled fields
    let completionPercent = 0;
    const totalFields = 5; // name, slug, description, categories, brand
    let filledFields = 0;

    if (nameControl?.value?.trim()) filledFields++;
    if (form.get('slug')?.value?.trim()) filledFields++;
    if (form.get('description')?.value?.trim()) filledFields++;
    if ((form.get('category_ids')?.value as any[])?.length > 0) filledFields++;
    if ((form.get('brand_ids')?.value as any[])?.length > 0) filledFields++;

    completionPercent = Math.round((filledFields / totalFields) * 100);

    this.validityChange.emit({ isValid, completionPercent, errors });
  }
}
