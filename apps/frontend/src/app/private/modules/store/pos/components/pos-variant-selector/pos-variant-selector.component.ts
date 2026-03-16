import {
  Component,
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import {
  Product,
  PosProductVariant,
} from '../../services/pos-product.service';

@Component({
  selector: 'app-pos-variant-selector',
  standalone: true,
  imports: [CommonModule, IconComponent, CurrencyPipe],
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4"
      (click)="onBackdropClick($event)"
    >
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>

      <!-- Modal -->
      <div
        class="relative bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden z-10"
        (click)="$event.stopPropagation()"
      >
        <!-- Header -->
        <div class="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold text-text-primary">
              Seleccionar variante
            </h3>
            <p class="text-sm text-text-secondary mt-0.5">{{ product.name }}</p>
          </div>
          <button
            (click)="onClose()"
            class="w-8 h-8 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
          >
            <app-icon name="x" [size]="18" class="text-text-secondary"></app-icon>
          </button>
        </div>

        <!-- Variant List -->
        <div class="flex-1 overflow-y-auto p-3">
          <div class="flex flex-col gap-2">
            @for (variant of variants; track variant.id) {
              <button
                class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left"
                [class]="isVariantAvailable(variant)
                  ? 'border-border hover:border-primary hover:bg-primary/5 cursor-pointer active:scale-[0.98]'
                  : 'border-border/50 opacity-50 cursor-not-allowed'"
                [disabled]="!isVariantAvailable(variant)"
                (click)="onSelectVariant(variant)"
              >
                <!-- Variant Image or Icon -->
                <div class="w-14 h-14 rounded-lg bg-muted/50 flex-shrink-0 overflow-hidden">
                  @if (variant.image_url) {
                    <img
                      [src]="variant.image_url"
                      [alt]="getVariantLabel(variant)"
                      class="w-full h-full object-cover"
                    />
                  } @else {
                    <div class="w-full h-full flex items-center justify-center">
                      <app-icon name="package" [size]="20" class="text-text-muted"></app-icon>
                    </div>
                  }
                </div>

                <!-- Variant Info -->
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-sm text-text-primary truncate">
                    {{ getVariantLabel(variant) }}
                  </p>
                  @if (variant.sku) {
                    <p class="text-xs text-text-muted font-mono mt-0.5">
                      SKU: {{ variant.sku }}
                    </p>
                  }
                </div>

                <!-- Price & Stock -->
                <div class="flex flex-col items-end flex-shrink-0">
                  <span class="font-bold text-sm text-text-primary">
                    {{ getVariantFinalPrice(variant) | currency }}
                  </span>
                  @if (getVariantPriceDiff(variant); as diff) {
                    <span class="text-[10px] mt-0.5"
                      [class]="diff > 0 ? 'text-error' : 'text-success'">
                      {{ diff > 0 ? '+' : '' }}{{ diff | currency }}
                    </span>
                  }
                  @if (product.track_inventory !== false) {
                    @if (variant.stock > 0) {
                      <span class="text-xs mt-0.5"
                        [class]="variant.stock <= 5 ? 'text-warning' : 'text-text-muted'"
                      >
                        {{ variant.stock }} disp.
                      </span>
                    } @else {
                      <span class="text-xs text-error font-medium mt-0.5">Agotado</span>
                    }
                  } @else {
                    <span class="text-xs text-info mt-0.5">Disponible</span>
                  }
                </div>
              </button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }
  `],
})
export class PosVariantSelectorComponent {
  @Input({ required: true }) product!: Product;
  @Input({ required: true }) variants!: PosProductVariant[];
  @Output() variantSelected = new EventEmitter<PosProductVariant>();
  @Output() closed = new EventEmitter<void>();

  /** Group variants by their first attribute for visual sections */
  get groupedAttributes(): { name: string; variants: PosProductVariant[] }[] {
    if (!this.variants?.length) return [];
    // Only group if there are multiple attribute types
    const firstVariant = this.variants[0];
    if (!firstVariant?.attributes || firstVariant.attributes.length <= 1) return [];
    const groups: Record<string, PosProductVariant[]> = {};
    for (const v of this.variants) {
      const groupKey = v.attributes?.[0]?.attribute_value || 'Otros';
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(v);
    }
    const groupName = firstVariant.attributes[0]?.attribute_name || 'Tipo';
    return Object.entries(groups).map(([name, variants]) => ({
      name: `${groupName}: ${name}`,
      variants,
    }));
  }

  /** Check if a variant is available considering track_inventory */
  isVariantAvailable(variant: PosProductVariant): boolean {
    if (this.product.track_inventory === false) return true;
    return variant.stock > 0;
  }

  getVariantLabel(variant: PosProductVariant): string {
    if (variant.attributes && variant.attributes.length > 0) {
      return variant.attributes.map(a => a.attribute_value).join(' / ');
    }
    return variant.sku || `Variante #${variant.id}`;
  }

  getVariantFinalPrice(variant: PosProductVariant): number {
    const basePrice = variant.price_override ?? this.product.price;
    // Tax rates are stored as decimals in DB (e.g., 0.19 for 19%) — do NOT divide by 100
    const taxRate = this.product.tax_assignments?.reduce((sum, ta) => {
      return sum + (ta.tax_categories?.tax_rates?.reduce(
        (rateSum, tr) => rateSum + parseFloat(tr.rate || '0'),
        0,
      ) || 0);
    }, 0) || 0;
    return basePrice * (1 + taxRate);
  }

  /** Get price difference between variant and base product price */
  getVariantPriceDiff(variant: PosProductVariant): number | null {
    const variantPrice = this.getVariantFinalPrice(variant);
    const basePrice = this.getBaseFinalPrice();
    const diff = variantPrice - basePrice;
    return Math.abs(diff) > 0.01 ? diff : null;
  }

  private getBaseFinalPrice(): number {
    const taxRate = this.product.tax_assignments?.reduce((sum, ta) => {
      return sum + (ta.tax_categories?.tax_rates?.reduce(
        (rateSum, tr) => rateSum + parseFloat(tr.rate || '0'),
        0,
      ) || 0);
    }, 0) || 0;
    return this.product.price * (1 + taxRate);
  }

  onSelectVariant(variant: PosProductVariant): void {
    if (!this.isVariantAvailable(variant)) return;
    this.variantSelected.emit(variant);
  }

  onClose(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }
}
