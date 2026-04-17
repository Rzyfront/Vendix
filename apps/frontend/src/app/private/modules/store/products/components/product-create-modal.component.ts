import {Component, input, output, model, signal, effect, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  ToastService,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  MultiSelectorComponent,
  MultiSelectorOption,
  DialogService,
  SettingToggleComponent,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  Product,
  ProductState,
  ProductCategory,
  Brand,
  TaxCategory,
} from '../interfaces';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { BrandsService } from '../services/brands.service';
import { TaxesService } from '../services/taxes.service';
import { CategoryQuickCreateComponent } from './category-quick-create.component';
import { BrandQuickCreateComponent } from './brand-quick-create.component';
import { TaxQuickCreateComponent } from './tax-quick-create.component';

@Component({
  selector: 'app-product-create-modal',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    SettingToggleComponent,
    CategoryQuickCreateComponent,
    BrandQuickCreateComponent,
    MultiSelectorComponent,
    TaxQuickCreateComponent,
  ],
  templateUrl: './product-create-modal/product-create-modal.component.html',
  styleUrls: ['./product-create-modal/product-create-modal.component.scss'],
})
export class ProductCreateModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private taxesService = inject(TaxesService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = model<boolean>(false);
  readonly isSubmitting = input<boolean>(false);
  readonly product = input<Product | null>(null);
  readonly submit = output<any>();
  readonly cancel = output<void>();

  get isEditMode(): boolean {
    return !!this.product();
  }

  productForm: FormGroup;
  categoryOptions: SelectorOption[] = [];
  brandOptions: SelectorOption[] = [];
  taxCategoryOptions: MultiSelectorOption[] = [];

  // Quick create modals state
  isCategoryCreateOpen = signal(false);
  isBrandCreateOpen = signal(false);
  isTaxCategoryCreateOpen = signal(false);

  private allTaxCategories: TaxCategory[] = [];

  constructor() {
    this.productForm = this.createForm();

    // React to product input changes
    effect(() => {
      const prod = this.product();
      if (prod) {
        this.populateForm();
      } else {
        this.resetForm();
      }
    });

    // React to isOpen changes
    effect(() => {
      if (this.isOpen()) {
        this.currencyService.loadCurrency();
        this.loadCategoriesAndBrands();
        if (!this.product()) {
          this.resetForm();
        }
      }
    });
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(1),
          Validators.maxLength(255),
        ],
      ],
      description: [''],
      base_price: [null, [Validators.required, Validators.min(0)]],
      stock_quantity: [0, [Validators.required, Validators.min(0)]],
      track_inventory: [true],
      sku: [''],
      category_id: [null],
      brand_id: [null],
      tax_category_ids: [[] as number[]],
      state: [ProductState.ACTIVE],
    });
  }

  resetForm() {
    this.productForm.reset({
      base_price: 0,
      stock_quantity: 0,
      track_inventory: true,
      tax_category_ids: [],
      state: ProductState.ACTIVE,
    });
  }

  goToAdvancedCreation(): void {
    const val = this.productForm.value;
    const draftData = {
      name: val.name || '',
      description: val.description || '',
      base_price: val.base_price || 0,
      stock_quantity: val.stock_quantity || 0,
      track_inventory: val.track_inventory ?? true,
      sku: val.sku || '',
      category_ids: val.category_id ? [Number(val.category_id)] : [],
      brand_id: val.brand_id || null,
      tax_category_ids: val.tax_category_ids || [],
      state: val.state || 'active',
    };

    this.router.navigate(['/admin/products/create'], {
      state: { draft: draftData },
    });
    this.onCancel();
  }

  get priceWithTax(): number {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const selectedIds: number[] =
      this.productForm.get('tax_category_ids')?.value || [];
    if (!basePrice || selectedIds.length === 0) return basePrice;

    const totalRate = this.allTaxCategories
      .filter((tc) => selectedIds.includes(tc.id))
      .reduce((sum, tc) => {
        const rawRate = tc.rate ?? tc.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        return sum + (isNaN(rate) ? 0 : rate);
      }, 0);

    return basePrice * (1 + totalRate);
  }

  private loadCategoriesAndBrands(): void {
    this.loadCategories();
    this.loadBrands();
    this.loadTaxCategories();
  }

  // Populate form when product data is available (edit mode)
  private populateForm(): void {
    const prod = this.product();
    if (!prod) return;

    this.productForm.patchValue({
      name: prod.name,
      base_price: prod.base_price,
      stock_quantity: prod.stock_quantity || 0,
      track_inventory: prod.track_inventory !== false,
      // Try to get category from new structure or legacy if exists
      category_id:
        (prod as any).category_ids?.[0] ||
        prod.categories?.[0]?.id ||
        null,
      brand_id: prod.brand_id || null,
      tax_category_ids:
        (prod.product_tax_assignments || []).map(
          (ta: any) => ta.tax_category_id,
        ),
      state: prod.state || ProductState.ACTIVE,
    });
  }

  private loadCategories(): void {
    this.categoriesService.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (categories: ProductCategory[]) => {
        this.categoryOptions = categories.map((cat: ProductCategory) => ({
          value: cat.id,
          label: cat.name,
          description: cat.description,
        }));
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar categorías');
        this.categoryOptions = [];
      },
    });
  }

  private loadTaxCategories(): void {
    this.taxesService.getTaxCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (taxCategories: TaxCategory[]) => {
        this.allTaxCategories = taxCategories;
        this.taxCategoryOptions = taxCategories.map((cat: TaxCategory) => {
          const rawRate = cat.rate ?? cat.tax_rates?.[0]?.rate ?? 0;
          const rate = parseFloat(String(rawRate));
          const finalRate = isNaN(rate) ? 0 : rate;

          return {
            value: cat.id,
            label: `${cat.name} (${(finalRate * 100).toFixed(0)}%)`,
            description: cat.description,
          };
        });
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(
          message,
          'Error al cargar categorías de impuestos',
        );
      },
    });
  }

  private loadBrands(): void {
    this.brandsService.getBrands().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (brands: Brand[]) => {
        this.brandOptions = brands.map((brand: Brand) => ({
          value: brand.id,
          label: brand.name,
          description: brand.description,
        }));
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar marcas');
        this.brandOptions = [];
      },
    });
  }

  onCategoryCreated(category: ProductCategory): void {
    // Add new option optimistically (triggers OnPush change detection)
    this.categoryOptions = [
      ...this.categoryOptions,
      {
        value: category.id,
        label: category.name,
        description: category.description,
      },
    ];
    this.productForm.patchValue({ category_id: category.id });
    this.isCategoryCreateOpen.set(false);
  }

  onBrandCreated(brand: Brand): void {
    // Add new option optimistically (triggers OnPush change detection)
    this.brandOptions = [
      ...this.brandOptions,
      { value: brand.id, label: brand.name, description: brand.description },
    ];
    this.productForm.patchValue({ brand_id: brand.id });
    this.isBrandCreateOpen.set(false);
  }

  onTaxCategoryCreated(taxCategory: TaxCategory): void {
    const rawRate = taxCategory.rate ?? taxCategory.tax_rates?.[0]?.rate ?? 0;
    const rate = parseFloat(String(rawRate));
    const finalRate = isNaN(rate) ? 0 : rate;

    this.allTaxCategories = [...this.allTaxCategories, taxCategory];
    this.taxCategoryOptions = [
      ...this.taxCategoryOptions,
      {
        value: taxCategory.id,
        label: `${taxCategory.name} (${(finalRate * 100).toFixed(0)}%)`,
        description: taxCategory.description,
      },
    ];

    const currentIds: number[] =
      this.productForm.get('tax_category_ids')?.value || [];
    this.productForm.patchValue({
      tax_category_ids: [...currentIds, taxCategory.id],
    });
    this.isTaxCategoryCreateOpen.set(false);
  }

  onCancel() {
    this.isOpen.set(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.productForm.invalid || this.isSubmitting()) {
      this.productForm.markAllAsTouched();
      return;
    }

    // Construct simplified DTO
    const val = this.productForm.value;
    const dto: any = {
      name: val.name,
      base_price: val.base_price,
      track_inventory: !!val.track_inventory,
      stock_quantity: val.track_inventory ? val.stock_quantity : null,
      sku: val.sku || undefined,
      // Map single category to array for backend compat
      category_ids: val.category_id ? [Number(val.category_id)] : [],
      brand_id: val.brand_id,
      tax_category_ids: val.tax_category_ids || [],
      state: val.state,
    };

    // Remove legacy field if it exists in val but not needed in DTO
    // delete dto.category_id;

    this.submit.emit(dto);
  }

  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }

    const errors = field.errors;

    if (errors['required']) {
      return 'Este campo es obligatorio';
    }

    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }

    if (errors['maxlength']) {
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }

    if (errors['min']) {
      return `El valor mínimo es ${errors['min'].min}`;
    }

    if (errors['email']) {
      return 'Formato de correo inválido';
    }

    return 'Entrada inválida';
  }

  onStockAdjustmentClick(): void {
    this.toastService.info(
      'Para ajustar stock, use la edición avanzada del producto o el módulo de Inventario',
      'Ajuste de Stock',
    );
  }

  // Product states (copiado de order-details)
  readonly productStateOptions = ['active', 'inactive', 'archived'] as const;

  // Método de actualización (con confirmación como en órdenes)
  updateProductState(newState: string): void {
    if (this.productForm.get('state')?.value === newState) return;

    this.dialogService
      .confirm({
        title: 'Change Product Status',
        message: `Are you sure you want to change the product status to "${this.formatStatus(newState)}"? This action cannot be undone and may affect product visibility.`,
        confirmText: 'Change Status',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.productForm.get('state')?.setValue(newState);
        }
      });
  }

  // Helper methods (copiados de order-details)
  getStatusColor(status: string): string {
    const statusColors: { [key: string]: string } = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-yellow-100 text-yellow-800',
      archived: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }
}
