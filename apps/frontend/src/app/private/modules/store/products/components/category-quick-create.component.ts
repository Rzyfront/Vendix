import { Component, EventEmitter, Input, Output } from '@angular/core';
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
} from '../../../../../shared/components';
import { CategoriesService } from '../services/categories.service';
import { ProductCategory } from '../interfaces';

@Component({
  selector: 'app-category-quick-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [size]="'md'"
      [title]="'Create New Category'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="categoryForm" class="space-y-4">
        <app-input
          label="Category Name"
          placeholder="Enter category name"
          formControlName="name"
          [error]="getErrorMessage('name')"
          [required]="true"
        >
        </app-input>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Description
          </label>
          <textarea
            formControlName="description"
            rows="3"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Enter category description (optional)"
          >
          </textarea>
        </div>
      </form>

      <div
        class="flex justify-end items-center pt-4 border-t border-gray-200 space-x-3"
      >
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
          [disabled]="categoryForm.invalid"
        >
          Create Category
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CategoryQuickCreateComponent {
  @Input() isOpen = false;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<ProductCategory>();
  @Output() cancel = new EventEmitter<void>();

  categoryForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private categoriesService: CategoriesService,
    private toastService: ToastService,
  ) {
    this.categoryForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(4),
          Validators.maxLength(255),
        ],
      ],
      description: ['', [Validators.maxLength(255)]],
    });
  }

  onCancel() {
    this.categoryForm.reset();
    this.openChange.emit(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.categoryForm.invalid) return;

    this.isSubmitting = true;
    const categoryData = this.categoryForm.value;

    // Generate a simple slug from name if not provided (backend usually handles this, but just in case)
    // For now, we send just name and description as per service signature
    this.categoriesService.createCategory(categoryData).subscribe({
      next: (category) => {
        this.toastService.success('Category created successfully');
        this.created.emit(category);
        this.isSubmitting = false;
        this.categoryForm.reset();
        this.openChange.emit(false);
      },
      error: (error) => {
        console.error('Error creating category:', error);
        this.toastService.error('Failed to create category');
        this.isSubmitting = false;
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.categoryForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'This field is required';
    if (field.errors['minlength']) return 'Minimum 4 characters required';
    if (field.errors['maxlength']) return 'Maximum 255 characters allowed';
    return 'Invalid input';
  }
}
