import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">
          Purchase Orders Management
        </h1>
        <p class="text-gray-600">Create and manage supplier purchase orders</p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4"
          >
            <svg
              class="w-8 h-8 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            Purchase Orders
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
            Purchase orders management is under development. You will be able to
            create and manage supplier orders here.
          </p>
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
export class PurchaseOrdersComponent {}
