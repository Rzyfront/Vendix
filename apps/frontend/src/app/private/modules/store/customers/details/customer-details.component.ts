import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-customer-details',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Detalles del cliente</h1>
        <p class="text-gray-600">
          Ver información detallada sobre este cliente
        </p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div
            class="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4"
          >
            <svg
              class="w-8 h-8 text-indigo-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              ></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">
            Perfil del cliente
          </h2>
          <p class="text-gray-600 max-w-md mx-auto">
           ID del Cliente: {{ customerId || 'Loading...' }}
          </p>
          <p class="text-gray-600 max-w-md mx-auto mt-2">
            La vista de detalles del cliente está en desarrollo. Podrás ver 
            información completa del cliente aquí.
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
export class CustomerDetailsComponent {
  customerId: string | null = null;

  constructor(private route: ActivatedRoute) {
    this.route.paramMap.subscribe((params) => {
      this.customerId = params.get('id');
    });
  }
}
