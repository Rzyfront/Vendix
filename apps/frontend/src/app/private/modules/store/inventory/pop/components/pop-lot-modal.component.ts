import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';

import { PopCartService, PopCartItemLotInfo } from '../services/pop-cart.service';

/**
 * POP Lot Information Modal
 * Optional lot/batch tracking for purchase order items
 */
@Component({
  selector: 'app-pop-lot-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      size="md"
      title="Información de Lote"
      subtitle="Información opcional para rastreo de inventario"
      (close)="onClose()"
    >
      <div class="space-y-4">
        <!-- Info Message -->
        <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
          <div class="flex items-start">
            <svg class="h-5 w-5 text-blue-400 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
            </svg>
            <div class="text-sm text-blue-700 dark:text-blue-300">
              <p class="font-medium mb-1">¿Qué es esto?</p>
              <p>La información de lote es <strong>opcional</strong>. Se usará al recibir el pedido para rastrear el inventario por lote, incluyendo fechas de vencimiento.</p>
            </div>
          </div>
        </div>

        <!-- Batch Number -->
        <app-input
          label="Número de Lote"
          [(ngModel)]="form.batch_number"
          name="batch_number"
          placeholder="Ej: LOT-2024-001"
          hint="Código único que identifica el lote del proveedor"
        ></app-input>

        <!-- Manufacturing Date -->
        <app-input
          label="Fecha de Fabricación"
          type="date"
          [(ngModel)]="form.manufacturing_date"
          name="manufacturing_date"
        ></app-input>

        <!-- Expiration Date -->
        <app-input
          label="Fecha de Vencimiento"
          type="date"
          [(ngModel)]="form.expiration_date"
          name="expiration_date"
          hint="Importante para productos con fecha de caducidad"
        ></app-input>
      </div>

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-between">
        <app-button
          variant="outline"
          (clicked)="onSkip()"
        >
          Omitir
        </app-button>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            (clicked)="onClose()"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSave()"
          >
            Guardar Lote
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styleUrls: ['./pop-lot-modal.component.scss'],
})
export class PopLotModalComponent {
  @Input() isOpen = false;
  @Input() initialLotInfo?: PopCartItemLotInfo;
  @Output() isOpenChange = new EventEmitter<boolean>();

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<PopCartItemLotInfo>();
  @Output() skip = new EventEmitter<void>();

  form: PopCartItemLotInfo = {
    batch_number: '',
    manufacturing_date: undefined,
    expiration_date: undefined,
  };

  // ============================================================
  // Lifecycle
  // ============================================================

  ngOnInit(): void {
    if (this.initialLotInfo) {
      this.form = { ...this.initialLotInfo };
    }
  }

  // ============================================================
  // Actions
  // ============================================================

  onSave(): void {
    // Only emit if there's actual data
    if (this.form.batch_number || this.form.manufacturing_date || this.form.expiration_date) {
      this.save.emit({
        batch_number: this.form.batch_number || undefined,
        manufacturing_date: this.form.manufacturing_date ? new Date(this.form.manufacturing_date) : undefined,
        expiration_date: this.form.expiration_date ? new Date(this.form.expiration_date) : undefined,
      });
    } else {
      // If empty, treat as skip
      this.skip.emit();
    }
    this.resetForm();
    this.isOpenChange.emit(false);
  }

  onSkip(): void {
    this.skip.emit();
    this.resetForm();
    this.isOpenChange.emit(false);
  }

  onClose(): void {
    this.close.emit();
    this.resetForm();
    this.isOpenChange.emit(false);
  }

  // ============================================================
  // Helpers
  // ============================================================

  private resetForm(): void {
    this.form = {
      batch_number: '',
      manufacturing_date: undefined,
      expiration_date: undefined,
    };
  }
}
