import { Component, effect, input, output } from '@angular/core';

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

  form: FormGroup;

  constructor(private fb: FormBuilder) {
    this.form = this.createForm();
    effect(() => {
      const current = this.brand();
      const open = this.isOpen();
      if (current) {
        this.patchForm(current);
      } else if (open && !current) {
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
          Validators.maxLength(100),
        ],
      ],
      slug: ['', [Validators.maxLength(120)]],
      description: ['', [Validators.maxLength(1000)]],
      logo_url: ['', [Validators.maxLength(500)]],
      state: [true],
    });
  }

  private patchForm(brand: Brand): void {
    this.form.patchValue({
      name: brand.name,
      slug: brand.slug || '',
      description: brand.description || '',
      logo_url: brand.logo_url || '',
      state: brand.state !== 'inactive',
    });
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
    };

    const payload: CreateBrandDto | UpdateBrandDto = {
      name: value.name,
      slug: value.slug ? value.slug : undefined,
      description: value.description ? value.description : undefined,
      logo_url: value.logo_url ? value.logo_url : undefined,
      state: value.state ? 'active' : 'inactive',
    };

    this.save.emit(payload);
  }
}
