import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Inventory Management</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/inventory/stock"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Stock Management</h3>
          <p class="text-gray-600">Monitor stock levels</p>
        </a>

        <a
          routerLink="/organization/inventory/transfers"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Stock Transfers</h3>
          <p class="text-gray-600">Manage transfers between stores</p>
        </a>

        <a
          routerLink="/organization/inventory/suppliers"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Suppliers</h3>
          <p class="text-gray-600">Supplier management</p>
        </a>

        <a
          routerLink="/organization/inventory/demand-forecast"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Demand Forecast</h3>
          <p class="text-gray-600">Predict demand trends</p>
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
