import { Component, input, output, effect, inject } from '@angular/core';

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
import {
  Supplier,
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierCategory,
} from '../../interfaces';
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
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="supplier() ? 'Editar Proveedor' : 'Nuevo Proveedor'"
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

          <!-- Fiscal Classification ("el QUIEN" — Colombian withholdings) -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-selector
              label="Régimen Tributario"
              formControlName="tax_regime"
              [options]="taxRegimeOptions"
              placeholder="Seleccionar"
            ></app-selector>
            <app-selector
              label="Tipo de Persona"
              formControlName="person_type"
              [options]="personTypeOptions"
              placeholder="Seleccionar"
            ></app-selector>
          </div>

          <app-setting-toggle
            formControlName="is_self_withholder"
            label="¿Es autorretenedor?"
            description="Marca si este proveedor se practica sus propias retenciones"
          ></app-setting-toggle>

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

          <!-- Plan Despacho Economía — FASE 1 paso 7.
               Categoría transportista + banco destino del pago inmediato
               al cerrar la ruta (paso 17). El bloque banco se muestra solo
               cuando la categoría es 'carrier'. -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 border-t pt-3">
            <app-selector
              label="Categoría"
              formControlName="supplier_category"
              [options]="supplierCategoryOptions"
              placeholder="Seleccionar"
            ></app-selector>
            <div></div>
          </div>

          @if (form.get('supplier_category')?.value === 'carrier') {
            <div class="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-3 space-y-3">
              <p class="text-xs text-amber-800 font-medium">
                Datos bancarios del transportista (requeridos para liquidar rutas de despacho)
              </p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <app-input
                  label="Banco"
                  formControlName="bank_name"
                  placeholder="Ej: Bancolombia"
                ></app-input>
                <app-input
                  label="Número de Cuenta"
                  formControlName="bank_account_number"
                  placeholder="000-000000-00"
                ></app-input>
              </div>
              <app-selector
                label="Tipo de Cuenta"
                formControlName="bank_account_type"
                [options]="bankAccountTypeOptions"
                placeholder="Seleccionar"
              ></app-selector>
            </div>
          }

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
            [loading]="isSubmitting()"
            [disabled]="form.invalid || isSubmitting()"
            (clicked)="onSubmit()"
          >
            {{ supplier() ? 'Guardar Cambios' : 'Crear Proveedor' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class SupplierFormModalComponent {
  private currencyFormatService = inject(CurrencyFormatService);
  private currencyHttpService = inject(CurrencyService);
  readonly isOpen = input(false);
  readonly supplier = input<Supplier | null>(null);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateSupplierDto | UpdateSupplierDto>();

  currencyOptions: { value: string; label: string }[] = [];

  // Fiscal classification options (Colombian withholdings — "el QUIEN")
  readonly taxRegimeOptions: { value: string; label: string }[] = [
    { value: 'COMUN', label: 'Régimen Común' },
    { value: 'SIMPLIFICADO', label: 'Régimen Simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
  ];

  readonly personTypeOptions: { value: string; label: string }[] = [
    { value: 'NATURAL', label: 'Persona Natural' },
    { value: 'JURIDICA', label: 'Persona Jurídica' },
  ];

  // Plan Despacho Economía — FASE 1 paso 7.
  readonly supplierCategoryOptions: { value: SupplierCategory; label: string }[] = [
    { value: 'goods', label: 'Bienes / Insumos' },
    { value: 'carrier', label: 'Transportista' },
    { value: 'service', label: 'Servicios' },
  ];

  readonly bankAccountTypeOptions: { value: string; label: string }[] = [
    { value: 'savings', label: 'Ahorros' },
    { value: 'checking', label: 'Corriente' },
  ];

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
    this.loadCurrencyOptions();
    effect(() => {
      const sup = this.supplier();
      const isOpen = this.isOpen();
      if (sup) {
        this.patchForm(sup);
      } else if (isOpen && !sup) {
        this.form.reset({ is_active: true, is_self_withholder: false });
      }
    });
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
      tax_regime: [''],
      person_type: [''],
      is_self_withholder: [false],
      payment_terms: [''],
      currency: [this.currencyFormatService.currencyCode() || 'COP'],
      lead_time_days: [null],
      notes: [''],
      // Plan Despacho Economía — FASE 1 paso 7.
      supplier_category: ['goods' as SupplierCategory],
      bank_name: [''],
      bank_account_number: [''],
      bank_account_type: [''],
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
      tax_regime: supplier.tax_regime || '',
      person_type: supplier.person_type || '',
      is_self_withholder: supplier.is_self_withholder ?? false,
      payment_terms: supplier.payment_terms || '',
      currency: supplier.currency || this.currencyFormatService.currencyCode() || 'COP',
      lead_time_days: supplier.lead_time_days || null,
      notes: supplier.notes || '',
      supplier_category: (supplier.supplier_category ?? 'goods') as SupplierCategory,
      bank_name: supplier.bank_name || '',
      bank_account_number: supplier.bank_account_number || '',
      bank_account_type: supplier.bank_account_type || '',
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
