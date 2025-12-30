import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
} from '../../../../../shared/components/index';
import { OrganizationListItem } from '../interfaces/organization.interface';

@Component({
  selector: 'app-organization-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Edit Organization"
      subtitle="Update the organization information"
      (isOpenChange)="onModalChange($event)"
    >
      <form [formGroup]="organizationForm" class="space-y-6">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Basic Information
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="name"
              label="Organization Name"
              placeholder="Enter organization name"
              [required]="true"
              [control]="organizationForm.get('name')"
            ></app-input>

            <app-input
              formControlName="email"
              label="Email"
              type="email"
              placeholder="organization@example.com"
              [required]="true"
              [control]="organizationForm.get('email')"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="phone"
              label="Phone"
              type="tel"
              placeholder="+1 (555) 123-4567"
            ></app-input>

            <app-input
              formControlName="website"
              label="Website"
              type="url"
              placeholder="https://example.com"
            ></app-input>
          </div>

          <div class="space-y-2">
            <label
              for="description"
              class="block text-sm font-medium text-text-primary"
            >
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
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Legal Information
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="legalName"
              label="Legal Name"
              placeholder="Legal entity name"
            ></app-input>

            <app-input
              formControlName="taxId"
              label="Tax ID"
              placeholder="Tax identification number"
            ></app-input>
          </div>
        </div>

        <!-- Organization Status -->
        <div class="space-y-4">
          <h3
            class="text-lg font-semibold text-text-primary border-b border-border pb-2"
          >
            Organization Status
          </h3>

          <div class="space-y-2">
            <label
              for="state"
              class="block text-sm font-medium text-text-primary"
            >
              Status
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
          <app-button variant="outline" (clicked)="onCancel()">
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="organizationForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            Update Organization
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class OrganizationEditModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() organization?: OrganizationListItem;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<any>();
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
      state: ['active'],
    });
  }

  ngOnChanges(): void {
    if (this.organization && this.organizationForm) {
      this.organizationForm.patchValue({
        name: this.organization.name,
        email: this.organization.email,
        phone: '',
        website: '',
        description: '',
        legalName: '',
        taxId: '',
        state: this.organization.status,
      });
    }
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onSubmit(): void {
    if (this.organizationForm.invalid) {
      // Mark all fields as touched to trigger validation messages
      Object.keys(this.organizationForm.controls).forEach((key) => {
        this.organizationForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formData = this.organizationForm.value;
    const organizationData = {
      id: this.organization?.id,
      name: formData.name,
      email: formData.email,
      phone: formData.phone || undefined,
      website: formData.website || undefined,
      description: formData.description || undefined,
      legal_name: formData.legalName || undefined,
      tax_id: formData.taxId || undefined,
      state: formData.state,
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
      state: 'active',
    });
  }
}
