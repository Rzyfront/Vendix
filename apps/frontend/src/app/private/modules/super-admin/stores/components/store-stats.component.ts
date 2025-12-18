import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { IconComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-store-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Stores -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Stores</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">
              {{ stats.total_stores }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
          >
            <app-icon name="store" [size]="24" class="text-primary"></app-icon>
          </div>
        </div>
      </div>

      <!-- Active Stores -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Active</p>
            <p class="text-2xl font-bold mt-1 text-green-600">
              {{ stats.active_stores }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
          >
            <app-icon
              name="check"
              [size]="24"
              class="text-green-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Inactive Stores -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Inactive</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">
              {{ stats.inactive_stores }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100"
          >
            <app-icon
              name="pause"
              [size]="24"
              class="text-yellow-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Draft Stores -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Draft</p>
            <p class="text-2xl font-bold mt-1 text-gray-600">
              {{ stats.draft_stores }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-gray-100"
          >
            <app-icon
              name="file-text"
              [size]="24"
              class="text-gray-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Suspended Stores -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Suspended</p>
            <p class="text-2xl font-bold mt-1 text-red-600">
              {{ stats.suspended_stores }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-red-100"
          >
            <app-icon
              name="alert-triangle"
              [size]="24"
              class="text-red-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Revenue -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Revenue</p>
            <p class="text-2xl font-bold mt-1 text-blue-600">
              $ {{ formatCurrency(stats.total_revenue) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-100"
          >
            <app-icon
              name="dollar-sign"
              [size]="24"
              class="text-blue-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Orders</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">
              {{ formatNumber(stats.total_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100"
          >
            <app-icon
              name="shopping-cart"
              [size]="24"
              class="text-purple-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Products -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">
              Total Products
            </p>
            <p class="text-2xl font-bold mt-1 text-orange-600">
              {{ formatNumber(stats.total_products) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-orange-100"
          >
            <app-icon
              name="package"
              [size]="24"
              class="text-orange-600"
            ></app-icon>
          </div>
        </div>
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
export class StoreStatsComponent {
  @Input() stats = {
    total_stores: 0,
    active_stores: 0,
    inactive_stores: 0,
    suspended_stores: 0,
    draft_stores: 0,
    total_revenue: 0,
    total_orders: 0,
    total_products: 0,
  };

  formatCurrency(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(0);
  }

  formatNumber(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toString();
  }
}
