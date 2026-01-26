import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { StoreType, OperatingHours } from '../../interfaces/store.interface';
import { OrganizationStoresService } from '../../services/organization-stores.service';

// App shared components
import {
  ModalComponent,
  InputComponent,
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  ToggleComponent,
  SelectorOption,
  ModalSize,
  ButtonVariant,
} from '../../../../../../shared/components/index';

export interface StoreCreateModalData {
  name: string;
  slug?: string;
  store_code?: string;
  store_type?: StoreType;
  website?: string;
  domain?: string;
  timezone?: string;
  is_active?: boolean;
  operating_hours?: any;
  manager_user_id?: number;
  settings?: {
    currency_code?: string;
    color_primary?: string;
    color_secondary?: string;
    [key: string]: any;
  };
}

@Component({
  selector: 'app-store-create-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    ToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Crear Nueva Tienda"
      subtitle="Completa los detalles para crear una nueva tienda en tu organización"
    >
      <form [formGroup]="storeForm" class="space-y-4">
        <!-- Basic Information Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="building" [size]="16" />
            Información Básica
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <app-input
              formControlName="name"
              label="Nombre"
              placeholder="Tienda Central"
              [required]="true"
              [control]="storeForm.get('name')"
              [error]="getErrorMessage(storeForm.get('name'))"
              size="md"
            >
              <app-icon name="building" [size]="16" slot="prefix" />
            </app-input>

            <app-input
              formControlName="store_code"
              label="Código"
              placeholder="TC001"
              [required]="true"
              [control]="storeForm.get('store_code')"
              [error]="getErrorMessage(storeForm.get('store_code'))"
              size="md"
            >
              <app-icon name="hash" [size]="16" slot="prefix" />
            </app-input>

            <app-input
              formControlName="slug"
              label="Slug"
              placeholder="tienda-central"
              [control]="storeForm.get('slug')"
              [helperText]="'Generado automáticamente desde el nombre'"
              size="md"
            >
              <app-icon name="link" [size]="16" slot="prefix" />
            </app-input>

            <app-selector
              formControlName="store_type"
              label="Tipo de Tienda"
              [options]="storeTypeOptions"
              [required]="true"
              [errorText]="getErrorMessage(storeForm.get('store_type'))"
              placeholder="Seleccionar tipo"
              size="md"
            />
          </div>
        </div>

        <!-- Store Configuration Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="settings" [size]="16" />
            Configuración
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <app-input
              formControlName="website"
              label="Sitio Web"
              type="url"
              placeholder="https://ejemplo.com"
              [control]="storeForm.get('website')"
              size="md"
            >
              <app-icon name="globe" [size]="16" slot="prefix" />
            </app-input>

            <app-input
              formControlName="domain"
              label="Dominio"
              placeholder="tienda.ejemplo.com"
              [control]="storeForm.get('domain')"
              size="md"
            >
              <app-icon name="link-2" [size]="16" slot="prefix" />
            </app-input>

            <app-selector
              formControlName="timezone"
              label="Zona Horaria"
              [options]="timezoneOptions"
              placeholder="Seleccionar zona horaria"
              size="md"
            />

            <app-selector
              formControlName="currency_code"
              label="Moneda"
              [options]="currencyOptions"
              placeholder="Seleccionar moneda"
              size="md"
            />
          </div>

          <!-- Color Configuration -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div class="space-y-2">
              <label
                class="block text-sm font-medium text-[var(--color-text-primary)]"
              >
                Color Primario
              </label>
              <div class="flex items-center gap-3">
                <input
                  type="color"
                  formControlName="color_primary"
                  class="h-10 w-20 border border-[var(--color-border)] rounded cursor-pointer"
                />
                <app-input
                  formControlName="color_primary"
                  placeholder="#7ed7a5"
                  [control]="storeForm.get('color_primary')"
                  size="sm"
                  customClasses="flex-1"
                />
              </div>
            </div>

            <div class="space-y-2">
              <label
                class="block text-sm font-medium text-[var(--color-text-primary)]"
              >
                Color Secundario
              </label>
              <div class="flex items-center gap-3">
                <input
                  type="color"
                  formControlName="color_secondary"
                  class="h-10 w-20 border border-[var(--color-border)] rounded cursor-pointer"
                />
                <app-input
                  formControlName="color_secondary"
                  placeholder="#2f6f4e"
                  [control]="storeForm.get('color_secondary')"
                  size="sm"
                  customClasses="flex-1"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Additional Settings Section -->
        <div
          class="bg-[var(--color-muted)]/50 rounded-lg p-4 border border-[var(--color-border)]"
        >
          <h3
            class="text-sm font-semibold text-[var(--color-text-primary)] mb-3 flex items-center gap-2"
          >
            <app-icon name="sliders" [size]="16" />
            Configuración Adicional
          </h3>
          <div class="flex items-center gap-4">
            <app-toggle formControlName="is_active" label="Tienda activa" />
            <span class="text-sm text-[var(--color-text-secondary)]">
              Las tiendas inactivas no serán visibles para los clientes
            </span>
          </div>
        </div>
      </form>

      <div slot="footer" class="flex justify-between items-center">
        <div class="text-sm text-[var(--color-text-secondary)]">
          <span class="text-[var(--color-destructive)]">*</span> Campos
          requeridos
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onCancel()"
            [disabled]="isSubmitting"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="storeForm.invalid || isSubmitting"
            [loading]="isSubmitting"
          >
            <app-icon name="plus" [size]="16" slot="icon"></app-icon>
            Crear Tienda
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Custom styles for color inputs */
      input[type='color'] {
        -webkit-appearance: none;
        border: none;
        background: transparent;
      }

      input[type='color']::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      input[type='color']::-webkit-color-swatch {
        border: 1px solid var(--color-border);
        border-radius: 4px;
      }
    `,
  ],
})
export class StoreCreateModalComponent implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() isSubmitting = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() submit = new EventEmitter<StoreCreateModalData>();
  @Output() cancel = new EventEmitter<void>();

  storeForm!: FormGroup;
  storeTypeOptions: SelectorOption[] = [];
  timezoneOptions: SelectorOption[] = [];
  currencyOptions: SelectorOption[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private fb: FormBuilder,
    private storesService: OrganizationStoresService,
  ) {
    this.initializeForm();
  }

  ngOnInit(): void {
    this.loadOptions();
    this.setupAutoSlugGeneration();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeForm(): void {
    this.storeForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(255),
        ],
      ],
      slug: [''],
      store_code: ['', [Validators.maxLength(20)]],
      store_type: [StoreType.PHYSICAL, [Validators.required]],
      website: [''],
      domain: [''],
      timezone: [''],
      currency_code: [''],
      color_primary: ['#7ed7a5'],
      color_secondary: ['#2f6f4e'],
      is_active: [true],
      operating_hours: [null],
      manager_user_id: [null],
    });
  }

  private loadOptions(): void {
    this.storeTypeOptions = this.storesService.getStoreTypeOptions();
    this.timezoneOptions = this.storesService.getTimezoneOptions();
    this.currencyOptions = this.storesService.getCurrencyOptions();
  }

  private setupAutoSlugGeneration(): void {
    this.storeForm
      .get('name')
      ?.valueChanges.pipe(takeUntil(this.destroy$))
      .subscribe((name) => {
        const slugControl = this.storeForm.get('slug');
        if (name && !slugControl?.value) {
          const slug = this.generateSlug(name);
          slugControl?.setValue(slug);
        }
      });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  onModalChange(isOpen: boolean): void {
    this.isOpenChange.emit(isOpen);
    if (!isOpen) {
      this.resetForm();
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.storeForm.invalid) {
      this.storeForm.markAllAsTouched();
      return;
    }

    const formValue = this.storeForm.value;

    // Map form values to DTO structure
    const storeData: StoreCreateModalData = {
      name: formValue.name,
      slug: formValue.slug || undefined,
      store_code: formValue.store_code || undefined,
      store_type: formValue.store_type,
      website: formValue.website || undefined,
      domain: formValue.domain || undefined,
      timezone: formValue.timezone || undefined,
      is_active: formValue.is_active || false,
      operating_hours: formValue.operating_hours || undefined,
      manager_user_id: formValue.manager_user_id || undefined,
      settings: {
        currency_code: formValue.currency_code || undefined,
        color_primary: formValue.color_primary || undefined,
        color_secondary: formValue.color_secondary || undefined,
      },
    };

    // Remove undefined values
    Object.keys(storeData).forEach((key) => {
      if (
        storeData[key as keyof StoreCreateModalData] === undefined ||
        storeData[key as keyof StoreCreateModalData] === ''
      ) {
        delete storeData[key as keyof StoreCreateModalData];
      }
    });

    this.submit.emit(storeData);
  }

  private resetForm(): void {
    this.storeForm.reset({
      name: '',
      slug: '',
      store_code: '',
      store_type: StoreType.PHYSICAL,
      website: '',
      domain: '',
      timezone: '',
      currency_code: '',
      color_primary: '#7ed7a5',
      color_secondary: '#2f6f4e',
      is_active: true,
      operating_hours: null,
      manager_user_id: null,
    });
  }

  getErrorMessage(control: AbstractControl | null): string {
    if (!control || !control.errors || !control.touched) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }
    if (errors['maxlength']) {
      return `Máximo ${errors['maxlength'].requiredLength} caracteres`;
    }
    if (errors['pattern']) {
      return 'Formato inválido. Solo letras, números, guiones y guiones bajos';
    }
    if (errors['email']) {
      return 'Email inválido';
    }

    return 'Valor inválido';
  }
}
