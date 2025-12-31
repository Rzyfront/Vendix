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
  TextareaComponent,
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
    TextareaComponent,
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

        <app-textarea
          label="Description"
          placeholder="Enter brand description (optional)"
          formControlName="description"
          [rows]="3"
          [control]="brandForm.get('description')"
        >
        </app-textarea>
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
  @Output() isOpenChange = new EventEmitter<boolean>();
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
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      description: [''],
    });
  }

  onCancel() {
    this.brandForm.reset();
    this.isOpenChange.emit(false);
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
        this.isOpenChange.emit(false);
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
    if (field.errors['minlength']) return 'Minimum 2 characters required';
    if (field.errors['maxlength']) return 'Maximum 100 characters allowed';
    return 'Invalid input';
  }
}
