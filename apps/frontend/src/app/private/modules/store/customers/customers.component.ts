import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-customers',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Customer Management</h1>
        <p class="text-gray-600">Manage customer information, reviews, and relationships</p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
            <svg class="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">Customers Module</h2>
          <p class="text-gray-600 max-w-md mx-auto">
            This module is under development. You will be able to manage customer information and reviews here.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
  `]
})
export class CustomersComponent {}