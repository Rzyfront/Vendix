import { Component, input, output } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * `pop-order-config-card`
 *
 * Mini-card compacta (desktop ≥ xl) que resume la configuración de la orden de
 * compra. Sin configurar muestra un botón "Configurar compra"; una vez que hay
 * proveedor + bodega muestra una card delgada con el detalle y un botón editar.
 * Réplica del patrón `pos-session-status-bar` (botón ↔ mini-card).
 */
@Component({
  selector: 'app-pop-order-config-card',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (isConfigured()) {
      <div
        class="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-xl min-h-[44px]"
      >
        <!-- Proveedor -->
        <div class="flex items-center gap-1.5 min-w-0">
          <app-icon name="truck" [size]="15" class="text-primary flex-shrink-0"></app-icon>
          <span class="text-sm font-semibold text-text-primary truncate max-w-[140px]">
            {{ supplierName() || 'Proveedor' }}
          </span>
        </div>

        <span class="text-border" aria-hidden="true">&middot;</span>

        <!-- Bodega -->
        <div class="flex items-center gap-1.5 min-w-0">
          <app-icon name="warehouse" [size]="15" class="text-emerald-600 flex-shrink-0"></app-icon>
          <span class="text-sm font-medium text-text-secondary truncate max-w-[120px]">
            {{ locationName() || 'Bodega' }}
          </span>
        </div>

        <!-- Fecha entrega -->
        @if (expectedDateLabel()) {
          <span class="text-border hidden 2xl:inline" aria-hidden="true">&middot;</span>
          <div class="items-center gap-1.5 min-w-0 hidden 2xl:flex">
            <app-icon name="calendar" [size]="14" class="text-amber-600 flex-shrink-0"></app-icon>
            <span class="text-xs font-medium text-text-secondary whitespace-nowrap">
              {{ expectedDateLabel() }}
            </span>
          </div>
        }

        <!-- Método de envío -->
        @if (shippingLabel()) {
          <span class="text-border hidden 2xl:inline" aria-hidden="true">&middot;</span>
          <div class="items-center gap-1.5 min-w-0 hidden 2xl:flex">
            <app-icon name="package" [size]="14" class="text-text-secondary flex-shrink-0"></app-icon>
            <span class="text-xs font-medium text-text-secondary whitespace-nowrap">
              {{ shippingLabel() }}
            </span>
          </div>
        }

        <!-- Editar -->
        <button
          type="button"
          (click)="edit.emit()"
          class="flex items-center gap-1 ml-auto flex-shrink-0 min-h-[34px] px-2.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 active:scale-95 transition-all text-xs font-semibold"
          aria-label="Editar configuración de compra"
          title="Editar configuración"
        >
          <app-icon name="pencil" [size]="14"></app-icon>
          <span>Editar</span>
        </button>
      </div>
    } @else {
      <button
        type="button"
        (click)="edit.emit()"
        class="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm hover:bg-amber-100 active:scale-95 transition-all min-h-[44px] justify-center"
        aria-label="Configurar orden de compra"
      >
        <app-icon name="settings" [size]="16"></app-icon>
        <span class="font-medium">Sin configurar</span>
        <span class="font-semibold underline decoration-amber-400/60 underline-offset-2">
          Configurar compra
        </span>
      </button>
    }
  `,
})
export class PopOrderConfigCardComponent {
  readonly isConfigured = input<boolean>(false);
  readonly supplierName = input('');
  readonly locationName = input('');
  readonly orderDateLabel = input('');
  readonly expectedDateLabel = input('');
  readonly shippingLabel = input('');
  readonly edit = output<void>();
}
