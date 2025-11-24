import { Component, Input, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
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
} from '../../../../../shared/components';
import {
  CreateProductDto,
  UpdateProductDto,
  CreateProductImageDto,
  ProductCategory,
  Brand,
  Product,
} from '../interfaces';
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
    CategoryQuickCreateComponent,
    BrandQuickCreateComponent,
  ],
  template: `
    <app-modal
      [size]="'lg'"
      [title]="isEditMode ? 'Editar Producto' : 'Crear Nuevo Producto'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="productForm" class="space-y-6">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2"
          >
            <app-icon name="package" [size]="20" class="mr-2"></app-icon>
            Información Básica
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Product Name"
              placeholder="Enter product name"
              formControlName="name"
              [error]="getErrorMessage('name')"
              [required]="true"
            >
            </app-input>

            <app-input
              label="SKU"
              placeholder="Enter SKU (optional)"
              formControlName="sku"
              [error]="getErrorMessage('sku')"
              [helperText]="'Leave empty to auto-generate'"
            >
            </app-input>
          </div>

          <app-input
            label="Slug"
            placeholder="Enter slug (optional)"
            formControlName="slug"
            [error]="getErrorMessage('slug')"
            [helperText]="'URL-friendly version of the name'"
          >
          </app-input>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              formControlName="description"
              rows="4"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Enter product description"
            >
            </textarea>
            @if (description?.invalid && description?.touched) {
              <p class="mt-1 text-sm text-red-600">Description is required</p>
            }
          </div>
        </div>

        <!-- Pricing and Inventory -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2"
          >
            <app-icon name="dollar-sign" [size]="20" class="mr-2"></app-icon>
            Pricing & Inventory
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Base Price"
              type="number"
              placeholder="0.00"
              formControlName="base_price"
              [error]="getErrorMessage('base_price')"
              [required]="true"
              [helperText]="'Base price without taxes'"
              [step]="'0.01'"
            >
            </app-input>

            <app-input
              label="Initial Stock"
              type="number"
              placeholder="0"
              formControlName="stock_quantity"
              [error]="getErrorMessage('stock_quantity')"
              [helperText]="'Initial stock quantity'"
            >
            </app-input>
          </div>
        </div>

        <!-- Categories and Brand -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2"
          >
            <app-icon name="tag" [size]="20" class="mr-2"></app-icon>
            Categories & Brand
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex items-start gap-2">
              <div class="flex-grow">
                <app-selector
                  label="Primary Category"
                  placeholder="Select a category (optional)"
                  [options]="categoryOptions"
                  formControlName="category_id"
                  [helpText]="'Primary product category'"
                  [errorText]="getErrorMessage('category_id')"
                >
                </app-selector>
              </div>
              <button
                type="button"
                class="mt-7 p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                (click)="isCategoryCreateOpen = true"
                title="Crear nueva categoría"
              >
                <app-icon name="plus" [size]="20"></app-icon>
              </button>
            </div>

            <div class="flex items-start gap-2">
              <div class="flex-grow">
                <app-selector
                  label="Brand"
                  placeholder="Select a brand (optional)"
                  [options]="brandOptions"
                  formControlName="brand_id"
                  [helpText]="'Product brand (optional)'"
                  [errorText]="getErrorMessage('brand_id')"
                >
                </app-selector>
              </div>
              <button
                type="button"
                class="mt-7 p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                (click)="isBrandCreateOpen = true"
                title="Crear nueva marca"
              >
                <app-icon name="plus" [size]="20"></app-icon>
              </button>
            </div>
          </div>
        </div>

        <!-- Product Images -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-2"
          >
            <app-icon name="image" [size]="20" class="mr-2"></app-icon>
            Product Images
          </h3>

          <div class="space-y-4">
            <!-- Image URL Input -->
            <div class="flex gap-2">
              <app-input
                label="Agregar URL de Imagen"
                placeholder="https://example.com/image.jpg"
                formControlName="newImageUrl"
                [helperText]="'Enter image URL or use the file upload below'"
                class="flex-1"
              >
              </app-input>
              <app-button
                variant="outline"
                (clicked)="addImageUrl()"
                [disabled]="!productForm.get('newImageUrl')?.value"
                class="mt-6"
              >
                <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                Agregar
              </app-button>
            </div>

            <!-- File Upload -->
            <div
              class="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors"
            >
              <app-icon
                name="upload"
                [size]="48"
                class="mx-auto text-gray-400 mb-4"
              ></app-icon>
              <p class="text-sm text-gray-600 mb-2">
                Drag and drop images here, or click to select files
              </p>
              <input
                type="file"
                multiple
                accept="image/*"
                (change)="onFileSelect($event)"
                class="hidden"
                #fileInput
              />
              <app-button
                variant="outline"
                (clicked)="fileInput.click()"
                type="button"
              >
                <app-icon name="folder-open" [size]="16" slot="icon"></app-icon>
                Select Files
              </app-button>
            </div>

            <!-- Image Preview -->
            @if (imageUrls.length > 0) {
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                @for (imageUrl of imageUrls; track imageUrl; let i = $index) {
                  <div class="relative group">
                    <img
                      [src]="imageUrl"
                      [alt]="'Product image ' + (i + 1)"
                      class="w-full h-32 object-cover rounded-lg border border-gray-200"
                      (error)="onImageError($event)"
                    />
                    <button
                      type="button"
                      (click)="removeImage(i)"
                      class="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <app-icon name="x" [size]="16"></app-icon>
                    </button>
                    @if (i === 0) {
                      <div
                        class="absolute bottom-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded"
                      >
                        Main
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </div>
      </form>

      <div
        class="flex justify-between items-center pt-6 border-t border-gray-200"
      >
        <div class="text-sm text-gray-500">
          <app-icon name="info" [size]="14" class="mr-1"></app-icon>
          Required fields are marked with *
        </div>
        <div class="flex space-x-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [loading]="isSubmitting"
            [disabled]="productForm.invalid"
          >
            <app-icon name="save" [size]="16" slot="icon"></app-icon>
            {{ isEditMode ? 'Actualizar Producto' : 'Crear Producto' }}
          </app-button>
        </div>
      </div>
    </app-modal>

    <app-category-quick-create
      [isOpen]="isCategoryCreateOpen"
      (openChange)="isCategoryCreateOpen = $event"
      (created)="onCategoryCreated($event)"
      (cancel)="isCategoryCreateOpen = false"
    ></app-category-quick-create>

    <app-brand-quick-create
      [isOpen]="isBrandCreateOpen"
      (openChange)="isBrandCreateOpen = $event"
      (created)="onBrandCreated($event)"
      (cancel)="isBrandCreateOpen = false"
    ></app-brand-quick-create>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProductCreateModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() product: Product | null = null; // Product data for edit mode
  @Output() openChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<any>();
  @Output() cancel = new EventEmitter<void>();

  get isEditMode(): boolean {
    return !!this.product;
  }
  productForm: FormGroup;
  imageUrls: string[] = [];
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
  ) {
    this.productForm = this.createForm();
    this.loadCategoriesAndBrands();
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
      slug: ['', [Validators.maxLength(255)]],
      description: [''],
      base_price: [0, [Validators.required, Validators.min(0)]],
      sku: ['', [Validators.maxLength(100)]],
      stock_quantity: [0, [Validators.min(0)]],
      category_id: [null],
      brand_id: [null],
      newImageUrl: [''],
    });
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
      slug: this.product.slug,
      description: this.product.description || '',
      base_price: this.product.base_price,
      sku: this.product.sku || '',
      stock_quantity: this.product.stock_quantity || 0,
      category_id: this.product.category_id || null,
      brand_id: this.product.brand_id || null,
    });

    // Load existing images
    if (this.product.images && this.product.images.length > 0) {
      // Sort images so main image is first
      const sortedImages = [...this.product.images].sort((a, b) => {
        if (a.is_main && !b.is_main) return -1;
        if (!a.is_main && b.is_main) return 1;
        return 0;
      });

      this.imageUrls = sortedImages.map((img) => img.image_url);
    }
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
        console.error('Error loading categories:', error);
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
        console.error('Error loading brands:', error);
        this.brandOptions = [];
      },
    });
  }

  onCategoryCreated(category: ProductCategory): void {
    this.loadCategories();
    this.productForm.patchValue({ category_id: category.id });
    this.isCategoryCreateOpen = false;
  }

  onBrandCreated(brand: Brand): void {
    this.loadBrands();
    this.productForm.patchValue({ brand_id: brand.id });
    this.isBrandCreateOpen = false;
  }

  onCancel() {
    this.openChange.emit(false);
    this.cancel.emit();
  }

  addImageUrl(): void {
    const urlControl = this.productForm.get('newImageUrl');
    const url = urlControl?.value?.trim();

    if (url && this.isValidUrl(url)) {
      this.imageUrls.push(url);
      urlControl?.setValue('');
      this.toastService.success('Image added successfully');
    } else {
      this.toastService.error('Please enter a valid image URL');
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;

    if (files) {
      Array.from(files).forEach((file) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            const result = e.target?.result as string;
            this.imageUrls.push(result);
          };
          reader.readAsDataURL(file);
        }
      });
      input.value = '';
    }
  }

  removeImage(index: number): void {
    this.imageUrls.splice(index, 1);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMiA2VjEwTDEwIDhMMTIgNlpNMTIgNlYxMEwxNCA4TDEyIDZaIiBmaWxsPSIjOUNBM0FGIi8+CjxwYXRoIGQ9Ik0xMiAxNFYxOEwxMCAxNkwxMiAxNFpNMTIgMTRWMThMMTQgMTZMMTIgMTRaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  onSubmit() {
    if (this.productForm.invalid || this.isSubmitting) {
      this.markFormGroupTouched(this.productForm);
      return;
    }

    this.isSubmitting = true;

    const formValue = this.productForm.value;
    const images: CreateProductImageDto[] = this.imageUrls.map(
      (url, index) => ({
        image_url: url,
        is_main: index === 0,
      }),
    );

    const createProductDto: CreateProductDto = {
      name: formValue.name,
      slug: formValue.slug || undefined,
      description: formValue.description || undefined,
      base_price: Number(formValue.base_price),
      sku: formValue.sku || undefined,
      stock_quantity:
        formValue.stock_quantity > 0
          ? Number(formValue.stock_quantity)
          : undefined,
      category_id: formValue.category_id ? Number(formValue.category_id) : null,
      brand_id: formValue.brand_id ? Number(formValue.brand_id) : null,
      images: images.length > 0 ? images : undefined,
    };

    this.productsService.createProduct(createProductDto).subscribe({
      next: () => {
        this.toastService.success('Product created successfully!');
        this.submit.emit(createProductDto);
        this.openChange.emit(false);
      },
      error: (error) => {
        this.toastService.error(error || 'Error creating product');
        console.error('Error creating product:', error);
        this.isSubmitting = false;
      },
    });
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.values(formGroup.controls).forEach((control) => {
      control.markAsTouched();
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
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

  // Getters for template access
  get name() {
    return this.productForm.get('name');
  }
  get slug() {
    return this.productForm.get('slug');
  }
  get description() {
    return this.productForm.get('description');
  }
  get base_price() {
    return this.productForm.get('base_price');
  }
  get sku() {
    return this.productForm.get('sku');
  }
  get stock_quantity() {
    return this.productForm.get('stock_quantity');
  }
  get category_id() {
    return this.productForm.get('category_id');
  }
  get brand_id() {
    return this.productForm.get('brand_id');
  }
  get newImageUrl() {
    return this.productForm.get('newImageUrl');
  }
}
