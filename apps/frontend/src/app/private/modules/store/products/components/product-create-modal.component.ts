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
  InputType,
  ToastService,
  IconComponent,
} from '../../../../../shared/components';
import { CreateProductDto } from '../interfaces';
import { ProductsService } from '../services/products.service';

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
  ],
  template: `
    <app-modal
      [size]="'lg'"
      [title]="'Create New Product'"
      [isOpen]="show"
      (closed)="onClose()"
    >
      <form [formGroup]="productForm" class="space-y-6">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-medium text-gray-900">Basic Information</h3>

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
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >Description</label
            >
            <textarea
              formControlName="description"
              rows="3"
              class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
          <h3 class="text-lg font-medium text-gray-900">Pricing & Inventory</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Base Price"
              type="number"
              placeholder="0.00"
              formControlName="base_price"
              [error]="getErrorMessage('base_price')"
              [required]="true"
              [helperText]="'Base price without taxes'"
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

        <!-- Categories -->
        <div class="space-y-4">
          <h3 class="text-lg font-medium text-gray-900">Categories</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Category ID"
              type="number"
              placeholder="Enter category ID"
              formControlName="category_id"
              [error]="getErrorMessage('category_id')"
              [helperText]="'Primary category'"
            >
            </app-input>

            <app-input
              label="Brand ID"
              type="number"
              placeholder="Enter brand ID"
              formControlName="brand_id"
              [error]="getErrorMessage('brand_id')"
              [helperText]="'Brand (optional)'"
            >
            </app-input>
          </div>
        </div>
      </form>

      <div class="flex justify-end space-x-3 pt-6 border-t">
        <app-button
          variant="outline"
          (clicked)="onClose()"
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
          Create Product
        </app-button>
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
export class ProductCreateModalComponent {
  @Input() show = false;
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();
  isSubmitting = false;
  productForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private productsService: ProductsService,
    private toastService: ToastService,
  ) {
    this.productForm = this.createForm();
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
    });
  }

  open() {
    this.show = true;
    this.productForm.reset({
      name: '',
      slug: '',
      description: '',
      base_price: 0,
      sku: '',
      stock_quantity: 0,
      category_id: null,
      brand_id: null,
    });
  }

  close() {
    this.show = false;
    this.productForm.reset();
  }

  onClose() {
    this.close();
    this.closed.emit();
  }

  onSubmit() {
    if (this.productForm.invalid || this.isSubmitting) {
      return;
    }

    this.isSubmitting = true;

    const formValue = this.productForm.value;
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
      category_id: formValue.category_id || undefined,
      brand_id: formValue.brand_id || undefined,
    };

    this.productsService.createProduct(createProductDto).subscribe({
      next: () => {
        this.toastService.success('Product created successfully!');
        this.isSubmitting = false;
        this.close();
        this.created.emit();
      },
      error: (error) => {
        this.isSubmitting = false;
        this.toastService.error(error || 'Error creating product');
        console.error('Error creating product:', error);
      },
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
}
