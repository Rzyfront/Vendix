import { Component, inject, input, output, effect, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  ToggleComponent,
} from '../../../../../../shared/components';
import {
  DOCUMENT_TYPES,
  findDocumentType,
  DocumentTypeOption,
} from '../../../../../../shared/constants/document-types';
import { Customer, CreateCustomerRequest } from '../../models/customer.model';

// Re-export del traductor centralizado para compatibilidad con consumidores
// que importaban `translateCustomerError` desde este archivo.
export { translateCustomerError } from '../../utils/customer-error.translator';

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
          label="Correo electrónico *"
          placeholder="cliente@ejemplo.com"
          type="email"
          [required]="true"
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

  readonly isOpen = input(false);
  readonly customer = input<Customer | null>(null);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly save = output<CreateCustomerRequest>();

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
      email: ['', [Validators.required, Validators.email]],
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
      }
    });

    effect(() => {
      const isOpen = this.isOpen();
      if (isOpen && !this.customer()) {
        this.form.reset();
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

  onSubmit() {
    if (this.form.valid) {
      // `getRawValue()` para incluir controles deshabilitados (document_number
      // se deshabilita cuando no hay tipo seleccionado, pero igual queremos
      // emitir el valor actual del formulario).
      this.save.emit(this.form.getRawValue() as CreateCustomerRequest);
    } else {
      this.form.markAllAsTouched();
    }
  }

  getFieldError(field: string): string {
    const control = this.form.get(field);
    if (!control?.touched || !control?.errors) return '';

    const errors = control.errors;

    if (errors['required']) {
      switch (field) {
        case 'email':
          return 'El correo es obligatorio';
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
