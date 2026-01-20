import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
} from '../../../../../shared/components/index';
import { CreateTemplateDto, TemplateConfigType } from '../interfaces/template.interface';

const CONFIGURATION_TYPES: Array<{ value: TemplateConfigType; label: string }> = [
  { value: 'domain', label: 'Domain' },
  { value: 'store_settings', label: 'Store Settings' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'payment_methods', label: 'Payment Methods' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'tax', label: 'Tax' },
  { value: 'email', label: 'Email' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'user_panel_ui', label: 'User Panel UI' },
];

@Component({
  selector: 'app-template-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Create New Template"
      subtitle="Configure a new template for the system"
    >
      <form [formGroup]="templateForm" class="space-y-6">
        <!-- Template Name -->
        <app-input
          formControlName="template_name"
          label="Template Name"
          placeholder="Enter unique template name"
          [required]="true"
          [control]="templateForm.get('template_name')"
        ></app-input>

        <!-- Configuration Type -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-text-primary">
            Configuration Type <span class="text-red-500">*</span>
          </label>
          <select
            formControlName="configuration_type"
            class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
          >
            <option value="">Select type...</option>
            <option *ngFor="let type of configurationTypes" [value]="type.value">
              {{ type.label }}
            </option>
          </select>
        </div>

        <!-- Description -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-text-primary">
            Description
          </label>
          <textarea
            formControlName="description"
            rows="3"
            class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
            placeholder="Describe what this template is for"
          ></textarea>
        </div>

        <!-- Template Data (JSON) -->
        <div class="space-y-2">
          <label class="block text-sm font-medium text-text-primary">
            Template Data (JSON) <span class="text-red-500">*</span>
          </label>
          <textarea
            formControlName="template_data"
            rows="10"
            class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary font-mono text-sm json-editor"
            placeholder='{"key": "value"}'
            [class.invalid]="isJsonInvalid"
          ></textarea>
          <p *ngIf="isJsonInvalid" class="text-sm text-red-500">
            Invalid JSON format. Please check your syntax.
          </p>
          <p class="text-sm text-text-secondary">
            Enter valid JSON configuration for the template.
          </p>
        </div>

        <!-- Is Active -->
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_active"
            formControlName="is_active"
            class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
          />
          <label for="is_active" class="text-sm font-medium text-text-primary">
            Active
          </label>
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
            [disabled]="templateForm.invalid || isJsonInvalid || isSubmitting"
            [loading]="isSubmitting"
          >
            Create Template
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class TemplateCreateModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<CreateTemplateDto>();
  @Output() cancel = new EventEmitter<void>();

  templateForm!: FormGroup;
  configurationTypes = CONFIGURATION_TYPES;
  isJsonInvalid = false;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.templateForm = this.fb.group({
      template_name: ['', [Validators.required, Validators.minLength(2)]],
      configuration_type: ['', [Validators.required]],
      description: [''],
      template_data: ['{}', [Validators.required]],
      is_active: [true],
    });

    // Watch for JSON changes
    this.templateForm.get('template_data')?.valueChanges.subscribe((value) => {
      this.isJsonInvalid = !this.isValidJson(value);
    });
  }

  private isValidJson(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  onSubmit(): void {
    if (this.templateForm.invalid || this.isJsonInvalid) {
      Object.keys(this.templateForm.controls).forEach((key) => {
        this.templateForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formData = this.templateForm.value;
    const templateData: CreateTemplateDto = {
      template_name: formData.template_name,
      configuration_type: formData.configuration_type,
      template_data: JSON.parse(formData.template_data),
      description: formData.description || undefined,
      is_active: formData.is_active,
    };

    this.submit.emit(templateData);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  resetForm(): void {
    this.templateForm.reset({
      template_name: '',
      configuration_type: '',
      description: '',
      template_data: '{}',
      is_active: true,
    });
    this.isJsonInvalid = false;
  }
}
