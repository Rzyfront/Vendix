import {Component, model, output, signal, DestroyRef, inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../shared/components';

import { InventoryService } from '../../services/inventory.service';
import { LocationType, CreateLocationDto, InventoryLocation } from '../../interfaces';

/**
 * Quick-create modal for warehouses/locations in POP
 * Allows creating a warehouse without leaving the purchase order interface
 */
@Component({
  selector: 'app-pop-warehouse-quick-create',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      size="md"
      title="Crear Bodega Rápido"
      subtitle="Agrega una nueva bodega sin salir del punto de compra"
      (cancel)="onClose()"
    >
      <form
        (ngSubmit)="onSubmit()"
        class="h-full flex flex-col"
      >
        <div class="space-y-4 flex-1">
          <!-- Name -->
          <app-input
            label="Nombre *"
            [formControl]="$any(form.get('name'))"
            name="name"
            [required]="true"
            placeholder="Ej: Bodega Principal"
          ></app-input>

          <!-- Code -->
          <app-input
            label="Código *"
            [formControl]="$any(form.get('code'))"
            name="code"
            [required]="true"
            placeholder="Ej: BOD-001"
          ></app-input>

          <!-- Type -->
          <app-selector
            label="Tipo de Ubicación"
            [formControl]="$any(form.get('type'))"
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
            [disabled]="!isFormValid() || isLoading()"
          >
            @if (!isLoading()) {
              <span>Crear Bodega</span>
            }
            @if (isLoading()) {
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
  private destroyRef = inject(DestroyRef);
  readonly isOpen = model<boolean>(false);
  readonly close = output<void>();
  readonly warehouseCreated = output<InventoryLocation>();

  isLoading = signal(false);

  typeOptions = [
    { value: 'warehouse', label: 'Almacén / Bodega' },
    { value: 'store', label: 'Tienda / Local' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'transit', label: 'En Tránsito' },
  ];

  form: FormGroup;

  constructor(
    private inventoryService: InventoryService,
    private fb: FormBuilder
  ) {
    this.form = this.fb.group({
      name: ['', []],
      code: ['', []],
      type: ['warehouse', []],
    });
  }

  // ============================================================
  // Form Actions
  // ============================================================

  onSubmit(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.isLoading.set(true);

    const formValue = this.form.value;
    const createDto: CreateLocationDto = {
      name: formValue.name,
      code: formValue.code,
      type: formValue.type as LocationType,
      is_active: true,
    };

    this.inventoryService.createLocation(createDto).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.warehouseCreated.emit(response.data);
          this.resetForm();
          this.isOpen.set(false);
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
    this.isOpen.set(false);
    this.close.emit();
  }

  public isFormValid(): boolean {
    const formValue = this.form.value;
    return !!(formValue.name && formValue.code && formValue.type);
  }

  private resetForm(): void {
    this.form.reset({
      name: '',
      code: '',
      type: 'warehouse',
    });
  }
}
