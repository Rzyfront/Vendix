import { Component, Input, Output, EventEmitter, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../shared/components/index';
import { TemplateListItem, UpdateTemplateDto } from '../interfaces/template.interface';

@Component({
  selector: 'app-template-edit-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Edit Template"
      [subtitle]="template?.template_name"
      (isOpenChange)="onModalChange($event)"
    >
      <div *ngIf="template" class="space-y-6">
        <!-- Warning banner for system templates -->
        <div class="warning-banner">
          <div class="flex items-start gap-3">
            <app-icon name="alert-triangle" [size]="20" class="text-warning flex-shrink-0"></app-icon>
            <div>
              <h4 class="font-semibold text-warning">
                {{ template.is_system ? 'System Template' : 'Custom Template' }}
              </h4>
              <p class="text-sm text-text-secondary mt-1">
                {{ template.is_system
                  ? 'You are modifying a system template. Changes will affect all organizations using this template. This action will be logged for audit purposes.'
                  : 'You can modify all fields of this custom template.' }}
              </p>
            </div>
          </div>
        </div>

        <form [formGroup]="templateForm">
          <!-- Template Name -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-text-primary">
              Template Name *
            </label>
            <input
              type="text"
              formControlName="template_name"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
              placeholder="Enter template name"
            />
            <p class="text-xs text-text-secondary">
              Must be unique across all templates
            </p>
          </div>

          <!-- Configuration Type -->
          <div class="space-y-2">
            <label class="block text-sm font-medium text-text-primary">
              Configuration Type *
            </label>
            <select
              formControlName="configuration_type"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary"
            >
              <option value="domain">Domain</option>
              <option value="store_settings">Store Settings</option>
              <option value="ecommerce">E-commerce</option>
              <option value="payment_methods">Payment Methods</option>
              <option value="shipping">Shipping</option>
              <option value="tax">Tax</option>
              <option value="email">Email</option>
              <option value="notifications">Notifications</option>
              <option value="user_panel_ui">User Panel UI</option>
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
              Template Data (JSON)
            </label>
            <textarea
              formControlName="template_data"
              rows="10"
              class="w-full px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary font-mono text-sm json-editor"
              [class.invalid]="isJsonInvalid"
            ></textarea>
            <p *ngIf="isJsonInvalid" class="text-sm text-red-500">
              Invalid JSON format. Please check your syntax.
            </p>
          </div>

          <!-- Is Active -->
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              id="edit_is_active"
              formControlName="is_active"
              class="w-4 h-4 text-primary border-border rounded focus:ring-primary"
            />
            <label for="edit_is_active" class="text-sm font-medium text-text-primary">
              Active
            </label>
          </div>
        </form>
      </div>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-text-secondary">
          <app-icon name="shield" [size]="12"></app-icon>
          All changes will be logged for audit purposes
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onCancel()">
            Cancel
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="isJsonInvalid || isSubmitting"
            [loading]="isSubmitting"
          >
            Update Template
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class TemplateEditModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() template?: TemplateListItem;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<UpdateTemplateDto>();
  @Output() cancel = new EventEmitter<void>();

  templateForm!: FormGroup;
  isJsonInvalid = false;

  constructor(private fb: FormBuilder) {
    this.initializeForm();
  }

  private initializeForm(): void {
    this.templateForm = this.fb.group({
      template_name: ['', [Validators.required]],
      configuration_type: ['', [Validators.required]],
      description: [''],
      template_data: ['{}'],
      is_active: [true],
    });

    this.templateForm.get('template_data')?.valueChanges.subscribe((value) => {
      this.isJsonInvalid = !this.isValidJson(value);
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template'] && this.template) {
      this.templateForm.patchValue({
        template_name: this.template.template_name,
        configuration_type: this.template.configuration_type,
        description: this.template.description || '',
        template_data: JSON.stringify(this.template.template_data, null, 2),
        is_active: this.template.is_active,
      });
    }
  }

  private isValidJson(jsonString: string): boolean {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
  }

  onSubmit(): void {
    if (this.isJsonInvalid) {
      return;
    }

    const formData = this.templateForm.value;
    const templateData: UpdateTemplateDto = {
      template_name: formData.template_name,
      configuration_type: formData.configuration_type,
      description: formData.description || undefined,
      template_data: JSON.parse(formData.template_data),
      is_active: formData.is_active,
    };

    this.submit.emit(templateData);
  }

  onCancel(): void {
    this.cancel.emit();
  }

  formatConfigurationType(type: string): string {
    const typeMap: Record<string, string> = {
      domain: 'Domain',
      store_settings: 'Store Settings',
      ecommerce: 'E-commerce',
      payment_methods: 'Payment Methods',
      shipping: 'Shipping',
      tax: 'Tax',
      email: 'Email',
      notifications: 'Notifications',
      user_panel_ui: 'User Panel UI',
    };
    return typeMap[type] || type;
  }
}
