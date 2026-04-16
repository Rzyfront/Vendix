import { Component, Input, inject } from '@angular/core';

import { StatsComponent } from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { PromotionsSummary } from '../../interfaces/promotion.interface';

@Component({
  selector: 'app-promotions-stats',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <div class="stats-container">
      <app-stats
        title="Activas"
        [value]="summary?.total_active ?? 0"
        smallText="Promociones activas"
        iconName="zap"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
        [loading]="loading"
      ></app-stats>

      <app-stats
        title="Programadas"
        [value]="summary?.total_scheduled ?? 0"
        smallText="Por activarse"
        iconName="clock"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
        [loading]="loading"
      ></app-stats>

      <app-stats
        title="Total descuentos"
        [value]="formatCurrency(summary?.total_discount_given ?? 0)"
        smallText="Descuento otorgado"
        iconName="dollar-sign"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
        [loading]="loading"
      ></app-stats>

      <app-stats
        title="Usos totales"
        [value]="summary?.total_usage ?? 0"
        smallText="Veces aplicadas"
        iconName="bar-chart-3"
        iconBgColor="bg-orange-100"
        iconColor="text-orange-600"
        [loading]="loading"
      ></app-stats>
    </div>
  `,
})
export class PromotionsStatsComponent {
  @Input() summary: PromotionsSummary | null = null;
  @Input() loading = false;

  private currency_service = inject(CurrencyFormatService);

  formatCurrency(value: number): string {
    return this.currency_service.format(value);
  }
}
