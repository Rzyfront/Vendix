import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  FormBuilder,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  Store,
  StoreSettings,
  StoreListItem,
} from '../../interfaces/store.interface';
import {
  ButtonComponent,
  ModalComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  SelectorOption,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, ModalComponent, InputComponent, SelectorComponent, TextareaComponent],
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Editar Tienda"
      subtitle="Actualiza la información de la tienda seleccionada"
    >
      @if (store) {
        <ng-container>
      <form [formGroup]="editForm" class="space-y-6">
        <!-- Store Information -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Información de la Tienda
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Store Name -->
            <app-input
              [label]="'Nombre de la Tienda'"
              formControlName="name"
              styleVariant="modern"
              placeholder="Ingresa el nombre de la tienda"
              [required]="true"
              [control]="editForm.get('name')"
            ></app-input>

            <!-- Domain -->
            <app-input
              [label]="'Dominio'"
              formControlName="domain"
              styleVariant="modern"
              placeholder="dominio-tienda"
              [required]="true"
              [control]="editForm.get('domain')"
            ></app-input>

            <!-- Email -->
            <app-input
              [label]="'Correo Electrónico'"
              type="email"
              formControlName="email"
              styleVariant="modern"
              placeholder="contacto@tienda.com"
              [required]="true"
              [control]="editForm.get('email')"
            ></app-input>

            <!-- Phone -->
            <app-input
              [label]="'Teléfono'"
              type="tel"
              formControlName="phone"
              styleVariant="modern"
              placeholder="+57 (1) 000-0000"
            ></app-input>

            <!-- Status -->
            <app-selector
              [label]="'Estado'"
              formControlName="status"
              styleVariant="modern"
              [options]="statusOptions"
            ></app-selector>

            <!-- Description -->
            <div class="md:col-span-2">
              <app-textarea
                [label]="'Descripción'"
                formControlName="description"
                styleVariant="modern"
                placeholder="Breve descripción de tu tienda"
                [rows]="3"
              ></app-textarea>
            </div>
          </div>
        </div>

        <!-- Address Information -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Información de Dirección
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4" formGroupName="address">
            <!-- Street -->
            <div class="md:col-span-2">
              <app-input
                [label]="'Dirección'"
                formControlName="street"
                styleVariant="modern"
                placeholder="Calle 123 #45-67"
              ></app-input>
            </div>

            <!-- City -->
            <app-input
              [label]="'Ciudad'"
              formControlName="city"
              styleVariant="modern"
              placeholder="Bogotá"
            ></app-input>

            <!-- State -->
            <app-input
              [label]="'Departamento'"
              formControlName="state"
              styleVariant="modern"
              placeholder="Cundinamarca"
            ></app-input>

            <!-- ZIP Code -->
            <app-input
              [label]="'Código Postal'"
              formControlName="zipCode"
              styleVariant="modern"
              placeholder="110111"
            ></app-input>

            <!-- Country -->
            <app-input
              [label]="'País'"
              formControlName="country"
              styleVariant="modern"
              placeholder="Colombia"
            ></app-input>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button (clicked)="onCancel()" variant="outline">
          Cancelar
        </app-button>
        <app-button
          (clicked)="onSubmit()"
          [disabled]="!editForm.valid || !settingsForm.valid || isSubmitting"
          variant="primary"
          [loading]="isSubmitting"
        >
          Actualizar Tienda
        </app-button>
      </div>
        </ng-container>
      } 
    </app-modal>
  `,
})
export class StoreEditModalComponent {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() store?: StoreListItem;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<any>();
  @Output() cancel = new EventEmitter<void>();

  editForm: FormGroup;
  settingsForm: FormGroup;

  statusOptions: SelectorOption[] = [
    { value: 'active', label: 'Activo' },
    { value: 'inactive', label: 'Inactivo' },
    { value: 'maintenance', label: 'Mantenimiento' }
  ];

  constructor(private fb: FormBuilder) {
    this.editForm = this.fb.group({
      id: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      domain: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/),
        ],
      ],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      address: this.fb.group({
        street: [''],
        city: [''],
        state: [''],
        zipCode: [''],
        country: [''],
      }),
      status: ['active', Validators.required],
      logoUrl: [''],
      bannerUrl: [''],
    });

    this.settingsForm = this.fb.group({
      allowGuestCheckout: [true],
      requireEmailVerification: [false],
      enableInventoryTracking: [true],
      lowStockThreshold: [10],
      enableTaxCalculation: [true],
      taxRate: [0],
      enableShipping: [true],
      freeShippingThreshold: [0],
      currency: ['USD'],
      timezone: ['UTC'],
      language: ['en'],
    });
  }

  ngOnChanges(): void {
    if (this.store) {
      this.editForm.patchValue({
        id: this.store.id,
        name: this.store.name,
        description: this.store.description || '',
        domain: this.store.domain,
        email: this.store.email,
        phone: this.store.phone || '',
        address: {
          street:
            (typeof this.store.address === 'object'
              ? this.store.address?.street
              : '') || '',
          city:
            (typeof this.store.address === 'object'
              ? this.store.address?.city
              : '') || '',
          state:
            (typeof this.store.address === 'object'
              ? this.store.address?.state
              : '') || '',
          zipCode:
            (typeof this.store.address === 'object'
              ? this.store.address?.zipCode
              : '') || '',
          country:
            (typeof this.store.address === 'object'
              ? this.store.address?.country
              : '') || '',
        },
        status: this.store.status,
        logoUrl: this.store.logo_url || '',
        bannerUrl: this.store.banner_url || '',
      });

      if (this.store.settings) {
        this.settingsForm.patchValue(this.store.settings);
      }
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.editForm.valid && this.settingsForm.valid) {
      const updatedStore = {
        ...this.editForm.value,
        settings: this.settingsForm.value,
      };
      this.submit.emit(updatedStore);
    }
  }

  private resetForm(): void {
    this.editForm.reset();
    this.settingsForm.reset();
  }

  // Getters para validación
  get f() {
    return this.editForm.controls;
  }
  get sf() {
    return this.settingsForm.controls;
  }

  // Validación de formulario
  isFieldInvalid(fieldName: string, formGroup: string = 'edit'): boolean {
    const form = formGroup === 'edit' ? this.editForm : this.settingsForm;
    const field = form.get(fieldName);
    return field ? field.invalid && (field.dirty || field.touched) : false;
  }

  getErrorMessage(fieldName: string, formGroup: string = 'edit'): string {
    const form = formGroup === 'edit' ? this.editForm : this.settingsForm;
    const field = form.get(fieldName);

    if (!field) return '';

    if (field.errors?.['required']) return 'Este campo es requerido';
    if (field.errors?.['minlength'])
      return `Mínimo ${field.errors['minlength'].requiredLength} caracteres`;
    if (field.errors?.['email']) return 'Email inválido';
    if (field.errors?.['pattern']) return 'Formato inválido';

    return 'Campo inválido';
  }
}
