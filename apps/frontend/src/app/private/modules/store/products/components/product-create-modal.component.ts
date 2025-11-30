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
  CreateProductImageDto,
  ProductCategory,
  Brand,
  Product,
  ProductState,
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
  templateUrl: './product-create-modal/product-create-modal.component.html',
  styleUrls: ['./product-create-modal/product-create-modal.component.scss'],
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
      state: [ProductState.ACTIVE],
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
      state: this.product.state || ProductState.ACTIVE,
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

  triggerFileUpload(): void {
    const fileInput = document.querySelector('.file-input') as HTMLInputElement;
    fileInput?.click();
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
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjRNEY2Ii8+CjxwYXRoIGQ9Ik0xMiA2VjEwTDEwIDhMMTIgNlpNMTIgNlYxMEwxNCA4TDEyIDZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
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
      state: formValue.state || ProductState.ACTIVE,
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
}
