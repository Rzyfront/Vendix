import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormArray,
  FormControl,
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
  CreateProductVariantDto,
  ProductCategory,
  Brand,
  Product,
  ProductVariant,
  ProductImage,
  StockByLocationDto,
} from '../interfaces';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { BrandsService } from '../services/brands.service';

export interface ProductManagementMode {
  type: 'create' | 'edit';
  product?: Product;
}

@Component({
  selector: 'app-product-management',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [size]="'xl'"
      [title]="mode.type === 'create' ? 'Create New Product' : 'Edit Product'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="productForm" class="space-y-6">
        <!-- Tabs Navigation -->
        <div class="border-b border-gray-200">
          <nav class="-mb-px flex space-x-8">
            @for (tab of tabs; track tab.id) {
              <button
                type="button"
                (click)="activeTab = tab.id"
                class="py-2 px-1 border-b-2 font-medium text-sm transition-colors"
                [class]="
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                "
              >
                <app-icon [name]="tab.icon" [size]="16" class="mr-2"></app-icon>
                {{ tab.label }}
                @if (tab.error && activeTab !== tab.id) {
                  <span class="ml-1 text-red-500">*</span>
                }
              </button>
            }
          </nav>
        </div>

        <!-- Tab Content -->
        <div class="min-h-[400px]">
          <!-- Basic Information Tab -->
          @if (activeTab === 'basic') {
            <div class="space-y-6">
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
              </div>

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

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <app-selector
                  label="Primary Category"
                  placeholder="Select a category (optional)"
                  [options]="categoryOptions"
                  formControlName="category_id"
                  [helpText]="'Primary product category'"
                  [errorText]="getErrorMessage('category_id')"
                >
                </app-selector>

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
            </div>
          }

          <!-- Variants Tab -->
          @if (activeTab === 'variants') {
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <h3 class="text-lg font-medium text-gray-900">
                  Product Variants
                </h3>
                <app-button
                  variant="outline"
                  (clicked)="addVariant()"
                  [disabled]="variantsFormArray.disabled"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Add Variant
                </app-button>
              </div>

              <div formArrayName="variants" class="space-y-4">
                @for (
                  variant of variantsFormArray.controls;
                  track trackVariantIndex($index, variant);
                  let i = $index
                ) {
                  <div
                    [formGroupName]="i"
                    class="border border-gray-200 rounded-lg p-4 space-y-4"
                  >
                    <div class="flex justify-between items-center">
                      <h4 class="font-medium text-gray-900">
                        Variant {{ i + 1 }}
                      </h4>
                      <app-button
                        variant="ghost"
                        size="sm"
                        (clicked)="removeVariant(i)"
                        [disabled]="variantsFormArray.length <= 1"
                      >
                        <app-icon
                          name="trash-2"
                          [size]="16"
                          slot="icon"
                        ></app-icon>
                      </app-button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <app-input
                        label="SKU"
                        placeholder="Enter variant SKU"
                        [formControlName]="'sku'"
                        [required]="true"
                        [error]="getVariantErrorMessage(i, 'sku')"
                      >
                      </app-input>

                      <app-input
                        label="Price Override"
                        type="number"
                        placeholder="0.00"
                        [formControlName]="'price_override'"
                        [helperText]="'Leave empty to use base price'"
                        [step]="'0.01'"
                        [error]="getVariantErrorMessage(i, 'price_override')"
                      >
                      </app-input>

                      <app-input
                        label="Stock Quantity"
                        type="number"
                        placeholder="0"
                        [formControlName]="'stock_quantity'"
                        [required]="true"
                        [error]="getVariantErrorMessage(i, 'stock_quantity')"
                      >
                      </app-input>
                    </div>
                  </div>
                }
              </div>

              @if (variantsFormArray.length === 0) {
                <div class="text-center py-8 text-gray-500">
                  <app-icon
                    name="package"
                    [size]="48"
                    class="mx-auto mb-2 text-gray-300"
                  ></app-icon>
                  <p>No variants added yet</p>
                  <p class="text-sm">
                    Click "Add Variant" to create your first variant
                  </p>
                </div>
              }
            </div>
          }

          <!-- Images Tab -->
          @if (activeTab === 'images') {
            <div class="space-y-4">
              <div class="flex gap-2">
                <app-input
                  label="Add Image URL"
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
                  Add
                </app-button>
              </div>

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
                  <app-icon
                    name="folder-open"
                    [size]="16"
                    slot="icon"
                  ></app-icon>
                  Select Files
                </app-button>
              </div>

              @if (imageUrls.length > 0) {
                <div class="space-y-2">
                  <div class="flex justify-between items-center">
                    <h4 class="font-medium text-gray-900">
                      Product Images ({{ imageUrls.length }})
                    </h4>
                    <p class="text-sm text-gray-500">
                      First image will be set as main
                    </p>
                  </div>
                  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    @for (
                      imageUrl of imageUrls;
                      track imageUrl;
                      let i = $index
                    ) {
                      <div class="relative group">
                        <img
                          [src]="imageUrl"
                          [alt]="'Product image ' + (i + 1)"
                          class="w-full h-32 object-cover rounded-lg border border-gray-200"
                          (error)="onImageError($event)"
                        />
                        <div
                          class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          @if (i !== 0) {
                            <button
                              type="button"
                              (click)="setMainImage(i)"
                              class="bg-blue-500 text-white rounded-full p-1 text-xs"
                              title="Set as main image"
                            >
                              <app-icon name="star" [size]="12"></app-icon>
                            </button>
                          }
                          <button
                            type="button"
                            (click)="removeImage(i)"
                            class="bg-red-500 text-white rounded-full p-1"
                            title="Remove image"
                          >
                            <app-icon name="x" [size]="12"></app-icon>
                          </button>
                        </div>
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
                </div>
              }
            </div>
          }

          <!-- Stock Tab -->
          @if (activeTab === 'stock') {
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <h3 class="text-lg font-medium text-gray-900">
                  Stock by Location
                </h3>
                <app-button
                  variant="outline"
                  (clicked)="addStockLocation()"
                  [disabled]="stockFormArray.disabled"
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                  Add Location
                </app-button>
              </div>

              <div formArrayName="stock_by_location" class="space-y-4">
                @for (
                  stock of stockFormArray.controls;
                  track trackStockIndex($index, stock);
                  let i = $index
                ) {
                  <div
                    [formGroupName]="i"
                    class="border border-gray-200 rounded-lg p-4 space-y-4"
                  >
                    <div class="flex justify-between items-center">
                      <h4 class="font-medium text-gray-900">
                        Stock Location {{ i + 1 }}
                      </h4>
                      <app-button
                        variant="ghost"
                        size="sm"
                        (clicked)="removeStockLocation(i)"
                        [disabled]="stockFormArray.length <= 1"
                      >
                        <app-icon
                          name="trash-2"
                          [size]="16"
                          slot="icon"
                        ></app-icon>
                      </app-button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <app-input
                        label="Location ID"
                        type="number"
                        placeholder="Enter location ID"
                        [formControlName]="'location_id'"
                        [required]="true"
                        [error]="getStockErrorMessage(i, 'location_id')"
                      >
                      </app-input>

                      <app-input
                        label="Quantity"
                        type="number"
                        placeholder="0"
                        [formControlName]="'quantity'"
                        [required]="true"
                        [error]="getStockErrorMessage(i, 'quantity')"
                      >
                      </app-input>

                      <app-input
                        label="Notes"
                        placeholder="Optional notes"
                        [formControlName]="'notes'"
                      >
                      </app-input>
                    </div>
                  </div>
                }
              </div>

              @if (stockFormArray.length === 0) {
                <div class="text-center py-8 text-gray-500">
                  <app-icon
                    name="map-pin"
                    [size]="48"
                    class="mx-auto mb-2 text-gray-300"
                  ></app-icon>
                  <p>No stock locations added yet</p>
                  <p class="text-sm">
                    Click "Add Location" to specify stock locations
                  </p>
                </div>
              }
            </div>
          }
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
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [loading]="isSubmitting"
            [disabled]="productForm.invalid"
          >
            <app-icon name="save" [size]="16" slot="icon"></app-icon>
            {{ mode.type === 'create' ? 'Create Product' : 'Update Product' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProductManagementComponent implements OnInit {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() mode: ProductManagementMode = { type: 'create' };
  @Output() openChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<any>();
  @Output() cancel = new EventEmitter<void>();

  productForm: FormGroup;
  imageUrls: string[] = [];
  categoryOptions: SelectorOption[] = [];
  brandOptions: SelectorOption[] = [];
  activeTab: 'basic' | 'variants' | 'images' | 'stock' = 'basic';

  tabs = [
    {
      id: 'basic' as const,
      label: 'Basic Info',
      icon: 'package',
      error: false,
    },
    {
      id: 'variants' as const,
      label: 'Variants',
      icon: 'layers',
      error: false,
    },
    { id: 'images' as const, label: 'Images', icon: 'image', error: false },
    { id: 'stock' as const, label: 'Stock', icon: 'map-pin', error: false },
  ];

  constructor(
    private fb: FormBuilder,
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
    private brandsService: BrandsService,
    private toastService: ToastService,
  ) {
    this.productForm = this.createForm();
  }

  ngOnInit(): void {
    this.loadCategoriesAndBrands();
    if (this.mode.type === 'edit' && this.mode.product) {
      this.loadProductData();
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
      slug: ['', [Validators.maxLength(255)]],
      description: [''],
      base_price: [0, [Validators.required, Validators.min(0)]],
      sku: ['', [Validators.maxLength(100)]],
      stock_quantity: [0, [Validators.min(0)]],
      category_id: [null],
      brand_id: [null],
      newImageUrl: [''],
      variants: this.fb.array([]),
      stock_by_location: this.fb.array([]),
    });
  }

  private loadCategoriesAndBrands(): void {
    this.loadCategories();
    this.loadBrands();
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

  private loadProductData(): void {
    if (!this.mode.product) return;

    const product = this.mode.product;
    this.productForm.patchValue({
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sku: product.sku,
      stock_quantity: product.stock_quantity,
      category_id: product.category_id,
      brand_id: product.brand_id,
    });

    // Load images
    if (product.images && product.images.length > 0) {
      this.imageUrls = product.images.map((img) => img.image_url);
    }

    // Load variants
    if (product.variants && product.variants.length > 0) {
      product.variants.forEach((variant) => {
        this.addVariant(variant);
      });
    }

    // Add at least one empty variant if none exist
    if (this.variantsFormArray.length === 0) {
      this.addVariant();
    }
  }

  // Variant management
  get variantsFormArray(): FormArray {
    return this.productForm.get('variants') as FormArray;
  }

  addVariant(variant?: ProductVariant): void {
    const variantGroup = this.fb.group({
      sku: [
        variant?.sku || '',
        [Validators.required, Validators.maxLength(100)],
      ],
      price_override: [variant?.price_override || null, [Validators.min(0)]],
      stock_quantity: [
        variant?.stock_quantity || 0,
        [Validators.required, Validators.min(0)],
      ],
      image_id: [variant?.image_id || null],
    });
    this.variantsFormArray.push(variantGroup);
  }

  removeVariant(index: number): void {
    this.variantsFormArray.removeAt(index);
  }

  // Stock management
  get stockFormArray(): FormArray {
    return this.productForm.get('stock_by_location') as FormArray;
  }

  addStockLocation(): void {
    const stockGroup = this.fb.group({
      location_id: [null, [Validators.required]],
      quantity: [0, [Validators.required, Validators.min(0)]],
      notes: [''],
    });
    this.stockFormArray.push(stockGroup);
  }

  removeStockLocation(index: number): void {
    this.stockFormArray.removeAt(index);
  }

  // Image management
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

  setMainImage(index: number): void {
    const [image] = this.imageUrls.splice(index, 1);
    this.imageUrls.unshift(image);
    this.toastService.success('Main image updated');
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

  onCancel(): void {
    this.openChange.emit(false);
    this.cancel.emit();
  }

  onSubmit(): void {
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

    const variants: CreateProductVariantDto[] = formValue.variants
      .filter((v: any) => v.sku)
      .map((v: any) => ({
        sku: v.sku,
        price_override: v.price_override || undefined,
        stock_quantity: Number(v.stock_quantity),
        image_id: v.image_id || undefined,
      }));

    const stock_by_location: StockByLocationDto[] = formValue.stock_by_location
      .filter((s: any) => s.location_id && s.quantity >= 0)
      .map((s: any) => ({
        location_id: Number(s.location_id),
        quantity: Number(s.quantity),
        notes: s.notes || undefined,
      }));

    if (this.mode.type === 'create') {
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
        category_id: formValue.category_id
          ? Number(formValue.category_id)
          : null,
        brand_id: formValue.brand_id ? Number(formValue.brand_id) : null,
        images: images.length > 0 ? images : undefined,
        variants: variants.length > 0 ? variants : undefined,
        stock_by_location:
          stock_by_location.length > 0 ? stock_by_location : undefined,
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
    } else {
      const updateProductDto: UpdateProductDto = {
        name: formValue.name,
        slug: formValue.slug || undefined,
        description: formValue.description || undefined,
        base_price: Number(formValue.base_price),
        sku: formValue.sku || undefined,
        stock_quantity: formValue.stock_quantity,
        category_id: formValue.category_id
          ? Number(formValue.category_id)
          : undefined,
        brand_id: formValue.brand_id ? Number(formValue.brand_id) : undefined,
      };

      // For updates, we would need separate API calls for variants, images, and stock
      // This is a simplified version - in production you'd handle these separately
      this.submit.emit({
        ...updateProductDto,
        variants,
        images,
        stock_by_location,
      });
      this.openChange.emit(false);
    }
  }

  private markFormGroupTouched(formGroup: FormGroup): void {
    Object.values(formGroup.controls).forEach((control) => {
      control.markAsTouched();
      if (control instanceof FormGroup) {
        this.markFormGroupTouched(control);
      }
    });
  }

  // Error message methods
  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }

    const errors = field.errors;

    if (errors['required']) return 'This field is required';
    if (errors['minlength'])
      return `Minimum ${errors['minlength'].requiredLength} characters`;
    if (errors['maxlength'])
      return `Maximum ${errors['maxlength'].requiredLength} characters`;
    if (errors['min']) return `Minimum value is ${errors['min'].min}`;
    if (errors['email']) return 'Invalid email format';

    return 'Invalid input';
  }

  getVariantErrorMessage(variantIndex: number, fieldName: string): string {
    const variantGroup = this.variantsFormArray.at(variantIndex) as FormGroup;
    const field = variantGroup.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';

    const errors = field.errors;
    if (errors['required']) return 'This field is required';
    if (errors['min']) return `Minimum value is ${errors['min'].min}`;
    return 'Invalid input';
  }

  getStockErrorMessage(stockIndex: number, fieldName: string): string {
    const stockGroup = this.stockFormArray.at(stockIndex) as FormGroup;
    const field = stockGroup.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';

    const errors = field.errors;
    if (errors['required']) return 'This field is required';
    if (errors['min']) return `Minimum value is ${errors['min'].min}`;
    return 'Invalid input';
  }

  // TrackBy functions for ngFor
  trackVariantIndex(index: number, item: any): number {
    return index;
  }

  trackStockIndex(index: number, item: any): number {
    return index;
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
