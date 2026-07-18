import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  effect,
  signal,
  computed,
} from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
  AddressFormFieldsComponent,
  IconComponent,
  type AddressPayload,
} from '../../../../../../shared/components';
import {
  DOCUMENT_TYPES,
  findDocumentType,
  DocumentTypeOption,
} from '../../../../../../shared/constants/document-types';
import { Customer, CreateCustomerRequest } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { Observable, of } from 'rxjs';
import { finalize } from 'rxjs/operators';

// Re-export del traductor centralizado para compatibilidad con consumidores
// que importaban `translateCustomerError` desde este archivo.
export { translateCustomerError } from '../../utils/customer-error.translator';

/**
 * Dirección de envío tal como la devuelve el backend (tabla `addresses`).
 * El modelo `Customer` del frontend no incluye `addresses`, pero el servicio
 * backend (`customers.service.ts#findOne`) las retorna con `type='shipping'`.
 */
interface CustomerAddress {
  id: number;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_province: string | null;
  country_code: string | null;
  postal_code: string | null;
  phone_number: string | null;
  latitude: number | null;
  longitude: number | null;
  type?: string;
  is_primary?: boolean;
}

/** Payload del DTO `POST /store/addresses` (nombres backend con guion bajo). */
interface AddressDtoPayload {
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  country: string;
  postal_code?: string;
  type: 'shipping';
  is_primary: true;
  customer_id?: number;
  latitude?: string;
  longitude?: string;
}

@Component({
  selector: 'app-customer-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    ToggleComponent,
    AddressFormFieldsComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="modalTitle()"
      subtitle="Administra la información del cliente"
    >
      <form [formGroup]="form" class="space-y-4">
        <!-- Email -->
        <app-input
          formControlName="email"
          label="Correo electrónico"
          placeholder="cliente@ejemplo.com"
          type="email"
          [error]="getFieldError('email')"
          (blur)="onFieldBlur('email')"
          customWrapperClass="mt-0"
        ></app-input>

        <!-- Names Row -->
        <div class="grid grid-cols-2 gap-4">
          <app-input
            formControlName="first_name"
            label="Nombre *"
            placeholder="Ej. María"
            [required]="true"
            [error]="getFieldError('first_name')"
            (blur)="onFieldBlur('first_name')"
            customWrapperClass="mt-0"
          ></app-input>

          <app-input
            formControlName="last_name"
            label="Apellido *"
            placeholder="Ej. Rodríguez"
            [required]="true"
            [error]="getFieldError('last_name')"
            (blur)="onFieldBlur('last_name')"
            customWrapperClass="mt-0"
          ></app-input>
        </div>

        <!-- Phone -->
        <app-input
          formControlName="phone"
          label="Teléfono *"
          type="tel"
          placeholder="+57 300 000 0000"
          [required]="true"
          [error]="getFieldError('phone')"
          (blur)="onFieldBlur('phone')"
          customWrapperClass="mt-0"
        ></app-input>

        <!-- Document Row -->
        <div class="grid grid-cols-2 gap-4">
          <app-selector
            formControlName="document_type"
            label="Tipo de documento"
            placeholder="Selecciona un tipo"
            [options]="documentTypeOptions"
          ></app-selector>

          <app-input
            formControlName="document_number"
            label="Número de documento"
            [placeholder]="documentNumberPlaceholder()"
            [error]="getFieldError('document_number')"
            (blur)="onFieldBlur('document_number')"
            customWrapperClass="mt-0"
          ></app-input>
        </div>

        <!-- Información fiscal -->
        <div class="pt-2 border-t border-[var(--color-border)]">
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
            Información fiscal
          </h3>

          <div class="grid grid-cols-2 gap-4">
            <app-selector
              formControlName="tax_regime"
              label="Régimen tributario"
              placeholder="Selecciona un régimen"
              [options]="taxRegimeOptions"
            ></app-selector>

            <app-selector
              formControlName="person_type"
              label="Tipo de persona"
              placeholder="Selecciona un tipo"
              [options]="personTypeOptions"
            ></app-selector>
          </div>

          <div class="flex items-center gap-3 mt-4">
            <app-toggle
              formControlName="is_withholding_agent"
              label="¿Es agente retenedor?"
            ></app-toggle>
          </div>
        </div>

        <!-- Dirección de envío (opcional, colapsable) -->
        <div class="pt-2 border-t border-[var(--color-border)]">
          <button
            type="button"
            class="flex w-full items-center justify-between text-left text-sm font-semibold text-[var(--color-text-primary)]"
            (click)="toggleAddressSection()"
          >
            <span>Dirección de envío (opcional)</span>
            <app-icon
              [name]="addressSectionOpen() ? 'chevron-down' : 'chevron-right'"
              [size]="16"
            ></app-icon>
          </button>

          @if (addressSectionOpen()) {
            <div class="mt-3">
              <app-address-form-fields
                [initialAddress]="existingAddress()"
                (addressChange)="onAddressChange($event)"
                (validChange)="onAddressValid($event)"
              ></app-address-form-fields>
            </div>
          }
        </div>
      </form>

      <!-- Footer with slot -->
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="form.invalid || loading()"
          [loading]="loading()"
          (clicked)="onSubmit()"
        >
          {{ submitLabel() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CustomerModalComponent {
  private fb = inject(FormBuilder);
  private customersService = inject(CustomersService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly customer = input<Customer | null>(null);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly save = output<CreateCustomerRequest>();

  /**
   * Emite la dirección capturada en crear-mode para que el consumidor padre
   * la persista vía `CustomersService.createCustomerAddress` tras crear el
   * cliente (el modal no conoce el nuevo `customer_id` hasta que el padre
   * recibe la respuesta de `createCustomer`). En editar-mode el modal
   * persiste la dirección directamente.
   */
  readonly addressData = output<AddressPayload>();

  /** Última dirección emitida por el formulario hijo. */
  readonly addressPayload = signal<AddressPayload | null>(null);
  /** Validez del formulario hijo. */
  readonly addressValid = signal(false);
  /** Sección de dirección abierta/cerrada. */
  readonly addressSectionOpen = signal(false);
  /** ID de la dirección existente (editar-mode); null si no hay. */
  readonly existingAddressId = signal<number | null>(null);
  /** Dirección existente mapeada a AddressPayload para prefill el hijo. */
  readonly existingAddress = computed<AddressPayload | null>(() => {
    const c = this.customer() as (Customer & { addresses?: CustomerAddress[] }) | null;
    if (!c?.addresses?.length) return null;
    const addr =
      c.addresses.find((a) => a.type === 'shipping' && a.is_primary) ??
      c.addresses[0];
    if (!addr) return null;
    // latitude/longitude vienen como Decimal (string|number) desde el backend;
    // normalizamos a number para el form del hijo.
    const lat = addr.latitude != null ? Number(addr.latitude) : null;
    const lng = addr.longitude != null ? Number(addr.longitude) : null;
    return {
      address_line1: addr.address_line1 ?? null,
      address_line2: addr.address_line2 ?? null,
      city: addr.city ?? null,
      state_province: addr.state_province ?? null,
      country_code: addr.country_code ?? null,
      postal_code: addr.postal_code ?? null,
      phone_number: addr.phone_number ?? null,
      latitude: lat,
      longitude: lng,
    };
  });

  form: FormGroup;

  /** Opciones (catalog -> SelectorOption shape: value/label). */
  readonly documentTypeOptions = DOCUMENT_TYPES.map((opt) => ({
    value: opt.code,
    label: opt.label,
  }));

  /** Acceso al catálogo completo si se necesita (placeholder, regex, etc). */
  readonly documentTypes: ReadonlyArray<DocumentTypeOption> = DOCUMENT_TYPES;

  /** Opciones de régimen tributario (clasificación fiscal del cliente). */
  readonly taxRegimeOptions = [
    { value: 'COMUN', label: 'Régimen común' },
    { value: 'SIMPLIFICADO', label: 'Régimen simplificado' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran contribuyente' },
  ];

  /** Opciones de tipo de persona. */
  readonly personTypeOptions = [
    { value: 'NATURAL', label: 'Persona natural' },
    { value: 'JURIDICA', label: 'Persona jurídica' },
  ];

  /** Tipo de documento seleccionado (reactivo a cambios del FormControl). */
  readonly selectedDocumentType = signal<DocumentTypeOption | undefined>(undefined);

  /** Placeholder dinámico para el input de número de documento. */
  readonly documentNumberPlaceholder = computed(() => {
    const type = this.selectedDocumentType();
    return type?.placeholder ?? 'Selecciona primero el tipo';
  });

  /** Título del modal según modo crear/editar. */
  readonly isEditMode = computed(() => this.customer() !== null);
  readonly modalTitle = computed(() =>
    this.isEditMode() ? 'Editar cliente' : 'Crear cliente',
  );
  readonly submitLabel = computed(() =>
    this.isEditMode() ? 'Guardar cambios' : 'Crear cliente',
  );

  constructor() {
    this.form = this.fb.group({
      email: ['', [Validators.email]],
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.minLength(7)]],
      document_type: [''],
      document_number: [''],
      tax_regime: [''],
      person_type: [''],
      is_withholding_agent: [false],
    });

    // Bridge document_type valueChanges -> signal (Zoneless-safe reactive read).
    const documentTypeControl = this.form.controls['document_type'];
    const documentTypeValue = toSignal(documentTypeControl.valueChanges, {
      initialValue: documentTypeControl.value as string | null,
    });

    // Mantener `selectedDocumentType` sincronizado con el FormControl.
    effect(() => {
      const code = documentTypeValue();
      this.selectedDocumentType.set(findDocumentType(code));
    });

    // Validadores dinámicos del número de documento según el tipo elegido.
    effect(() => {
      const ctrl = this.form.controls['document_number'];
      const type = this.selectedDocumentType();
      if (type) {
        ctrl.setValidators([
          Validators.pattern(type.regex),
          Validators.maxLength(type.maxLength),
        ]);
        if (ctrl.disabled) {
          ctrl.enable({ emitEvent: false });
        }
      } else {
        ctrl.clearValidators();
        if (!ctrl.disabled) {
          ctrl.disable({ emitEvent: false });
        }
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    });

    // Reemplaza ngOnChanges para customer y isOpen.
    effect(() => {
      const customer = this.customer();
      if (customer) {
        this.form.patchValue({
          email: customer.email,
          first_name: customer.first_name,
          last_name: customer.last_name,
          phone: customer.phone,
          document_type: customer.document_type,
          document_number: customer.document_number,
          tax_regime: customer.tax_regime ?? '',
          person_type: customer.person_type ?? '',
          is_withholding_agent: customer.is_withholding_agent ?? false,
        });

        // Cargar la dirección de envío existente (si la hay) para el hijo.
        const c = customer as Customer & { addresses?: CustomerAddress[] };
        const addr =
          c.addresses?.find((a) => a.type === 'shipping' && a.is_primary) ??
          c.addresses?.[0] ??
          null;
        this.existingAddressId.set(addr?.id ?? null);
        // Resetear estado del hijo; se rellenará vía `initialAddress` + emit
        // cuando el hijo aplique el effect de prefill.
        this.addressPayload.set(null);
        this.addressValid.set(false);
        // Abrir la sección automáticamente si ya hay dirección.
        this.addressSectionOpen.set(!!addr);
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen && !this.customer()) {
        // `reset()` sin argumento pone TODOS los controles en `null`, ignorando
        // el default `[false]` del FormBuilder. `is_withholding_agent` es un
        // Boolean no-nullable en backend, así que un `null` emitido rompe el
        // alta (500). Reseteamos preservando el booleano en `false`.
        this.form.reset({ is_withholding_agent: false });
        // Reset de estado de dirección en alta.
        this.existingAddressId.set(null);
        this.addressPayload.set(null);
        this.addressValid.set(false);
        this.addressSectionOpen.set(false);
      }
    });
  }

  onClose() {
    this.closed.emit();
  }

  onCancel() {
    this.closed.emit();
    this.isOpenChange.emit(false);
  }

  /** Toggle de la sección colapsable de dirección. */
  toggleAddressSection(): void {
    this.addressSectionOpen.set(!this.addressSectionOpen());
  }

  /** Handler del hijo: actualiza la última dirección emitida. */
  onAddressChange(payload: AddressPayload): void {
    this.addressPayload.set(payload);
  }

  /** Handler del hijo: actualiza la validez del formulario de dirección. */
  onAddressValid(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /**
   * Mapea `AddressPayload` (claves del schema Prisma: address_line1,
   * state_province, country_code) al DTO del backend (`address_line_1`,
   * `state`, `country` con guion bajo y nombres cortos). Verifica
   * `apps/backend/src/domains/store/addresses/dto/index.ts`.
   */
  private mapAddressToDto(
    p: AddressPayload,
    customerId?: number,
  ): AddressDtoPayload {
    const dto: AddressDtoPayload = {
      address_line_1: p.address_line1 ?? '',
      city: p.city ?? '',
      state: p.state_province ?? '',
      country: p.country_code ?? '',
      type: 'shipping',
      is_primary: true,
    };
    if (p.address_line2) dto.address_line_2 = p.address_line2;
    if (p.postal_code) dto.postal_code = p.postal_code;
    if (p.latitude != null) dto.latitude = String(p.latitude);
    if (p.longitude != null) dto.longitude = String(p.longitude);
    if (customerId != null) dto.customer_id = customerId;
    return dto;
  }

  /**
   * Persiste la dirección de envío para un cliente EXISTENTE (editar-mode).
   * - Si hay `existingAddressId` → PATCH /store/addresses/:id (update).
   * - Si no → POST /store/addresses con customer_id (create).
   * Retorna un Observable que completa tras la persistencia.
   */
  private saveExistingAddress(
    customerId: number,
  ): Observable<unknown> {
    const payload = this.addressPayload();
    if (!this.addressValid() || !payload) {
      // Nada que guardar: flujo no-op.
      return of(null);
    }
    const dto = this.mapAddressToDto(payload, customerId);
    const existingId = this.existingAddressId();
    return existingId
      ? this.customersService.updateCustomerAddress(existingId, dto)
      : this.customersService.createCustomerAddress(dto);
  }

  onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // `getRawValue()` para incluir controles deshabilitados (document_number
    // se deshabilita cuando no hay tipo seleccionado, pero igual queremos
    // emitir el valor actual del formulario).
    const data = this.form.getRawValue() as CreateCustomerRequest;
    const customer = this.customer();

    if (customer) {
      // EDITAR-MODE: el modal persiste la dirección (independiente del update
      // del cliente que hace el padre). Tras éxito/fracaso de la dirección,
      // emite `save` para que el padre actualice el cliente + refresque lista.
      if (this.addressValid() && this.addressPayload()) {
        this.internalLoading.set(true);
        this.saveExistingAddress(customer.id)
          .pipe(
            takeUntilDestroyed(this.destroyRef),
            finalize(() => this.internalLoading.set(false)),
          )
          .subscribe({
            next: () => {
              this.toast.success('Dirección de envío guardada.');
              this.save.emit(data);
            },
            error: (err: unknown) => {
              console.error('Error saving customer address:', err);
              this.toast.error(
                'No se pudo guardar la dirección de envío. El cliente se actualizará igualmente.',
              );
              // Igual emitimos para que el cliente se actualice.
              this.save.emit(data);
            },
          });
      } else {
        this.save.emit(data);
      }
    } else {
      // CREAR-MODE: el modal no conoce el nuevo `customer_id` hasta que el
      // padre reciba la respuesta de `createCustomer`. Emitimos `save` (el
      // padre crea al cliente + refresca lista + cierra modal) y además
      // emitimos `addressData` para que el padre persista la dirección tras
      // el alta usando `CustomersService.createCustomerAddress`.
      this.save.emit(data);
      if (this.addressValid() && this.addressPayload()) {
        this.addressData.emit(this.addressPayload()!);
      }
    }
  }

  getFieldError(field: string): string {
    const control = this.form.get(field);
    if (!control?.touched || !control?.errors) return '';

    const errors = control.errors;

    if (errors['required']) {
      switch (field) {
        case 'first_name':
          return 'El nombre es obligatorio';
        case 'last_name':
          return 'El apellido es obligatorio';
        case 'phone':
          return 'El teléfono es obligatorio';
        default:
          return 'Este campo es obligatorio';
      }
    }

    if (errors['email']) {
      return 'Ingresa un correo válido';
    }

    if (errors['minlength']) {
      switch (field) {
        case 'first_name':
          return 'El nombre debe tener al menos 2 caracteres';
        case 'last_name':
          return 'El apellido debe tener al menos 2 caracteres';
        case 'phone':
          return 'El teléfono debe tener al menos 7 caracteres';
        default:
          return `Debe tener al menos ${errors['minlength'].requiredLength} caracteres`;
      }
    }

    if (errors['maxlength']) {
      const type = this.selectedDocumentType();
      if (field === 'document_number' && type) {
        return `Máximo ${type.maxLength} caracteres`;
      }
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }

    if (errors['pattern'] && field === 'document_number') {
      const type = this.selectedDocumentType();
      return `Número de documento inválido para ${type?.label ?? 'el tipo seleccionado'}`;
    }

    return '';
  }

  onFieldBlur(field: string) {
    this.form.get(field)?.markAsTouched();
  }
}
