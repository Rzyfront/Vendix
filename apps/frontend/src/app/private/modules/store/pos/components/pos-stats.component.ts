import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { StatsComponent } from '../../../../../shared/components/index';

import { CartState } from '../models/cart.model';

@Component({
  selector: 'app-pos-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="grid grid-cols-3 gap-2 md:gap-4 lg:gap-6">
      <!-- Productos en Carrito -->
      <app-stats
        title="Productos"
        [value]="cartState?.items?.length || 0"
        smallText="En carrito"
        iconName="package"
        iconBgColor="bg-primary/10"
        iconColor="text-primary"
      ></app-stats>

      <!-- Cantidad Total -->
      <app-stats
        title="Cantidad"
        [value]="getTotalQuantity()"
        smallText="Unidades totales"
        iconName="hash"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-600"
      ></app-stats>

      <!-- Total Carrito -->
      <app-stats
        title="Total"
        [value]="formatCurrency(getTotalAmount())"
        smallText="Carrito actual"
        iconName="dollar-sign"
        iconBgColor="bg-green-100"
        iconColor="text-green-600"
      ></app-stats>
    </div>
  `,
})
export class PosStatsComponent {
  @Input() cartState: CartState | null = null;

  getTotalQuantity(): number {
    return (
      this.cartState?.items?.reduce(
        (total, item) => total + item.quantity,
        0,
      ) || 0
    );
  }

  getTotalAmount(): number {
    return this.cartState?.summary?.total || 0;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(value);
  }
}
