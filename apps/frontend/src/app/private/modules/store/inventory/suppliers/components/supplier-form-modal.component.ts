import {
  Component,
  computed,
  input,
  output,
  effect,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../../../../../../shared/components/address-form-fields/address-form-fields.component';
import {
  DOCUMENT_TYPE_NIT_CODE,
  DOCUMENT_TYPE_OPTIONS,
} from '../../../invoicing/components/invoice-create/invoice-dian-catalogs';

// Interfaces
import {
  Supplier,
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierCategory,
  SupplierAddressInput,
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
    SelectorComponent,
    AddressFormFieldsComponent,
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

          <!-- Datos fiscales: lo que exige el documento soporte (DIAN) -->
          <div class="border-t pt-3 space-y-3">
            <p class="text-sm font-semibold text-gray-800">Datos fiscales</p>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="md:col-span-2">
                <app-selector
                  label="Tipo de documento"
                  formControlName="document_type"
                  [options]="documentTypeOptions"
                  placeholder="Seleccionar"
                ></app-selector>
              </div>
              <app-input
                label="DV"
                formControlName="verification_digit"
                placeholder="Solo NIT"
                [helperText]="isNit() ? 'Dígito de verificación del NIT' : 'Aplica solo para NIT'"
                [error]="getError('verification_digit')"
              ></app-input>
            </div>
            <p class="text-xs text-gray-500">
              Dirección fiscal del proveedor (departamento y municipio DIAN).
            </p>
            <app-address-form-fields
              [initialAddress]="initialAddress()"
              [showPhone]="false"
              (addressChange)="onAddressChange($event)"
            />
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

          <!-- Estado: solo activo ↔ inactivo. Archivar va por "Eliminar". -->
          @if (isArchived()) {
            <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <p class="text-sm text-gray-700">
                Este proveedor está <strong>archivado</strong>: no aparece en
                listados ni selectores. Puedes corregir sus datos sin
                desarchivarlo.
              </p>
            </div>
          } @else {
            <app-setting-toggle
              formControlName="is_active"
              label="Proveedor activo"
              description="Al desactivarlo sigue visible en el listado, pero nadie podrá seleccionarlo en órdenes de compra, remisiones ni rutas"
            ></app-setting-toggle>
          }
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

  /**
   * Un archivado se puede editar (corregir datos) pero su estado no se toca
   * desde este formulario: desarchivar es una decisión explícita, no un efecto
   * secundario de guardar.
   */
  readonly isArchived = computed(() => this.supplier()?.state === 'archived');
  readonly isSubmitting = input(false);

  /** Catálogo DIAN de tipos de documento (mismo de facturación). */
  readonly documentTypeOptions = DOCUMENT_TYPE_OPTIONS;
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentType = signal<string | null>(null);
  /** El DV solo existe para el NIT colombiano. */
  readonly isNit = computed(() => this.documentType() === DOCUMENT_TYPE_NIT_CODE);

  /** Dirección del proveedor en edición, en la forma que consume el formulario compartido. */
  readonly initialAddress = computed<AddressPayload | null>(() => {
    const a = this.supplier()?.addresses;
    if (!a) return null;
    return {
      address_line1: a.address_line1 ?? null,
      address_line2: a.address_line2 ?? null,
      city: a.city ?? null,
      state_province: a.state_province ?? null,
      country_code: a.country_code ?? 'CO',
      postal_code: a.postal_code ?? null,
      phone_number: null,
      latitude: null,
      longitude: null,
      municipality_code: a.municipality_code ?? null,
    };
  });
  private readonly currentAddress = signal<AddressPayload | null>(null);

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
    this.form
      .get('document_type')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.syncVerificationDigit(value));
    effect(() => {
      const sup = this.supplier();
      const isOpen = this.isOpen();
      this.currentAddress.set(null);
      if (sup) {
        this.patchForm(sup);
      } else if (isOpen && !sup) {
        this.form.reset({ is_active: true, is_self_withholder: false });
        this.syncVerificationDigit(null);
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
      document_type: [''],
      verification_digit: [{ value: '', disabled: true }, [Validators.pattern(/^\d?$/)]],
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
      document_type: supplier.document_type || '',
      verification_digit: supplier.verification_digit || '',
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
      // El toggle es booleano: on = active, off = inactive. Un archivado se
      // muestra como inactivo pero el toggle queda oculto (ver template).
      is_active: supplier.state === 'active',
    });
    this.syncVerificationDigit(supplier.document_type ?? null);
  }

  /** Habilita el DV solo con NIT; con otro tipo se limpia y no se envía. */
  private syncVerificationDigit(documentType: string | null): void {
    this.documentType.set(documentType || null);
    const dv = this.form.get('verification_digit')!;
    if (documentType === DOCUMENT_TYPE_NIT_CODE) {
      dv.enable({ emitEvent: false });
    } else {
      dv.reset('', { emitEvent: false });
      dv.disable({ emitEvent: false });
    }
  }

  onAddressChange(address: AddressPayload): void {
    this.currentAddress.set(address);
  }

  /** Solo se envía dirección cuando hay datos mínimos (línea y ciudad). */
  private buildAddress(): SupplierAddressInput | undefined {
    const a = this.currentAddress() ?? this.initialAddress();
    if (!a?.address_line1?.trim() || !a.city?.trim()) return undefined;
    const clean = (v?: string | null) => (v?.trim() ? v.trim() : undefined);
    return {
      address_line1: a.address_line1.trim(),
      address_line2: clean(a.address_line2),
      city: a.city.trim(),
      state_province: clean(a.state_province),
      country_code: clean(a.country_code) ?? 'CO',
      postal_code: clean(a.postal_code),
      municipality_code: clean(a.municipality_code),
    };
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['email']) return 'Email inválido';
      if (control.errors['maxlength']) return 'Texto demasiado largo';
      if (control.errors['pattern']) return 'Debe ser un solo dígito';
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (!this.form.valid) return;

    const { is_active, ...fields } = this.form.value as Record<string, any>;
    // Los selectores vacíos llegan como '': no se envían (el DTO valida el catálogo).
    const rest: Record<string, any> = { ...fields };
    if (!rest['document_type']) delete rest['document_type'];
    if (!rest['verification_digit']) delete rest['verification_digit'];
    const address = this.buildAddress();
    if (address) rest['address'] = address;

    // Un proveedor archivado se edita sin tocar su estado: el toggle está
    // oculto y mandar `state` aquí lo desarchivaría en silencio. Reactivarlo
    // es una decisión aparte, no un efecto secundario de corregir su teléfono.
    if (this.isArchived()) {
      this.save.emit(rest);
      return;
    }

    this.save.emit({
      ...rest,
      state: is_active ? 'active' : 'inactive',
    });
  }
}
