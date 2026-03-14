import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../shared/components';
import { CategoriesService } from '../services/categories.service';
import { ProductCategory } from '../interfaces';

@Component({
  selector: 'app-category-quick-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [size]="'md'"
      [title]="'Crear Nueva Categoría'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="categoryForm" class="space-y-4">
        <app-input
          label="Nombre de Categoría"
          placeholder="Ingresa el nombre de la categoría"
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
          [control]="categoryForm.get('description')"
        >
        </app-textarea>
      </form>

      <div
        class="flex justify-end items-center pt-4 border-t border-gray-200 space-x-3"
      >
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
          [loading]="isSubmitting"
          [disabled]="categoryForm.invalid"
        >
          Crear Categoría
        </app-button>
      </div>
    </app-modal>
  `,
})
export class CategoryQuickCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<ProductCategory>();
  @Output() cancel = new EventEmitter<void>();

  categoryForm: FormGroup;
  isSubmitting = false;

  constructor(
    private fb: FormBuilder,
    private categoriesService: CategoriesService,
    private toastService: ToastService,
  ) {
    this.categoryForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(255),
        ],
      ],
      description: ['', [Validators.maxLength(255)]],
    });
  }

  onCancel() {
    this.categoryForm.reset();
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.categoryForm.invalid) return;

    this.isSubmitting = true;
    const categoryData = this.categoryForm.value;

    // Generate a simple slug from name if not provided (backend usually handles this, but just in case)
    // For now, we send just name and description as per service signature
    this.categoriesService.createCategory(categoryData).subscribe({
      next: (category) => {
        this.toastService.success('Categoría creada exitosamente');
        this.created.emit(category);
        this.isSubmitting = false;
        this.categoryForm.reset();
        this.isOpenChange.emit(false);
      },
      error: (error) => {
        console.error('Error creating category:', error);
        this.toastService.error('Error al crear la categoría');
        this.isSubmitting = false;
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.categoryForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'Este campo es obligatorio';
    if (field.errors['minlength']) return 'Mínimo 2 caracteres requeridos';
    if (field.errors['maxlength']) return 'Máximo 255 caracteres permitidos';
    return 'Entrada inválida';
  }
}
