import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PosProductService, Product } from '../../../pos/services/pos-product.service';
import {
  DispatchNoteWizardService,
  WizardItem,
} from '../../services/dispatch-note-wizard.service';

/**
 * Item-picker step (step 2 for non-customer_delivery subtypes — ref R4a).
 *
 * Free product search + add. Unlike the order-first flow, items here have no
 * `order_item_id` — the operator picks products and sets quantities/prices
 * manually. Uses `PosProductService.searchProducts` (same pattern as the
 * deprecated `products-step.component.ts`).
 *
 * Zoneless puro: signal/computed, sin NgZone/markForCheck.
 */
@Component({
  selector: 'app-dispatch-wizard-item-picker-step',
  standalone: true,
  imports: [
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    CurrencyPipe,
    FormsModule,
  ],
  template: `
    <div class="space-y-2">
      <!-- Product Search -->
      <app-inputsearch
        placeholder="Buscar por nombre, SKU o código de barras..."
        [debounceTime]="300"
        (search)="onSearch($event)"
      ></app-inputsearch>

      <!-- Search Results -->
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
                     min-h-[44px]"
              (click)="addProduct(product)"
            >
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
                  <app-icon name="package" [size]="14" color="var(--color-text-muted)"></app-icon>
                }
              </div>
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
              <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0">
                {{ product.final_price || product.price | currency }}
              </span>
              <app-icon name="plus" [size]="14" color="var(--color-primary)" class="shrink-0"></app-icon>
            </button>
          }
        </div>
      }

      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center gap-2 py-2">
          <div
            class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
          ></div>
          <span class="text-sm text-[var(--color-text-secondary)]">Buscando...</span>
        </div>
      }

      <!-- Selected Items -->
      @if (items().length > 0) {
        <div>
          <p class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
            Productos seleccionados ({{ items().length }})
          </p>

          <div class="space-y-1.5 max-h-60 overflow-y-auto">
            @for (item of items(); track trackByItem(item, $index); let i = $index) {
              <div
                class="border border-[var(--color-border)] rounded-lg p-2 bg-[var(--color-surface)]"
              >
                <div class="flex items-center gap-2">
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
                      <app-icon name="package" [size]="14" color="var(--color-text-muted)"></app-icon>
                    }
                  </div>

                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                      {{ item.product_name }}
                    </p>
                    @if (item.product_sku) {
                      <p class="text-[10px] text-[var(--color-text-muted)] truncate">
                        {{ item.product_sku }}
                      </p>
                    }
                  </div>

                  <!-- Quantity -->
                  <app-input
                    type="number"
                    size="sm"
                    [min]="1"
                    [ngModel]="item.dispatched_quantity"
                    (ngModelChange)="onQtyChange(i, $event)"
                    customClasses="w-16"
                  ></app-input>

                  <!-- Line total -->
                  <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0 min-w-[60px] text-right">
                    {{ item.unit_price * item.dispatched_quantity | currency }}
                  </span>

                  <!-- Remove -->
                  <button
                    type="button"
                    class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors shrink-0"
                    (click)="removeItem(i)"
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
        <app-empty-state
          icon="package"
          title="Sin productos"
          description="Busca y selecciona los productos a despachar."
        ></app-empty-state>
      }
    </div>
  `,
})
export class ItemPickerStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly productService = inject(PosProductService);
  private readonly destroyRef = inject(DestroyRef);

  readonly searchResults = signal<Product[]>([]);
  readonly loading = signal(false);

  readonly items = computed(() => this.wizardService.items());

  onSearch(query: string): void {
    if (!query || !query.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.loading.set(true);
    this.productService
      .searchProducts({ search: query.trim(), include_stock: true }, 1, 10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: any) => {
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

    // Avoid duplicate adds (same product_id + variant_id).
    const variantId = product.product_variants?.[0]?.id;
    const exists = this.wizardService.items().some(
      (i) => i.product_id === Number(product.id) && i.product_variant_id === variantId,
    );
    if (exists) return;

    // Calculate tax from product tax assignments.
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
      product_variant_id: variantId,
      requires_serial_numbers: !!product.requires_serial_numbers,
      ordered_quantity: 1,
      pending_quantity: 9999,
      dispatched_quantity: 1,
      unit_price: price,
      discount_amount: 0,
      tax_amount: taxAmount,
    };

    this.wizardService.addItem(item);
    this.searchResults.set([]);
  }

  onQtyChange(index: number, value: number | string | null): void {
    const n = typeof value === 'string' ? parseInt(value, 10) : (value ?? 0);
    this.wizardService.updateFreeItemQuantity(index, isNaN(n) ? 0 : n);
  }

  removeItem(index: number): void {
    this.wizardService.removeItem(index);
  }

  trackByItem(item: WizardItem, index: number): string {
    return `${item.product_id}-${item.product_variant_id ?? 'none'}-${index}`;
  }
}