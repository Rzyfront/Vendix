import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Stock Transfers</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Inter-store stock transfer management will be displayed here
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
export class TransfersComponent {}
