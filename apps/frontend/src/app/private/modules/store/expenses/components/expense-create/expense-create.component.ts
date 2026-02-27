import { Component, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { createExpense } from '../../state/actions/expenses.actions';
import { selectActiveExpenseCategories, selectExpensesLoading } from '../../state/selectors/expenses.selectors';
import { ExpenseCategory } from '../../interfaces/expense.interface';
import { ExpensesService } from '../../services/expenses.service';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';

@Component({
  selector: 'vendix-expense-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Nuevo Gasto"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="expenseForm" (ngSubmit)="onSubmit()" class="space-y-4">

          <!-- Description -->
          <app-input
            label="Descripción"
            formControlName="description"
            [control]="expenseForm.get('description')"
            placeholder="Ej: Pago de servicios públicos"
            [required]="true"
          ></app-input>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Amount -->
            <app-input
              label="Monto"
              type="number"
              formControlName="amount"
              [control]="expenseForm.get('amount')"
              [required]="true"
              min="0"
              step="0.01"
              [prefixIcon]="true"
            >
              <span slot="prefix-icon" class="text-text-secondary">$</span>
            </app-input>

            <!-- Date -->
            <app-input
              label="Fecha"
              type="date"
              formControlName="expense_date"
              [control]="expenseForm.get('expense_date')"
              [required]="true"
            ></app-input>
          </div>

          <!-- Category -->
          <app-selector
            label="Categoría"
            formControlName="category_id"
            [options]="(categoryOptions$ | async) || []"
            placeholder="Seleccione una categoría"
          ></app-selector>

          <!-- Notes -->
          <app-textarea
            label="Notas Adicionales"
            formControlName="notes"
            [control]="expenseForm.get('notes')"
            placeholder="Detalles adicionales..."
            [rows]="3"
          ></app-textarea>

          <!-- Receipt Upload -->
          <div class="space-y-2">
            <label class="text-sm font-medium text-text-primary">Comprobante</label>
            <div class="flex items-center gap-3">
              <input
                #fileInput
                type="file"
                accept="image/*,application/pdf"
                class="hidden"
                (change)="onFileSelected($event)"
              />
              <app-button
                variant="outline"
                size="sm"
                type="button"
                (clicked)="fileInput.click()"
              >
                {{ receiptFile ? 'Cambiar archivo' : 'Seleccionar archivo' }}
              </app-button>
              <span *ngIf="receiptFile" class="text-sm text-text-secondary truncate max-w-[200px]">
                {{ receiptFile.name }}
              </span>
            </div>
            <!-- Preview for images -->
            <img
              *ngIf="receiptPreview"
              [src]="receiptPreview"
              alt="Preview"
              class="mt-2 max-h-32 rounded-lg border border-border object-contain"
            />
          </div>

        </form>
      </div>

       <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cancelar
          </app-button>

          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="expenseForm.invalid || submitting"
            [loading]="submitting">
            Guardar Gasto
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class ExpenseCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  private expensesService = inject(ExpensesService);

  expenseForm: FormGroup;
  categories$: Observable<ExpenseCategory[]>;
  categoryOptions$: Observable<SelectorOption[]>;
  loading$: Observable<boolean>;

  receiptFile: File | null = null;
  receiptPreview: string | null = null;
  submitting = false;

  constructor(
    private fb: FormBuilder,
    private store: Store
  ) {
    this.categories$ = this.store.select(selectActiveExpenseCategories);
    this.loading$ = this.store.select(selectExpensesLoading);

    this.categoryOptions$ = this.categories$.pipe(
      map(categories => categories.map(cat => ({
        label: cat.name,
        value: cat.id
      })))
    );

    const today = new Date().toISOString().split('T')[0];

    this.expenseForm = this.fb.group({
      description: ['', [Validators.required, Validators.minLength(3)]],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      category_id: [null],
      expense_date: [today, [Validators.required]],
      notes: ['']
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.receiptFile = input.files[0];

      // Generate preview for images
      if (this.receiptFile.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          this.receiptPreview = e.target?.result as string;
        };
        reader.readAsDataURL(this.receiptFile);
      } else {
        this.receiptPreview = null;
      }
    }
  }

  onSubmit() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.submitting = true;

    const formValue = this.expenseForm.value;
    const categoryId = formValue.category_id ? Number(formValue.category_id) : undefined;
    const expenseDate = new Date(formValue.expense_date);

    const dispatchCreate = (receiptUrl?: string) => {
      this.store.dispatch(createExpense({
        expense: {
          description: formValue.description,
          amount: Number(formValue.amount),
          category_id: categoryId,
          expense_date: expenseDate,
          notes: formValue.notes,
          receipt_url: receiptUrl,
        }
      }));

      this.submitting = false;
      this.resetForm();
      this.onClose();
    };

    // Upload receipt first if present, then create expense
    if (this.receiptFile) {
      this.expensesService.uploadReceipt(this.receiptFile).subscribe({
        next: (result: { key: string; url: string }) => dispatchCreate(result.key),
        error: () => {
          // Create without receipt if upload fails
          this.submitting = false;
          dispatchCreate();
        }
      });
    } else {
      dispatchCreate();
    }
  }

  private resetForm(): void {
    this.expenseForm.reset({
      expense_date: new Date().toISOString().split('T')[0],
    });
    this.receiptFile = null;
    this.receiptPreview = null;
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
