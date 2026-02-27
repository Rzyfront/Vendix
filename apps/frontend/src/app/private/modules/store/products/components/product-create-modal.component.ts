import {
  Component,
  Input,
  EventEmitter,
  Output,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
  DialogService,
  SettingToggleComponent,
} from '../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { Product, ProductState, ProductCategory, Brand } from '../interfaces';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { BrandsService } from '../services/brands.service';
import { CategoryQuickCreateComponent } from './category-quick-create.component';
import { BrandQuickCreateComponent } from './brand-quick-create.component';

@Component({
  selector: 'app-product-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
    SettingToggleComponent,
    CategoryQuickCreateComponent,
    BrandQuickCreateComponent,
  ],
  templateUrl: './product-create-modal/product-create-modal.component.html',
  styleUrls: ['./product-create-modal/product-create-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductCreateModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() product: Product | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<any>();
  @Output() cancel = new EventEmitter<void>();

  get isEditMode(): boolean {
    return !!this.product;
  }

  productForm: FormGroup;
  categoryOptions: SelectorOption[] = [];
  brandOptions: SelectorOption[] = [];

  // Quick create modals state
  isCategoryCreateOpen = false;
  isBrandCreateOpen = false;

  constructor(
    private fb: FormBuilder,
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
    private brandsService: BrandsService,
    private toastService: ToastService,
    private router: Router,
    private dialogService: DialogService,
    private currencyService: CurrencyFormatService,
  ) {
    this.productForm = this.createForm();
    this.loadCategoriesAndBrands();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['product']) {
      if (this.product) {
        this.populateForm();
      } else {
        this.resetForm();
      }
    }

    if (changes['isOpen'] && this.isOpen) {
      // Asegurar que la moneda esté cargada cuando el modal se abre
      this.currencyService.loadCurrency();
      if (!this.product) {
        this.resetForm();
      }
    }
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
      state: [ProductState.ACTIVE],
    });
  }

  resetForm() {
    this.productForm.reset({
      base_price: 0,
      stock_quantity: 0,
      track_inventory: true,
      state: ProductState.ACTIVE,
    });
  }

  goToAdvancedCreation(): void {
    this.router.navigate(['/admin/products/create']);
    this.onCancel();
  }

  private loadCategoriesAndBrands(): void {
    this.loadCategories();
    this.loadBrands();
  }

  // Populate form when product data is available (edit mode)
  private populateForm(): void {
    if (!this.product) return;

    this.productForm.patchValue({
      name: this.product.name,
      base_price: this.product.base_price,
      stock_quantity: this.product.stock_quantity || 0,
      track_inventory: this.product.track_inventory !== false,
      // Try to get category from new structure or legacy if exists
      category_id:
        (this.product as any).category_ids?.[0] ||
        this.product.categories?.[0]?.id ||
        null,
      brand_id: this.product.brand_id || null,
      state: this.product.state || ProductState.ACTIVE,
    });
  }

  private loadCategories(): void {
    this.categoriesService.getCategories().subscribe({
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

  private loadBrands(): void {
    this.brandsService.getBrands().subscribe({
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
      { value: category.id, label: category.name, description: category.description },
    ];
    this.productForm.patchValue({ category_id: category.id });
    this.isCategoryCreateOpen = false;
  }

  onBrandCreated(brand: Brand): void {
    // Add new option optimistically (triggers OnPush change detection)
    this.brandOptions = [
      ...this.brandOptions,
      { value: brand.id, label: brand.name, description: brand.description },
    ];
    this.productForm.patchValue({ brand_id: brand.id });
    this.isBrandCreateOpen = false;
  }

  onCancel() {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.productForm.invalid || this.isSubmitting) {
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
      return 'This field is required';
    }

    if (errors['minlength']) {
      return `Minimum ${errors['minlength'].requiredLength} characters`;
    }

    if (errors['maxlength']) {
      return `Maximum ${errors['maxlength'].requiredLength} characters`;
    }

    if (errors['min']) {
      return `Minimum value is ${errors['min'].min}`;
    }

    if (errors['email']) {
      return 'Invalid email format';
    }

    return 'Invalid input';
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
