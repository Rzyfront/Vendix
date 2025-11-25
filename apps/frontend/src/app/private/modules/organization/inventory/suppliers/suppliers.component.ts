import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-suppliers',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Gestión de proveedores</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Aquí se mostrará la gestión centralizada de proveedores
        </p>
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
export class SuppliersComponent {}
