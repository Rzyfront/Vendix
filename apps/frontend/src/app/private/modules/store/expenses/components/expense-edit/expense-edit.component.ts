import { Component, OnInit, OnChanges, SimpleChanges, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, map } from 'rxjs';
import {
  updateExpense,
  loadExpenseCategories,
  approveExpense,
  rejectExpense,
  payExpense,
  cancelExpense,
  deleteExpense,
} from '../../state/actions/expenses.actions';
import { ExpensesService } from '../../services/expenses.service';
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
        <!-- State Badge -->
        <div *ngIf="expense" class="mb-4 flex items-center gap-2">
          <span class="text-sm text-text-secondary">Estado:</span>
          <span [class]="getStateBadgeClass(expense.state)" class="px-2 py-0.5 rounded-full text-xs font-medium">
            {{ getStateLabel(expense.state) }}
          </span>
        </div>

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

          <!-- Receipt -->
          <div class="space-y-2">
            <div *ngIf="expense?.receipt_url" class="flex items-center gap-2">
              <span class="text-sm text-text-secondary">Comprobante:</span>
              <a [href]="expense!.receipt_url" target="_blank" class="text-sm text-primary hover:underline">
                Ver comprobante actual
              </a>
            </div>
            <!-- Upload new receipt (only for pending) -->
            <div *ngIf="expense?.state === 'pending'" class="flex items-center gap-3">
              <input
                #editFileInput
                type="file"
                accept="image/*,application/pdf"
                class="hidden"
                (change)="onFileSelected($event)"
              />
              <app-button
                variant="outline"
                size="sm"
                type="button"
                (clicked)="editFileInput.click()"
              >
                {{ receiptFile ? 'Cambiar archivo' : 'Subir comprobante' }}
              </app-button>
              <span *ngIf="receiptFile" class="text-sm text-text-secondary truncate max-w-[200px]">
                {{ receiptFile.name }}
              </span>
            </div>
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
        <div class="flex flex-col gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <!-- State transition buttons -->
          <div *ngIf="expense" class="flex flex-wrap items-center gap-2">
            <!-- Pending: Approve + Reject -->
            <ng-container *ngIf="expense.state === 'pending'">
              <app-button
                variant="success"
                size="sm"
                (clicked)="onApprove()"
                [loading]="(loading$ | async) || false"
              >
                Aprobar
              </app-button>
              <app-button
                variant="danger"
                size="sm"
                (clicked)="onReject()"
                [loading]="(loading$ | async) || false"
              >
                Rechazar
              </app-button>
            </ng-container>

            <!-- Approved: Pay + Cancel -->
            <ng-container *ngIf="expense.state === 'approved'">
              <app-button
                variant="primary"
                size="sm"
                (clicked)="onPay()"
                [loading]="(loading$ | async) || false"
              >
                Marcar Pagado
              </app-button>
              <app-button
                variant="danger"
                size="sm"
                (clicked)="onCancel()"
                [loading]="(loading$ | async) || false"
              >
                Cancelar
              </app-button>
            </ng-container>

            <!-- Pending: can also cancel -->
            <ng-container *ngIf="expense.state === 'pending'">
              <app-button
                variant="ghost"
                size="sm"
                (clicked)="onCancel()"
                [loading]="(loading$ | async) || false"
              >
                Cancelar Gasto
              </app-button>
            </ng-container>

            <!-- Delete: only pending/rejected -->
            <ng-container *ngIf="expense.state === 'pending' || expense.state === 'rejected'">
              <app-button
                variant="ghost"
                size="sm"
                (clicked)="onDelete()"
                [loading]="(loading$ | async) || false"
              >
                Eliminar
              </app-button>
            </ng-container>
          </div>

          <!-- Save / Close -->
          <div class="flex items-center justify-end gap-3">
            <app-button
              variant="outline"
              (clicked)="onClose()">
              Cerrar
            </app-button>

            <app-button
              *ngIf="expense?.state === 'pending'"
              variant="primary"
              (clicked)="onSubmit()"
              [disabled]="expenseForm.invalid || ((loading$ | async) || false)"
              [loading]="(loading$ | async) || false">
              Actualizar Gasto
            </app-button>
          </div>
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

  receiptFile: File | null = null;
  receiptPreview: string | null = null;
  submitting = false;

  private expensesService = inject(ExpensesService);

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
      // Disable form for non-pending expenses
      if (this.expense.state !== 'pending') {
        this.expenseForm.disable();
      } else {
        this.expenseForm.enable();
      }
    }
  }

  private patchForm(expense: Expense) {
    let dateStr = '';
    if (expense.expense_date) {
      const d = new Date(expense.expense_date);
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

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.receiptFile = input.files[0];
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
    if (this.expenseForm.invalid || !this.expense || this.expense.state !== 'pending') {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.submitting = true;
    const formValue = this.expenseForm.value;
    const categoryId = formValue.category_id ? Number(formValue.category_id) : undefined;
    const expenseDate = new Date(formValue.expense_date);

    const dispatchUpdate = (receiptUrl?: string) => {
      this.store.dispatch(updateExpense({
        id: this.expense!.id,
        expense: {
          description: formValue.description,
          amount: Number(formValue.amount),
          category_id: categoryId,
          expense_date: expenseDate,
          notes: formValue.notes,
          ...(receiptUrl && { receipt_url: receiptUrl }),
        }
      }));
      this.submitting = false;
      this.receiptFile = null;
      this.receiptPreview = null;
      this.onClose();
    };

    if (this.receiptFile) {
      this.expensesService.uploadReceipt(this.receiptFile).subscribe({
        next: (result: { key: string; url: string }) => dispatchUpdate(result.key),
        error: () => {
          this.submitting = false;
          dispatchUpdate();
        }
      });
    } else {
      dispatchUpdate();
    }
  }

  onApprove(): void {
    if (this.expense) {
      this.store.dispatch(approveExpense({ id: this.expense.id }));
      this.onClose();
    }
  }

  onReject(): void {
    if (this.expense) {
      this.store.dispatch(rejectExpense({ id: this.expense.id }));
      this.onClose();
    }
  }

  onPay(): void {
    if (this.expense) {
      this.store.dispatch(payExpense({ id: this.expense.id }));
      this.onClose();
    }
  }

  onCancel(): void {
    if (this.expense) {
      this.store.dispatch(cancelExpense({ id: this.expense.id }));
      this.onClose();
    }
  }

  onDelete(): void {
    if (this.expense) {
      this.store.dispatch(deleteExpense({ id: this.expense.id }));
      this.onClose();
    }
  }

  onClose() {
    this.isOpenChange.emit(false);
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      paid: 'Pagado',
      cancelled: 'Cancelado',
    };
    return labels[state] || state;
  }

  getStateBadgeClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      paid: 'bg-blue-100 text-blue-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return classes[state] || 'bg-gray-100 text-gray-800';
  }
}
