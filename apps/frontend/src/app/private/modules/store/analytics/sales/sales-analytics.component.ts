import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sales-analytics',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">
          Análisis de ventas
        </h1>
        <p class="text-gray-600">
          Vea el rendimiento y las tendencias de ventas detalladas
        </p>
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
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            Informes de ventas
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
            El análisis de ventas está en desarrollo. Podrás ver el rendimiento
            y las tendencias de ventas detalladamente aquí.
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
export class SalesAnalyticsComponent {}
