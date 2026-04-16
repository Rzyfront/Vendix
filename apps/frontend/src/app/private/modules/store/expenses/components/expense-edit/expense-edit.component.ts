import {
  Component,
  inject,
  signal,
  effect,
  input,
  output,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  updateExpense,
  approveExpense,
  rejectExpense,
  payExpense,
  cancelExpense,
  refundExpense,
  deleteExpense,
} from '../../state/actions/expenses.actions';
import { ExpensesService } from '../../services/expenses.service';
import {
  selectActiveExpenseCategories,
  selectExpensesLoading,
} from '../../state/selectors/expenses.selectors';
import { Expense, ExpenseCategory } from '../../interfaces/expense.interface';
import { toUTCDateString } from '../../../../../../shared/utils/date.util';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { FileUploadDropzoneComponent } from '../../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';

@Component({
  selector: 'vendix-expense-edit',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    FileUploadDropzoneComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Editar Gasto"
      size="md"
      >
      <!-- State Badge in header -->
      @if (expense()) {
        <span
          slot="header-end"
          [class]="getStateBadgeClass(expense()!.state)"
          class="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
          >
          {{ getStateLabel(expense()!.state) }}
        </span>
      }
    
      <div class="p-4">
        <!-- Refund Info -->
        @if (expense()?.state === 'refunded') {
          <div
            class="mb-4 p-3 bg-orange-50 rounded-lg border border-orange-200 w-full"
            >
            <p class="text-sm text-orange-800">
              <strong>Reembolsado:</strong>
              {{ expense()!.refunded_at | date: 'short' }}
            </p>
            @if (expense()!.refunded_by_user) {
              <p class="text-sm text-orange-700">
                <strong>Por:</strong> {{ expense()!.refunded_by_user!.first_name }}
                {{ expense()!.refunded_by_user!.last_name }}
              </p>
            }
            @if (expense()!.refund_reason) {
              <p
                class="text-sm text-orange-700 mt-1"
                >
                <strong>Motivo:</strong> {{ expense()!.refund_reason }}
              </p>
            }
          </div>
        }
    
        <form
          [formGroup]="expenseForm"
          (ngSubmit)="onSubmit()"
          class="space-y-4"
          >
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
              [currency]="true"
              formControlName="amount"
              [control]="expenseForm.get('amount')"
              [required]="true"
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
            [options]="categoryOptions() || []"
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
            @if (expense()?.receipt_url) {
              <div class="flex items-center gap-2">
                <span class="text-sm text-text-secondary">Comprobante:</span>
                <a
                  [href]="expense()!.receipt_url"
                  target="_blank"
                  class="text-sm text-primary hover:underline"
                  >
                  Ver comprobante actual
                </a>
              </div>
            }
            <!-- Upload new receipt (only for pending) -->
            @if (expense()?.state === 'pending') {
              <app-file-upload-dropzone
                label="Subir comprobante"
                helperText="Imagenes o PDF"
                accept="image/*,application/pdf"
                (fileSelected)="onFileSelected($event)"
                (fileRemoved)="onFileRemoved()"
              ></app-file-upload-dropzone>
            }
          </div>
        </form>
    
        <!-- Action buttons (state transitions) -->
        @if (expense()) {
          @if (
            expense()!.state === 'pending' ||
            expense()!.state === 'approved' ||
            expense()!.state === 'rejected' ||
            expense()!.state === 'paid'
            ) {
            <div
              class="mt-5 pt-4 border-t border-border space-y-2"
              >
              <span
                class="text-xs font-medium text-text-secondary uppercase tracking-wide"
                >Acciones</span
                >
                <!-- Pending: Approve / Reject -->
                @if (expense()!.state === 'pending') {
                  <div
                    class="grid grid-cols-2 gap-2"
                    >
                    <app-button
                      variant="success"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onApprove()"
                      [loading]="loading() || false"
                      >
                      Aprobar
                    </app-button>
                    <app-button
                      variant="danger"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onReject()"
                      [loading]="loading() || false"
                      >
                      Rechazar
                    </app-button>
                  </div>
                }
                <!-- Pending: Cancel + Delete -->
                @if (expense()!.state === 'pending') {
                  <div
                    class="grid grid-cols-2 gap-2"
                    >
                    <app-button
                      variant="outline-warning"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onCancel()"
                      [loading]="loading() || false"
                      >
                      Cancelar Gasto
                    </app-button>
                    <app-button
                      variant="outline-danger"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onDelete()"
                      [loading]="loading() || false"
                      >
                      Eliminar
                    </app-button>
                  </div>
                }
                <!-- Approved: Pay + Cancel -->
                @if (expense()!.state === 'approved') {
                  <div
                    class="grid grid-cols-2 gap-2"
                    >
                    <app-button
                      variant="success"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onPay()"
                      [loading]="loading() || false"
                      >
                      Marcar Pagado
                    </app-button>
                    <app-button
                      variant="outline-warning"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onCancel()"
                      [loading]="loading() || false"
                      >
                      Cancelar
                    </app-button>
                  </div>
                }
                <!-- Rejected: Delete only -->
                @if (expense()!.state === 'rejected') {
                  <div class="flex justify-end">
                    <app-button
                      variant="outline-danger"
                      size="sm"
                      (clicked)="onDelete()"
                      [loading]="loading() || false"
                      >
                      Eliminar
                    </app-button>
                  </div>
                }
                <!-- Paid: Refund -->
                @if (expense()!.state === 'paid') {
                  <div class="flex justify-end">
                    <app-button
                      variant="outline-warning"
                      size="sm"
                      (clicked)="showRefundModal.set(true)"
                      [loading]="loading() || false"
                      >
                      Reembolsar
                    </app-button>
                  </div>
                }
                <!-- Refund Confirmation Modal -->
                @if (showRefundModal()) {
                  <div
                    class="mt-3 p-3 bg-orange-50 rounded-lg border border-orange-200"
                    >
                    <p class="text-sm text-orange-800 mb-2">
                      Confirme el motivo del reembolso:
                    </p>
                    <textarea
                      [ngModel]="refundReason()"
                      (ngModelChange)="refundReason.set($event)"
                      [ngModelOptions]="{ standalone: true }"
                      class="w-full p-2 text-sm border border-orange-300 rounded focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder="Ingrese el motivo del reembolso..."
                      rows="2"
                    ></textarea>
                    <div class="flex justify-end gap-2 mt-2">
                      <app-button
                        variant="outline"
                        size="sm"
                        (clicked)="showRefundModal.set(false)"
                        >
                        Cancelar
                      </app-button>
                      <app-button
                        variant="danger"
                        size="sm"
                        (clicked)="onRefund()"
                        [disabled]="!refundReason().trim()"
                        [loading]="loading() || false"
                        >
                        Confirmar Reembolso
                      </app-button>
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>
    
        <!-- Footer: solo controles del modal -->
        <div slot="footer">
          <div
            class="flex items-center justify-end gap-2 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100"
            >
            <app-button variant="outline" size="sm" (clicked)="onClose()">
              Cerrar
            </app-button>
    
            @if (expense()?.state === 'pending') {
              <app-button
                variant="primary"
                size="sm"
                (clicked)="onSubmit()"
                [disabled]="expenseForm.invalid || loading() || false"
                [loading]="loading() || false"
                >
                Actualizar Gasto
              </app-button>
            }
          </div>
        </div>
      </app-modal>
    `,
})
export class ExpenseEditComponent {
  readonly isOpen = input<boolean>(false);
  readonly expense = input<Expense | null>(null);
  readonly isOpenChange = output<boolean>();

  private expensesService = inject(ExpensesService);
  private fb = inject(FormBuilder);
  private store = inject(Store);

  readonly loading = toSignal(this.store.select(selectExpensesLoading), { initialValue: false });
  readonly categoryOptions = toSignal(
    this.store.select(selectActiveExpenseCategories).pipe(
      map((categories) =>
        categories.map((cat) => ({
          label: cat.name,
          value: cat.id,
        })),
      ),
    ),
    { initialValue: [] as { label: string; value: number }[] }
  );

  readonly receiptFile = signal<File | null>(null);
  readonly submitting = signal(false);
  readonly showRefundModal = signal(false);
  readonly refundReason = signal('');

  expenseForm: FormGroup = this.fb.group({
    description: ['', [Validators.required, Validators.minLength(3)]],
    amount: [null, [Validators.required, Validators.min(0.01)]],
    category_id: [null],
    expense_date: ['', [Validators.required]],
    notes: [''],
  });

  constructor() {
    effect(() => {
      const expense = this.expense();
      if (expense) {
        this.patchForm(expense);
        if (expense.state !== 'pending') {
          this.expenseForm.disable();
        } else {
          this.expenseForm.enable();
        }
      }
    });
  }

  private patchForm(expense: Expense) {
    let dateStr = '';
    if (expense.expense_date) {
      const d = new Date(expense.expense_date);
      dateStr = toUTCDateString(d);
    }

    this.expenseForm.patchValue({
      description: expense.description,
      amount: expense.amount,
      category_id: expense.category_id,
      expense_date: dateStr,
      notes: expense.notes,
    });
  }

  onFileSelected(file: File): void {
    this.receiptFile.set(file);
  }

  onFileRemoved(): void {
    this.receiptFile.set(null);
  }

  onSubmit() {
    const expense = this.expense();
    if (
      this.expenseForm.invalid ||
      !expense ||
      expense.state !== 'pending'
    ) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const formValue = this.expenseForm.value;
    const categoryId = formValue.category_id
      ? Number(formValue.category_id)
      : undefined;
    const expenseDate = new Date(formValue.expense_date);

    const dispatchUpdate = (receiptUrl?: string) => {
      this.store.dispatch(
        updateExpense({
          id: expense.id,
          expense: {
            description: formValue.description,
            amount: Number(formValue.amount),
            category_id: categoryId,
            expense_date: expenseDate,
            notes: formValue.notes,
            ...(receiptUrl && { receipt_url: receiptUrl }),
          },
        }),
      );
      this.submitting.set(false);
      this.receiptFile.set(null);
      this.onClose();
    };

    const currentFile = this.receiptFile();
    if (currentFile) {
      this.expensesService.uploadReceipt(currentFile).subscribe({
        next: (result: { key: string; url: string }) =>
          dispatchUpdate(result.key),
        error: () => {
          this.submitting.set(false);
          dispatchUpdate();
        },
      });
    } else {
      dispatchUpdate();
    }
  }

  onApprove(): void {
    const expense = this.expense();
    if (expense) {
      this.store.dispatch(approveExpense({ id: expense.id }));
      this.onClose();
    }
  }

  onReject(): void {
    const expense = this.expense();
    if (expense) {
      this.store.dispatch(rejectExpense({ id: expense.id }));
      this.onClose();
    }
  }

  onPay(): void {
    const expense = this.expense();
    if (expense) {
      this.store.dispatch(payExpense({ id: expense.id }));
      this.onClose();
    }
  }

  onCancel(): void {
    const expense = this.expense();
    if (expense) {
      this.store.dispatch(cancelExpense({ id: expense.id }));
      this.onClose();
    }
  }

  onDelete(): void {
    const expense = this.expense();
    if (expense) {
      this.store.dispatch(deleteExpense({ id: expense.id }));
      this.onClose();
    }
  }

  onRefund(): void {
    const expense = this.expense();
    const reason = this.refundReason().trim();
    if (expense && reason) {
      this.store.dispatch(
        refundExpense({
          id: expense.id,
          reason,
        }),
      );
      this.showRefundModal.set(false);
      this.refundReason.set('');
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
      refunded: 'Reembolsado',
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
      refunded: 'bg-orange-100 text-orange-800',
    };
    return classes[state] || 'bg-gray-100 text-gray-800';
  }
}
