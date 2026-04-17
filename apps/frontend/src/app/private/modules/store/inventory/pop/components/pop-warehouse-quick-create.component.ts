import { Component, input, output, signal } from '@angular/core';

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
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
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
            @if (!isLoading) {
              <span>Crear Bodega</span>
            }
            @if (isLoading) {
              <span>Creando...</span>
            }
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
  readonly isOpen = input(false);
  readonly isOpenChange = output<boolean>();
  readonly close = output<void>();
  readonly warehouseCreated = output<number>();

  isLoading = signal(false);

  typeOptions = [
    { value: 'warehouse', label: 'Almacén / Bodega' },
    { value: 'store', label: 'Tienda / Local' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'transit', label: 'En Tránsito' },
  ];

  form = signal({
    name: '',
    code: '',
    type: 'warehouse',
  });

  constructor(private inventoryService: InventoryService) {}

  // ============================================================
  // Form Actions
  // ============================================================

  onSubmit(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.isLoading.set(true);

    const f = this.form();
    const createDto: CreateLocationDto = {
      name: f.name,
      code: f.code,
      type: f.type as LocationType,
      is_active: true,
    };

    this.inventoryService.createLocation(createDto).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.warehouseCreated.emit(response.data.id);
          this.resetForm();
          this.isOpenChange.emit(false);
          this.close.emit();
        }
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error creating warehouse:', error);
        this.isLoading.set(false);
      },
    });
  }

  onClose(): void {
    this.resetForm();
    this.isOpenChange.emit(false);
    this.close.emit();
  }

  public isFormValid(): boolean {
    const f = this.form();
    return !!(f.name && f.code && f.type);
  }

  private resetForm(): void {
    this.form.set({
      name: '',
      code: '',
      type: 'warehouse',
    });
  }
}
