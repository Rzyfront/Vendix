import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, OnInit, inject } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  SettingToggleComponent,
  SelectorComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { Supplier, CreateSupplierDto, UpdateSupplierDto } from '../../interfaces';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { CurrencyService } from '../../../../../../services/currency.service';

@Component({
  selector: 'app-supplier-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SettingToggleComponent,
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="supplier ? 'Editar Proveedor' : 'Nuevo Proveedor'"
      subtitle="Administra la información del proveedor"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Basic Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Código *"
              formControlName="code"
              placeholder="Ej: PROV-001"
              [error]="getError('code')"
            ></app-input>
            <app-input
              label="Nombre *"
              formControlName="name"
              placeholder="Nombre del proveedor"
              [error]="getError('name')"
            ></app-input>
          </div>

          <!-- Contact Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Persona de Contacto"
              formControlName="contact_person"
              placeholder="Nombre del contacto"
            ></app-input>
            <app-input
              label="Email"
              formControlName="email"
              type="email"
              placeholder="email@ejemplo.com"
              [error]="getError('email')"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Teléfono"
              formControlName="phone"
              type="tel"
              placeholder="+1 234 567 890"
            ></app-input>
            <app-input
              label="Móvil"
              formControlName="mobile"
              type="tel"
              placeholder="+1 234 567 890"
            ></app-input>
          </div>

          <!-- Business Info -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Sitio Web"
              formControlName="website"
              placeholder="https://ejemplo.com"
            ></app-input>
            <app-input
              label="ID Fiscal / NIT"
              formControlName="tax_id"
              placeholder="123-456-789"
            ></app-input>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <app-input
              label="Términos de Pago"
              formControlName="payment_terms"
              placeholder="Ej: Net 30"
            ></app-input>
            <app-selector
              label="Moneda"
              formControlName="currency"
              [options]="currencyOptions"
              placeholder="Seleccionar"
            ></app-selector>
            <app-input
              label="Días de Entrega"
              formControlName="lead_time_days"
              type="number"
              placeholder="15"
            ></app-input>
          </div>

          <!-- Notes -->
          <app-textarea
            label="Notas"
            formControlName="notes"
            [rows]="2"
            placeholder="Notas adicionales sobre este proveedor..."
            [control]="form.get('notes')"
          ></app-textarea>

          <!-- Active Toggle -->
          <app-setting-toggle
            formControlName="is_active"
            label="Proveedor activo"
            description="Desactiva para ocultar este proveedor de las listas"
          ></app-setting-toggle>
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
export class SupplierFormModalComponent implements OnChanges, OnInit {
  private currencyFormatService = inject(CurrencyFormatService);
  private currencyHttpService = inject(CurrencyService);
  @Input() isOpen = false;
  @Input() supplier: Supplier | null = null;
  @Input() isSubmitting = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateSupplierDto | UpdateSupplierDto>();

  currencyOptions: { value: string; label: string }[] = [];

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
  }

  async ngOnInit(): Promise<void> {
    await this.loadCurrencyOptions();
  }

  private async loadCurrencyOptions(): Promise<void> {
    try {
      const currencies = await this.currencyHttpService.getActiveCurrencies();
      this.currencyOptions = currencies.map((c) => ({
        value: c.code,
        label: `${c.name} (${c.code})`,
      }));
    } catch {
      this.currencyOptions = [
        { value: 'COP', label: 'Peso Colombiano (COP)' },
        { value: 'USD', label: 'Dólar Americano (USD)' },
      ];
    }
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
      currency: [this.currencyFormatService.currencyCode() || 'COP'],
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
      currency: supplier.currency || this.currencyFormatService.currencyCode() || 'COP',
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
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    // TODO: The 'emit' function requires a mandatory void argument
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.valid) {
      this.save.emit(this.form.value);
    }
  }
}
