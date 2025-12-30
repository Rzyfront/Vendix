import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { StatsComponent } from '../../../../../../shared/components/index';

export interface PurchaseOrderStats {
  total: number;
  pending: number;
  received: number;
  total_value: number;
}

@Component({
  selector: 'app-purchase-order-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  templateUrl: './purchase-order-stats.component.html',
  styleUrls: ['./purchase-order-stats.component.scss'],
})
export class PurchaseOrderStatsComponent {
  @Input() stats: PurchaseOrderStats = {
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  };

  // Formatear número para visualización
  formatNumber(num: number | string): string {
    const numValue = typeof num === 'string' ? parseFloat(num) : num;
    if (numValue >= 1000000) {
      return (numValue / 1000000).toFixed(1) + 'M';
    } else if (numValue >= 1000) {
      return (numValue / 1000).toFixed(1) + 'K';
    }
    return numValue.toString();
  }

  // Formatear moneda para visualización
  formatCurrency(value: number | string): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (numValue >= 1000000) {
      return '$' + (numValue / 1000000).toFixed(1) + 'M';
    } else if (numValue >= 1000) {
      return '$' + (numValue / 1000).toFixed(1) + 'K';
    }
    return '$' + numValue.toFixed(2);
  }
}
