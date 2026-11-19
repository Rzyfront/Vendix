import { Component, input } from '@angular/core';


// Import shared components
import { StatsComponent } from '../../../../../shared/components';
import { formatCompactMoney } from '../../../../../shared/utils/compact-money.util';
import { OrderStats } from '../interfaces/order.interface';

@Component({
  selector: 'app-order-stats',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <div class="space-y-4">
      <div class="stats-container">
        <app-stats
          title="Total Orders"
          [value]="formatNumber(stats().total_orders)"
          iconName="shopping-cart"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
        ></app-stats>

        <app-stats
          title="Pending"
          [value]="formatNumber(stats().pending_orders)"
          iconName="clock"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>

        <app-stats
          title="Confirmed"
          [value]="formatNumber(stats().confirmed_orders)"
          iconName="check-circle"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Processing"
          [value]="formatNumber(stats().processing_orders)"
          iconName="refresh-cw"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <div class="stats-container">
        <app-stats
          title="Delivered"
          [value]="formatNumber(stats().delivered_orders)"
          iconName="file-check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Total Revenue"
          [value]="formatCurrency(stats().total_revenue)"
          iconName="dollar-sign"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
        ></app-stats>
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
  readonly stats = input<OrderStats>({
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
});

  /**
   * QUI-1017 — formateador compacto central: el signo va antes del símbolo
   * ("-$ 5.9M"). Bajo mil conserva 2 decimales, como antes.
   */
  formatCurrency(value: number): string {
    const num = Number(value) || 0;
    if (Math.abs(num) >= 1000) {
      return formatCompactMoney(num, { symbol: '$ ' });
    }
    const body = `$ ${Math.abs(num).toFixed(2)}`;
    return num < 0 && Number(Math.abs(num).toFixed(2)) !== 0 ? `-${body}` : body;
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
