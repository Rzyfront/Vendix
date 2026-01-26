import { Component, OnInit, OnChanges, SimpleChanges, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import { updateExpense, loadExpenseCategories } from '../../state/actions/expenses.actions';
import { selectActiveExpenseCategories, selectExpensesLoading } from '../../state/selectors/expenses.selectors';
import { Expense, ExpenseCategory } from '../../interfaces/expense.interface';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';

@Component({
  selector: 'vendix-expense-edit',
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
      title="Editar Gasto"
      size="md"
    >
      <div class="p-4">
        <form [formGroup]="expenseForm" (ngSubmit)="onSubmit()" class="space-y-4">
          
          <!-- Description -->
          <app-input
            label="Descripción"
            formControlName="description"
            [control]="expenseForm.get('description')"
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
            [disabled]="expenseForm.invalid || ((loading$ | async) || false)"
            [loading]="(loading$ | async) || false">
            Actualizar Gasto
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class ExpenseEditComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() expense: Expense | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();

  expenseForm: FormGroup;
  categories$: Observable<ExpenseCategory[]>;
  categoryOptions$: Observable<SelectorOption[]>;
  loading$: Observable<boolean>;

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

    this.expenseForm = this.fb.group({
      description: ['', [Validators.required, Validators.minLength(3)]],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      category_id: [null],
      expense_date: ['', [Validators.required]],
      notes: ['']
    });
  }

  ngOnInit() {
    this.store.dispatch(loadExpenseCategories());
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['expense'] && this.expense) {
      this.patchForm(this.expense);
    }
  }

  private patchForm(expense: Expense) {
    let dateStr = '';
    if (expense.expense_date) {
      // Handle Date object or string
      const d = new Date(expense.expense_date);
      // Format YYYY-MM-DD
      dateStr = d.toISOString().split('T')[0];
    }

    this.expenseForm.patchValue({
      description: expense.description,
      amount: expense.amount,
      category_id: expense.category_id,
      expense_date: dateStr,
      notes: expense.notes
    });
  }

  onSubmit() {
    if (this.expenseForm.valid && this.expense) {
      const formValue = this.expenseForm.value;
      const categoryId = formValue.category_id ? Number(formValue.category_id) : undefined;
      const expenseDate = new Date(formValue.expense_date);

      this.store.dispatch(updateExpense({
        id: this.expense.id,
        expense: {
          description: formValue.description,
          amount: Number(formValue.amount),
          category_id: categoryId,
          expense_date: expenseDate,
          notes: formValue.notes,
          currency: 'USD'
        }
      }));

      this.onClose();
    } else {
      this.expenseForm.markAllAsTouched();
    }
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
