import { Component, OnInit, ViewChild, TemplateRef, AfterViewInit, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { TableComponent, TableColumn } from '../../../../../../shared/components/table/table.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { loadExpenseCategories, createExpenseCategory, deleteExpenseCategory } from '../../state/actions/expenses.actions';
import { selectExpenseCategories, selectExpenseCategoriesLoading } from '../../state/selectors/expenses.selectors';
import { ExpenseCategory } from '../../interfaces/expense.interface';

@Component({
  selector: 'vendix-expense-categories',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TableComponent,
    ModalComponent,
    ButtonComponent,
    InputComponent
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Gestión de Categorías"
      size="lg"
    >
      <div class="space-y-6 p-4">
        
        <!-- Create Form -->
        <div class="p-4 bg-surface border border-border rounded-lg">
          <h3 class="text-sm font-medium text-text-secondary mb-2">Nueva Categoría</h3>
          <form [formGroup]="categoryForm" (ngSubmit)="onSubmit()" class="flex flex-col md:flex-row gap-4 items-start">
            <div class="flex-1 w-full">
              <app-input
                label="Nombre"
                formControlName="name"
                [control]="categoryForm.get('name')"
                placeholder="Ej: Oficina"
                [required]="true"
                customWrapperClass="!mt-0"
              ></app-input>
            </div>
            <div class="flex-1 w-full">
               <app-input
                label="Descripción"
                formControlName="description"
                [control]="categoryForm.get('description')"
                placeholder="Opcional"
                customWrapperClass="!mt-0"
              ></app-input>
            </div>
            <div class="pt-[28px]">
              <app-button 
                variant="primary"
                (clicked)="onSubmit()" 
                [disabled]="categoryForm.invalid || ((loading$ | async) || false)"
                class="whitespace-nowrap">
                Agregar
              </app-button>
            </div>
          </form>
        </div>

        <!-- Categories Table -->
        <div class="overflow-hidden">
          <app-table
            [data]="(categories$ | async) || []"
            [columns]="columns"
            [loading]="(loading$ | async) || false"
            size="sm">
          </app-table>
        </div>
      
        <ng-template #actionsTemplate let-row>
          <button 
            (click)="deleteCategory(row.id)"
            class="text-danger-500 hover:text-danger-700 p-1 rounded hover:bg-danger-50 transition-colors"
            title="Eliminar">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </ng-template>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button 
            variant="outline" 
            (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
  `
})
export class ExpenseCategoriesComponent implements OnInit, AfterViewInit {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  categoryForm: FormGroup;
  categories$: Observable<ExpenseCategory[]>;
  loading$: Observable<boolean>;

  @ViewChild('actionsTemplate') actionsTemplate!: TemplateRef<any>;

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true },
    { key: 'description', label: 'Descripción' }
  ];

  constructor(
    private fb: FormBuilder,
    private store: Store
  ) {
    this.categoryForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: ['']
    });
    this.categories$ = this.store.select(selectExpenseCategories);
    this.loading$ = this.store.select(selectExpenseCategoriesLoading);
  }

  ngOnInit() {
    this.store.dispatch(loadExpenseCategories());
  }

  ngAfterViewInit() {
    // Add actions column with template
    setTimeout(() => {
      this.columns = [
        ...this.columns,
        { key: 'actions', label: 'Acciones', width: '80px', align: 'center', template: this.actionsTemplate }
      ];
    });
  }

  onSubmit() {
    if (this.categoryForm.valid) {
      this.store.dispatch(createExpenseCategory({
        category: this.categoryForm.value
      }));
      this.categoryForm.reset();
    }
  }

  deleteCategory(id: number) {
    if (confirm('¿Estás seguro de que deseas eliminar esta categoría?')) {
      this.store.dispatch(deleteExpenseCategory({ id }));
    }
  }

  onClose() {
    this.isOpenChange.emit(false);
  }
}
