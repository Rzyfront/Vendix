import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges } from '@angular/core';
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
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../shared/components';
import { TaxesService } from '../services/taxes.service';
import { TaxCategory } from '../interfaces';

@Component({
  selector: 'app-tax-quick-create',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [size]="'md'"
      [title]="'Crear Nueva Categoría de Impuesto'"
      [isOpen]="isOpen"
      (closed)="onCancel()"
    >
      <form [formGroup]="taxCategoryForm" class="space-y-4">
        <app-input
          label="Nombre de la Categoría"
          placeholder="Ej. IVA, IVA Reducido"
          formControlName="name"
          [error]="getErrorMessage('name')"
          [required]="true"
        >
        </app-input>

        <app-selector
          label="Tipo"
          [options]="typeOptions"
          formControlName="type"
          placeholder="Seleccionar tipo"
          [required]="true"
        >
        </app-selector>

        <app-input
          label="Tasa"
          type="number"
          placeholder="Ej. 19"
          formControlName="rate"
          [error]="getErrorMessage('rate')"
          suffix="%"
          [required]="true"
        >
        </app-input>

        <app-textarea
          label="Descripción"
          placeholder="Descripción de la categoría de impuesto (opcional)"
          formControlName="description"
          [rows]="3"
          [control]="taxCategoryForm.get('description')"
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
          [disabled]="taxCategoryForm.invalid"
        >
          Crear Impuesto
        </app-button>
      </div>
    </app-modal>
  `,
})
export class TaxQuickCreateComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<TaxCategory>();
  @Output() cancel = new EventEmitter<void>();

  taxCategoryForm: FormGroup;
  isSubmitting = false;

  typeOptions: SelectorOption[] = [
    { value: 'percentage', label: 'Porcentaje' },
    { value: 'fixed', label: 'Fijo' },
  ];

  constructor(
    private fb: FormBuilder,
    private taxesService: TaxesService,
    private toastService: ToastService,
  ) {
    this.taxCategoryForm = this.fb.group({
      name: [
        '',
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(255),
        ],
      ],
      type: ['percentage', [Validators.required]],
      rate: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
      store_id: [1],
      description: ['', [Validators.maxLength(500)]],
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && changes['isOpen'].currentValue === true) {
      this.taxCategoryForm.reset({
        name: '',
        type: 'percentage',
        rate: 0,
        store_id: 1,
        description: '',
      });
    }
  }

  onCancel() {
    this.taxCategoryForm.reset();
    this.isOpenChange.emit(false);
    this.cancel.emit();
  }

  onSubmit() {
    if (this.taxCategoryForm.invalid) return;

    this.isSubmitting = true;
    const taxCategoryData = this.taxCategoryForm.value;

    this.taxesService.createTaxCategory(taxCategoryData).subscribe({
      next: (taxCategory) => {
        this.toastService.success('Categoría de impuesto creada exitosamente');
        this.created.emit(taxCategory);
        this.isSubmitting = false;
        this.taxCategoryForm.reset();
        this.isOpenChange.emit(false);
      },
      error: (error) => {
        console.error('Error creando categoría de impuesto:', error);
        this.toastService.error('Error al crear categoría de impuesto');
        this.isSubmitting = false;
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.taxCategoryForm.get(fieldName);
    if (!field || !field.errors || !field.touched) {
      return '';
    }
    if (field.errors['required']) return 'Este campo es requerido';
    if (field.errors['minlength']) return 'Mínimo 2 caracteres requeridos';
    if (field.errors['maxlength']) return 'Máximo caracteres permitidos';
    if (field.errors['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    if (field.errors['max']) return `Valor máximo: ${field.errors['max'].max}`;
    return 'Entrada inválida';
  }
}