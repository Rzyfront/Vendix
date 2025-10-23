import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { OrganizationsService } from '../services/organizations.service';
import { Organization } from '../../../../../core/models/organization.model';

@Component({
  selector: 'app-edit-organization',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">Edit Organization</h1>
          <p class="text-sm mt-1 text-text-secondary">
            Update organization information
          </p>
        </div>
        <button
          class="px-4 py-2 rounded-lg font-medium border border-border text-text-primary hover:bg-gray-50"
          routerLink="/super-admin/organizations">
          <i class="fas fa-arrow-left mr-2"></i>
          Back to Organizations
        </button>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading" class="p-8 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Loading organization details...</p>
      </div>

      <!-- Form -->
      <div *ngIf="!isLoading && organizationForm" class="bg-white rounded-lg shadow-sm border border-border">
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
                  [class.border-red-500]="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched">
                <div
                  *ngIf="organizationForm.get('name')?.invalid && organizationForm.get('name')?.touched"
                  class="text-red-500 text-sm mt-1">
                  Organization name is required
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Description
                </label>
                <textarea
                  formControlName="description"
                  rows="3"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"></textarea>
              </div>
            </div>
          </div>

          <!-- Contact Information -->
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Contact Information</h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium mb-2 text-text-primary">
                  Email Address *
                </label>
                <input
                  type="email"
                  formControlName="email"
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
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
                  class="w-full px-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary">
              </div>
            </div>
          </div>

          <!-- Settings -->
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold mb-4 text-text-primary">Settings & Limits</h2>
            <div class="space-y-4">
              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="allowPublicStore"
                  class="rounded border-gray-300 text-primary shadow-sm focus:border-primary focus:ring focus:ring-primary/20">
                <label class="ml-2 text-sm text-text-primary">
                  Allow public store
                </label>
              </div>

              <div class="flex items-center">
                <input
                  type="checkbox"
                  formControlName="allowMultipleStores"
                  class="rounded border-gray-300 text-primary shadow-sm focus:border-primary focus:ring focus:ring-primary/20">
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
                {{ isSubmitting ? 'Saving...' : 'Save Changes' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class EditOrganizationComponent implements OnInit {
  organizationForm: FormGroup;
  organization: Organization | null = null;
  isLoading = false;
  isSubmitting = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private fb: FormBuilder,
    private organizationsService: OrganizationsService
  ) {
    this.organizationForm = this.createForm();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadOrganization(+id);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  createForm(): FormGroup {
    return this.fb.group({
      name: ['', [Validators.required]],
      description: [''],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      allowPublicStore: [true],
      allowMultipleStores: [true],
      maxStores: [5],
      maxUsers: [50]
    });
  }

  loadOrganization(id: number): void {
    this.isLoading = true;

    const sub = this.organizationsService.getOrganizationById(id).subscribe({
      next: (response) => {
        if (response.success) {
          this.organization = response.data;
          this.patchForm();
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading organization:', error);
        this.isLoading = false;
      }
    });

    this.subscriptions.push(sub);
  }

  patchForm(): void {
    if (this.organization) {
      this.organizationForm.patchValue({
        name: this.organization.name,
        description: this.organization.description,
        email: this.organization.contact.email,
        phone: this.organization.contact.phone,
        allowPublicStore: this.organization.settings.allowPublicStore,
        allowMultipleStores: this.organization.settings.allowMultipleStores,
        maxStores: this.organization.settings.maxStores,
        maxUsers: this.organization.settings.maxUsers
      });
    }
  }

  onSubmit(): void {
    if (this.organizationForm.invalid || !this.organization) {
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
    const updateDto = {
      name: formData.name,
      description: formData.description,
      contact: {
        email: formData.email,
        phone: formData.phone
      },
      settings: {
        allowPublicStore: formData.allowPublicStore,
        allowMultipleStores: formData.allowMultipleStores,
        maxStores: formData.maxStores,
        maxUsers: formData.maxUsers
      }
    };

    const sub = this.organizationsService.updateOrganization(this.organization.id, updateDto).subscribe({
      next: (response) => {
        if (response.success) {
          // TODO: Show success notification
          // TODO: Navigate to organizations list or details page
          console.log('Organization updated successfully:', response.data);
        }
        this.isSubmitting = false;
      },
      error: (error) => {
        console.error('Error updating organization:', error);
        // TODO: Show error notification
        this.isSubmitting = false;
      }
    });

    this.subscriptions.push(sub);
  }
}