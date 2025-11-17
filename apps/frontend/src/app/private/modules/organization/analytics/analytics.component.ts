import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Analytics & Business Intelligence</h1>

      <!-- Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a
          routerLink="/organization/analytics/predictive"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Predictive Analysis</h3>
          <p class="text-gray-600">Sales forecasting and trend analysis</p>
        </a>

        <a
          routerLink="/organization/analytics/cross-store"
          class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
        >
          <h3 class="text-lg font-semibold mb-2">Cross-Store Analysis</h3>
          <p class="text-gray-600">Product performance across stores</p>
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
export class AnalyticsComponent {}
