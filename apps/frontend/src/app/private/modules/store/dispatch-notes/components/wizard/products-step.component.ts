import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';

import {
  InputsearchComponent,
  IconComponent,
  QuantityControlComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PosProductService, Product } from '../../../pos/services/pos-product.service';
import {
  DispatchNoteWizardService,
  WizardItem,
} from '../../services/dispatch-note-wizard.service';

@Component({
  selector: 'app-dispatch-wizard-products-step',
  standalone: true,
  imports: [
    CommonModule,
    InputsearchComponent,
    IconComponent,
    QuantityControlComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2">
      <!-- Product Search -->
      <app-inputsearch
        placeholder="Buscar por nombre, SKU o codigo de barras..."
        [debounceTime]="300"
        (search)="onSearch($event)"
      ></app-inputsearch>

      <!-- Search Results (dropdown-like) -->
      @if (searchResults().length > 0) {
        <div
          class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)]"
        >
          @for (product of searchResults(); track product.id) {
            <button
              type="button"
              class="w-full text-left p-2 flex items-center gap-2
                     hover:bg-[var(--color-primary-light)] transition-colors duration-200
                     border-b border-[var(--color-border)] last:border-b-0
                     focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-ring)]
                     min-h-[44px]"
              (click)="addProduct(product)"
            >
              <!-- Thumbnail -->
              <div
                class="w-8 h-8 rounded-md bg-[var(--color-surface-elevated)] flex items-center justify-center shrink-0 overflow-hidden"
              >
                @if (product.image_url || product.image) {
                  <img
                    [src]="product.image_url || product.image"
                    [alt]="product.name"
                    class="w-full h-full object-cover"
                  />
                } @else {
                  <app-icon
                    name="package"
                    [size]="14"
                    color="var(--color-text-muted)"
                  ></app-icon>
                }
              </div>

              <!-- Product info -->
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                  {{ product.name }}
                </p>
                @if (product.sku) {
                  <p class="text-xs text-[var(--color-text-muted)] truncate">
                    SKU: {{ product.sku }}
                  </p>
                }
              </div>

              <!-- Price -->
              <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0">
                {{ product.final_price || product.price | currency }}
              </span>

              <!-- Add indicator -->
              <app-icon
                name="plus"
                [size]="14"
                color="var(--color-primary)"
                class="shrink-0"
              ></app-icon>
            </button>
          }
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center justify-center py-3">
          <div
            class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin"
          ></div>
          <span class="ml-2 text-sm text-[var(--color-text-secondary)]">
            Buscando...
          </span>
        </div>
      }

      <!-- Selected Items -->
      @if (wizardService.items().length > 0) {
        <div>
          <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
            Productos seleccionados ({{ wizardService.items().length }})
          </p>

          <div class="space-y-1.5">
            @for (item of wizardService.items(); track trackByItem(item)) {
              <div
                class="border border-[var(--color-border)] rounded-lg p-2.5 bg-[var(--color-surface)]"
              >
                <div class="flex items-center gap-2">
                  <!-- Thumbnail -->
                  <div
                    class="w-8 h-8 rounded-md bg-[var(--color-surface-elevated)] flex items-center justify-center shrink-0 overflow-hidden"
                  >
                    @if (item.product_image_url) {
                      <img
                        [src]="item.product_image_url"
                        [alt]="item.product_name"
                        class="w-full h-full object-cover"
                      />
                    } @else {
                      <app-icon
                        name="package"
                        [size]="14"
                        color="var(--color-text-muted)"
                      ></app-icon>
                    }
                  </div>

                  <!-- Item info — name, sku, stock inline on desktop -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ item.product_name }}
                      </p>
                      @if (item.product_sku) {
                        <span class="hidden md:inline text-[10px] text-[var(--color-text-muted)] shrink-0">
                          {{ item.product_sku }}
                        </span>
                      }
                    </div>
                    @if (item.stock_available !== undefined && item.stock_available !== null) {
                      <p class="text-[10px] text-[var(--color-text-muted)]">
                        Disp: {{ item.stock_available }}
                      </p>
                    }
                  </div>

                  <!-- Quantity control -->
                  <app-quantity-control
                    [value]="item.dispatched_quantity"
                    [min]="1"
                    [max]="item.stock_available ?? 9999"
                    size="sm"
                    (valueChange)="onQuantityChange(item, $event)"
                  ></app-quantity-control>

                  <!-- Line total -->
                  <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0 min-w-[60px] text-right">
                    {{ item.unit_price * item.dispatched_quantity | currency }}
                  </span>

                  <!-- Delete button -->
                  <button
                    type="button"
                    class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)]
                           hover:bg-[var(--color-danger)]/10 transition-colors duration-200
                           focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]
                           min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                    (click)="removeItem(item)"
                    aria-label="Eliminar producto"
                  >
                    <app-icon name="x" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            }
          </div>

          <!-- Totals -->
          <div
            class="rounded-lg mt-2 p-2.5 space-y-1"
            style="background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));"
          >
            <div class="flex justify-between text-xs">
              <span class="text-[var(--color-text-secondary)]">Subtotal</span>
              <span class="text-[var(--color-text-primary)]">
                {{ wizardService.totals().subtotal | currency }}
              </span>
            </div>
            @if (wizardService.totals().discount > 0) {
              <div class="flex justify-between text-xs">
                <span class="text-[var(--color-text-secondary)]">Descuento</span>
                <span class="text-[var(--color-success)]">
                  -{{ wizardService.totals().discount | currency }}
                </span>
              </div>
            }
            @if (wizardService.totals().tax > 0) {
              <div class="flex justify-between text-xs">
                <span class="text-[var(--color-text-secondary)]">Impuestos</span>
                <span class="text-[var(--color-text-primary)]">
                  {{ wizardService.totals().tax | currency }}
                </span>
              </div>
            }
            <div class="flex justify-between text-sm font-bold pt-1 border-t border-[var(--color-primary)]/15">
              <span class="text-[var(--color-text-primary)]">Total</span>
              <span class="text-[var(--color-primary)]">
                {{ wizardService.totals().grandTotal | currency }}
              </span>
            </div>
          </div>
        </div>
      } @else if (!loading() && searchResults().length === 0) {
        <!-- Empty state -->
        <div class="flex items-center justify-center gap-2 py-4 text-[var(--color-text-muted)]">
          <app-icon name="package" [size]="18"></app-icon>
          <p class="text-sm">
            Busca y selecciona los productos a despachar
          </p>
        </div>
      }
    </div>
  `,
})
export class ProductsStepComponent implements OnDestroy {
  readonly wizardService = inject(DispatchNoteWizardService);

  private readonly productService = inject(PosProductService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroy$ = new Subject<void>();

  readonly searchResults = signal<Product[]>([]);
  readonly loading = signal(false);

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearch(query: string): void {
    if (!query || !query.trim()) {
      this.searchResults.set([]);
      return;
    }

    this.loading.set(true);
    this.productService
      .searchProducts({ search: query.trim(), include_stock: true }, 1, 10)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result) => {
          this.searchResults.set(result.products || []);
          this.loading.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.loading.set(false);
        },
      });
  }

  addProduct(product: Product): void {
    const price = Number(product.final_price || product.price) || 0;

    // Calculate tax from product tax assignments
    let taxRate = 0;
    if (product.tax_assignments?.length) {
      for (const assignment of product.tax_assignments) {
        const rates = assignment.tax_categories?.tax_rates || [];
        for (const rate of rates) {
          taxRate += Number(rate.rate) || 0;
        }
      }
    }

    const taxAmount = price * (taxRate / 100);

    const item: WizardItem = {
      product_id: Number(product.id),
      product_name: product.name,
      product_sku: product.sku,
      product_image_url: product.image_url || product.image,
      ordered_quantity: 1,
      dispatched_quantity: 1,
      unit_price: price,
      discount_amount: 0,
      tax_amount: taxAmount,
      stock_available: product.stock,
    };

    this.wizardService.addItem(item);
    this.searchResults.set([]);
  }

  removeItem(item: WizardItem): void {
    this.wizardService.removeItem(item.product_id, item.product_variant_id);
  }

  onQuantityChange(item: WizardItem, newQuantity: number): void {
    this.wizardService.updateItem(item.product_id, item.product_variant_id, {
      ordered_quantity: newQuantity,
      dispatched_quantity: newQuantity,
    });
  }

  trackByItem(item: WizardItem): string {
    return `${item.product_id}-${item.product_variant_id ?? 'none'}`;
  }
}
