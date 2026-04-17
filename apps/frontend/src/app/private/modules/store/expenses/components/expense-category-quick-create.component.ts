import {Component, inject, signal, input, output, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { ExpensesService } from '../services/expenses.service';
import { ExpenseCategory } from '../interfaces/expense.interface';

@Component({
  selector: 'vendix-expense-category-quick-create',
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
      [title]="'Crear Categoría de Gasto'"
      [isOpen]="isOpen()"
      (closed)="onCancel()"
    >
      <form [formGroup]="categoryForm" class="space-y-4">
        <app-input
          label="Nombre de Categoría"
          placeholder="Ej: Servicios públicos, Arriendo..."
          formControlName="name"
          [error]="getErrorMessage('name')"
          [required]="true"
        >
        </app-input>

        <app-textarea
          label="Descripción"
          placeholder="Descripción opcional de la categoría"
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
          [disabled]="isSubmitting()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onSubmit()"
          [loading]="isSubmitting()"
          [disabled]="categoryForm.invalid"
        >
          Crear Categoría
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ExpenseCategoryQuickCreateComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly created = output<ExpenseCategory>();

  private fb = inject(FormBuilder);
  private expensesService = inject(ExpensesService);
  private toastService = inject(ToastService);

  readonly isSubmitting = signal(false);

  categoryForm: FormGroup = this.fb.group({
    name: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(255),
      ],
    ],
    description: ['', [Validators.maxLength(255)]],
  });

  onCancel() {
    this.categoryForm.reset();
    this.isOpenChange.emit(false);
  }

  onSubmit() {
    if (this.categoryForm.invalid) return;

    this.isSubmitting.set(true);
    const categoryData = this.categoryForm.value;

    this.expensesService.createExpenseCategory(categoryData).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.toastService.success('Categoría de gasto creada exitosamente');
        this.created.emit(response.data);
        this.isSubmitting.set(false);
        this.categoryForm.reset();
        this.isOpenChange.emit(false);
      },
      error: (error) => {
        console.error('Error creating expense category:', error);
        this.toastService.error('Error al crear la categoría');
        this.isSubmitting.set(false);
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.categoryForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'Este campo es obligatorio';
    if (field.errors['minlength']) return 'Mínimo 3 caracteres requeridos';
    if (field.errors['maxlength']) return 'Máximo 255 caracteres permitidos';
    return 'Entrada inválida';
  }
}
