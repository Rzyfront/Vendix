import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent
} from '../../../../../shared/components/index';
import { StoreListItem, UpdateStoreDto, StoreState, StoreType } from '../interfaces/store.interface';

@Component({
  selector: 'app-store-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Edit Store"
      subtitle="Update the store information"
      (openChange)="onModalChange($event)"
    >
      <form [formGroup]="storeForm" class="space-y-6" *ngIf="store">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Basic Information</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="name"
              label="Store Name"
              placeholder="Enter store name"
              [required]="true"
              [control]="storeForm.get('name')"
            ></app-input>

            <app-input
              formControlName="slug"
              label="Store Slug"
              placeholder="store-slug"
              [required]="true"
              [control]="storeForm.get('slug')"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="email"
              label="Email"
              type="email"
              placeholder="store@example.com"
              [required]="true"
              [control]="storeForm.get('email')"
            ></app-input>

            <app-input
              formControlName="phone"
              label="Phone"
              type="tel"
              placeholder="+1 (555) 123-4567"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="store_code"
              label="Store Code"
              placeholder="STORE001"
              [control]="storeForm.get('store_code')"
            ></app-input>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">
                Organization
              </label>
              <div class="px-3 py-2 border border-border rounded-input bg-gray-50 text-text-secondary">
                {{ store.organization_name }} (ID: {{ store.organization_id }})
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="website"
              label="Website"
              type="url"
              placeholder="https://example.com"
            ></app-input>

            <div class="space-y-2">
              <label for="store_type" class="block text-sm font-medium text-text-primary">
                Store Type
              </label>
              <select
                id="store_type"
                formControlName="store_type"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              >
                <option value="physical">Physical</option>
                <option value="online">Online</option>
                <option value="hybrid">Hybrid</option>
                <option value="popup">Popup</option>
                <option value="kiosko">Kiosko</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="domain"
              label="Domain"
              placeholder="store.example.com"
            ></app-input>

            <app-input
              formControlName="timezone"
              label="Timezone"
              placeholder="America/Bogota"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="currency_code"
              label="Currency Code"
              placeholder="COP"
            ></app-input>

            <app-input
              formControlName="manager_user_id"
              label="Manager User ID"
              type="number"
              placeholder="1"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="color_primary"
              label="Primary Color"
              placeholder="#FF0000"
            ></app-input>

            <app-input
              formControlName="color_secondary"
              label="Secondary Color"
              placeholder="#00FF00"
            ></app-input>
          </div>

          <div class="space-y-2">
            <label for="description" class="block text-sm font-medium text-text-primary">
              Description
            </label>
            <textarea
              id="description"
              formControlName="description"
              rows="3"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              placeholder="Brief description of the store"
            ></textarea>
          </div>
        </div>

        <!-- Address Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Address Information</h3>
          
          <div class="space-y-2">
            <label for="address" class="block text-sm font-medium text-text-primary">
              Address
            </label>
            <textarea
              id="address"
              formControlName="address"
              rows="2"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              placeholder="Store address"
            ></textarea>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="city"
              label="City"
              placeholder="New York"
            ></app-input>

            <app-input
              formControlName="country"
              label="Country"
              placeholder="United States"
            ></app-input>
          </div>
        </div>

        <!-- Store Status -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Store Status</h3>
          
          <div class="space-y-2">
            <label for="is_active" class="block text-sm font-medium text-text-primary">
              Status
            </label>
            <select
              id="is_active"
              formControlName="is_active"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
            >
              <option [ngValue]="true">Active</option>
              <option [ngValue]="false">Inactive</option>
            </select>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-text-secondary">
          <span class="text-red-500">*</span> Required fields
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
          >
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="!store || storeForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            Update Store
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class StoreEditModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() store?: StoreListItem;

  @Output() openChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<UpdateStoreDto>();
  @Output() cancel = new EventEmitter<void>();

  storeForm!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.storeForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      slug: ['', [Validators.required, Validators.minLength(2), Validators.pattern(/^[a-z0-9-]+$/)]],
      store_code: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
      address: [''],
      city: [''],
      country: [''],
      store_type: [StoreType.PHYSICAL, [Validators.required]],
      is_active: [true, [Validators.required]],
      domain: [''],
      timezone: [''],
      currency_code: [''],
      manager_user_id: [null],
      color_primary: [''],
      color_secondary: ['']
    });
  }

  ngOnChanges(): void {
    if (this.store && this.isOpen) {
      this.populateForm();
    }
  }

  private populateForm(): void {
    if (!this.store) return;

    this.storeForm.patchValue({
      name: this.store.name,
      slug: this.store.slug,
      store_code: this.store.store_code || '',
      description: '',
      email: this.store.email,
      phone: this.store.phone || '',
      website: '',
      address: '',
      city: this.store.city || '',
      country: this.store.country || '',
      store_type: this.store.store_type || StoreType.PHYSICAL,
      is_active: this.store.is_active !== undefined ? this.store.is_active : true,
      domain: '',
      timezone: '',
      currency_code: '',
      manager_user_id: null,
      color_primary: '',
      color_secondary: ''
    });
  }

  onModalChange(isOpen: boolean): void {
    this.openChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (!this.store || this.storeForm.invalid) {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.storeForm.controls).forEach(key => {
        this.storeForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formData = this.storeForm.value;
    const storeData: UpdateStoreDto = {
      name: formData.name,
      description: formData.description || undefined,
      email: formData.email,
      phone: formData.phone || undefined,
      website: formData.website || undefined,
      address: formData.address || undefined,
      city: formData.city || undefined,
      country: formData.country || undefined,
      store_type: formData.store_type as StoreType,
      is_active: formData.is_active as boolean,
      domain: formData.domain || undefined,
      timezone: formData.timezone || undefined,
      currency_code: formData.currency_code || undefined,
      manager_user_id: formData.manager_user_id || undefined,
      color_primary: formData.color_primary || undefined,
      color_secondary: formData.color_secondary || undefined
    };

    this.submit.emit(storeData);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  resetForm(): void {
    this.storeForm.reset({
      name: '',
      slug: '',
      store_code: '',
      description: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      city: '',
      country: '',
      store_type: StoreType.PHYSICAL,
      is_active: true,
      domain: '',
      timezone: '',
      currency_code: '',
      manager_user_id: null,
      color_primary: '',
      color_secondary: ''
    });
  }
}