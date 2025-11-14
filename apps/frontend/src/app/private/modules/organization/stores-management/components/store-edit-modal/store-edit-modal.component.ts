import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store, StoreSettings } from '../../interfaces/store.interface';

@Component({
  selector: 'app-store-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './store-edit-modal.component.html',
  styleUrls: ['./store-edit-modal.component.scss']
})
export class StoreEditModalComponent {
  @Input() store: Store | null = null;
  @Input() isVisible: boolean = false;
  @Input() isLoading: boolean = false;
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<Store>;

  editForm: FormGroup;
  settingsForm: FormGroup;

  constructor(private fb: FormBuilder) {
    this.editForm = this.fb.group({
      id: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      domain: ['', [Validators.required, Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      address: this.fb.group({
        street: [''],
        city: [''],
        state: [''],
        zipCode: [''],
        country: ['']
      }),
      status: ['active', Validators.required],
      logoUrl: [''],
      bannerUrl: ['']
    });

    this.settingsForm = this.fb.group({
      allowGuestCheckout: [true],
      requireEmailVerification: [false],
      enableInventoryTracking: [true],
      lowStockThreshold: [10],
      enableTaxCalculation: [true],
      taxRate: [0],
      enableShipping: [true],
      freeShippingThreshold: [0],
      currency: ['USD'],
      timezone: ['UTC'],
      language: ['en']
    });
  }

  ngOnChanges(): void {
    if (this.store) {
      this.editForm.patchValue({
        id: this.store.id,
        name: this.store.name,
        description: this.store.description || '',
        domain: this.store.domain,
        email: this.store.email,
        phone: this.store.phone || '',
        address: {
          street: (typeof this.store.address === 'object' ? this.store.address?.street : '') || '',
          city: (typeof this.store.address === 'object' ? this.store.address?.city : '') || '',
          state: (typeof this.store.address === 'object' ? this.store.address?.state : '') || '',
          zipCode: (typeof this.store.address === 'object' ? this.store.address?.zipCode : '') || '',
          country: (typeof this.store.address === 'object' ? this.store.address?.country : '') || ''
        },
        status: this.store.status,
        logoUrl: this.store.logo_url || '',
        bannerUrl: this.store.banner_url || ''
      });

      if (this.store.settings) {
        this.settingsForm.patchValue(this.store.settings);
      }
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onSave(): void {
    if (this.editForm.valid && this.settingsForm.valid) {
      const updatedStore: Store = {
        ...this.store,
        ...this.editForm.value,
        settings: this.settingsForm.value
      };
      this.save.emit(updatedStore);
    }
  }

  // Getters para validación
  get f() { return this.editForm.controls; }
  get sf() { return this.settingsForm.controls; }

  // Validación de formulario
  isFieldInvalid(fieldName: string, formGroup: string = 'edit'): boolean {
    const form = formGroup === 'edit' ? this.editForm : this.settingsForm;
    const field = form.get(fieldName);
    return field ? field.invalid && (field.dirty || field.touched) : false;
  }

  getErrorMessage(fieldName: string, formGroup: string = 'edit'): string {
    const form = formGroup === 'edit' ? this.editForm : this.settingsForm;
    const field = form.get(fieldName);

    if (!field) return '';

    if (field.errors?.['required']) return 'This field is required';
    if (field.errors?.['minlength']) return `Minimum ${field.errors['minlength'].requiredLength} characters`;
    if (field.errors?.['email']) return 'Please enter a valid email';
    if (field.errors?.['pattern']) return 'Invalid format';

    return 'Invalid field';
  }
}