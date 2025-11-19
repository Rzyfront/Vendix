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
import { BrandsService } from '../services/brands.service';
import { Brand } from '../interfaces';

@Component({
  selector: 'app-brand-quick-create',
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
      [title]="'Create New Brand'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="brandForm" class="space-y-4">
        <app-input
          label="Brand Name"
          placeholder="Enter brand name"
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
            placeholder="Enter brand description (optional)"
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
          [disabled]="brandForm.invalid"
        >
          Create Brand
        </app-button>
      </div>
    </app-modal>
  `,
})
export class BrandQuickCreateComponent {
  @Input() isOpen = false;
  @Output() openChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<Brand>();
  @Output() cancel = new EventEmitter<void>();

  brandForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private brandsService: BrandsService,
    private toastService: ToastService,
  ) {
    this.brandForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      description: [''],
    });
  }

  onCancel() {
    this.brandForm.reset();
    this.openChange.emit(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.brandForm.invalid) return;

    this.isSubmitting = true;
    const brandData = this.brandForm.value;

    this.brandsService.createBrand(brandData).subscribe({
      next: (brand) => {
        this.toastService.success('Brand created successfully');
        this.created.emit(brand);
        this.isSubmitting = false;
        this.brandForm.reset();
        this.openChange.emit(false);
      },
      error: (error) => {
        console.error('Error creating brand:', error);
        this.toastService.error('Failed to create brand');
        this.isSubmitting = false;
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.brandForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'This field is required';
    if (field.errors['maxlength']) return 'Maximum 100 characters allowed';
    return 'Invalid input';
  }
}
