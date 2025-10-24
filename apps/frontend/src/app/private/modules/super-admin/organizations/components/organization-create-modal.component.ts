import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { ModalComponent } from '../../../../../shared/components/index';
import { CreateOrganizationDto } from '../services/organizations.service';

@Component({
  selector: 'app-organization-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Create New Organization"
      subtitle="Fill in the details to create a new organization"
      (openChange)="onModalChange($event)"
    >
      <form [formGroup]="organizationForm" class="space-y-6">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Basic Information</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="name" class="block text-sm font-medium text-text-primary">
                Organization Name <span class="text-red-500">*</span>
              </label>
              <input
                id="name"
                type="text"
                formControlName="name"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="Enter organization name"
                [class.border-red-500]="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched"
              >
              <div
                *ngIf="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched"
                class="text-red-500 text-sm mt-1"
              >
                Organization name is required
              </div>
            </div>

            <div class="space-y-2">
              <label for="email" class="block text-sm font-medium text-text-primary">
                Email <span class="text-red-500">*</span>
              </label>
              <input
                id="email"
                type="email"
                formControlName="email"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="organization@example.com"
                [class.border-red-500]="organizationForm.get('email')?.invalid && organizationForm.get('email')?.touched"
              >
              <div
                *ngIf="organizationForm.get('email')?.invalid && organizationForm.get('email')?.touched"
                class="text-red-500 text-sm mt-1"
              >
                Valid email is required
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="phone" class="block text-sm font-medium text-text-primary">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                formControlName="phone"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="+1 (555) 123-4567"
              >
            </div>

            <div class="space-y-2">
              <label for="website" class="block text-sm font-medium text-text-primary">
                Website
              </label>
              <input
                id="website"
                type="url"
                formControlName="website"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="https://example.com"
              >
            </div>
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
              placeholder="Brief description of the organization"
            ></textarea>
          </div>
        </div>

        <!-- Legal Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Legal Information</h3>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <label for="legalName" class="block text-sm font-medium text-text-primary">
                Legal Name
              </label>
              <input
                id="legalName"
                type="text"
                formControlName="legalName"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="Legal entity name"
              >
            </div>

            <div class="space-y-2">
              <label for="taxId" class="block text-sm font-medium text-text-primary">
                Tax ID
              </label>
              <input
                id="taxId"
                type="text"
                formControlName="taxId"
                class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
                placeholder="Tax identification number"
              >
            </div>
          </div>
        </div>

        <!-- Organization Status -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Organization Status</h3>
          
          <div class="space-y-2">
            <label for="state" class="block text-sm font-medium text-text-primary">
              Initial Status
            </label>
            <select
              id="state"
              formControlName="state"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-text-secondary">
          <span class="text-red-500">*</span> Required fields
        </div>
        <div class="flex gap-3">
          <button
            type="button"
            class="px-4 py-2 border border-border text-text-primary rounded-button hover:bg-muted/20 transition-colors"
            (click)="onCancel()"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 bg-primary text-surface rounded-button hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            (click)="onSubmit()"
            [disabled]="organizationForm.invalid || isSubmitting"
          >
            <span *ngIf="!isSubmitting">Create Organization</span>
            <span *ngIf="isSubmitting" class="flex items-center">
              <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-surface" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating...
            </span>
          </button>
        </div>
      </div>
    </app-modal>
  `
})
export class OrganizationCreateModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;

  @Output() openChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<CreateOrganizationDto>();
  @Output() cancel = new EventEmitter<void>();

  organizationForm!: FormGroup;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.organizationForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
      description: [''],
      legalName: [''],
      taxId: [''],
      state: ['active']
    });
  }

  onModalChange(isOpen: boolean): void {
    this.openChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.organizationForm.invalid) {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.organizationForm.controls).forEach(key => {
        this.organizationForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formData = this.organizationForm.value;
    const organizationData: CreateOrganizationDto = {
      name: formData.name,
      email: formData.email,
      phone: formData.phone || undefined,
      website: formData.website || undefined,
      description: formData.description || undefined,
      legal_name: formData.legalName || undefined,
      tax_id: formData.taxId || undefined,
      state: formData.state
    };

    this.submit.emit(organizationData);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  resetForm(): void {
    this.organizationForm.reset({
      name: '',
      email: '',
      phone: '',
      website: '',
      description: '',
      legalName: '',
      taxId: '',
      state: 'active'
    });
  }
}