import { Component, ViewChild, inject, signal, input, output } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { loadExpenses, loadExpensesSummary, loadExpenseCategories } from '../../state/actions/expenses.actions';
import { selectActiveExpenseCategories } from '../../state/selectors/expenses.selectors';
import { ExpenseCategory } from '../../interfaces/expense.interface';
import { ExpensesService } from '../../services/expenses.service';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  FileUploadDropzoneComponent,
  IconComponent,
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../shared/components';
import { ExpenseCategoryQuickCreateComponent } from '../expense-category-quick-create.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-expense-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    FileUploadDropzoneComponent,
    IconComponent,
    StepsLineComponent,
    ExpenseCategoryQuickCreateComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="currentStep() === 1 ? 'Nuevo Gasto' : 'Confirmar Gasto'"
      size="md"
    >
      <!-- Steps -->
      <app-steps-line
        [steps]="steps"
        [currentStep]="currentStep() - 1"
        size="md"
        primaryColor="var(--color-primary)"
        secondaryColor="var(--color-secondary)"
        class="mb-4 block"
      ></app-steps-line>

      <!-- STEP 1: PREPARAR -->
      @if (currentStep() === 1) {
        <div class="p-4">
          <form [formGroup]="expenseForm" class="space-y-4">

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
                formControlName="amount"
                [control]="expenseForm.get('amount')"
                [required]="true"
                [currency]="true"
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

            <!-- Category with quick-create button -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1">Categoría</label>
              <div class="flex gap-2 items-end">
                <app-selector
                  class="flex-1"
                  formControlName="category_id"
                  [options]="categoryOptions() || []"
                  placeholder="Seleccione una categoría"
                ></app-selector>
                <button
                  type="button"
                  (click)="showCategoryQuickCreate.set(true)"
                  class="flex items-center justify-center w-10 h-10 rounded-xl border border-border bg-surface hover:bg-primary/5 hover:border-primary text-text-secondary hover:text-primary transition-colors shrink-0"
                  title="Crear categoría"
                >
                  <app-icon name="plus" [size]="18"></app-icon>
                </button>
              </div>
            </div>

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
              <app-file-upload-dropzone
                label="Subir comprobante"
                helperText="Imagenes o PDF"
                accept="image/*,application/pdf"
                (fileSelected)="onFileSelected($event)"
                (fileRemoved)="onFileRemoved()"
              ></app-file-upload-dropzone>
            </div>

          </form>
        </div>

        <!-- Quick Create Category Modal -->
        <vendix-expense-category-quick-create
          [isOpen]="showCategoryQuickCreate()"
          (isOpenChange)="showCategoryQuickCreate.set($event)"
          (created)="onCategoryCreated($event)"
        ></vendix-expense-category-quick-create>
      }

      <!-- STEP 2: CONFIRMAR -->
      @if (currentStep() === 2) {
        <div class="p-4 space-y-4">
          <!-- Summary Card -->
          <div class="rounded-xl border border-border overflow-hidden">
            <!-- Description -->
            <div class="p-4 border-b border-border">
              <p class="text-xs text-text-secondary mb-1">Descripción</p>
              <p class="text-sm font-medium text-text-primary">{{ expenseForm.value.description }}</p>
            </div>

            <!-- Amount + Date -->
            <div class="grid grid-cols-2 divide-x divide-border border-b border-border">
              <div class="p-4">
                <p class="text-xs text-text-secondary mb-1">Monto</p>
                <p class="text-lg font-bold text-primary">{{ expenseForm.value.amount | currency }}</p>
              </div>
              <div class="p-4">
                <p class="text-xs text-text-secondary mb-1">Fecha</p>
                <p class="text-sm font-medium text-text-primary">{{ expenseForm.value.expense_date }}</p>
              </div>
            </div>

            <!-- Category -->
            <div class="p-4 border-b border-border">
              <p class="text-xs text-text-secondary mb-1">Categoría</p>
              <p class="text-sm font-medium text-text-primary">{{ getCategoryName() || 'Sin categoría' }}</p>
            </div>

            <!-- Notes -->
            @if (expenseForm.value.notes) {
              <div class="p-4 border-b border-border">
                <p class="text-xs text-text-secondary mb-1">Notas</p>
                <p class="text-sm text-text-primary">{{ expenseForm.value.notes }}</p>
              </div>
            }

            <!-- Receipt -->
            <div class="p-4">
              <p class="text-xs text-text-secondary mb-1">Comprobante</p>
              <div class="flex items-center gap-2">
                <app-icon [name]="receiptFile() ? 'file-check' : 'file'" [size]="16"
                  [class]="receiptFile() ? 'text-success' : 'text-text-secondary'"></app-icon>
                <p class="text-sm text-text-primary">
                  {{ receiptFile() ? receiptFile()!.name : 'No adjunto' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Approve Checkbox -->
          <label class="flex items-start gap-3 p-3 bg-success/5 rounded-xl border border-success/20 cursor-pointer select-none">
            <input
              type="checkbox"
              [ngModel]="confirmApprove()"
              (ngModelChange)="confirmApprove.set($event)"
              class="mt-0.5 w-4 h-4 rounded border-border text-success focus:ring-success"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">Aprobar inmediatamente</p>
              <p class="text-xs text-text-secondary mt-0.5">
                El gasto se creará en estado "aprobado" directamente, omitiendo la revisión.
              </p>
            </div>
          </label>

          <!-- Pay Checkbox (only if approved) -->
          @if (confirmApprove()) {
            <label class="flex items-start gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20 cursor-pointer select-none">
              <input
                type="checkbox"
                [ngModel]="confirmPay()"
                (ngModelChange)="confirmPay.set($event)"
                class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
              />
              <div>
                <p class="text-sm font-medium text-text-primary">Marcar como pagado</p>
                <p class="text-xs text-text-secondary mt-0.5">
                  Además de aprobar, el gasto se registrará como pagado inmediatamente.
                </p>
              </div>
            </label>
          }
        </div>
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-between gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <div>
          @if (currentStep() > 1) {
            <app-button variant="outline" type="button" (clicked)="goToStep(currentStep() - 1)" customClasses="!rounded-xl">
              <app-icon name="arrow-left" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Atrás
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            type="button"
            (clicked)="onClose()"
            customClasses="!rounded-xl"
          >
            Cancelar
          </app-button>
          @if (currentStep() < 2) {
            <app-button
              variant="primary"
              type="button"
              (clicked)="goToStep(currentStep() + 1)"
              [disabled]="!canAdvance()"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              Continuar
              <app-icon name="arrow-right" [size]="14" class="ml-1.5" slot="icon"></app-icon>
            </app-button>
          } @else {
            <app-button
              variant="outline"
              type="button"
              (clicked)="onSubmit('pending')"
              [loading]="submitting()"
              [disabled]="submitting()"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon name="file-text" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Guardar
            </app-button>
            @if (confirmApprove() && !confirmPay()) {
              <app-button
                variant="primary"
                type="button"
                (clicked)="onSubmit('approved')"
                [loading]="submitting()"
                [disabled]="submitting()"
                customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
              >
                <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
                Guardar y Aprobar
              </app-button>
            }
            @if (confirmApprove() && confirmPay()) {
              <app-button
                variant="primary"
                type="button"
                (clicked)="onSubmit('paid')"
                [loading]="submitting()"
                [disabled]="submitting()"
                customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
              >
                <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
                Guardar y Pagar
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>
  `
})
export class ExpenseCreateComponent {
  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();

  private expensesService = inject(ExpensesService);
  private fb = inject(FormBuilder);
  private store = inject(Store);

  private readonly categories = toSignal(this.store.select(selectActiveExpenseCategories), { initialValue: [] as ExpenseCategory[] });
  readonly categoryOptions = toSignal(
    this.store.select(selectActiveExpenseCategories).pipe(
      map(categories => categories.map(cat => ({
        label: cat.name,
        value: cat.id
      })))
    ),
    { initialValue: [] as { label: string; value: number }[] }
  );

  readonly receiptFile = signal<File | null>(null);
  readonly submitting = signal(false);
  readonly confirmApprove = signal(false);
  readonly confirmPay = signal(false);
  readonly showCategoryQuickCreate = signal(false);

  // Steps
  readonly currentStep = signal(1);
  steps: StepsLineItem[] = [
    { label: 'PREPARAR', completed: false },
    { label: 'CONFIRMAR', completed: false },
  ];

  @ViewChild('dropzone') dropzoneRef!: FileUploadDropzoneComponent;

  expenseForm: FormGroup = this.fb.group({
    description: ['', [Validators.required, Validators.minLength(3)]],
    amount: [null, [Validators.required, Validators.min(0.01)]],
    category_id: [null],
    expense_date: [toLocalDateString(), [Validators.required]],
    notes: ['']
  });

  // --- Step Navigation ---

  canAdvance(): boolean {
    if (this.currentStep() === 1) {
      return this.expenseForm.valid;
    }
    return true;
  }

  goToStep(step: number): void {
    if (step > this.currentStep() && !this.canAdvance()) {
      this.expenseForm.markAllAsTouched();
      return;
    }
    this.currentStep.set(step);
    this.steps = this.steps.map((s, i) => ({
      ...s,
      completed: i < step - 1,
    }));
  }

  // --- Category Quick Create ---

  getCategoryName(): string {
    const categoryId = this.expenseForm.value.category_id;
    if (!categoryId) return '';
    return this.categories().find(c => c.id === +categoryId)?.name || '';
  }

  onCategoryCreated(category: ExpenseCategory): void {
    this.store.dispatch(loadExpenseCategories());
    this.expenseForm.patchValue({ category_id: category.id });
    this.showCategoryQuickCreate.set(false);
  }

  // --- File Handling ---

  onFileSelected(file: File): void {
    this.receiptFile.set(file);
  }

  onFileRemoved(): void {
    this.receiptFile.set(null);
  }

  // --- Submit ---

  onSubmit(targetState: 'pending' | 'approved' | 'paid' = 'pending') {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.submitting.set(true);

    const formValue = this.expenseForm.value;
    const categoryId = formValue.category_id ? Number(formValue.category_id) : undefined;
    const expenseDate = new Date(formValue.expense_date);

    const createAndFinish = (receiptUrl?: string) => {
      this.expensesService.createExpense({
        description: formValue.description,
        amount: Number(formValue.amount),
        category_id: categoryId,
        expense_date: expenseDate,
        notes: formValue.notes,
        receipt_url: receiptUrl,
      }).subscribe({
        next: (response) => {
          const expenseId = response.data?.id;
          if (!expenseId || targetState === 'pending') {
            this.finishSubmit();
            return;
          }

          // Approve first (required for both 'approved' and 'paid')
          this.expensesService.approveExpense(expenseId).subscribe({
            next: () => {
              if (targetState === 'paid') {
                this.expensesService.payExpense(expenseId).subscribe({
                  next: () => this.finishSubmit(),
                  error: () => this.finishSubmit(),
                });
              } else {
                this.finishSubmit();
              }
            },
            error: () => this.finishSubmit(),
          });
        },
        error: () => {
          this.submitting.set(false);
        }
      });
    };

    // Upload receipt first if present
    const currentFile = this.receiptFile();
    if (currentFile) {
      this.expensesService.uploadReceipt(currentFile).subscribe({
        next: (result: { key: string; url: string }) => createAndFinish(result.key),
        error: () => createAndFinish(),
      });
    } else {
      createAndFinish();
    }
  }

  private finishSubmit(): void {
    this.store.dispatch(loadExpenses());
    this.store.dispatch(loadExpensesSummary());
    this.submitting.set(false);
    this.resetForm();
    this.onClose();
  }

  // --- Reset & Close ---

  private resetForm(): void {
    this.expenseForm.reset({
      expense_date: toLocalDateString(),
    });
    this.receiptFile.set(null);
    this.dropzoneRef?.clear();
    this.currentStep.set(1);
    this.confirmApprove.set(false);
    this.confirmPay.set(false);
    this.showCategoryQuickCreate.set(false);
    this.steps = [
      { label: 'PREPARAR', completed: false },
      { label: 'CONFIRMAR', completed: false },
    ];
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
