import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  ToggleComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { Supplier, CreateSupplierDto, UpdateSupplierDto } from '../../interfaces';

@Component({
  selector: 'app-supplier-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [title]="supplier ? 'Editar Proveedor' : 'Nuevo Proveedor'"
      subtitle="Administra la información del proveedor"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-6">
          <!-- Basic Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Código *</label>
              <app-input
                formControlName="code"
                placeholder="Ej: PROV-001"
                [error]="getError('code')"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Nombre *</label>
              <app-input
                formControlName="name"
                placeholder="Nombre del proveedor"
                [error]="getError('name')"
              ></app-input>
            </div>
          </div>

          <!-- Contact Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Persona de Contacto</label>
              <app-input
                formControlName="contact_person"
                placeholder="Nombre del contacto"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Email</label>
              <app-input
                formControlName="email"
                type="email"
                placeholder="email@ejemplo.com"
                [error]="getError('email')"
              ></app-input>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Teléfono</label>
              <app-input
                formControlName="phone"
                placeholder="+1 234 567 890"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Móvil</label>
              <app-input
                formControlName="mobile"
                placeholder="+1 234 567 890"
              ></app-input>
            </div>
          </div>

          <!-- Business Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Sitio Web</label>
              <app-input
                formControlName="website"
                placeholder="https://ejemplo.com"
              ></app-input>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">ID Fiscal / NIT</label>
              <app-input
                formControlName="tax_id"
                placeholder="123-456-789"
              ></app-input>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Términos de Pago</label>
              <app-input
                formControlName="payment_terms"
                placeholder="Ej: Net 30"
              ></app-input>
            </div>
            <div class="mt-4 w-full">
              <label class="block text-sm font-medium text-text-secondary mb-1">Moneda</label>
              <app-selector
                formControlName="currency"
                [options]="currencyOptions"
                placeholder="Seleccionar"
              ></app-selector>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1">Días de Entrega Habil</label>
              <app-input
                formControlName="lead_time_days"
                type="number"
                placeholder="15"
              ></app-input>
            </div>
          </div>

          <!-- Notes -->
          <app-textarea
            label="Notas"
            formControlName="notes"
            [rows]="3"
            placeholder="Notas adicionales sobre este proveedor..."
            [control]="form.get('notes')"
          ></app-textarea>

          <!-- Active Toggle -->
          <div class="flex items-center gap-3">
            <app-toggle formControlName="is_active"></app-toggle>
            <span class="text-sm text-text-secondary">Proveedor activo</span>
          </div>
        </div>
      </form>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" type="button" (clicked)="onCancel()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="button"
            [loading]="isSubmitting"
            [disabled]="form.invalid || isSubmitting"
            (clicked)="onSubmit()"
          >
            {{ supplier ? 'Guardar Cambios' : 'Crear Proveedor' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class SupplierFormModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() supplier: Supplier | null = null;
  @Input() isSubmitting = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateSupplierDto | UpdateSupplierDto>();

  currencyOptions = [
    { value: 'COP', label: 'Peso colombiano (COP)' },
    { value: 'USD', label: 'Dolar (USD)' }
  ];

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['supplier'] && this.supplier) {
      this.patchForm(this.supplier);
    } else if (changes['isOpen'] && this.isOpen && !this.supplier) {
      this.form.reset({ is_active: true });
    }
  }

  private createForm(): FormGroup {
    return this.fb.group({
      code: ['', [Validators.required, Validators.maxLength(50)]],
      name: ['', [Validators.required, Validators.maxLength(200)]],
      contact_person: [''],
      email: ['', [Validators.email]],
      phone: [''],
      mobile: [''],
      website: [''],
      tax_id: [''],
      payment_terms: [''],
      currency: ['COP'],
      lead_time_days: [null],
      notes: [''],
      is_active: [true],
    });
  }

  private patchForm(supplier: Supplier): void {
    this.form.patchValue({
      code: supplier.code,
      name: supplier.name,
      contact_person: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      mobile: supplier.mobile || '',
      website: supplier.website || '',
      tax_id: supplier.tax_id || '',
      payment_terms: supplier.payment_terms || '',
      currency: supplier.currency || 'COP',
      lead_time_days: supplier.lead_time_days || null,
      notes: supplier.notes || '',
      is_active: supplier.is_active,
    });
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['email']) return 'Email inválido';
      if (control.errors['maxlength']) return 'Texto demasiado largo';
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.valid) {
      this.save.emit(this.form.value);
    }
  }
}
