import { Component, input, inject } from '@angular/core';

import { PaymentMethodStats } from '../interfaces/payment-methods.interface';
import { StatsComponent } from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-payment-methods-stats',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <div class="stats-container">
      <app-stats
        title="Total Methods"
        [value]="is_loading() ? '-' : stats()?.total_methods || 0"
        iconName="credit-card"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Enabled"
        [value]="is_loading() ? '-' : stats()?.enabled_methods || 0"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Needs Config"
        [value]="is_loading() ? '-' : stats()?.requires_config || 0"
        iconName="alert-triangle"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
      ></app-stats>

      <app-stats
        title="Total Revenue"
        [value]="
          is_loading() ? '-' : formatCurrency(stats()?.total_revenue || 0)
        "
        iconName="dollar-sign"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
      ></app-stats>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class PaymentMethodsStatsComponent {
  private currencyService = inject(CurrencyFormatService);
  readonly stats = input<PaymentMethodStats | null>(null);
  readonly is_loading = input<boolean>(false);

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
  }
}
