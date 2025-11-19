import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../shared/components';

import { CartState } from '../models/cart.model';

@Component({
  selector: 'app-pos-stats',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <!-- Total Items -->
      <div
        class="bg-surface p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-text-secondary mb-1">Productos en Carrito</p>
            <p class="text-2xl font-bold text-text-primary">
              {{ cartState?.items?.length || 0 }}
            </p>
          </div>
          <div
            class="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center"
          >
            <app-icon
              name="package"
              [size]="24"
              class="text-primary"
            ></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Quantity -->
      <div
        class="bg-surface p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-text-secondary mb-1">Cantidad Total</p>
            <p class="text-2xl font-bold text-text-primary">
              {{ getTotalQuantity() }}
            </p>
          </div>
          <div
            class="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center"
          >
            <app-icon name="hash" [size]="24" class="text-blue-600"></app-icon>
          </div>
        </div>
      </div>

      <!-- Total Amount -->
      <div
        class="bg-surface p-6 rounded-lg border border-border hover:shadow-md transition-shadow cursor-pointer"
      >
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-text-secondary mb-1">Total Carrito</p>
            <p class="text-2xl font-bold text-text-primary">
              {{ formatCurrency(getTotalAmount()) }}
            </p>
          </div>
          <div
            class="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center"
          >
            <app-icon
              name="dollar-sign"
              [size]="24"
              class="text-green-600"
            ></app-icon>
          </div>
        </div>
      </div>
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
