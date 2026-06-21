import { Component, computed, input } from '@angular/core';
import { StatsComponent } from '../../../../../../shared/components/index';
import { DispatchRouteStats } from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planilla-stats',
  standalone: true,
  imports: [StatsComponent],
  template: `
    <ng-container>
      <app-stats
        title="Total Planillas"
        [value]="formatNumber(stats()?.total ?? 0)"
        smallText="Planillas creadas"
        iconName="file-text"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-500"
        [loading]="loading()"
      ></app-stats>

      <app-stats
        title="En Ruta"
        [value]="formatNumber(inRoute())"
        smallText="Despachadas y en tránsito"
        iconName="truck"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-500"
        [loading]="loading()"
      ></app-stats>

      <app-stats
        title="Cerradas"
        [value]="formatNumber(stats()?.closed ?? 0)"
        smallText="Cuadradas"
        iconName="check-circle"
        iconBgColor="bg-emerald-100"
        iconColor="text-emerald-500"
        [loading]="loading()"
      ></app-stats>

      <app-stats
        title="Anuladas"
        [value]="formatNumber(stats()?.voided ?? 0)"
        smallText="Canceladas"
        iconName="x-circle"
        iconBgColor="bg-red-100"
        iconColor="text-red-500"
        [loading]="loading()"
      ></app-stats>
    </ng-container>
  `,
  styles: [`:host { display: contents; }`],
})
export class PlanillaStatsComponent {
  readonly stats = input<DispatchRouteStats | null>(null);
  readonly loading = input<boolean>(false);

  readonly inRoute = computed(() => {
    const s = this.stats();
    return (s?.dispatched ?? 0) + (s?.in_transit ?? 0);
  });

  formatNumber(num: number | string): string {
    const num_value = typeof num === 'string' ? parseFloat(num) : num;
    if (num_value >= 1000000) {
      return (num_value / 1000000).toFixed(1) + 'M';
    } else if (num_value >= 1000) {
      return (num_value / 1000).toFixed(1) + 'K';
    }
    return num_value.toString();
  }
}
