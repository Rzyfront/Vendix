import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components';
import { Customer, CreateCustomerRequest } from '../../models/customer.model';

@Component({
  selector: 'app-customer-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'md'"
      (closed)="onClose()"
      [title]="customer ? 'Edit Customer' : 'New Customer'"
    >
      <div class="p-6">
        <form [formGroup]="form" class="space-y-4">
          <!-- Email -->
          <app-input
            formControlName="email"
            label="Email *"
            placeholder="john.doe@example.com"
            type="email"
            [error]="getFieldError('email')"
            (blur)="onFieldBlur('email')"
          ></app-input>

          <!-- Names Row -->
          <div class="grid grid-cols-2 gap-4">
            <app-input
              formControlName="first_name"
              label="First Name *"
              placeholder="John"
              [error]="getFieldError('first_name')"
              (blur)="onFieldBlur('first_name')"
            ></app-input>

            <app-input
              formControlName="last_name"
              label="Last Name *"
              placeholder="Doe"
              [error]="getFieldError('last_name')"
              (blur)="onFieldBlur('last_name')"
            ></app-input>
          </div>

          <!-- Phone -->
          <app-input
            formControlName="phone"
            label="Phone"
            placeholder="+1 234 567 890"
            [error]="getFieldError('phone')"
            (blur)="onFieldBlur('phone')"
          ></app-input>

          <!-- Document Row -->
          <div class="grid grid-cols-2 gap-4">
            <app-selector
              formControlName="document_type"
              label="ID Type"
              placeholder="Select Type"
              [options]="documentTypes"
            ></app-selector>

            <app-input
              formControlName="document_number"
              label="ID Number"
              placeholder="12345678"
              [error]="getFieldError('document_number')"
              (blur)="onFieldBlur('document_number')"
            ></app-input>
          </div>
        </form>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-3 p-6 border-t border-gray-100 bg-gray-50">
        <app-button variant="ghost" (clicked)="onClose()">Cancel</app-button>
        <app-button
          variant="primary"
          [disabled]="form.invalid || loading"
          [loading]="loading"
          (clicked)="onSubmit()"
        >
          {{ customer ? 'Update' : 'Create' }}
        </app-button>
      </div>
    </app-modal>
  `
})
export class CustomerModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() customer: Customer | null = null;
  @Input() loading = false;
  @Output() closed = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateCustomerRequest>();

  form: FormGroup;

  documentTypes = [
    { value: 'DNI', label: 'DNI' },
    { value: 'PASSPORT', label: 'Passport' },
    { value: 'LICENSE', label: 'Driver License' }
  ];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      phone: [''],
      document_type: [''],
      document_number: ['']
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['customer'] && this.customer) {
      this.form.patchValue({
        email: this.customer.email,
        first_name: this.customer.first_name,
        last_name: this.customer.last_name,
        phone: this.customer.phone,
        document_type: this.customer.document_type,
        document_number: this.customer.document_number
      });
    } else if (changes['isOpen'] && this.isOpen && !this.customer) {
      this.form.reset();
    }
  }

  onClose() {
    this.closed.emit();
  }

  onSubmit() {
    if (this.form.valid) {
      this.save.emit(this.form.value);
    } else {
      this.form.markAllAsTouched();
    }
  }

  getFieldError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'This field is required';
      if (control.errors['email']) return 'Invalid email address';
      if (control.errors['minlength']) return `Min length is ${control.errors['minlength'].requiredLength}`;
    }
    return '';
  }

  onFieldBlur(field: string) {
    this.form.get(field)?.markAsTouched();
  }
}
