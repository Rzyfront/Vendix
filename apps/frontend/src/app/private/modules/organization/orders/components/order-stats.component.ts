import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { IconComponent } from '../../../../../shared/components';
import { OrderStats } from '../interfaces/order.interface';

@Component({
  selector: 'app-order-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Total Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Orders</p>
            <p class="text-2xl font-bold mt-1 text-text-primary">
              {{ formatNumber(stats.total_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10"
          >
            <app-icon name="cart" [size]="24" class="text-primary"></app-icon>
          </div>
        </div>
      </div>

      <!-- Pending Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Pending</p>
            <p class="text-2xl font-bold mt-1 text-yellow-600">
              {{ formatNumber(stats.pending_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-yellow-100"
          >
            <app-icon
              name="clock"
              [size]="24"
              class="text-yellow-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Confirmed Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Confirmed</p>
            <p class="text-2xl font-bold mt-1 text-blue-600">
              {{ formatNumber(stats.confirmed_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-blue-100"
          >
            <app-icon
              name="check-circle"
              [size]="24"
              class="text-blue-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Processing Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Processing</p>
            <p class="text-2xl font-bold mt-1 text-purple-600">
              {{ formatNumber(stats.processing_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-purple-100"
          >
            <app-icon
              name="refresh"
              [size]="24"
              class="text-purple-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Delivered Orders -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Delivered</p>
            <p class="text-2xl font-bold mt-1 text-green-600">
              {{ formatNumber(stats.delivered_orders) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-green-100"
          >
            <app-icon
              name="file-check"
              [size]="24"
              class="text-green-600"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Revenue -->
      <div class="bg-surface rounded-card shadow-card border border-border p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-text-secondary">Total Revenue</p>
            <p class="text-2xl font-bold mt-1 text-emerald-600">
              $ {{ formatCurrency(stats.total_revenue) }}
            </p>
          </div>
          <div
            class="w-12 h-12 rounded-lg flex items-center justify-center bg-emerald-100"
          >
            <app-icon
              name="dollar-sign"
              [size]="24"
              class="text-emerald-600"
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
export class OrderStatsComponent {
  @Input() stats: OrderStats = {
    total_orders: 0,
    pending_orders: 0,
    confirmed_orders: 0,
    processing_orders: 0,
    shipped_orders: 0,
    delivered_orders: 0,
    cancelled_orders: 0,
    refunded_orders: 0,
    total_revenue: 0,
    pending_revenue: 0,
    average_order_value: 0,
    orders_by_status: {} as any,
    orders_by_payment_status: {} as any,
    orders_by_store: [],
    recent_orders: [],
  };

  formatCurrency(value: number): string {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(2);
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
