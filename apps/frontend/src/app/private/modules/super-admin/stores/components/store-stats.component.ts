import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-store-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
      <app-stats
        title="Total Stores"
        [value]="stats.total_stores"
        iconName="store"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <app-stats
        title="Active"
        [value]="stats.active_stores"
        iconName="check"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Inactive"
        [value]="stats.inactive_stores"
        iconName="pause"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Draft"
        [value]="stats.draft_stores"
        iconName="file-text"
        iconBgColor="bg-gray-100"
        iconColor="text-gray-600"
      ></app-stats>

      <app-stats
        title="Suspended"
        [value]="stats.suspended_stores"
        iconName="alert-triangle"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>

      <app-stats
        title="Total Revenue"
        [value]="'$ ' + formatCurrency(stats.total_revenue)"
        iconName="dollar-sign"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Total Orders"
        [value]="formatNumber(stats.total_orders)"
        iconName="shopping-cart"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>

      <app-stats
        title="Total Products"
        [value]="formatNumber(stats.total_products)"
        iconName="package"
        iconBgColor="bg-orange-100"
        iconColor="text-orange-600"
      ></app-stats>
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
