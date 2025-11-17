import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoreStats } from '../../interfaces/store.interface';
import { IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-store-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './store-stats.component.html',
  styleUrls: ['./store-stats.component.scss'],
})
export class StoreStatsComponent {
  @Input() stats: StoreStats | null = null;

  // Formatear número para visualización
  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }

  // Formatear moneda
  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
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
