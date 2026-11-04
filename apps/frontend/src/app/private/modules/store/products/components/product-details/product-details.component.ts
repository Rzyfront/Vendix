import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { UomService } from '../../../inventory/services/uom.service';
import { Product } from '../../interfaces';
import {
  fromProduct,
  summaryText,
} from '../../utils/sale-unit-form.util';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [],
  template: `
    <div class="product-details space-y-4">
      @if (saleUnitSummary(); as summary) {
        <div class="p-4 bg-surface rounded-xl border border-border">
          <h3 class="text-base font-semibold text-text-primary mb-2">
            Unidad de venta
          </h3>
          <p class="text-sm text-text-primary">{{ summary }}</p>
        </div>
      }
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
  private readonly uomService = inject(UomService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly catalog = toSignal(this.uomService.getCatalog(), {
    initialValue: { success: true, data: [] },
  });

  readonly product = input<Product>();

  /** Mismo resumen que el editor (S7); vacío mientras no hay catálogo. */
  readonly saleUnitSummary = computed<string>(() => {
    const product = this.product();
    const units = this.catalog().data ?? [];
    if (!product || units.length === 0) return '';
    return summaryText(
      fromProduct(product, units),
      Number(product.base_price ?? 0),
      units,
      (v) => this.currencyService.format(v),
    );
  });
}
