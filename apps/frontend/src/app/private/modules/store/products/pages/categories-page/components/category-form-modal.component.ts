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
import { firstValueFrom } from 'rxjs';

import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  TextareaComponent,
  SettingToggleComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

// Interfaces
import {
  ProductCategory,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../../../interfaces';
import { CategoriesService } from '../../../services/categories.service';
import { ProductImageSourceModalComponent } from '../../../components/product-image-source-modal.component';
import { dataUrlToFile } from '../../../../../../../shared/utils';

@Component({
  selector: 'app-category-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    TextareaComponent,
    SettingToggleComponent,
    ProductImageSourceModalComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      [title]="category() ? 'Editar Categoría' : 'Nueva Categoría'"
      subtitle="Administra la información de la categoría"
    >
      <form [formGroup]="form" (ngSubmit)="onSubmit()">
        <div class="space-y-4">
          <!-- Name + Slug -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-input
              label="Nombre *"
              formControlName="name"
              placeholder="Nombre de la categoría"
              [error]="getError('name')"
            ></app-input>
            <app-input
              label="Slug"
              formControlName="slug"
              placeholder="nombre-categoria"
              [error]="getError('slug')"
            ></app-input>
          </div>

          <div class="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div class="flex items-center gap-3">
              <div
                class="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white"
              >
                @if (imagePreviewUrl()) {
                  <img
                    [src]="imagePreviewUrl()"
                    alt="Imagen de categoría"
                    class="h-full w-full object-cover"
                  />
                } @else {
                  <div
                    class="flex h-full w-full items-center justify-center text-xs text-gray-400"
                  >
                    Imagen
                  </div>
                }
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-900">
                  Imagen para la tienda online
                </p>
                <p class="text-xs text-gray-500">
                  Se usará en el inicio y en filtros visuales de categorías.
                </p>
              </div>
              <app-button
                variant="outline"
                type="button"
                size="sm"
                [loading]="isUploadingImage()"
                [disabled]="isUploadingImage()"
                (clicked)="openImageSourceModal()"
              >
                <app-icon slot="icon" name="image" size="16"></app-icon>
                {{ imagePreviewUrl() ? 'Cambiar' : 'Agregar' }}
              </app-button>
              @if (imagePreviewUrl()) {
                <app-button
                  variant="ghost"
                  type="button"
                  size="sm"
                  (clicked)="removeImage()"
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
            placeholder="Descripción opcional..."
            [control]="form.get('description')"
          ></app-textarea>

          <!-- Active Toggle -->
          <app-setting-toggle
            formControlName="state"
            label="Categoría activa"
            description="Desactiva para ocultar esta categoría del catálogo"
          ></app-setting-toggle>

          <app-setting-toggle
            formControlName="is_featured"
            label="Categoría destacada"
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
            [disabled]="form.invalid || isSubmitting() || isUploadingImage()"
            (clicked)="onSubmit()"
          >
            {{ category() ? 'Guardar Cambios' : 'Crear Categoría' }}
          </app-button>
        </div>
      </div>
    </app-modal>

    <app-product-image-source-modal
      [isOpen]="isImageSourceModalOpen()"
      (isOpenChange)="isImageSourceModalOpen.set($event)"
      [remainingSlots]="1"
      [allowAiEnhance]="false"
      (imagesAdded)="onImagesAdded($event)"
    ></app-product-image-source-modal>
  `,
})
export class CategoryFormModalComponent {
  readonly isOpen = input(false);
  readonly category = input<ProductCategory | null>(null);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateCategoryDto | UpdateCategoryDto>();

  readonly imagePreviewUrl = signal<string | null>(null);
  readonly isUploadingImage = signal(false);
  readonly isImageSourceModalOpen = signal(false);

  form: FormGroup;
  private readonly categoriesService = inject(CategoriesService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
    effect(() => {
      const cat = this.category();
      const isOpen = this.isOpen();
      if (cat) {
        this.patchForm(cat);
      } else if (isOpen && !cat) {
        this.form.reset({ state: true, is_featured: false });
        this.imagePreviewUrl.set(null);
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
          Validators.maxLength(255),
        ],
      ],
      slug: ['', [Validators.maxLength(255)]],
      description: ['', [Validators.maxLength(1000)]],
      image_url: ['', [Validators.maxLength(500)]],
      state: [true],
      is_featured: [false],
    });
  }

  private patchForm(category: ProductCategory): void {
    this.form.patchValue({
      name: category.name ?? '',
      slug: category.slug ?? '',
      description: category.description ?? '',
      image_url: category.image_url ?? '',
      state: category.state ? category.state === 'active' : true,
      is_featured: !!category.is_featured,
    });
    this.imagePreviewUrl.set(category.image_url ?? null);
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['minlength']) {
        const min = control.errors['minlength'].requiredLength;
        return `Mínimo ${min} caracteres`;
      }
      if (control.errors['maxlength']) {
        const max = control.errors['maxlength'].requiredLength;
        return `Máximo ${max} caracteres`;
      }
    }
    return '';
  }

  onCancel(): void {
    this.isImageSourceModalOpen.set(false);
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue();
    const payload: CreateCategoryDto | UpdateCategoryDto = {
      name: (raw.name ?? '').trim(),
    };

    const slug = (raw.slug ?? '').trim();
    if (slug) payload.slug = slug;

    const description = (raw.description ?? '').trim();
    if (description) payload.description = description;

    const imageUrl = (raw.image_url ?? '').trim();
    if (imageUrl || this.category()) payload.image_url = imageUrl;

    payload.state = raw.state ? 'active' : 'inactive';

    const nextFeatured = !!raw.is_featured;
    const currentFeatured = !!this.category()?.is_featured;
    if (nextFeatured || (this.category() && nextFeatured !== currentFeatured)) {
      payload.is_featured = nextFeatured;
    }

    this.save.emit(payload);
  }

  openImageSourceModal(): void {
    if (this.isUploadingImage()) return;
    this.isImageSourceModalOpen.set(true);
  }

  async onImagesAdded(images: string[]): Promise<void> {
    const dataUrl = images?.[0];
    if (!dataUrl) return;

    this.isUploadingImage.set(true);
    try {
      const file = dataUrlToFile(dataUrl, `category-image-${Date.now()}.jpg`);
      const result = await firstValueFrom(
        this.categoriesService
          .uploadCategoryImage(file)
          .pipe(takeUntilDestroyed(this.destroyRef)),
      );

      this.form.patchValue({ image_url: result.key });
      this.imagePreviewUrl.set(result.url);
      this.form.markAsDirty();
      this.toastService.success('Imagen cargada correctamente');
    } catch {
      this.toastService.error('No pudimos cargar la imagen de la categoría');
    } finally {
      this.isUploadingImage.set(false);
    }
  }

  removeImage(): void {
    this.form.patchValue({ image_url: '' });
    this.imagePreviewUrl.set(null);
    this.form.markAsDirty();
  }
}
