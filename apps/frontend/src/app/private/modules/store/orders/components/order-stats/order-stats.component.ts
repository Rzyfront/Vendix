import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { StatsComponent } from '../../../../../../shared/components/index';
import { ExtendedOrderStats } from '../../interfaces/order.interface';

@Component({
  selector: 'app-order-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  templateUrl: './order-stats.component.html',
  styleUrls: ['./order-stats.component.scss']
})
export class OrderStatsComponent {
  @Input() stats: ExtendedOrderStats = {
    total_orders: 0,
    total_revenue: 0,
    pending_orders: 0,
    completed_orders: 0,
    average_order_value: 0,
    ordersGrowthRate: 0,
    pendingGrowthRate: 0,
    completedGrowthRate: 0,
    revenueGrowthRate: 0,
  };

  // Formatear número para visualización
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  // Formatear moneda para visualización
  formatCurrency(value: number): string {
    if (value >= 1000000) {
      return '$' + (value / 1000000).toFixed(1) + 'M';
    } else if (value >= 1000) {
      return '$' + (value / 1000).toFixed(1) + 'K';
    }
    return '$' + value.toFixed(2);
  }

  // Calcular porcentaje de crecimiento
  getGrowthPercentage(growthRate: number): string {
    const sign = growthRate >= 0 ? '+' : '';
    return `${sign}${growthRate.toFixed(1)}%`;
  }

  // Determinar clase CSS según el crecimiento
  getGrowthClass(growthRate: number): string {
    if (growthRate > 0) return 'text-green-600';
    if (growthRate < 0) return 'text-red-600';
    return 'text-gray-600';
  }
}
