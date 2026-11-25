import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';

import { CatalogService } from '../../private/modules/ecommerce/services/catalog.service';
import {
  AppProductsLayout,
  AppProductsSelection,
  MAX_BLOCK_PRODUCT_IDS,
} from '../../private/modules/store/apps/templates/app-page.types';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { CurrencyFormatService, CurrencyPipe } from '../../shared/pipes/currency';
import {
  AppPageProductItem,
  ResolvedCardPrice,
  mapEcommerceProductToItem,
  orderProductsByIds,
  resolveProductCardPrice,
} from './app-page-products.util';
import { safeUrl } from './app-page-view.util';

/**
 * Renderizador compartido del bloque `products` para Product Page y Service Page.
 *
 * Se usa tanto en la página pública (cargando productos reales desde
 * `CatalogService` con `include_variants`) como en la vista previa del editor
 * (recibiendo `previewItems` ya resueltos desde el builder, sin peticiones).
 *
 * - Soporta diseños `grid` (por defecto), `list` y `carousel`.
 * - En modo `manual`, respeta exactamente el orden de `productIds` (máx. 50).
 * - Con `showVariants = true`, cada tarjeta con variantes ofrece selector
 *   (nombre y precio) que actualiza el precio mostrado usando la misma
 *   resolución que la página pública. Sin HTML libre.
 */
@Component({
  selector: 'app-page-products-view',
  standalone: true,
  imports: [RouterModule, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (displayedProducts().length > 0) {
      <div
        class="ap-products"
        [attr.data-currency]="currencyCode()"
        [attr.data-products-layout]="effectiveLayout()"
        [attr.data-testid]="preview() ? 'preview-products' : 'app-page-products'"
      >
        @if (title()) {
          <h2 class="ap-heading mb-4 font-bold text-text-primary" [class]="compact() ? 'text-base md:text-lg' : 'text-xl md:text-2xl'">
            {{ title() }}
          </h2>
        }

        @if (effectiveLayout() === 'carousel') {
          <div class="relative" data-testid="products-layout-carousel">
            <div
              #carouselTrack
              class="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 scroll-smooth"
              data-testid="products-carousel-track"
            >
              @for (item of displayedProducts(); track item.id) {
                <article
                  class="ap-card flex w-60 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-surface sm:w-64"
                  [attr.data-product-id]="item.id"
                  data-testid="product-block-card"
                >
                  <div class="aspect-square overflow-hidden bg-surface-secondary">
                    @if (imageOf(item); as src) {
                      <img [src]="src" [alt]="item.name" loading="lazy" class="ap-img h-full w-full object-cover" />
                    } @else {
                      <span class="flex h-full w-full items-center justify-center text-text-secondary">
                        <app-icon name="package" [size]="28" />
                      </span>
                    }
                  </div>
                  <div class="flex flex-1 flex-col gap-2 p-3.5 text-left">
                    @if (preview()) {
                      <h3 class="ap-heading line-clamp-2 text-sm font-semibold text-text-primary">{{ item.name }}</h3>
                    } @else {
                      <a
                        [routerLink]="['/products', item.slug]"
                        [queryParams]="variantQueryParams(item.id)"
                        class="hover:underline"
                      >
                        <h3 class="ap-heading line-clamp-2 text-sm font-semibold text-text-primary">{{ item.name }}</h3>
                      </a>
                    }

                    @let priceInfo = priceOf(item);
                    <div class="flex flex-wrap items-baseline gap-2" data-testid="product-card-price-row">
                      <span
                        class="text-base font-bold text-text-primary"
                        [class.text-emerald-600]="priceInfo.onSale"
                        data-testid="product-card-price"
                      >
                        {{ priceInfo.price | currency }}
                      </span>
                      @if (priceInfo.compareAt !== null) {
                        <span class="text-xs text-text-secondary line-through" data-testid="product-card-compare-at">
                          {{ priceInfo.compareAt | currency }}
                        </span>
                      }
                    </div>

                    @if (showVariants() && item.variants.length > 0) {
                      <div
                        class="mt-auto flex flex-wrap gap-1.5 pt-1"
                        role="group"
                        [attr.aria-label]="'Variantes de ' + item.name"
                        data-testid="product-variant-selector"
                      >
                        @for (variant of item.variants; track variant.id) {
                          @let active = isVariantSelected(item.id, variant.id);
                          <button
                            type="button"
                            class="rounded-lg border px-2 py-1 text-xs font-medium transition-colors"
                            [class]="active
                              ? 'ap-accent-bg border-transparent'
                              : 'border-border bg-surface text-text-primary hover:bg-surface-secondary'"
                            [attr.aria-pressed]="active"
                            [attr.data-variant-id]="variant.id"
                            [attr.data-testid]="'variant-option-' + variant.id"
                            (click)="selectVariant(item.id, variant.id, $event)"
                          >
                            {{ variant.name }} · {{ variant.final_price | currency }}
                          </button>
                        }
                      </div>
                    }
                  </div>
                </article>
              }
            </div>

            @if (displayedProducts().length > 1) {
              <div class="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-secondary"
                  aria-label="Productos anteriores"
                  data-testid="products-carousel-prev"
                  (click)="scrollCarousel(carouselTrack, -1)"
                >
                  <app-icon name="chevron-left" [size]="16" />
                </button>
                <button
                  type="button"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-secondary"
                  aria-label="Siguientes productos"
                  data-testid="products-carousel-next"
                  (click)="scrollCarousel(carouselTrack, 1)"
                >
                  <app-icon name="chevron-right" [size]="16" />
                </button>
              </div>
            }
          </div>
        } @else if (effectiveLayout() === 'list') {
          <div class="flex flex-col gap-3" data-testid="products-layout-list">
            @for (item of displayedProducts(); track item.id) {
              <article
                class="ap-card flex overflow-hidden rounded-2xl border border-border bg-surface text-left"
                [attr.data-product-id]="item.id"
                data-testid="product-block-card"
              >
                <div class="h-28 w-28 shrink-0 overflow-hidden bg-surface-secondary sm:h-36 sm:w-36">
                  @if (imageOf(item); as src) {
                    <img [src]="src" [alt]="item.name" loading="lazy" class="ap-img h-full w-full object-cover" />
                  } @else {
                    <span class="flex h-full w-full items-center justify-center text-text-secondary">
                      <app-icon name="package" [size]="28" />
                    </span>
                  }
                </div>
                <div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    @if (preview()) {
                      <h3 class="ap-heading text-base font-semibold text-text-primary">{{ item.name }}</h3>
                    } @else {
                      <a
                        [routerLink]="['/products', item.slug]"
                        [queryParams]="variantQueryParams(item.id)"
                        class="min-w-0 hover:underline"
                      >
                        <h3 class="ap-heading text-base font-semibold text-text-primary">{{ item.name }}</h3>
                      </a>
                    }

                    @let priceInfo = priceOf(item);
                    <div class="flex shrink-0 items-baseline gap-2" data-testid="product-card-price-row">
                      <span
                        class="text-base font-bold text-text-primary"
                        [class.text-emerald-600]="priceInfo.onSale"
                        data-testid="product-card-price"
                      >
                        {{ priceInfo.price | currency }}
                      </span>
                      @if (priceInfo.compareAt !== null) {
                        <span class="text-xs text-text-secondary line-through" data-testid="product-card-compare-at">
                          {{ priceInfo.compareAt | currency }}
                        </span>
                      }
                    </div>
                  </div>

                  @if (showVariants() && item.variants.length > 0) {
                    <div
                      class="mt-auto flex flex-wrap gap-1.5 pt-1"
                      role="group"
                      [attr.aria-label]="'Variantes de ' + item.name"
                      data-testid="product-variant-selector"
                    >
                      @for (variant of item.variants; track variant.id) {
                        @let active = isVariantSelected(item.id, variant.id);
                        <button
                          type="button"
                          class="rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors"
                          [class]="active
                            ? 'ap-accent-bg border-transparent'
                            : 'border-border bg-surface text-text-primary hover:bg-surface-secondary'"
                          [attr.aria-pressed]="active"
                          [attr.data-variant-id]="variant.id"
                          [attr.data-testid]="'variant-option-' + variant.id"
                          (click)="selectVariant(item.id, variant.id, $event)"
                        >
                          {{ variant.name }} · {{ variant.final_price | currency }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </article>
            }
          </div>
        } @else {
          <div
            class="ap-grid grid gap-4"
            [class]="compact() ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'"
            data-testid="products-layout-grid"
          >
            @for (item of displayedProducts(); track item.id) {
              <article
                class="ap-card flex flex-col overflow-hidden rounded-2xl border border-border bg-surface text-left"
                [attr.data-product-id]="item.id"
                data-testid="product-block-card"
              >
                <div class="aspect-square overflow-hidden bg-surface-secondary">
                  @if (imageOf(item); as src) {
                    <img [src]="src" [alt]="item.name" loading="lazy" class="ap-img h-full w-full object-cover" />
                  } @else {
                    <span class="flex h-full w-full items-center justify-center text-text-secondary">
                      <app-icon name="package" [size]="28" />
                    </span>
                  }
                </div>
                <div class="flex flex-1 flex-col gap-2 p-3.5">
                  @if (preview()) {
                    <h3 class="ap-heading line-clamp-2 text-sm font-semibold text-text-primary">{{ item.name }}</h3>
                  } @else {
                    <a
                      [routerLink]="['/products', item.slug]"
                      [queryParams]="variantQueryParams(item.id)"
                      class="hover:underline"
                    >
                      <h3 class="ap-heading line-clamp-2 text-sm font-semibold text-text-primary">{{ item.name }}</h3>
                    </a>
                  }

                  @let priceInfo = priceOf(item);
                  <div class="flex flex-wrap items-baseline gap-2" data-testid="product-card-price-row">
                    <span
                      class="text-base font-bold text-text-primary"
                      [class.text-emerald-600]="priceInfo.onSale"
                      data-testid="product-card-price"
                    >
                      {{ priceInfo.price | currency }}
                    </span>
                    @if (priceInfo.compareAt !== null) {
                      <span class="text-xs text-text-secondary line-through" data-testid="product-card-compare-at">
                        {{ priceInfo.compareAt | currency }}
                      </span>
                    }
                  </div>

                  @if (showVariants() && item.variants.length > 0) {
                    <div
                      class="mt-auto flex flex-wrap gap-1.5 pt-1"
                      role="group"
                      [attr.aria-label]="'Variantes de ' + item.name"
                      data-testid="product-variant-selector"
                    >
                      @for (variant of item.variants; track variant.id) {
                        @let active = isVariantSelected(item.id, variant.id);
                        <button
                          type="button"
                          class="rounded-lg border px-2 py-1 text-xs font-medium transition-colors"
                          [class]="active
                            ? 'ap-accent-bg border-transparent'
                            : 'border-border bg-surface text-text-primary hover:bg-surface-secondary'"
                          [attr.aria-pressed]="active"
                          [attr.data-variant-id]="variant.id"
                          [attr.data-testid]="'variant-option-' + variant.id"
                          (click)="selectVariant(item.id, variant.id, $event)"
                        >
                          {{ variant.name }} · {{ variant.final_price | currency }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </article>
            }
          </div>
        }
      </div>
    } @else if (preview()) {
      <div class="rounded-xl border-2 border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary" data-testid="products-empty-preview">
        @if (selection() === 'manual') {
          Elige los productos en el inspector para verlos aquí.
        } @else {
          Aquí se mostrarán los productos reales de tu tienda.
        }
      </div>
    }
  `,
})
export class AppPageProductsViewComponent {
  private readonly injector = inject(Injector);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly title = input<string>('');
  readonly selection = input<AppProductsSelection | null>(null);
  readonly productIds = input<readonly number[]>([]);
  readonly autoProductIds = input<readonly number[]>([]);
  readonly showVariants = input(false);
  readonly layout = input<AppProductsLayout | null>(null);
  readonly preview = input(false);
  readonly previewItems = input<readonly AppPageProductItem[] | null>(null);
  readonly compact = input(false);
  readonly allowCatalogFallback = input(false);

  protected readonly currencyCode = this.currencyService.currencyCode;

  /** Mapa reactivo productId -> variantId elegido en cada tarjeta. */
  readonly selectedVariants = signal<Readonly<Record<number, number>>>({});
  /** Productos cargados desde el catálogo público (solo cuando `previewItems()` es null). */
  private readonly loadedItems = signal<AppPageProductItem[]>([]);

  readonly effectiveLayout = computed<AppProductsLayout>(() => this.layout() ?? 'grid');

  readonly effectiveIds = computed<number[]>(() => {
    const raw =
      this.selection() === 'manual'
        ? this.productIds()
        : this.autoProductIds().length > 0
          ? this.autoProductIds()
          : this.productIds();
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of raw) {
      if (out.length >= MAX_BLOCK_PRODUCT_IDS) break;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  });

  readonly displayedProducts = computed<AppPageProductItem[]>(() => {
    const preloaded = this.previewItems();
    const ids = this.effectiveIds();
    if (preloaded !== null) {
      if (this.selection() === 'manual') {
        return orderProductsByIds(preloaded, this.productIds(), MAX_BLOCK_PRODUCT_IDS);
      }
      if (ids.length > 0) {
        return orderProductsByIds(preloaded, ids, MAX_BLOCK_PRODUCT_IDS);
      }
      return preloaded.slice(0, MAX_BLOCK_PRODUCT_IDS);
    }
    const loaded = this.loadedItems();
    return ids.length > 0 ? orderProductsByIds(loaded, ids, MAX_BLOCK_PRODUCT_IDS) : loaded;
  });

  constructor() {
    this.currencyService.loadCurrency();

    effect((onCleanup) => {
      if (this.previewItems() !== null || this.preview()) {
        return;
      }
      const catalog = this.injector.get(CatalogService, null);
      if (!catalog) {
        return;
      }
      const selection = this.selection();
      const ids = this.effectiveIds();
      const includeVariants = this.showVariants();
      const allowFallback = this.allowCatalogFallback();

      if (selection === 'manual' && ids.length === 0) {
        this.loadedItems.set([]);
        return;
      }
      if (ids.length === 0 && !allowFallback) {
        this.loadedItems.set([]);
        return;
      }

      const query =
        ids.length > 0
          ? { ids: ids.join(','), limit: ids.length, include_variants: includeVariants }
          : { limit: 8, include_variants: includeVariants };

      const sub = catalog.getProducts(query).subscribe({
        next: (res) => {
          const mapped = (res?.data ?? []).map(mapEcommerceProductToItem);
          this.loadedItems.set(
            ids.length > 0 ? orderProductsByIds(mapped, ids, MAX_BLOCK_PRODUCT_IDS) : mapped,
          );
        },
        error: () => this.loadedItems.set([]),
      });
      onCleanup(() => sub.unsubscribe());
    });
  }

  isVariantSelected(productId: number, variantId: number): boolean {
    return this.selectedVariants()[productId] === variantId;
  }

  selectVariant(productId: number, variantId: number, event?: Event): void {
    event?.stopPropagation();
    const current = this.selectedVariants();
    if (current[productId] === variantId) {
      const next = { ...current };
      delete next[productId];
      this.selectedVariants.set(next);
      return;
    }
    this.selectedVariants.set({ ...current, [productId]: variantId });
  }

  priceOf(item: AppPageProductItem): ResolvedCardPrice {
    const selectedId = this.selectedVariants()[item.id] ?? null;
    return resolveProductCardPrice(item, selectedId);
  }

  imageOf(item: AppPageProductItem): string | null {
    const selectedId = this.selectedVariants()[item.id];
    if (selectedId !== undefined) {
      const variant = item.variants.find((v) => v.id === selectedId);
      const variantImg = safeUrl(variant?.image_url ?? undefined);
      if (variantImg) return variantImg;
    }
    return safeUrl(item.image_url ?? undefined);
  }

  variantQueryParams(productId: number): Record<string, number> | null {
    const selectedId = this.selectedVariants()[productId];
    return selectedId !== undefined ? { variant_id: selectedId } : null;
  }

  scrollCarousel(track: HTMLElement, direction: -1 | 1): void {
    const step = Math.max(track.clientWidth * 0.8, 240);
    track.scrollBy?.({ left: direction * step, behavior: 'smooth' });
  }
}
