import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';

import { AccountingService } from '../../../services/accounting.service';
import { FixedAsset, FixedAssetCategory } from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-fixed-asset-create-modal',
  standalone: true,
  imports: [
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
      [title]="editAsset ? 'Editar Activo Fijo' : 'Nuevo Activo Fijo'"
      size="lg"
    >
      <div class="p-4 space-y-4">
        <form [formGroup]="form">
          <!-- Row 1: Name + Category -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <app-input
              label="Nombre del Activo"
              formControlName="name"
              [control]="form.get('name')"
              [required]="true"
              placeholder="Ej: Computador Dell Latitude"
            ></app-input>

            <app-selector
              label="Categoria"
              formControlName="category_id"
              [options]="category_options"
              placeholder="Seleccionar categoria"
              (valueChange)="onCategoryChange($event)"
            ></app-selector>
          </div>

          <!-- Row 2: Acquisition Date + Cost -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-input
              label="Fecha de Adquisicion"
              formControlName="acquisition_date"
              [control]="form.get('acquisition_date')"
              [required]="true"
              type="date"
            ></app-input>

            <app-input
              label="Costo de Adquisicion"
              formControlName="acquisition_cost"
              [control]="form.get('acquisition_cost')"
              [required]="true"
              [currency]="true"
              placeholder="0"
            ></app-input>
          </div>

          <!-- Row 3: Salvage Value + Useful Life -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-input
              label="Valor Residual"
              formControlName="salvage_value"
              [control]="form.get('salvage_value')"
              [required]="true"
              type="number"
              placeholder="0"
            ></app-input>

            <app-input
              label="Vida Util (meses)"
              formControlName="useful_life_months"
              [control]="form.get('useful_life_months')"
              [required]="true"
              type="number"
              placeholder="60"
            ></app-input>
          </div>

          <!-- Row 4: Depreciation Method + Start Date -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <app-selector
              label="Metodo de Depreciacion"
              formControlName="depreciation_method"
              [options]="depreciation_method_options"
              [required]="true"
            ></app-selector>

            <app-input
              label="Inicio Depreciacion"
              formControlName="depreciation_start_date"
              [control]="form.get('depreciation_start_date')"
              type="date"
            ></app-input>
          </div>

          <!-- Row 5: Description -->
          <div class="mt-4">
            <app-textarea
              label="Descripcion"
              formControlName="description"
              [rows]="2"
              placeholder="Descripcion opcional del activo..."
            ></app-textarea>
          </div>

          <!-- Row 6: Notes -->
          <div class="mt-4">
            <app-textarea
              label="Notas"
              formControlName="notes"
              [rows]="2"
              placeholder="Notas adicionales..."
            ></app-textarea>
          </div>
        </form>
      </div>

      <div slot="footer">
        <div class="flex items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          <app-button variant="outline" (clicked)="onClose()">Cancelar</app-button>
          <app-button
            variant="primary"
            (clicked)="onSubmit()"
            [disabled]="form.invalid || is_submitting"
            [loading]="is_submitting"
          >
            {{ editAsset ? 'Actualizar' : 'Crear' }}
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class FixedAssetCreateModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Input() editAsset: FixedAsset | null = null;
  @Input() categories: FixedAssetCategory[] = [];
  @Output() saved = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);

  is_submitting = false;

  depreciation_method_options = [
    { value: 'straight_line', label: 'Linea Recta' },
    { value: 'declining_balance', label: 'Saldo Decreciente' },
  ];

  get category_options() {
    return [
      { value: null as any, label: 'Sin categoria' },
      ...this.categories
        .filter((c) => c.is_active)
        .map((c) => ({ value: c.id, label: c.name })),
    ];
  }

  form = this.fb.group({
    name: ['', [Validators.required]],
    description: [''],
    category_id: [null as number | null],
    acquisition_date: ['', [Validators.required]],
    acquisition_cost: [0, [Validators.required, Validators.min(1)]],
    salvage_value: [0, [Validators.required, Validators.min(0)]],
    useful_life_months: [60, [Validators.required, Validators.min(1)]],
    depreciation_method: ['straight_line' as string, [Validators.required]],
    depreciation_start_date: [''],
    notes: [''],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editAsset'] && this.editAsset) {
      this.form.patchValue({
        name: this.editAsset.name,
        description: this.editAsset.description || '',
        category_id: this.editAsset.category_id || null,
        acquisition_date: this.editAsset.acquisition_date?.split('T')[0] || '',
        acquisition_cost: this.editAsset.acquisition_cost,
        salvage_value: this.editAsset.salvage_value,
        useful_life_months: this.editAsset.useful_life_months,
        depreciation_method: this.editAsset.depreciation_method,
        depreciation_start_date: this.editAsset.depreciation_start_date?.split('T')[0] || '',
        notes: this.editAsset.notes || '',
      });
    } else if (changes['editAsset'] && !this.editAsset) {
      this.resetForm();
    }
  }

  onCategoryChange(category_id: any): void {
    if (!category_id) return;
    const category = this.categories.find((c) => c.id === category_id);
    if (category) {
      this.form.patchValue({
        useful_life_months: category.default_useful_life_months,
        depreciation_method: category.default_depreciation_method,
      });

      // Calculate salvage value from percentage
      const cost = this.form.get('acquisition_cost')?.value || 0;
      if (cost > 0 && category.default_salvage_percentage > 0) {
        const salvage = Math.round(cost * (category.default_salvage_percentage / 100));
        this.form.patchValue({ salvage_value: salvage });
      }
    }
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.is_submitting = true;
    const values = this.form.getRawValue();

    const dto: any = {
      name: values.name,
      description: values.description || undefined,
      category_id: values.category_id || undefined,
      acquisition_date: values.acquisition_date,
      acquisition_cost: Number(values.acquisition_cost),
      salvage_value: Number(values.salvage_value),
      useful_life_months: Number(values.useful_life_months),
      depreciation_method: values.depreciation_method,
      depreciation_start_date: values.depreciation_start_date || undefined,
      notes: values.notes || undefined,
    };

    const request$ = this.editAsset
      ? this.accounting_service.updateFixedAsset(this.editAsset.id, dto)
      : this.accounting_service.createFixedAsset(dto);

    request$.subscribe({
      next: () => {
        this.toast_service.show({
          variant: 'success',
          description: this.editAsset ? 'Activo actualizado correctamente' : 'Activo creado correctamente',
        });
        this.is_submitting = false;
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        this.saved.emit();
        this.onClose();
      },
      error: () => {
        this.toast_service.show({
          variant: 'error',
          description: 'Error al guardar el activo',
        });
        this.is_submitting = false;
      },
    });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.editAsset = null;
    this.resetForm();
  }

  private resetForm(): void {
    this.form.reset({
      name: '',
      description: '',
      category_id: null,
      acquisition_date: '',
      acquisition_cost: 0,
      salvage_value: 0,
      useful_life_months: 60,
      depreciation_method: 'straight_line',
      depreciation_start_date: '',
      notes: '',
    });
  }
}
