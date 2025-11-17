import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pos-register',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900 mb-2">POS Register</h1>
        <p class="text-gray-600">Cash register and sales transaction processing</p>
      </div>

      <div class="bg-white rounded-lg shadow-sm border p-8">
        <div class="text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path>
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">Cash Register</h2>
          <p class="text-gray-600 max-w-md mx-auto">
            POS register is under development. You will be able to process cash transactions and manage payments here.
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
export class PosRegisterComponent {}