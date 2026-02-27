import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';

import { PreBulkData } from '../interfaces/pop-cart.interface';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

/**
 * POP Pre-Bulk Product Modal
 * Adds temporary products to purchase order that don't exist in catalog
 */
@Component({
  selector: 'app-pop-prebulk-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      title="Agregar Producto Pre-Bulk"
      subtitle="Producto temporal solo para esta orden de compra"
    >
      <div class="space-y-4">
        <!-- Warning Message -->
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div class="flex items-start">
            <svg class="h-5 w-5 text-amber-600 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <div class="text-sm">
              <p class="font-semibold text-amber-800 mb-1">Producto Temporal</p>
              <p class="text-amber-900">Este producto <strong>NO se guardará</strong> en el catálogo. Solo aparecerá en esta orden de compra y no estará disponible para futuras órdenes.</p>
            </div>
          </div>
        </div>

        <!-- Product Name and SKU Row -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <app-input
            label="Nombre del Producto"
            [(ngModel)]="form.name"
            name="name"
            [required]="true"
            placeholder="Ej: Material genérico"
          ></app-input>

          <app-input
            label="SKU / Código"
            [(ngModel)]="form.code"
            name="code"
            [required]="true"
            placeholder="Ej: MAN-001"
          ></app-input>
        </div>

        <!-- Description -->
        <app-textarea
          label="Descripción"
          [(ngModel)]="form.description"
          name="description"
          placeholder="Descripción opcional del producto..."
          [rows]="3"
        ></app-textarea>

        <!-- Quantity and Unit Cost -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <app-input
            label="Cantidad"
            type="number"
            [(ngModel)]="form.quantity"
            name="quantity"
            [required]="true"
            placeholder="0"
          ></app-input>

          <app-input
            label="Costo Unitario"
            type="number"
            [(ngModel)]="form.unit_cost"
            name="unit_cost"
            [required]="true"
            step="0.01"
            placeholder="$ 0.00"
          ></app-input>
        </div>

        <!-- Calculated Total -->
        <div class="bg-[var(--color-muted)] rounded-md p-3">
          <div class="flex justify-between items-center">
            <span class="text-sm text-[var(--color-text-secondary)]">Total estimado:</span>
            <span class="text-lg font-semibold text-[var(--color-text-primary)]">
              {{ calculatedTotal | currency: 0 }}
            </span>
          </div>
        </div>

        <!-- Notes -->
        <app-textarea
          label="Notas"
          [(ngModel)]="form.notes"
          name="notes"
          placeholder="Notas adicionales sobre este producto..."
          [rows]="2"
        ></app-textarea>
      </div>

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-end gap-3">
        <app-button
          variant="outline"
          (clicked)="onClose()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          (clicked)="onAdd()"
          [disabled]="!isFormValid()"
        >
          Agregar a Orden
        </app-button>
      </div>
    </app-modal>
  `,
  styleUrls: ['./pop-prebulk-modal.component.scss'],
})
export class PopPreBulkModalComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();

  @Output() close = new EventEmitter<void>();
  @Output() add = new EventEmitter<{
    prebulkData: PreBulkData;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }>();

  form = {
    name: '',
    code: '',
    description: '',
    quantity: 1,
    unit_cost: 0,
    notes: '',
  };

  // ============================================================
  // Getters
  // ============================================================

  get calculatedTotal(): number {
    return (this.form.quantity || 0) * (this.form.unit_cost || 0);
  }

  // ============================================================
  // Actions
  // ============================================================

  onAdd(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.add.emit({
      prebulkData: {
        name: this.form.name,
        code: this.form.code,
        description: this.form.description || undefined,
      },
      quantity: this.form.quantity,
      unit_cost: this.form.unit_cost,
      notes: this.form.notes || undefined,
    });

    this.resetForm();
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  onClose(): void {
    this.resetForm();
    this.close.emit();
  }

  onCancel(): void {
    this.resetForm();
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  // ============================================================
  // Helpers
  // ============================================================

  public isFormValid(): boolean {
    return !!(
      this.form.name &&
      this.form.code &&
      this.form.quantity > 0 &&
      this.form.unit_cost >= 0
    );
  }

  private resetForm(): void {
    this.form = {
      name: '',
      code: '',
      description: '',
      quantity: 1,
      unit_cost: 0,
      notes: '',
    };
  }
}
