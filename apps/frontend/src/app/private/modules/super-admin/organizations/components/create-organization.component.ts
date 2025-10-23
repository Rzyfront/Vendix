import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { OrganizationsService } from '../services/organizations.service';
import { CreateOrganizationForm } from '../interfaces/organization.interface';

@Component({
  selector: 'app-create-organization',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  providers: [OrganizationsService],
  template: `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">Create Organization</h1>
          <p class="text-sm mt-1 text-text-secondary">
            Add a new organization to the platform
          </p>
        </div>
        <button
          class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
          routerLink="/super-admin/organizations">
          <i class="fas fa-arrow-left mr-2"></i>
          Back to Organizations
        </button>
      </div>

      <!-- Form -->
      <div class="bg-white rounded-lg shadow-sm border border-border">
        <form [formGroup]="organizationForm" (ngSubmit)="onSubmit()">
          <!-- Basic Information -->
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Basic Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Organization Name *
                </label>
                <input
                  type="text"
                  formControlName="name"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Enter organization name"
                  [class.border-red-500]="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched">
                <div
                  *ngIf="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched"
                  class="text-red-500 text-sm mt-1">
                  Organization name is required
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Email Address *
                </label>
                <input
                  type="email"
                  formControlName="email"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="org@example.com"
                  [class.border-red-500]="organizationForm.get('email')?.invalid && organizationForm.get('email')?.touched">
                <div
                  *ngIf="organizationForm.get('email')?.invalid && organizationForm.get('email')?.touched"
                  class="text-red-500 text-sm mt-1">
                  Valid email address is required
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Phone Number
                </label>
                <input
                  type="tel"
                  formControlName="phone"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="+1 (555) 123-4567">
              </div>

              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Website
                </label>
                <input
                  type="url"
                  formControlName="website"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="https://example.com">
              </div>

              <div class="md:col-span-2">
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Description
                </label>
                <textarea
                  formControlName="description"
                  rows="3"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Brief description of the organization"></textarea>
              </div>
            </div>
          </div>

          <!-- Legal Information -->
          <div class="p-6 border-b" style="border-color: var(--border);">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Legal Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Legal Name
                </label>
                <input
                  type="text"
                  formControlName="legalName"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Legal business name">
              </div>

              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Tax ID
                </label>
                <input
                  type="text"
                  formControlName="taxId"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  placeholder="Tax identification number">
              </div>
            </div>
          </div>

          <!-- Settings -->
          <div class="p-6 border-b" style="border-color: var(--border);">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Settings & Limits</h2>
            <div class="space-y-4">
              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="allowPublicStore"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Allow public store
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="allowMultipleStores"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Allow multiple stores
                </label>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium mb-2 text-text-primary">
                    Maximum Stores
                  </label>
                  <input
                    type="number"
                    formControlName="maxStores"
                    min="1"
                    class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary">
                </div>

                <div>
                  <label class="block text-sm font-medium mb-2 text-text-primary">
                    Maximum Users
                  </label>
                  <input
                    type="number"
                    formControlName="maxUsers"
                    min="1"
                    class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary">
                </div>
              </div>
            </div>
          </div>

          <!-- Features -->
          <div class="p-6 border-b" style="border-color: var(--border);">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Features</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.ecommerce"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  E-commerce
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.inventory"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Inventory Management
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.analytics"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Analytics
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.multiCurrency"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Multi-Currency
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.taxManagement"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Tax Management
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="features.shippingManagement"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                <label class="ml-2 text-sm text-text-primary">
                  Shipping Management
                </label>
              </div>
            </div>
          </div>

          <!-- Form Actions -->
          <div class="p-6 bg-gray-50 rounded-b-lg">
            <div class="flex justify-end gap-3">
              <button
                type="button"
                class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
                routerLink="/super-admin/organizations">
                Cancel
              </button>
              <button
                type="submit"
                class="px-4 py-2 rounded-lg text-white font-medium bg-primary hover:bg-primary/90 disabled:opacity-50"
                [disabled]="organizationForm.invalid || isSubmitting">
                <i *ngIf="isSubmitting" class="fas fa-spinner fa-spin mr-2"></i>
                <i *ngIf="!isSubmitting" class="fas fa-save mr-2"></i>
                {{ isSubmitting ? 'Creating...' : 'Create Organization' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `
})
export class CreateOrganizationComponent implements OnInit {
  organizationForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private organizationsService: OrganizationsService
  ) {
    this.organizationForm = this.createForm();
  }

  ngOnInit(): void {
    // Set default values
    this.organizationForm.patchValue({
      maxStores: 5,
      maxUsers: 50,
      allowPublicStore: true,
      allowMultipleStores: true,
      features: {
        ecommerce: true,
        inventory: true,
        analytics: true,
        multiCurrency: false,
        taxManagement: true,
        shippingManagement: true
      }
    });
  }

  createForm(): FormGroup {
    return this.fb.group({
      // Basic Information
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      website: [''],
      description: [''],

      // Legal Information
      legalName: [''],
      taxId: [''],

      // Settings
      allowPublicStore: [true],
      allowMultipleStores: [true],
      maxStores: [5],
      maxUsers: [50],

      // Features
      features: this.fb.group({
        ecommerce: [true],
        inventory: [true],
        analytics: [true],
        multiCurrency: [false],
        taxManagement: [true],
        shippingManagement: [true]
      })
    });
  }

  onSubmit(): void {
    if (this.organizationForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.organizationForm.controls).forEach(key => {
        const control = this.organizationForm.get(key);
        if (control) {
          control.markAsTouched();
        }
      });
      return;
    }

    this.isSubmitting = true;

    const formData = this.organizationForm.value;

    // Map form data to match the backend DTO structure
    const createDto = {
      name: formData.name,
      email: formData.email,
      ...(formData.phone && { phone: formData.phone }),
      ...(formData.website && { website: formData.website }),
      ...(formData.description && { description: formData.description }),
      ...(formData.legalName && { legal_name: formData.legalName }),
      ...(formData.taxId && { tax_id: formData.taxId }),
      state: 'active' as const
    };

    this.organizationsService.createOrganization(createDto).subscribe({
      next: (response) => {
        if (response.success) {
          // TODO: Show success notification
          // TODO: Navigate to organizations list or details page
          console.log('Organization created successfully:', response.data);
        }
        this.isSubmitting = false;
      },
      error: (error) => {
        console.error('Error creating organization:', error);
        // TODO: Show error notification
        this.isSubmitting = false;
      }
    });
  }
}