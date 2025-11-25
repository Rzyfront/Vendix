import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-operations',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Operaciones y Logística</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/operations/shipping"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Gestión de envíos</h3>
          <p class="text-gray-600">Gestionar operaciones de envío</p>
        </a>

        <a
          routerLink="/organization/operations/procurement"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Obtención</h3>
          <p class="text-gray-600">Compras de proveedores</p>
        </a>

        <a
          routerLink="/organization/operations/returns"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Gestión de devoluciones</h3>
          <p class="text-gray-600">Gestionar devoluciones y reembolsos</p>
        </a>

        <a
          routerLink="/organization/operations/route-optimization"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Optimización de ruta</h3>
          <p class="text-gray-600">Optimizar las rutas de entrega</p>
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
export class OperationsComponent {}
