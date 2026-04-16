import { Component, input, output, inject } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';

import { AccountingService } from '../../../services/accounting.service';
import { FixedAssetCategory } from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  ToastService,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'vendix-fixed-asset-categories-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    SelectorComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Categorias de Activos Fijos"
      size="lg"
    >
      <div class="p-4 space-y-4 max-h-[70vh] overflow-y-auto">

        <!-- Category List -->
        @if (categories().length === 0 && !show_form) {
          <div class="flex flex-col items-center justify-center py-8 text-gray-400">
            <app-icon name="tag" [size]="40"></app-icon>
            <p class="mt-3 text-sm">No hay categorias creadas</p>
          </div>
        } @else {
          <div class="divide-y divide-border">
            @for (cat of categories(); track cat.id) {
              <div class="flex items-center justify-between py-3 px-2 hover:bg-gray-50 rounded-lg">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-text-primary">{{ cat.name }}</span>
                    @if (!cat.is_active) {
                      <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Inactivo</span>
                    }
                  </div>
                  <div class="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    <span>{{ cat.default_useful_life_months }} meses</span>
                    <span>{{ cat.default_depreciation_method === 'straight_line' ? 'Linea Recta' : 'Saldo Decreciente' }}</span>
                    <span>Residual: {{ cat.default_salvage_percentage }}%</span>
                  </div>
                </div>
                <div class="flex items-center gap-1 ml-2">
                  <button (click)="editCategory(cat)"
                          class="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-primary">
                    <app-icon name="edit" [size]="14"></app-icon>
                  </button>
                  <button (click)="deleteCategory(cat)"
                          class="p-1.5 hover:bg-red-50 rounded text-gray-400 hover:text-red-500">
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <!-- Create/Edit Form -->
        @if (show_form) {
          <div class="p-4 bg-gray-50 rounded-lg space-y-3 border border-border">
            <h4 class="text-sm font-semibold text-gray-700">
              {{ editing_category ? 'Editar Categoria' : 'Nueva Categoria' }}
            </h4>
            <form [formGroup]="form">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <app-input
                  label="Nombre"
                  formControlName="name"
                  [control]="form.get('name')"
                  [required]="true"
                  placeholder="Ej: Equipos de Computo"
                ></app-input>

                <app-input
                  label="Vida Util (meses)"
                  formControlName="default_useful_life_months"
                  [control]="form.get('default_useful_life_months')"
                  [required]="true"
                  type="number"
                  placeholder="60"
                ></app-input>

                <app-selector
                  label="Metodo Depreciacion"
                  formControlName="default_depreciation_method"
                  [options]="method_options"
                  [required]="true"
                ></app-selector>

                <app-input
                  label="Porcentaje Residual (%)"
                  formControlName="default_salvage_percentage"
                  [control]="form.get('default_salvage_percentage')"
                  [required]="true"
                  type="number"
                  placeholder="10"
                ></app-input>
              </div>

              <div class="flex justify-end gap-2 mt-3">
                <app-button variant="outline" size="sm" (clicked)="cancelForm()">Cancelar</app-button>
                <app-button variant="primary" size="sm" (clicked)="saveCategory()"
                            [disabled]="form.invalid || is_submitting"
                            [loading]="is_submitting">
                  {{ editing_category ? 'Actualizar' : 'Crear' }}
                </app-button>
              </div>
            </form>
          </div>
        }
      </div>

      <div slot="footer">
        <div class="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-gray-100">
          @if (!show_form) {
            <app-button variant="primary" size="sm" (clicked)="showCreateForm()">
              <app-icon name="plus" [size]="14" slot="icon"></app-icon>
              Nueva Categoria
            </app-button>
          } @else {
            <div></div>
          }
          <app-button variant="outline" (clicked)="onClose()">Cerrar</app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class FixedAssetCategoriesModalComponent {
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly categories = input<FixedAssetCategory[]>([]);
  readonly categoriesChanged = output<void>();

  private fb = inject(FormBuilder);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);

  show_form = false;
  editing_category: FixedAssetCategory | null = null;
  is_submitting = false;

  method_options = [
    { value: 'straight_line', label: 'Linea Recta' },
    { value: 'declining_balance', label: 'Saldo Decreciente' },
  ];

  form = this.fb.group({
    name: ['', [Validators.required]],
    default_useful_life_months: [60, [Validators.required, Validators.min(1)]],
    default_depreciation_method: ['straight_line' as string, [Validators.required]],
    default_salvage_percentage: [10, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  showCreateForm(): void {
    this.editing_category = null;
    this.form.reset({
      name: '',
      default_useful_life_months: 60,
      default_depreciation_method: 'straight_line',
      default_salvage_percentage: 10,
    });
    this.show_form = true;
  }

  editCategory(cat: FixedAssetCategory): void {
    this.editing_category = cat;
    this.form.patchValue({
      name: cat.name,
      default_useful_life_months: cat.default_useful_life_months,
      default_depreciation_method: cat.default_depreciation_method,
      default_salvage_percentage: cat.default_salvage_percentage,
    });
    this.show_form = true;
  }

  cancelForm(): void {
    this.show_form = false;
    this.editing_category = null;
  }

  saveCategory(): void {
    if (this.form.invalid) return;
    this.is_submitting = true;

    const values = this.form.getRawValue();
    const dto: any = {
      name: values.name,
      default_useful_life_months: Number(values.default_useful_life_months),
      default_depreciation_method: values.default_depreciation_method,
      default_salvage_percentage: Number(values.default_salvage_percentage),
    };

    const request$ = this.editing_category
      ? this.accounting_service.updateFixedAssetCategory(this.editing_category.id, dto)
      : this.accounting_service.createFixedAssetCategory(dto);

    request$.subscribe({
      next: () => {
        this.toast_service.show({
          variant: 'success',
          description: this.editing_category ? 'Categoria actualizada' : 'Categoria creada',
        });
        this.is_submitting = false;
        this.show_form = false;
        this.editing_category = null;
        this.categoriesChanged.emit();
      },
      error: () => {
        this.toast_service.show({ variant: 'error', description: 'Error al guardar la categoria' });
        this.is_submitting = false;
      },
    });
  }

  deleteCategory(cat: FixedAssetCategory): void {
    if (!confirm(`¿Eliminar la categoria "${cat.name}"? Los activos asociados no seran eliminados.`)) return;

    this.accounting_service.deleteFixedAssetCategory(cat.id).subscribe({
      next: () => {
        this.toast_service.show({ variant: 'success', description: 'Categoria eliminada' });
        this.categoriesChanged.emit();
      },
      error: () => {
        this.toast_service.show({ variant: 'error', description: 'Error al eliminar la categoria' });
      },
    });
  }

  onClose(): void {
    this.isOpenChange.emit(false);
    this.show_form = false;
    this.editing_category = null;
  }
}
