import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-promotions',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Promociones</h1>
        <p class="text-gray-600">Crea y gestiona campañas promocionales</p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4"
          >
            <svg
              class="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            Gestión de Promociones
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
           La gestión de promociones está en desarrollo. Podrás
           cree y administre campañas promocionales aquí.
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
export class PromotionsComponent {}
