import {
  Component,
  ChangeDetectionStrategy,
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
import { TAX_REGIMES } from '../../../../../../shared/constants/tax-regime.constants';
import {
  FISCAL_RESPONSIBILITIES,
  FISCAL_RESPONSIBILITY_LABELS,
  FiscalResponsibility,
} from '../../../../../../shared/constants/fiscal-responsibilities.constants';
import { nitDvGroupValidator } from '../../../../../../shared/utils/nit.util';
import { Customer, CreateCustomerRequest } from '../../models/customer.model';
import { CustomersService } from '../../services/customers.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { Observable, of } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * Validador NIT ↔ DV atado a los nombres de control de ESTE formulario. El
 * espejo backend es `@NitDvMatches()` en `CreateCustomerDto`, que rechaza con
 * 400 cualquier par incoherente — incluidos clientes ya guardados con un DV
 * inconsistente de antes de que esa validación existiera.
 */
const CUSTOMER_NIT_DV_VALIDATOR = nitDvGroupValidator(
  'document_number',
  'verification_digit',
);

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
  /** Código DANE del municipio; NULL en toda dirección anterior a su captura. */
  municipality_code?: string | null;
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
  /**
   * Código DANE del municipio. Es el dato que desbloquea la facturación
   * electrónica: `invoice-flow.service.ts` lee `addresses.municipality_code`
   * para poblar `customer_address.city_code`, y sin él el validador de
   * identidad fiscal lanza `CITY_CODE_REQUIRED` (bloqueante).
   */
  municipality_code?: string;
}

@Component({
  selector: 'app-customer-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
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
      [size]="mode() === 'advanced' ? 'xl' : 'md'"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
    >
      <form [formGroup]="form" class="space-y-4">
        <!-- ============================================================ -->
        <!-- QUICK MODE: solo datos básicos del cliente                    -->
        <!-- ============================================================ -->
        @if (mode() === 'quick') {
          <!-- Tipo persona + Nombres/Apellidos o Razón social -->
          <app-selector
            formControlName="person_type"
            label="Tipo de persona"
            placeholder="Selecciona un tipo"
            [options]="personTypeOptions"
          ></app-selector>

          @if (person_type() !== 'JURIDICA') {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          } @else {
            <app-input
              formControlName="legal_name"
              label="Razón social *"
              placeholder="Ej. Acme S.A.S"
              [required]="true"
              [error]="getFieldError('legal_name')"
              (blur)="onFieldBlur('legal_name')"
              customWrapperClass="mt-0"
            ></app-input>
          }

          <!-- Email + Teléfono en 2 cols -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="email"
              label="Correo electrónico"
              placeholder="cliente@ejemplo.com"
              type="email"
              [error]="getFieldError('email')"
              (blur)="onFieldBlur('email')"
              customWrapperClass="mt-0"
            ></app-input>

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
          </div>

          <!-- Info check place: activa creación completa DIAN -->
          <label class="flex items-start gap-3 p-4 mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] cursor-pointer hover:border-[var(--color-primary)] transition-colors">
            <input
              type="checkbox"
              class="mt-1"
              [checked]="needsInvoicing()"
              (change)="onInvoicingToggle($event)"
            />
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <app-icon name="info" [size]="16"></app-icon>
                <h4 class="text-sm font-semibold text-[var(--color-text-primary)]">
                  ¿Este cliente va a facturar electrónicamente?
                </h4>
              </div>
              <p class="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">
                Activa esta opción para capturar la información DIAN completa:
                dígito de verificación (NIT y CC), régimen tributario,
                responsabilidades fiscales del RUT, código CIIU y dirección.
              </p>
            </div>
          </label>
        }

        <!-- ============================================================ -->
        <!-- ADVANCED MODE (xl): 3 columnas                                -->
        <!-- Col 1: Datos del cliente                                       -->
        <!-- Col 2: Datos fiscales                                         -->
        <!-- Col 3: Responsabilidades tributarias                          -->
        <!-- ============================================================ -->
        @if (mode() === 'advanced') {
          <!-- Link para volver al modo rápido -->
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            (click)="switchToQuick()"
          >
            <app-icon name="arrow-left" [size]="14"></app-icon>
            Volver al modo rápido
          </button>

          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- ============================================================ -->
            <!-- COLUMNA 1: Datos del cliente (comercial)                    -->
            <!-- ============================================================ -->
            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-[var(--color-text-primary)] pb-1 border-b border-[var(--color-border)]">
                Datos del cliente
              </h3>

              <app-selector
                formControlName="person_type"
                label="Tipo de persona"
                placeholder="Selecciona un tipo"
                [options]="personTypeOptions"
              ></app-selector>

              @if (person_type() !== 'JURIDICA') {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              } @else {
                <app-input
                  formControlName="legal_name"
                  label="Razón social *"
                  placeholder="Ej. Acme S.A.S"
                  [required]="true"
                  [error]="getFieldError('legal_name')"
                  (blur)="onFieldBlur('legal_name')"
                  customWrapperClass="mt-0"
                ></app-input>
              }

              <app-input
                formControlName="email"
                label="Correo electrónico"
                placeholder="cliente@ejemplo.com"
                type="email"
                [error]="getFieldError('email')"
                (blur)="onFieldBlur('email')"
                customWrapperClass="mt-0"
              ></app-input>

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

              <div class="grid grid-cols-1 gap-3" [class.sm:grid-cols-3]="document_type() === 'NIT'" [class.sm:grid-cols-2]="document_type() !== 'NIT'">
                <app-selector
                  formControlName="document_type"
                  label="Tipo doc"
                  placeholder="Tipo"
                  [options]="documentTypeOptions"
                ></app-selector>

                <app-input
                  formControlName="document_number"
                  label="Número"
                  [placeholder]="documentNumberPlaceholder()"
                  [error]="getFieldError('document_number')"
                  (blur)="onFieldBlur('document_number')"
                  customWrapperClass="mt-0"
                ></app-input>

                @if (document_type() === 'NIT') {
                  <app-input
                    formControlName="verification_digit"
                    label="DV"
                    placeholder="3"
                    type="text"
                    [maxlength]="1"
                    [error]="getFieldError('verification_digit') || getGroupNitDvError()"
                    (blur)="onFieldBlur('verification_digit')"
                    customWrapperClass="mt-0"
                  ></app-input>
                }
              </div>
            </div>

            <!-- ============================================================ -->
            <!-- COLUMNA 2: Datos fiscales + Dirección                       -->
            <!-- ============================================================ -->
            <div class="space-y-4">
              <h3 class="text-sm font-semibold text-[var(--color-text-primary)] pb-1 border-b border-[var(--color-border)]">
                Datos fiscales
              </h3>

              <app-selector
                formControlName="tax_regime"
                label="Régimen tributario"
                placeholder="Selecciona un régimen"
                [options]="taxRegimeOptions"
              ></app-selector>

              <app-input
                formControlName="ciiu_code"
                label="Código CIIU"
                placeholder="4711"
                type="text"
                [maxlength]="10"
                hint="4 dígitos"
                [error]="getFieldError('ciiu_code')"
                (blur)="onFieldBlur('ciiu_code')"
                customWrapperClass="mt-0"
              ></app-input>

              <div class="pt-2">
                <app-toggle
                  formControlName="is_withholding_agent"
                  label="¿Es agente retenedor?"
                ></app-toggle>
              </div>

              <!-- Dirección (se reutiliza para envío y facturación) -->
              <div class="pt-2 border-t border-[var(--color-border)]">
                <button
                  type="button"
                  class="flex w-full items-center justify-between text-left text-sm font-semibold text-[var(--color-text-primary)]"
                  (click)="toggleAddressSection()"
                >
                  <span>Dirección (opcional)</span>
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
            </div>

            <!-- ============================================================ -->
            <!-- COLUMNA 3: Responsabilidades tributarias                    -->
            <!-- ============================================================ -->
            <div class="space-y-3">
              <h3 class="text-sm font-semibold text-[var(--color-text-primary)] pb-1 border-b border-[var(--color-border)]">
                Responsabilidades tributarias *
              </h3>
              <p class="text-xs text-[var(--color-text-secondary)]">
                Una o más del RUT.
              </p>
              <div class="flex flex-col gap-1.5">
                @for (resp of FISCAL_RESPONSIBILITIES; track resp) {
                  <label class="flex items-start gap-2 px-2 py-1.5 rounded border border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-bg-secondary)]">
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      [checked]="fiscalResponsibilitiesValue().includes(resp)"
                      (change)="toggleFiscalResponsibility(resp)"
                    />
                    <span class="text-xs text-[var(--color-text-primary)] leading-tight">{{ FISCAL_RESPONSIBILITY_LABELS[resp] }}</span>
                  </label>
                }
              </div>
              @if (getFieldError('fiscal_responsibilities')) {
                <p class="text-xs text-[var(--color-error)] mt-1">
                  {{ getFieldError('fiscal_responsibilities') }}
                </p>
              }
            </div>
          </div>
        }
      </form>

      <!-- Footer (idéntico en ambos modos) -->
      <div slot="footer" class="flex justify-end gap-3">
        <app-button variant="ghost" (clicked)="onCancel()">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="(mode() === 'quick' ? quickFormInvalid() : form.invalid) || loading()"
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
      municipality_code: addr.municipality_code ?? null,
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

  /** Opciones de régimen tributario (clasificación fiscal del cliente, Anexo 19). */
  readonly taxRegimeOptions = TAX_REGIMES.map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));

  /** Catálogo de responsabilidades fiscales (RUT). */
  readonly FISCAL_RESPONSIBILITIES = FISCAL_RESPONSIBILITIES;
  readonly FISCAL_RESPONSIBILITY_LABELS = FISCAL_RESPONSIBILITY_LABELS;

  /** Modo del modal: 'quick' (md) o 'advanced' (xl, 3-col DIAN). */
  readonly mode = signal<'quick' | 'advanced'>('quick');

  /** Toggle del info check place. */
  readonly needsInvoicing = signal(false);

  /** Bridge del FormControl `person_type` a signal. */
  readonly person_type = signal<string>('');
  readonly document_type = signal<string>('');
  /** Bridge del FormControl `fiscal_responsibilities` (array) a signal. */
  readonly fiscalResponsibilitiesValue = signal<string[]>([]);

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

  /** Título del modal según modo crear/editar + nivel de detalle. */
  readonly isEditMode = computed(() => this.customer() !== null);
  readonly modalTitle = computed(() => {
    const base = this.isEditMode() ? 'Editar cliente' : 'Crear cliente';
    const suffix = this.mode() === 'advanced' ? ' — Configuración completa' : '';
    return base + suffix;
  });
  readonly modalSubtitle = computed(() =>
    this.mode() === 'advanced'
      ? 'Información DIAN completa para emisión electrónica'
      : 'Datos esenciales para crear el cliente',
  );
  readonly submitLabel = computed(() =>
    this.isEditMode() ? 'Guardar cambios' : 'Crear cliente',
  );

  /**
   * Bridge `form.statusChanges` a un signal para que `quickFormInvalid` pueda
   * re-evaluarse cuando cualquier control del form cambia de validez. Sin este
   * puente, el computed original cacheaba el resultado y nunca reflejaba el
   * cambio de `first_name/last_name/email/phone` porque esas propiedades no
   * son signals. Se inicializa en `INVALID` (cualquier form inicial cae en
   * este estado mientras el usuario no llene nada) y se actualiza vía
   * subscription a `form.statusChanges` en el constructor.
   */
  private readonly formStatus = signal<string>('INVALID');

  /** En modo quick, sólo validamos los campos básicos (no fiscales avanzados). */
  quickFormInvalid(): boolean {
    this.formStatus(); // dependencia: re-evalúa en cada cambio de validez
    const emailCtrl = this.form.controls['email'];
    if (emailCtrl.invalid) return true;
    if (this.person_type() === 'JURIDICA') {
      if (this.form.controls['legal_name'].invalid) return true;
    } else {
      if (this.form.controls['first_name'].invalid) return true;
      if (this.form.controls['last_name'].invalid) return true;
    }
    if (this.form.controls['phone'].invalid) return true;
    return false;
  }

  constructor() {
    this.form = this.fb.group({
      email: ['', [Validators.email]],
      first_name: ['', [Validators.required, Validators.minLength(2)]],
      last_name: ['', [Validators.required, Validators.minLength(2)]],
      legal_name: ['', [Validators.maxLength(255)]],
      phone: ['', [Validators.required, Validators.minLength(7)]],
      document_type: ['CC'],
      document_number: [''],
      verification_digit: ['', [Validators.maxLength(1), Validators.pattern(/^\d?$/)]],
      ciiu_code: ['', [Validators.maxLength(10), Validators.pattern(/^\d{2,4}$/)]],
      tax_regime: [''],
      person_type: [''],
      is_withholding_agent: [false],
      fiscal_responsibilities: this.fb.control<string[]>([]),
    });

    // Bridge document_type valueChanges -> signal (Zoneless-safe reactive read).
    const documentTypeControl = this.form.controls['document_type'];
    const documentTypeValue = toSignal(documentTypeControl.valueChanges, {
      initialValue: documentTypeControl.value as string | null,
    });

    // Bridge person_type valueChanges -> signal (para swap jurídica/natural).
    const personTypeControl = this.form.controls['person_type'];
    const personTypeValue = toSignal(personTypeControl.valueChanges, {
      initialValue: personTypeControl.value as string | null,
    });

    // Bridge fiscal_responsibilities valueChanges -> signal.
    const fiscalRespControl = this.form.controls['fiscal_responsibilities'];
    const fiscalRespValue = toSignal(fiscalRespControl.valueChanges, {
      initialValue: (fiscalRespControl.value ?? []) as string[],
    });

    // Bridge form.statusChanges -> signal (re-evalúa computed/methods cuando
    // cualquier control cambia de validez).
    this.form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.formStatus.set(status));

    // Mantener `selectedDocumentType` sincronizado con el FormControl.
    effect(() => {
      const code = documentTypeValue();
      this.selectedDocumentType.set(findDocumentType(code));
      this.document_type.set(code ?? '');
      if (code !== 'NIT') {
        const dvCtrl = this.form.controls['verification_digit'];
        if (dvCtrl && dvCtrl.value) {
          dvCtrl.setValue('', { emitEvent: false });
        }
      }
    });

    // Sincronizar signals derivados.
    effect(() => {
      this.person_type.set(personTypeValue() ?? '');
      this.applyPersonTypeValidators();
    });

    effect(() => {
      this.fiscalResponsibilitiesValue.set(fiscalRespValue() ?? []);
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

    // Group-level validator: solo aplica cuando document_type='NIT'.
    // Los nombres de control se pasan explícitos porque este formulario usa
    // `document_number`/`verification_digit`, no el `nit`/`nit_dv` de los
    // formularios fiscales; con los nombres por defecto el validador queda
    // como un no-op silencioso y el usuario sólo se entera por el 400 del
    // backend (`NitDvMatches`), sin saber qué campo corregir.
    effect(() => {
      const type = this.document_type();
      this.form.setValidators(type === 'NIT' ? [CUSTOMER_NIT_DV_VALIDATOR] : []);
      this.form.updateValueAndValidity({ emitEvent: false });
    });

    // Reemplaza ngOnChanges para customer y isOpen.
    effect(() => {
      const customer = this.customer();
      if (customer) {
        this.form.patchValue({
          email: customer.email,
          first_name: customer.first_name,
          last_name: customer.last_name,
          legal_name: customer.legal_name ?? null,
          phone: customer.phone,
          document_type: customer.document_type,
          document_number: customer.document_number,
          verification_digit: customer.verification_digit ?? null,
          ciiu_code: customer.ciiu_code ?? null,
          tax_regime: customer.tax_regime ?? '',
          person_type: customer.person_type ?? '',
          is_withholding_agent: customer.is_withholding_agent ?? false,
          fiscal_responsibilities: customer.fiscal_responsibilities ?? [],
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
        // Editar: arrancar en advanced para mostrar todos los campos DIAN.
        this.mode.set('advanced');
        this.needsInvoicing.set(true);
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen && !this.customer()) {
        // `reset()` sin argumento pone TODOS los controles en `null`, ignorando
        // el default `[false]` del FormBuilder. `is_withholding_agent` es un
        // Boolean no-nullable en backend, así que un `null` emitido rompe el
        // alta (500). Reseteamos preservando el booleano en `false` y los
        // defaults razonables (CC como tipo de documento por default, para
        // que el campo "Número" quede habilitado desde el arranque).
        this.form.reset({
          document_type: 'CC',
          is_withholding_agent: false,
          fiscal_responsibilities: [],
        });
        // Reset de estado de dirección en alta.
        this.existingAddressId.set(null);
        this.addressPayload.set(null);
        this.addressValid.set(false);
        this.addressSectionOpen.set(false);
        // Crear: arrancar en modo rápido.
        this.mode.set('quick');
        this.needsInvoicing.set(false);
      }
    });
  }

  /**
   * Toggle de validación required entre `first_name/last_name` y `legal_name`
   * según el `person_type` actual. Aplica el efecto de swap jurídica↔natural.
   */
  private applyPersonTypeValidators(): void {
    const isJuridica = this.person_type() === 'JURIDICA';
    const first = this.form.controls['first_name'];
    const last = this.form.controls['last_name'];
    const legal = this.form.controls['legal_name'];

    if (isJuridica) {
      first.clearValidators();
      last.clearValidators();
      first.setValue(null, { emitEvent: false });
      last.setValue(null, { emitEvent: false });
      legal.setValidators([Validators.required, Validators.maxLength(255)]);
    } else {
      legal.clearValidators();
      legal.setValue(null, { emitEvent: false });
      first.setValidators([Validators.required, Validators.minLength(2)]);
      last.setValidators([Validators.required, Validators.minLength(2)]);
    }

    first.updateValueAndValidity({ emitEvent: false });
    last.updateValueAndValidity({ emitEvent: false });
    legal.updateValueAndValidity({ emitEvent: false });
  }

  /** Toggle handler para el multi-checkbox de responsabilidades fiscales. */
  toggleFiscalResponsibility(code: FiscalResponsibility): void {
    const current = this.fiscalResponsibilitiesValue();
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    this.form.controls['fiscal_responsibilities'].setValue(next);
    this.form.controls['fiscal_responsibilities'].markAsTouched();
  }

  /** Mensaje de error a nivel de grupo (nitDvValidator). */
  getGroupNitDvError(): string {
    const errors = this.form.errors;
    if (!errors || !errors['nitDv']) return '';
    const expected = (errors['nitDv'] as { expected?: string | null })?.expected;
    return expected
      ? `El dígito de verificación no corresponde al NIT (debería ser ${expected})`
      : 'El dígito de verificación no corresponde al NIT';
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

  /** Cambia del modal rápido (md) al modal avanzado (xl, 3-col DIAN). */
  switchToAdvanced(): void {
    this.mode.set('advanced');
    this.needsInvoicing.set(true);
    if (this.existingAddress() || this.addressValid()) {
      this.addressSectionOpen.set(true);
    }
  }

  /** Vuelve del modal avanzado al modal rápido. */
  switchToQuick(): void {
    this.mode.set('quick');
    this.needsInvoicing.set(false);
  }

  /** Handler del info checkbox: alterna entre quick y advanced. */
  onInvoicingToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.switchToAdvanced();
    } else {
      this.switchToQuick();
    }
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
    if (p.municipality_code) dto.municipality_code = p.municipality_code;
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
      // Un error de grupo (NIT ↔ DV) sólo se pinta junto al campo DV, dentro
      // de la sección fiscal; sin toast el botón parece no responder.
      this.toast.error(
        this.getGroupNitDvError() ||
          'Revisa los campos marcados antes de guardar.',
      );
      return;
    }

    // `getRawValue()` para incluir controles deshabilitados (document_number
    // se deshabilita cuando no hay tipo seleccionado, pero igual queremos
    // emitir el valor actual del formulario).
    const data = this.form.getRawValue() as CreateCustomerRequest;
    if (data.document_type !== 'NIT') {
      data.verification_digit = null;
    }
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
        case 'legal_name':
          return 'La razón social es obligatoria';
        case 'phone':
          return 'El teléfono es obligatorio';
        case 'fiscal_responsibilities':
          return 'Selecciona al menos una responsabilidad fiscal';
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

    if (errors['pattern'] && field === 'verification_digit') {
      return 'El DV debe ser un dígito (0-9)';
    }

    if (errors['pattern'] && field === 'ciiu_code') {
      return 'El código CIIU debe tener 2 a 4 dígitos';
    }

    if (errors['maxlength'] && field === 'legal_name') {
      return 'La razón social no puede superar 255 caracteres';
    }

    return '';
  }

  onFieldBlur(field: string) {
    this.form.get(field)?.markAsTouched();
  }
}
