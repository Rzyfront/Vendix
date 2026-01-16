import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CurrencyStats } from '../interfaces';
import { StatsComponent } from '../../../../../shared/components';

@Component({
  selector: 'app-currency-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-6">
      <app-stats
        title="Total Monedas"
        [value]="stats.total_currencies"
        iconName="dollar-sign"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <app-stats
        title="Activas"
        [value]="stats.active_currencies"
        iconName="check-circle"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>

      <app-stats
        title="Inactivas"
        [value]="stats.inactive_currencies"
        iconName="x-circle"
        iconBgColor="bg-red-100"
        iconColor="text-red-600"
      ></app-stats>

      <app-stats
        title="Obsoletas"
        [value]="stats.deprecated_currencies"
        iconName="archive"
        iconBgColor="bg-yellow-100"
        iconColor="text-yellow-600"
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
export class CurrencyStatsComponent {
  @Input() stats: CurrencyStats = {
    total_currencies: 0,
    active_currencies: 0,
    inactive_currencies: 0,
    deprecated_currencies: 0,
  };
}
