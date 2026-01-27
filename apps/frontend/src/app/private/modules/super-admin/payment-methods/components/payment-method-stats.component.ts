import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PaymentMethodStats } from '../interfaces/payment-method.interface';
import { StatsComponent } from '../../../../../shared/components/index';

@Component({
  selector: 'app-payment-method-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <app-stats
        title="Total Métodos"
        [value]="stats().total_methods"
        iconName="credit-card"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Activos"
        [value]="stats().active_methods"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Inactivos"
        [value]="stats().inactive_methods"
        iconName="x-circle"
        iconBgColor="bg-gray-100"
        iconColor="text-gray-600"
      ></app-stats>

      <app-stats
        title="Tiendas Usando"
        [value]="stats().total_stores_using_methods"
        iconName="store"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
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
export class PaymentMethodStatsComponent {
  stats = input<PaymentMethodStats>({
    total_methods: 0,
    active_methods: 0,
    inactive_methods: 0,
    methods_requiring_config: 0,
    total_stores_using_methods: 0,
  });
}
