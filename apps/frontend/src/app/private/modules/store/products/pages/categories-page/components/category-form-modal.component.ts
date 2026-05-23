import { Component, input, output, effect } from '@angular/core';

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
  InputComponent,
  TextareaComponent,
  SettingToggleComponent,
} from '../../../../../../../shared/components/index';

// Interfaces
import {
  ProductCategory,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../../../interfaces';

@Component({
  selector: 'app-category-form-modal',
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

          <!-- Image URL -->
          <app-input
            label="URL de Imagen"
            formControlName="image_url"
            placeholder="https://..."
            [error]="getError('image_url')"
          ></app-input>

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
            {{ category() ? 'Guardar Cambios' : 'Crear Categoría' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class CategoryFormModalComponent {
  readonly isOpen = input(false);
  readonly category = input<ProductCategory | null>(null);
  readonly isSubmitting = input(false);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateCategoryDto | UpdateCategoryDto>();

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
    effect(() => {
      const cat = this.category();
      const isOpen = this.isOpen();
      if (cat) {
        this.patchForm(cat);
      } else if (isOpen && !cat) {
        this.form.reset({ state: true });
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
    });
  }

  private patchForm(category: ProductCategory): void {
    this.form.patchValue({
      name: category.name ?? '',
      slug: category.slug ?? '',
      description: category.description ?? '',
      image_url: category.image_url ?? '',
      state: category.state ? category.state === 'active' : true,
    });
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
    if (imageUrl) payload.image_url = imageUrl;

    payload.state = raw.state ? 'active' : 'inactive';

    this.save.emit(payload);
  }
}
