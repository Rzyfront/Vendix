import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { CreateStoreDto, StoreType, OperatingHours } from '../../interfaces/store.interface';
import { OrganizationStoresService } from '../../services/organization-stores.service';

// App shared components
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  IconComponent
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'lg'"
      title="Crear Nueva Tienda"
      subtitle="Completa los detalles para crear una nueva tienda en tu organización"
      (openChange)="onModalChange($event)"
    >
      <form [formGroup]="storeForm" class="space-y-6">
        <!-- Basic Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Información Básica</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="name"
              label="Nombre de la Tienda"
              placeholder="Ej: Tienda Central"
              [required]="true"
              [control]="storeForm.get('name')"
              [error]="storeForm.get('name')?.invalid && storeForm.get('name')?.touched ? 'El nombre es requerido' : ''"
            >
              <app-icon slot="prefix" name="building" [size]="16" />
            </app-input>

            <app-input
              formControlName="slug"
              label="Slug"
              placeholder="tienda-central"
              [control]="storeForm.get('slug')"
            >
              <app-icon slot="prefix" name="link" [size]="16" />
              <div class="text-xs text-text-secondary mt-1">Se generará automáticamente si no se especifica</div>
            </app-input>

            <app-input
              formControlName="store_code"
              label="Código de Tienda"
              placeholder="TC001"
              [required]="true"
              [control]="storeForm.get('store_code')"
              [error]="storeForm.get('store_code')?.invalid && storeForm.get('store_code')?.touched ? 'El código es requerido' : ''"
            >
              <app-icon slot="prefix" name="hash" [size]="16" />
            </app-input>

            <app-input
              formControlName="email"
              label="Email de Contacto"
              type="email"
              placeholder="tienda@ejemplo.com"
              [required]="true"
              [control]="storeForm.get('email')"
              [error]="storeForm.get('email')?.invalid && storeForm.get('email')?.touched ? 'Email inválido' : ''"
            >
              <app-icon slot="prefix" name="mail" [size]="16" />
            </app-input>

            <app-input
              formControlName="phone"
              label="Teléfono"
              type="tel"
              placeholder="+52 (555) 123-4567"
              [control]="storeForm.get('phone')"
            >
              <app-icon slot="prefix" name="phone" [size]="16" />
            </app-input>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Tipo de Tienda</label>
              <select
                formControlName="store_type"
                class="w-full h-[var(--height-md)] px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                [class]="{'border-[var(--color-destructive)]': storeForm.get('store_type')?.invalid && storeForm.get('store_type')?.touched}"
              >
                <option value="">Seleccionar tipo</option>
                <option *ngFor="let option of storeTypeOptions" [value]="option.value">
                  {{ option.label }}
                </option>
              </select>
              <div *ngIf="storeForm.get('store_type')?.invalid && storeForm.get('store_type')?.touched"
                   class="text-[var(--color-destructive)] text-xs mt-1">
                El tipo es requerido
              </div>
            </div>
          </div>
        </div>

        <!-- Store Configuration -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Configuración de la Tienda</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              formControlName="website"
              label="Sitio Web"
              type="url"
              placeholder="https://ejemplo.com"
              [control]="storeForm.get('website')"
            >
              <app-icon slot="prefix" name="globe" [size]="16" />
            </app-input>

            <app-input
              formControlName="domain"
              label="Dominio"
              placeholder="tienda.ejemplo.com"
              [control]="storeForm.get('domain')"
            >
              <app-icon slot="prefix" name="link-2" [size]="16" />
            </app-input>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Zona Horaria</label>
              <select
                formControlName="timezone"
                class="w-full h-[var(--height-md)] px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              >
                <option value="">Seleccionar zona horaria</option>
                <option *ngFor="let option of timezoneOptions" [value]="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Moneda</label>
              <select
                formControlName="currency_code"
                class="w-full h-[var(--height-md)] px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
              >
                <option value="">Seleccionar moneda</option>
                <option *ngFor="let option of currencyOptions" [value]="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Color Primario</label>
              <div class="flex items-center space-x-3">
                <input
                  type="color"
                  formControlName="color_primary"
                  class="h-10 w-20 px-2 py-1 border border-border rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                <span class="text-sm text-text-secondary">{{ storeForm.value.color_primary }}</span>
              </div>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Color Secundario</label>
              <div class="flex items-center space-x-3">
                <input
                  type="color"
                  formControlName="color_secondary"
                  class="h-10 w-20 px-2 py-1 border border-border rounded-[var(--radius-md)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                <span class="text-sm text-text-secondary">{{ storeForm.value.color_secondary }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Address Information -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Dirección</h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="md:col-span-2">
              <app-input
                formControlName="address"
                label="Dirección"
                placeholder="Calle Principal #123"
                [control]="storeForm.get('address')"
              >
                <app-icon slot="prefix" name="map-pin" [size]="16" />
              </app-input>
            </div>

            <app-input
              formControlName="city"
              label="Ciudad"
              placeholder="Ciudad de México"
              [control]="storeForm.get('city')"
            >
              <app-icon slot="prefix" name="map" [size]="16" />
            </app-input>

            <app-input
              formControlName="country"
              label="País"
              placeholder="México"
              [control]="storeForm.get('country')"
            >
              <app-icon slot="prefix" name="flag" [size]="16" />
            </app-input>
          </div>
        </div>

        <!-- Additional Settings -->
        <div class="space-y-4">
          <h3 class="text-lg font-semibold text-text-primary border-b border-border pb-2">Configuración Adicional</h3>

          <div class="space-y-4">
            <div class="flex items-center">
              <input
                type="checkbox"
                formControlName="is_active"
                class="h-4 w-4 text-[var(--color-primary)] focus:ring-[var(--color-primary)] border-border rounded"
              >
              <label class="ml-2 block text-sm text-text-primary">
                Tienda activa (puede recibir pedidos)
              </label>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-text-primary">Descripción</label>
              <textarea
                formControlName="description"
                placeholder="Descripción breve de la tienda..."
                rows="3"
                class="w-full px-3 py-2 border border-border rounded-[var(--radius-md)] bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent resize-none"
              ></textarea>
            </div>
          </div>
        </div>
      </form>

      <ng-template #footer>
        <div class="flex justify-end space-x-3">
          <app-button
            (click)="closeModal()"
            variant="outline"
            size="md"
            [disabled]="isSubmitting"
          >
            Cancelar
          </app-button>
          <app-button
            (click)="onSubmit()"
            variant="primary"
            size="md"
            [disabled]="storeForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            <ng-container *ngIf="!isSubmitting">
              <app-icon name="plus" [size]="16" class="mr-2" />
              Crear Tienda
            </ng-container>
            <ng-container *ngIf="isSubmitting">
              <app-icon name="loader-2" [size]="16" class="mr-2 animate-spin" />
              Creando...
            </ng-container>
          </app-button>
        </div>
      </ng-template>
    </app-modal>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class StoreCreateModalComponent implements OnInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() storeCreated = new EventEmitter<any>();

  storeForm: FormGroup;
  isSubmitting = false;
  storeTypeOptions: Array<{ value: StoreType; label: string }> = [];
  timezoneOptions: Array<{ value: string; label: string }> = [];
  currencyOptions: Array<{ value: string; label: string }> = [];

  constructor(
    private fb: FormBuilder,
    private storesService: OrganizationStoresService
  ) {
    this.storeForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(255)]],
      slug: [''],
      store_code: ['', [Validators.required, Validators.maxLength(20)]],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      store_type: [StoreType.PHYSICAL, [Validators.required]],
      website: [''],
      domain: [''],
      timezone: [''],
      currency_code: [''],
      color_primary: ['#7ed7a5'],
      color_secondary: ['#2f6f4e'],
      address: [''],
      city: [''],
      country: [''],
      is_active: [true],
      description: [''],
      operating_hours: [null],
      manager_user_id: [null]
    });

    // Auto-generate slug from name
    this.storeForm.get('name')?.valueChanges.subscribe(name => {
      if (name && !this.storeForm.get('slug')?.value) {
        const slug = name.toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim('-');
        this.storeForm.get('slug')?.setValue(slug);
      }
    });
  }

  ngOnInit(): void {
    this.storeTypeOptions = this.storesService.getStoreTypeOptions();
    this.timezoneOptions = this.storesService.getTimezoneOptions();
    this.currencyOptions = this.storesService.getCurrencyOptions();
  }

  onModalChange(isOpen: boolean): void {
    if (!isOpen) {
      this.closeModal();
    }
    this.isOpenChange.emit(isOpen);
  }

  closeModal(): void {
    this.isOpen = false;
    this.isOpenChange.emit(false);
    this.resetForm();
  }

  onSubmit(): void {
    if (this.storeForm.invalid) {
      this.storeForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;

    const storeData: Omit<CreateStoreDto, 'organization_id'> = {
      ...this.storeForm.value,
      is_active: this.storeForm.value.is_active || false,
    };

    this.storesService.createStore(storeData).subscribe({
      next: (response) => {
        this.isSubmitting = false;
        this.storeCreated.emit(response.data);
        this.closeModal();
      },
      error: (error) => {
        this.isSubmitting = false;
        console.error('Error creating store:', error);
        // Handle error display
      }
    });
  }

  private resetForm(): void {
    this.storeForm.reset({
      name: '',
      slug: '',
      store_code: '',
      email: '',
      phone: '',
      store_type: StoreType.PHYSICAL,
      website: '',
      domain: '',
      timezone: '',
      currency_code: '',
      color_primary: '#7ed7a5',
      color_secondary: '#2f6f4e',
      address: '',
      city: '',
      country: '',
      is_active: true,
      description: '',
      operating_hours: null,
      manager_user_id: null
    });
  }
}