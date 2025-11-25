import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stock',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Gestión de stock</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Aquí se mostrará la gestión de stock consolidada de todas las tiendas.
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
export class StockComponent {}
