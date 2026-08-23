import { Component, computed, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { PopShippingAllocation } from '../interfaces';

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
    ToggleComponent,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Configurar orden de compra"
      subtitle="Proveedor, bodega, fechas, envío y flete"
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

        <!--
          B.6 — paridad con el paso Configuración del wizard: donde se declara
          el método de envío se declara también el flete. Si el monto sólo
          existiera en el wizard, el operador podría elegir «Flete» aquí y
          confirmar sin que nadie le preguntara cuánto.
        -->
        @if (isFreight()) {
          <div class="flex flex-col gap-1.5 min-w-0">
            <label class="text-xs font-semibold text-text-secondary pl-0.5">
              Costo del flete
            </label>
            <app-input
              size="sm"
              [currency]="true"
              [currencyDecimals]="2"
              [ngModel]="shippingCost()"
              (ngModelChange)="onShippingCostModel($event)"
              customWrapperClass="!mt-0"
            ></app-input>

            <!--
              CP-PURCHASE-TRANSPARENCY (T2/D.1) — el conmutador se DESHABILITA
              cuando no hay flete, y dice por qué. Antes quedaba armado: el
              operador lo pulsaba, app-toggle se pintaba solo, el carrito
              descartaba el cambio en silencio y la pantalla quedaba afirmando
              una imputación que el carrito no tenía. Deshabilitarlo SIN dar el
              motivo sería el otro antipatrón (ver D.4): la interfaz negando
              una acción sin decir qué falta.
            -->
            <app-toggle
              [checked]="isProrate()"
              [disabled]="!hasShippingCost()"
              label="Prorratear el flete en el costo de los productos"
              ariaLabel="Prorratear el flete en el costo de los productos"
              (toggled)="onAllocationToggle($event)"
            ></app-toggle>
            @if (!hasShippingCost()) {
              <p class="text-[11px] leading-snug text-warning">
                Escribe primero el costo del flete: sin monto no hay nada que
                repartir, así que la imputación no se puede elegir todavía.
              </p>
            }
            <p class="text-[11px] leading-snug text-text-secondary">
              {{ allocationLegend() }}
            </p>
          </div>
        }
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
  readonly shippingCost = input(0);
  readonly shippingCostAllocation = input<PopShippingAllocation | undefined>(
    undefined,
  );

  // Field changes bubble up to pop-header's existing handlers.
  readonly supplierChange = output<number | null | string>();
  readonly locationChange = output<number | null | string>();
  readonly orderDateChange = output<string>();
  readonly expectedDateChange = output<string>();
  readonly shippingMethodChange = output<string>();
  readonly shippingCostChange = output<number>();
  readonly shippingCostAllocationChange = output<PopShippingAllocation>();

  readonly isFreight = computed<boolean>(
    () => this.shippingMethod() === 'freight',
  );
  readonly isProrate = computed<boolean>(
    () => (this.shippingCostAllocation() ?? 'prorate') === 'prorate',
  );

  /**
   * CP-PURCHASE-TRANSPARENCY (T2/D.1) — hay flete que imputar.
   *
   * `PopCartService.setShippingCostAllocation()` rechaza el modo cuando el
   * monto es 0 (el backend responde 400 a un modo sin monto). Ese rechazo es
   * legítimo; lo que no lo era es que ocurriera sin que nadie se enterara. La
   * pantalla lo anticipa: sin monto el conmutador no se puede accionar y se
   * explica qué falta para poder accionarlo.
   */
  readonly hasShippingCost = computed<boolean>(
    () => Number(this.shippingCost()) > 0,
  );

  /**
   * La leyenda va en términos de negocio, no de contabilidad: la duda del
   * operador es inmediata y es la misma en los dos modos — «¿esto me toca el
   * costo del producto?» y «¿esto suma al total?».
   *
   * CP-PURCHASE-TRANSPARENCY (T2/D.3) — la versión anterior prometía una
   * DIRECCIÓN («sube su costo unitario»), y la dirección no es universal: el
   * costo se expresa por unidad de STOCK, así que cuando una unidad comprada
   * rinde varias de stock (`purchase_to_stock_factor`) la conversión diluye
   * más de lo que el flete suma y el costo unitario BAJA. La vista previa lo
   * enseñaba —«$4 → $3»— con esta leyenda al lado afirmando lo contrario.
   * Ahora se explica el MECANISMO, que es cierto en los dos casos.
   */
  readonly allocationLegend = computed<string>(() =>
    this.isProrate()
      ? 'El flete se reparte entre los productos según su participación en la compra y entra en el costo con el que cada uno queda valorado en bodega. El costo unitario resultante no siempre sube: también depende de cuántas unidades de stock entran por unidad comprada, así que un envase que rinde varias unidades reparte ese costo entre todas y puede terminar por debajo. La vista previa de costos muestra la cifra final de cada producto. El flete se suma al total de la orden.'
      : 'El flete no toca el costo de los productos: se registra como un costo de la orden y el costo unitario no se mueve. El flete se suma igual al total de la orden.',
  );

  /**
   * El CVA de `app-input [currency]` entrega el número crudo (o null al
   * vaciar). Se sanea a 2 decimales porque la columna es `Decimal(12,2)` y el
   * DTO rechaza el tercero con 400.
   */
  onShippingCostModel(value: number | string | null): void {
    const n = Number(value);
    const safe = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    this.shippingCostChange.emit(safe);
    if (safe > 0) {
      this.shippingCostAllocationChange.emit(
        this.shippingCostAllocation() ?? 'prorate',
      );
    }
  }

  onAllocationToggle(prorate: boolean): void {
    this.shippingCostAllocationChange.emit(prorate ? 'prorate' : 'expense');
  }
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
