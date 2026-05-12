import { Component, effect, inject, input, output } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SelectorComponent,
  SettingToggleComponent,
  TextareaComponent,
} from '../../../../../../../shared/components/index';

import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { CurrencyService } from '../../../../../../../services/currency.service';
import {
  CreateOrgSupplierRequest,
  OrgSupplierRow,
  UpdateOrgSupplierRequest,
} from '../../../services/org-inventory.service';

export interface OrgSupplierStoreOption {
  value: number | string;
  label: string;
}

/**
 * ORG_ADMIN — Supplier create/edit modal.
 *
 * Mirrors the store-side `SupplierFormModalComponent` and adds an explicit
 * `store_id` selector. Empty value means org-shared supplier (`store_id = null`).
 */
@Component({
  selector: 'app-org-supplier-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SettingToggleComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="supplier() ? 'Editar Proveedor' : 'Nuevo Proveedor'"
      subtitle="Administra el proveedor a nivel organización"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4 max-h-[70vh] overflow-y-auto px-1">
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

          <!-- Store assignment -->
          <div>
            <label
              class="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1.5 ml-1"
              >Tienda asignada</label
            >
            <app-selector
              formControlName="store_id"
              [options]="effectiveStoreOptions"
              placeholder="Sin tienda (organización)"
            ></app-selector>
            <p class="mt-1 ml-1 text-[11px] text-text-tertiary">
              Deja vacío para un proveedor compartido por toda la organización.
            </p>
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
        <div
          class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
        >
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
export class OrgSupplierFormModalComponent {
  private fb = inject(FormBuilder);
  private currencyFormatService = inject(CurrencyFormatService);
  private currencyHttpService = inject(CurrencyService);

  readonly isOpen = input(false);
  readonly supplier = input<OrgSupplierRow | null>(null);
  readonly isSubmitting = input(false);
  readonly storeOptions = input<OrgSupplierStoreOption[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateOrgSupplierRequest | UpdateOrgSupplierRequest>();

  currencyOptions: { value: string; label: string }[] = [];

  // Computed-style getter (reading the input signal each call). Kept as a
  // getter to avoid creating a separate computed for a simple template need.
  get effectiveStoreOptions(): OrgSupplierStoreOption[] {
    return [
      { value: '', label: 'Sin tienda (organización)' },
      ...this.storeOptions(),
    ];
  }

  readonly form: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(50)]],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    store_id: [''],
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

  constructor() {
    this.loadCurrencyOptions();
    effect(() => {
      const sup = this.supplier();
      const open = this.isOpen();
      if (sup) {
        this.patchForm(sup);
      } else if (open && !sup) {
        this.form.reset({
          code: '',
          name: '',
          store_id: '',
          contact_person: '',
          email: '',
          phone: '',
          mobile: '',
          website: '',
          tax_id: '',
          payment_terms: '',
          currency: this.currencyFormatService.currencyCode() || 'COP',
          lead_time_days: null,
          notes: '',
          is_active: true,
        });
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

  private patchForm(sup: OrgSupplierRow): void {
    this.form.patchValue(
      {
        code: sup.code ?? '',
        name: sup.name ?? '',
        store_id: sup.store_id ?? '',
        contact_person: sup.contact_person ?? '',
        email: sup.email ?? '',
        phone: sup.phone ?? '',
        mobile: sup.mobile ?? '',
        website: sup.website ?? '',
        tax_id: sup.tax_id ?? sup.document_number ?? '',
        payment_terms: sup.payment_terms ?? '',
        currency:
          sup.currency || this.currencyFormatService.currencyCode() || 'COP',
        lead_time_days: sup.lead_time_days ?? null,
        notes: sup.notes ?? '',
        is_active: sup.is_active ?? true,
      },
      { emitEvent: false },
    );
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
    if (this.form.invalid) return;
    const raw = this.form.getRawValue();
    const storeIdRaw = raw.store_id;
    const storeId =
      storeIdRaw === '' || storeIdRaw === null || storeIdRaw === undefined
        ? null
        : Number(storeIdRaw);

    const payload: CreateOrgSupplierRequest = {
      code: String(raw.code).trim(),
      name: String(raw.name).trim(),
      store_id: storeId,
      contact_person: raw.contact_person || undefined,
      email: raw.email || undefined,
      phone: raw.phone || undefined,
      mobile: raw.mobile || undefined,
      website: raw.website || undefined,
      tax_id: raw.tax_id || undefined,
      payment_terms: raw.payment_terms || undefined,
      currency: raw.currency || undefined,
      lead_time_days:
        raw.lead_time_days === null || raw.lead_time_days === ''
          ? undefined
          : Number(raw.lead_time_days),
      notes: raw.notes || undefined,
      is_active: !!raw.is_active,
    };

    this.save.emit(payload);
  }
}
