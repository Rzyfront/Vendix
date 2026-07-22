import { Component, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';

/**
 * `pop-order-config-modal`
 *
 * Modal presentacional que captura la configuración de la orden de compra
 * (proveedor, bodega, fecha de orden, fecha de entrega, método de envío).
 * Réplica del patrón POS caja/cliente (botón → modal → mini-card/dropdown).
 *
 * Es "tonto": recibe opciones + valores actuales y emite cambios; el
 * `pop-header` sigue siendo dueño de la data, el quick-create y la
 * sincronización con `PopCartService`.
 */
@Component({
  selector: 'app-pop-order-config-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    SelectorComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Configurar orden de compra"
      subtitle="Proveedor, bodega, fechas y método de envío"
      size="md"
    >
      <div class="flex flex-col gap-4">
        <!-- Proveedor -->
        <div class="flex flex-col gap-1.5 min-w-0">
          <label
            class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1"
          >
            Proveedor <span class="text-destructive">*</span>
          </label>
          <div class="flex gap-2">
            <app-selector
              class="flex-1 min-w-0"
              size="sm"
              [options]="supplierOptions()"
              [ngModel]="selectedSupplierId()"
              (ngModelChange)="supplierChange.emit($event)"
              placeholder="Seleccionar proveedor..."
            ></app-selector>
            <app-button
              variant="outline"
              size="sm"
              customClasses="!px-2 flex items-center justify-center"
              (clicked)="openSupplierModal.emit()"
            >
              <app-icon name="plus" [size]="18" slot="icon"></app-icon>
            </app-button>
          </div>
        </div>

        <!-- Bodega -->
        <div class="flex flex-col gap-1.5 min-w-0">
          <label
            class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1"
          >
            Bodega <span class="text-destructive">*</span>
          </label>
          <div class="flex gap-2">
            <app-selector
              class="flex-1 min-w-0"
              size="sm"
              [options]="locationOptions()"
              [ngModel]="selectedLocationId()"
              (ngModelChange)="locationChange.emit($event)"
              placeholder="Seleccionar bodega..."
            ></app-selector>
            <app-button
              variant="outline"
              size="sm"
              customClasses="!px-2 flex items-center justify-center"
              (clicked)="openWarehouseModal.emit()"
            >
              <app-icon name="plus" [size]="18" slot="icon"></app-icon>
            </app-button>
          </div>
        </div>

        <!-- Fechas -->
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1.5 min-w-0">
            <label class="text-xs font-semibold text-text-secondary pl-0.5">
              Fecha Orden
            </label>
            <app-input
              type="date"
              size="sm"
              [ngModel]="orderDate()"
              (ngModelChange)="orderDateChange.emit($event)"
              customWrapperClass="!mt-0"
            ></app-input>
          </div>
          <div class="flex flex-col gap-1.5 min-w-0">
            <label class="text-xs font-semibold text-text-secondary pl-0.5">
              Fecha Entrega
            </label>
            <app-input
              type="date"
              size="sm"
              [ngModel]="expectedDate()"
              (ngModelChange)="expectedDateChange.emit($event)"
              [min]="minExpectedDate()"
              customWrapperClass="!mt-0"
            ></app-input>
          </div>
        </div>

        <!-- Método de envío -->
        <div class="flex flex-col gap-1.5 min-w-0">
          <label class="text-xs font-semibold text-text-secondary pl-0.5">
            Método Envío
          </label>
          <app-selector
            class="w-full"
            size="sm"
            [options]="shippingMethodOptions()"
            [ngModel]="shippingMethod()"
            (ngModelChange)="shippingMethodChange.emit($event)"
            placeholder="Elegir método..."
          ></app-selector>
        </div>
      </div>

      <div slot="footer" class="flex justify-end">
        <app-button variant="primary" size="sm" (clicked)="onDone()">
          Listo
        </app-button>
      </div>
    </app-modal>
  `,
})
export class PopOrderConfigModalComponent {
  // Two-way visibility with the host (pop-header).
  readonly isOpen = model<boolean>(false);

  // Options + current values (owned by pop-header).
  readonly supplierOptions = input<SelectorOption[]>([]);
  readonly locationOptions = input<SelectorOption[]>([]);
  readonly shippingMethodOptions = input<SelectorOption[]>([]);
  readonly selectedSupplierId = input<number | null>(null);
  readonly selectedLocationId = input<number | null>(null);
  readonly orderDate = input('');
  readonly expectedDate = input('');
  readonly shippingMethod = input('');
  readonly minExpectedDate = input('');

  // Field changes bubble up to pop-header's existing handlers.
  readonly supplierChange = output<number | null | string>();
  readonly locationChange = output<number | null | string>();
  readonly orderDateChange = output<string>();
  readonly expectedDateChange = output<string>();
  readonly shippingMethodChange = output<string>();
  readonly openSupplierModal = output<void>();
  readonly openWarehouseModal = output<void>();

  /**
   * Emitido al pulsar "Listo". El host (pop-header) decide si propagar la
   * reconexión de la acción pendiente según `isConfigured()`.
   */
  readonly done = output<void>();

  onDone(): void {
    this.isOpen.set(false);
    this.done.emit();
  }
}
