import { Component, input } from '@angular/core';
import { Product } from '../../interfaces';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [],
  template: `
    <div class="product-details space-y-4">
      <div class="p-4 bg-surface rounded-xl border border-border">
        <h3 class="text-base font-semibold text-text-primary mb-2">Inventario</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-text-muted">Stock actual:</span>
            <span class="font-medium text-text-primary ml-1.5">{{ product()?.stock_quantity ?? 0 }}</span>
          </div>
          <div>
            <span class="text-text-muted">Stock mínimo para alerta:</span>
            <span class="font-medium text-text-primary ml-1.5">
              {{ product()?.min_stock_level ? product()?.min_stock_level + ' un.' : 'Por defecto de la tienda' }}
            </span>
          </div>
        </div>
      </div>
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
export class ProductDetailsComponent {
  readonly product = input<Product>();
}
