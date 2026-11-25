import { NgTemplateOutlet } from '@angular/common';
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
} from './app-page-products.util';
import { safeUrl } from './app-page-view.util';

/**
 * Renderizador compartido del bloque `products` para Product Page y Service Page.
 *
 * Se usa tanto en la página pública (cargando productos reales desde
 * `CatalogService` con `include_variants`) como en la vista previa del editor
 * (recibiendo `previewItems` ya resueltos desde el servidor, sin peticiones).
 *
 * - Soporta diseños `grid` (por defecto), `list` y `carousel` con una sola
 *   plantilla de tarjeta (`#productCardTpl`).
 * - En modo `manual`, respeta exactamente el orden de `productIds` (máx. 50).
 * - En modo `auto`:
 *   - En `service_page`: usa `autoProductIds` (los productos secundarios de General).
 *   - En `product_page`: no repite la sección `complements`; muestra hasta 8
 *     productos recientes del catálogo (`allowCatalogFallback = true`, y
 *     `auto_products` en vista previa).
 * - Con `showVariants = true`, cada tarjeta con variantes ofrece selector
 *   (nombre y precio) y anuncia el cambio de precio con `aria-live="polite"`.
 *   Sin HTML libre.
 */
@Component({
  selector: 'app-page-products-view',
  standalone: true,
  imports: [NgTemplateOutlet, RouterModule, IconComponent, CurrencyPipe],
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
                <ng-container *ngTemplateOutlet="productCardTpl; context: { item: item, layout: 'carousel' }" />
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
              <ng-container *ngTemplateOutlet="productCardTpl; context: { item: item, layout: 'list' }" />
            }
          </div>
        } @else {
          <div
            class="ap-grid grid gap-4"
            [class]="compact() ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'"
            data-testid="products-layout-grid"
          >
            @for (item of displayedProducts(); track item.id) {
              <ng-container *ngTemplateOutlet="productCardTpl; context: { item: item, layout: 'grid' }" />
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

    <!-- Plantilla única de tarjeta de producto compartida por cuadrícula, lista y carrusel -->
    <ng-template #productCardTpl let-item="item" let-layout="layout">
      <article
        class="ap-card flex overflow-hidden rounded-2xl border border-border bg-surface text-left"
        [class]="layout === 'carousel'
          ? 'w-60 shrink-0 snap-start flex-col sm:w-64'
          : layout === 'list'
            ? 'flex-row'
            : 'flex-col'"
        [attr.data-product-id]="item.id"
        data-testid="product-block-card"
      >
        <div
          class="overflow-hidden bg-surface-secondary"
          [class]="layout === 'list' ? 'h-28 w-28 shrink-0 sm:h-36 sm:w-36' : 'aspect-square'"
        >
          @if (imageOf(item); as src) {
            <img [src]="src" [alt]="item.name" loading="lazy" class="ap-img h-full w-full object-cover" />
          } @else {
            <span class="flex h-full w-full items-center justify-center text-text-secondary">
              <app-icon name="package" [size]="28" />
            </span>
          }
        </div>

        <div
          class="flex min-w-0 flex-1 flex-col gap-2"
          [class]="layout === 'list' ? 'p-4' : 'p-3.5'"
        >
          <div
            [class]="layout === 'list'
              ? 'flex flex-wrap items-start justify-between gap-2'
              : 'flex flex-col gap-2'"
          >
            @if (preview()) {
              <h3
                class="ap-heading font-semibold text-text-primary"
                [class]="layout === 'list' ? 'text-base' : 'line-clamp-2 text-sm'"
              >
                {{ item.name }}
              </h3>
            } @else {
              <a
                [routerLink]="['/products', item.slug]"
                [queryParams]="variantQueryParams(item.id)"
                class="min-w-0 hover:underline"
              >
                <h3
                  class="ap-heading font-semibold text-text-primary"
                  [class]="layout === 'list' ? 'text-base' : 'line-clamp-2 text-sm'"
                >
                  {{ item.name }}
                </h3>
              </a>
            }

            @let priceInfo = priceOf(item);
            <div
              class="flex items-baseline gap-2"
              [class]="layout === 'list' ? 'shrink-0' : 'flex-wrap'"
              aria-live="polite"
              aria-atomic="true"
              data-testid="product-card-price-row"
            >
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
                  class="rounded-lg border py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:line-through"
                  [class]="(layout === 'list' ? 'px-2.5 ' : 'px-2 ') + (active
                    ? 'ap-accent-bg border-transparent'
                    : 'border-border bg-surface text-text-primary hover:bg-surface-secondary')"
                  [attr.aria-pressed]="active"
                  [attr.aria-disabled]="variant.is_available === false"
                  [disabled]="variant.is_available === false"
                  [attr.title]="variant.is_available === false ? 'Variante agotada' : null"
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
    </ng-template>
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
    // En automático los `product_ids` guardados no cuentan: si el usuario cambia
    // de manual a automático quedan en el documento y la página pública los
    // usaría sin querer (la vista previa, en cambio, carga los recientes). El
    // bloque automático se resuelve solo con lo que manda el servidor.
    const raw = this.selection() === 'manual' ? this.productIds() : this.autoProductIds();
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

  /** Lee directamente el precio resuelto por el servidor para el producto o la variante elegida. */
  priceOf(item: AppPageProductItem): ResolvedCardPrice {
    const selectedId = this.selectedVariants()[item.id];
    const variant =
      selectedId !== undefined
        ? (item.variants.find((v) => v.id === selectedId) ?? null)
        : null;
    const target = variant ?? item;
    const price = Number.isFinite(Number(target.final_price)) ? Number(target.final_price) : 0;
    const regular = Number(target.regular_final_price);
    const compareAt = Number.isFinite(regular) && regular > price ? regular : null;
    return {
      price,
      compareAt,
      onSale: compareAt !== null || Boolean(target.is_on_sale),
    };
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
