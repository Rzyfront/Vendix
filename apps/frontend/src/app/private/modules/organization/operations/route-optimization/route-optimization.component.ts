import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-route-optimization',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Route Optimization</h1>

      <div class="bg-white rounded-lg shadow p-6">
        <p class="text-gray-600">
          Delivery route optimization will be displayed here
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
export class RouteOptimizationComponent {}
