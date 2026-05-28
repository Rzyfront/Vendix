import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

// Shared Components
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  SettingToggleComponent,
  TextareaComponent,
} from '../../../../../../../shared/components/index';

// Interfaces
import {
  Brand,
  CreateBrandDto,
  UpdateBrandDto,
} from '../../../interfaces';
import { BrandsService } from '../../../services/brands.service';

@Component({
  selector: 'app-brand-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SettingToggleComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="brand() ? 'Editar Marca' : 'Nueva Marca'"
      subtitle="Administra la información de la marca"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Basic Info -->
          <app-input
            label="Nombre *"
            formControlName="name"
            placeholder="Ej: Nike"
            [error]="getError('name')"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Slug"
              formControlName="slug"
              placeholder="nike"
              [error]="getError('slug')"
            ></app-input>
            <app-input
              label="URL del Logo"
              formControlName="logo_url"
              placeholder="https://..."
              [error]="getError('logo_url')"
            ></app-input>
          </div>

          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div class="flex items-center gap-3">
              <div
                class="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white"
              >
                @if (logoPreviewUrl()) {
                  <img
                    [src]="logoPreviewUrl()"
                    alt="Logo de marca"
                    class="h-full w-full object-contain p-2"
                  />
                } @else {
                  <div
                    class="flex h-full w-full items-center justify-center text-xs text-gray-400"
                  >
                    Logo
                  </div>
                }
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-900">
                  Logo para la tienda online
                </p>
                <p class="text-xs text-gray-500">
                  Se usará en el inicio y en filtros visuales de marcas.
                </p>
              </div>
              <input
                #brandLogoInput
                type="file"
                accept="image/*"
                class="hidden"
                (change)="onLogoSelected($event)"
              />
              <app-button
                variant="outline"
                type="button"
                size="sm"
                [loading]="isUploadingLogo()"
                [disabled]="isUploadingLogo()"
                (clicked)="brandLogoInput.click()"
              >
                Subir
              </app-button>
              @if (logoPreviewUrl()) {
                <app-button
                  variant="ghost"
                  type="button"
                  size="sm"
                  (clicked)="removeLogo()"
                >
                  Quitar
                </app-button>
              }
            </div>
          </div>

          <!-- Description -->
          <app-textarea
            label="Descripción"
            formControlName="description"
            [rows]="3"
            placeholder="Describe brevemente la marca..."
            [control]="form.get('description')"
          ></app-textarea>

          <!-- Active Toggle -->
          <app-setting-toggle
            formControlName="state"
            label="Marca activa"
            description="Desactiva para ocultar esta marca del catálogo"
          ></app-setting-toggle>

          <app-setting-toggle
            formControlName="is_featured"
            label="Marca destacada"
            description="Dale prioridad en el inicio de la tienda online"
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
            {{ brand() ? 'Guardar Cambios' : 'Crear Marca' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class BrandFormModalComponent {
  readonly isOpen = input(false);
  readonly brand = input<Brand | null>(null);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateBrandDto | UpdateBrandDto>();

  readonly logoPreviewUrl = signal<string | null>(null);
  readonly isUploadingLogo = signal(false);

  form: FormGroup;
  private readonly brandsService = inject(BrandsService);
  private readonly destroyRef = inject(DestroyRef);

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
    effect(() => {
      const current = this.brand();
      const open = this.isOpen();
      if (current) {
        this.patchForm(current);
      } else if (open && !current) {
        this.form.reset({ state: true, is_featured: false });
        this.logoPreviewUrl.set(null);
      }
    });
  }

  private createForm(): FormGroup {
    return this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(100),
        ],
      ],
      slug: ['', [Validators.maxLength(120)]],
      description: ['', [Validators.maxLength(1000)]],
      logo_url: ['', [Validators.maxLength(500)]],
      state: [true],
      is_featured: [false],
    });
  }

  private patchForm(brand: Brand): void {
    this.form.patchValue({
      name: brand.name,
      slug: brand.slug || '',
      description: brand.description || '',
      logo_url: brand.logo_url || '',
      state: brand.state !== 'inactive',
      is_featured: !!brand.is_featured,
    });
    this.logoPreviewUrl.set(brand.logo_url || null);
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['minlength']) {
        const requiredLength = control.errors['minlength'].requiredLength;
        return `Mínimo ${requiredLength} caracteres`;
      }
      if (control.errors['maxlength']) {
        const requiredLength = control.errors['maxlength'].requiredLength;
        return `Máximo ${requiredLength} caracteres`;
      }
    }
    return '';
  }

  onCancel(): void {
    this.cancel.emit();
  }

  onSubmit(): void {
    if (!this.form.valid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.value as {
      name: string;
      slug: string;
      description: string;
      logo_url: string;
      state: boolean;
      is_featured: boolean;
    };

    const payload: CreateBrandDto | UpdateBrandDto = {
      name: value.name,
      slug: value.slug ? value.slug : undefined,
      description: value.description ? value.description : undefined,
      logo_url: value.logo_url ? value.logo_url : this.brand() ? '' : undefined,
      state: value.state ? 'active' : 'inactive',
      is_featured: !!value.is_featured,
    };

    this.save.emit(payload);
  }

  onLogoSelected(event: Event): void {
    const inputElement = event.target as HTMLInputElement;
    const file = inputElement.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      inputElement.value = '';
      return;
    }

    this.isUploadingLogo.set(true);
    this.brandsService
      .uploadBrandLogo(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.form.patchValue({ logo_url: result.key });
          this.logoPreviewUrl.set(result.url);
          this.form.markAsDirty();
        },
        error: () => {
          this.isUploadingLogo.set(false);
        },
        complete: () => {
          this.isUploadingLogo.set(false);
          inputElement.value = '';
        },
      });
  }

  removeLogo(): void {
    this.form.patchValue({ logo_url: '' });
    this.logoPreviewUrl.set(null);
    this.form.markAsDirty();
  }
}
