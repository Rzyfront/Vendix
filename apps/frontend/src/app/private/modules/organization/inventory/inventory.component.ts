import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Gestión de inventario</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/inventory/stock"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Gestión de stock</h3>
          <p class="text-gray-600">Stock Monitor de gestión de niveles de stock</p>
        </a>

        <a
          routerLink="/organization/inventory/transfers"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Transferencias de acciones</h3>
          <p class="text-gray-600">Gestionar transferencias entre tiendas</p>
        </a>

        <a
          routerLink="/organization/inventory/suppliers"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Suppliers</h3>
          <p class="text-gray-600">Gestión de proveedoresGestión de proveedores</p>
        </a>

        <a
          routerLink="/organization/inventory/demand-forecast"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Previsión de demanda</h3>
          <p class="text-gray-600">Predecir las tendencias de la demanda</p>
        </a>
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
export class InventoryComponent {}
