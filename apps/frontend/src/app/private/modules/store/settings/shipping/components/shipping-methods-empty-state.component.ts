import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'app-shipping-methods-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  template: `
    <div class="text-center py-12">
      <div
        class="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4"
      >
        <app-icon
          name="truck"
          [size]="32"
          class="text-gray-400"
        ></app-icon>
      </div>
      <h3 class="text-lg font-medium text-gray-900 mb-2">
        No hay métodos de envío configurados
      </h3>
      <p class="text-gray-600 max-w-md mx-auto mb-6">
        Comienza agregando tu primer método de envío. Puedes elegir entre
        distintas opciones como recogida en tienda, flota propia, transportadoras
        y proveedores externos.
      </p>
      <div class="space-y-3">
        <app-button variant="primary" (clicked)="addShippingMethod.emit()">
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Agregar Método de Envío
        </app-button>
        <div class="text-sm text-gray-500">
          <p>Opciones populares:</p>
          <ul class="mt-2 space-y-1">
            <li>• Recogida en tienda (Pickup)</li>
            <li>• Flota propia</li>
            <li>• Transportadora</li>
            <li>• Proveedores externos</li>
          </ul>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ShippingMethodsEmptyStateComponent {
  @Output() addShippingMethod = new EventEmitter<void>();
}
