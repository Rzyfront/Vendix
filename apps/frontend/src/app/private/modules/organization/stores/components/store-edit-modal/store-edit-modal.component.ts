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
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-edit-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, ModalComponent],
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
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Nombre de la Tienda *</label
              >
              <input
                type="text"
                formControlName="name"
                [class]="
                  isFieldInvalid('name') ? 'border-red-500' : 'border-border'
                "
                class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Ingresa el nombre de la tienda"
              />
              <div
                *ngIf="isFieldInvalid('name')"
                class="mt-1 text-sm text-destructive"
              >
                {{ getErrorMessage("name") }}
              </div>
            </div>

            <!-- Domain -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Dominio *</label
              >
              <input
                type="text"
                formControlName="domain"
                [class]="
                  isFieldInvalid('domain')
                    ? 'border-red-500'
                    : 'border-border'
                "
                class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="dominio-tienda"
              />
              <div
                *ngIf="isFieldInvalid('domain')"
                class="mt-1 text-sm text-destructive"
              >
                {{ getErrorMessage("domain") }}
              </div>
            </div>

            <!-- Email -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Correo Electrónico *</label
              >
              <input
                type="email"
                formControlName="email"
                [class]="
                  isFieldInvalid('email') ? 'border-red-500' : 'border-border'
                "
                class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="contacto@tienda.com"
              />
              <div
                *ngIf="isFieldInvalid('email')"
                class="mt-1 text-sm text-destructive"
              >
                {{ getErrorMessage("email") }}
              </div>
            </div>

            <!-- Phone -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Teléfono</label
              >
              <input
                type="tel"
                formControlName="phone"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="+57 (1) 000-0000"
              />
            </div>

            <!-- Status -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Estado</label
              >
              <select
                formControlName="status"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
              >
                <option value="active">Activa</option>
                <option value="inactive">Inactiva</option>
                <option value="maintenance">En Mantenimiento</option>
              </select>
            </div>

            <!-- Description -->
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Descripción</label
              >
              <textarea
                formControlName="description"
                rows="3"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Breve descripción de tu tienda"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- Address Information -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Información de Dirección
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Street -->
            <div class="md:col-span-2">
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Dirección</label
              >
              <input
                type="text"
                formControlName="address.street"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Calle 123 #45-67"
              />
            </div>

            <!-- City -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Ciudad</label
              >
              <input
                type="text"
                formControlName="address.city"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Bogotá"
              />
            </div>

            <!-- State -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Departamento</label
              >
              <input
                type="text"
                formControlName="address.state"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Cundinamarca"
              />
            </div>

            <!-- ZIP Code -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >Código Postal</label
              >
              <input
                type="text"
                formControlName="address.zipCode"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="110111"
              />
            </div>

            <!-- Country -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2"
                >País</label
              >
              <input
                type="text"
                formControlName="address.country"
                class="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text-primary"
                placeholder="Colombia"
              />
            </div>
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
