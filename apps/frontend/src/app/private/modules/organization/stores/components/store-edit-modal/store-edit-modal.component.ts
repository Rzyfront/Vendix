import {
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  IconComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { ImageSourceModalComponent } from '../../../../../../shared/components/image-source-modal/image-source-modal.component';
import { ImageUploadService } from '../../../../../../shared/services/image-upload.service';
import { dataUrlToFile } from '../../../../../../shared/utils/data-url.util';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-store-edit-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
    ImageSourceModalComponent,
  ],
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Editar Tienda"
      subtitle="Actualiza la información de la tienda seleccionada"
    >
      @if (store()) {
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

        <!-- Brand Assets -->
        <div>
          <h3 class="text-lg font-medium text-text-primary mb-4">
            Recursos de Marca
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Logo -->
            <div class="flex items-center gap-4">
              <div
                class="w-16 h-16 rounded-lg border border-border bg-surface-secondary flex items-center justify-center overflow-hidden flex-shrink-0"
              >
                @if (logoPreview()) {
                  <img
                    [src]="logoPreview()"
                    alt="Logo de la tienda"
                    class="w-full h-full object-contain"
                  />
                } @else {
                  <app-icon name="image" size="20" class="text-gray-300" />
                }
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-sm font-medium text-text-primary">Logo</span>
                <span class="text-xs text-text-secondary">PNG, JPG o SVG</span>
                <div class="flex items-center gap-2 mt-1">
                  <app-button
                    variant="outline"
                    size="sm"
                    [loading]="uploadingLogo()"
                    (clicked)="openLogoModal()"
                  >
                    <app-icon name="upload" size="14" slot="icon" />
                    <span>{{ logoPreview() ? 'Cambiar' : 'Subir' }}</span>
                  </app-button>
                  @if (logoPreview()) {
                    <app-button
                      variant="outline-danger"
                      size="sm"
                      (clicked)="removeLogo()"
                    >
                      <app-icon name="x" size="14" slot="icon" />
                    </app-button>
                  }
                </div>
              </div>
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

      <!-- Image source modals (subir / URL / cámara + recorte) -->
      <app-image-source-modal
        [(isOpen)]="logoModalOpen"
        [singleImage]="true"
        [headerTitle]="'Logo'"
        (imagesAdded)="onLogoImages($event)"
      ></app-image-source-modal>

      <div slot="footer" class="flex justify-end gap-3">
        <app-button (clicked)="onCancel()" variant="outline">
          Cancelar
        </app-button>
        <app-button
          (clicked)="onSubmit()"
          [disabled]="
            !editForm.valid ||
            !settingsForm.valid ||
            isSubmitting() ||
            uploadingLogo()
          "
          variant="primary"
          [loading]="isSubmitting()"
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
  private currencyFormatService = inject(CurrencyFormatService);
  private imageUploadService = inject(ImageUploadService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly store = input<StoreListItem>();

  readonly isOpenChange = output<boolean>();
  readonly submit = output<any>();
  readonly cancel = output<void>();

  editForm: FormGroup;
  settingsForm: FormGroup;

  // Brand assets upload state
  readonly logoModalOpen = signal(false);
  readonly logoPreview = signal<string | null>(null);
  readonly uploadingLogo = signal(false);

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
      currency: [this.currencyFormatService.currencyCode() || 'USD'],
      timezone: ['UTC'],
      language: ['en'],
    });
  }

  ngOnChanges(): void {
    const store = this.store();
    if (store) {
      this.editForm.patchValue({
        id: store.id,
        name: store.name,
        description: store.description || '',
        domain: store.domain,
        email: store.email,
        phone: store.phone || '',
        address: {
          street:
            (typeof store.address === 'object'
              ? store.address?.street
              : '') || '',
          city:
            (typeof store.address === 'object'
              ? store.address?.city
              : '') || '',
          state:
            (typeof store.address === 'object'
              ? store.address?.state
              : '') || '',
          zipCode:
            (typeof store.address === 'object'
              ? store.address?.zipCode
              : '') || '',
          country:
            (typeof store.address === 'object'
              ? store.address?.country
              : '') || '',
        },
        status: store.status,
        logoUrl: store.logo_url || '',
      });

      // El backend persiste keys de S3 y devuelve previews firmados en el
      // listado; aquí mostramos la URL/clave existente como preview inicial.
      this.logoPreview.set(store.logo_url || null);

      if (store.settings) {
        this.settingsForm.patchValue(store.settings);
      }
    }
  }

  // --- Logo upload (via app-image-source-modal) ---
  openLogoModal(): void {
    this.logoModalOpen.set(true);
  }

  onLogoImages(dataUrls: string[]): void {
    const dataUrl = dataUrls[0];
    if (!dataUrl) return;
    this.logoPreview.set(dataUrl);
    this.uploadStoreAsset(dataUrl, 'store_logos', 'logoUrl', this.uploadingLogo);
  }

  removeLogo(): void {
    this.logoPreview.set(null);
    this.editForm.get('logoUrl')?.setValue('');
  }

  /**
   * Sube el data URL recortado al endpoint genérico y persiste la `key` de S3
   * en el control de formulario indicado (la enviará `onSubmit` al padre).
   *
   * El upload apunta SIEMPRE a la tienda que se está editando (no a la del
   * `RequestContext`): se envía `storeId` con el id de la tienda del input,
   * para que el backend construya el path S3 de esa tienda (validando que
   * pertenezca a la organización del usuario).
   */
  private uploadStoreAsset(
    dataUrl: string,
    entityType: 'store_logos',
    controlName: 'logoUrl',
    uploadingFlag: ReturnType<typeof signal<boolean>>,
  ): void {
    const storeId = this.store()?.id;
    if (!storeId) {
      this.toastService.error('No se pudo identificar la tienda a editar');
      return;
    }

    const fileName = `${controlName}-${Date.now()}.jpg`;
    const file = dataUrlToFile(dataUrl, fileName);

    uploadingFlag.set(true);
    this.imageUploadService
      .uploadFile(file, entityType, { storeId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.editForm.get(controlName)?.setValue(result.key);
          uploadingFlag.set(false);
        },
        error: (err) => {
          console.error(`Error uploading ${entityType}:`, err);
          this.toastService.error('Error al subir la imagen');
          uploadingFlag.set(false);
        },
      });
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
