import { Component, input, output, model, inject, signal, DestroyRef } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components';
import { BrandsService } from '../services/brands.service';
import { Brand } from '../interfaces';

@Component({
  selector: 'app-brand-quick-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [size]="'md'"
      [title]="'Crear Nueva Marca'"
      [isOpen]="isOpen()"
      (closed)="onCancel()"
    >
      <form [formGroup]="brandForm" class="space-y-4">
        <app-input
          label="Nombre de Marca"
          placeholder="Ingresa el nombre de la marca"
          formControlName="name"
          [error]="getErrorMessage('name')"
          [required]="true"
        >
        </app-input>

        <app-textarea
          label="Descripción"
          placeholder="Ingresa una descripción (opcional)"
          formControlName="description"
          [rows]="3"
          [control]="brandForm.get('description')"
        >
        </app-textarea>
      </form>

      <div
        class="flex justify-end items-center pt-4 border-t border-gray-200 space-x-3"
      >
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          [disabled]="isSubmitting()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="isSubmitting()"
          [disabled]="brandForm.invalid"
        >
          Crear Marca
        </app-button>
      </div>
    </app-modal>
  `,
})
export class BrandQuickCreateComponent {
  private fb = inject(FormBuilder);
  private brandsService = inject(BrandsService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly created = output<Brand>();
  readonly cancel = output<void>();

  readonly isSubmitting = signal(false);

  brandForm: FormGroup;

  constructor() {
    this.brandForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(100),
        ],
      ],
      description: [''],
    });
  }

  onCancel() {
    this.brandForm.reset();
    this.isOpen.set(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.brandForm.invalid) return;

    this.isSubmitting.set(true);
    const brandData = this.brandForm.value;

    this.brandsService.createBrand(brandData)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brand) => {
          this.toastService.success('Marca creada exitosamente');
          this.created.emit(brand);
          this.isSubmitting.set(false);
          this.brandForm.reset();
          this.isOpen.set(false);
        },
        error: (error) => {
          console.error('Error creating brand:', error);
          this.toastService.error('Error al crear la marca');
          this.isSubmitting.set(false);
        },
      });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.brandForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'Este campo es obligatorio';
    if (field.errors['minlength']) return 'Mínimo 2 caracteres requeridos';
    if (field.errors['maxlength']) return 'Máximo 100 caracteres permitidos';
    return 'Entrada inválida';
  }
}
