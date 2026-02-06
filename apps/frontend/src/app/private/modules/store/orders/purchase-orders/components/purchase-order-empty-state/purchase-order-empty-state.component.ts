import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-purchase-order-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="text-center py-12">
      <!-- Icon -->
      <div
        class="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6"
      >
        <svg
          class="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
          ></path>
        </svg>
      </div>

      <!-- Title -->
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        {{ title }}
      </h3>

      <!-- Description -->
      <p class="text-gray-500 mb-6 max-w-md mx-auto">
        {{ description }}
      </p>

      <!-- Actions -->
      <div class="flex flex-col items-center sm:flex-row gap-3 justify-center">
        <app-button
          variant="primary"
          (clicked)="actionClick.emit()"
          *ngIf="showActionButton"
        >
          {{ actionButtonText }}
        </app-button>

        <app-button
          variant="outline"
          (clicked)="refreshClick.emit()"
          *ngIf="showRefreshButton"
        >
          Actualizar
        </app-button>

        <app-button
          variant="ghost"
          (clicked)="clearFiltersClick.emit()"
          *ngIf="showAdditionalActions"
        >
          Limpiar Filtros
        </app-button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PurchaseOrderEmptyStateComponent {
  @Input() title = 'No se encontraron órdenes de compra';
  @Input() description =
    'Comienza creando tu primera orden de compra para reabastecer inventario.';
  @Input() actionButtonText = 'Crear Primera Orden';
  @Input() showActionButton = true;
  @Input() showAdditionalActions = false;
  @Input() showRefreshButton = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
