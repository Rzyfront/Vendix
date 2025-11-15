import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-cross-store',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Cross-Store Product Analysis</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Cross-store product performance analysis will be displayed here
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
export class CrossStoreComponent {}
