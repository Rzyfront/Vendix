import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import shared components
import { StatsComponent } from '../../../../../shared/components/index';

import { CartState } from '../models/cart.model';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-pos-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="stats-container">
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

      <!-- Subtotal -->
      <app-stats
        title="Subtotal"
        [value]="formatCurrency(getSubtotal())"
        smallText="Antes de impuestos"
        iconName="calculator"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-600"
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

  private currencyService = inject(CurrencyFormatService);

  getTotalQuantity(): number {
    return (
      this.cartState?.items?.reduce(
        (total, item) => total + item.quantity,
        0,
      ) || 0
    );
  }

  getSubtotal(): number {
    return this.cartState?.summary?.subtotal || 0;
  }

  getTotalAmount(): number {
    return this.cartState?.summary?.total || 0;
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
  }
}
