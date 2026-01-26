import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components';

import { InventoryService } from '../../services/inventory.service';
import { LocationType, CreateLocationDto } from '../../interfaces';

/**
 * Quick-create modal for warehouses/locations in POP
 * Allows creating a warehouse without leaving the purchase order interface
 */
@Component({
  selector: 'app-pop-warehouse-quick-create',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      size="md"
      title="Crear Bodega Rápido"
      subtitle="Agrega una nueva bodega sin salir del punto de compra"
      (close)="onClose()"
    >
      <form
        (ngSubmit)="onSubmit()"
        #warehouseForm="ngForm"
        class="h-full flex flex-col"
      >
        <div class="space-y-4 flex-1">
          <!-- Name -->
          <app-input
            label="Nombre *"
            [(ngModel)]="form.name"
            name="name"
            [required]="true"
            placeholder="Ej: Bodega Principal"
          ></app-input>

          <!-- Code -->
          <app-input
            label="Código *"
            [(ngModel)]="form.code"
            name="code"
            [required]="true"
            placeholder="Ej: BOD-001"
          ></app-input>

          <!-- Type -->
          <app-selector
            label="Tipo de Ubicación"
            [(ngModel)]="form.type"
            name="type"
            [options]="typeOptions"
            placeholder="Seleccionar tipo"
          ></app-selector>
        </div>

        <!-- Footer Actions -->
        <div slot="footer" class="flex justify-end gap-3 mt-4">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            type="submit"
            [disabled]="!isFormValid() || isLoading"
          >
            <span *ngIf="!isLoading">Crear Bodega</span>
            <span *ngIf="isLoading">Creando...</span>
          </app-button>
        </div>
      </form>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PopWarehouseQuickCreateComponent {
  @Input() isOpen = false;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() close = new EventEmitter<void>();
  @Output() warehouseCreated = new EventEmitter<number>();

  isLoading = false;

  typeOptions = [
    { value: 'warehouse', label: 'Almacén / Bodega' },
    { value: 'store', label: 'Tienda / Local' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'transit', label: 'En Tránsito' },
  ];

  form = {
    name: '',
    code: '',
    type: 'warehouse',
  };

  constructor(private inventoryService: InventoryService) {}

  // ============================================================
  // Form Actions
  // ============================================================

  onSubmit(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.isLoading = true;

    const createDto: CreateLocationDto = {
      name: this.form.name,
      code: this.form.code,
      type: this.form.type as LocationType,
      is_active: true,
      // No address for simple create
    };

    this.inventoryService.createLocation(createDto).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.warehouseCreated.emit(response.data.id);
          this.resetForm();
          this.isOpenChange.emit(false);
          this.close.emit();
        }
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error creating warehouse:', error);
        this.isLoading = false;
      },
    });
  }

  onClose(): void {
    this.resetForm();
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  public isFormValid(): boolean {
    return !!(this.form.name && this.form.code && this.form.type);
  }

  private resetForm(): void {
    this.form = {
      name: '',
      code: '',
      type: 'warehouse',
    };
  }
}
