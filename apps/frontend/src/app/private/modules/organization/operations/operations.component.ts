import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-operations',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Operations & Logistics</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a
          routerLink="/organization/operations/shipping"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Shipping Management</h3>
          <p class="text-gray-600">Manage shipping operations</p>
        </a>

        <a
          routerLink="/organization/operations/procurement"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Procurement</h3>
          <p class="text-gray-600">Supplier purchases</p>
        </a>

        <a
          routerLink="/organization/operations/returns"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Returns Management</h3>
          <p class="text-gray-600">Handle returns and refunds</p>
        </a>

        <a
          routerLink="/organization/operations/route-optimization"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Route Optimization</h3>
          <p class="text-gray-600">Optimize delivery routes</p>
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
