import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-product-empty-state',
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
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
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
        <app-button variant="primary" (clicked)="actionClick.emit()">
          Crear Primer Producto
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
export class ProductEmptyStateComponent {
  @Input() title = 'No products found';
  @Input() description = 'Comience creando su primer producto.';
  @Input() showAdditionalActions = false;
  @Input() showRefreshButton = true;

  @Output() actionClick = new EventEmitter<void>();
  @Output() refreshClick = new EventEmitter<void>();
  @Output() clearFiltersClick = new EventEmitter<void>();
}
