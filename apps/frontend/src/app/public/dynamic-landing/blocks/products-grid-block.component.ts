import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { IconComponent } from '../../../shared/components/icon/icon.component';

interface ProductItem {
  name: string;
  slug: string;
  price: number | null;
  image_url: string | null;
}

/**
 * Grilla de productos destacados.
 * Props: title?, subtitle?, items?.
 */
@Component({
  selector: 'app-products-grid-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, CurrencyPipe, IconComponent],
  template: `
    <section class="products-container max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div class="text-center max-w-3xl mx-auto mb-10 sm:mb-14">
        <div class="products-badge inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-semibold mb-3">
          <app-icon name="shopping-bag" [size]="13" [color]="'var(--crm-primary, #2563eb)'" />
          <span>Catálogo Destacado</span>
        </div>
        <h2 class="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
          {{ props()['title'] || 'Lo más destacado de nuestro catálogo' }}
        </h2>
        @if (props()['subtitle']) {
          <p class="text-base sm:text-lg text-slate-600 max-w-2xl mx-auto">
            {{ props()['subtitle'] }}
          </p>
        }
      </div>

      @if (items().length > 0) {
        <div class="products-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          @for (item of items(); track item.slug) {
            <a
              class="product-card group bg-white rounded-2xl border border-slate-200/80 overflow-hidden shadow-xs hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 flex flex-col"
              [href]="productUrl(item.slug)"
              target="_blank"
              rel="noopener"
            >
              <!-- Image Container -->
              <div class="product-image-box relative w-full aspect-square bg-slate-50 overflow-hidden flex items-center justify-center p-3">
                @if (item.image_url) {
                  <img
                    [src]="item.image_url"
                    [alt]="item.name"
                    loading="lazy"
                    class="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                  />
                } @else {
                  <div class="w-full h-full flex flex-col items-center justify-center text-slate-400 bg-slate-100/70 rounded-xl">
                    <app-icon name="shopping-bag" [size]="32" color="#94a3b8" />
                    <span class="text-xs font-medium mt-2">Sin imagen</span>
                  </div>
                }

                <div class="absolute top-3 right-3 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-full text-[11px] font-semibold text-emerald-700 shadow-xs border border-emerald-100 flex items-center gap-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>Disponible</span>
                </div>
              </div>

              <!-- Product Info -->
              <div class="p-5 flex flex-col flex-grow justify-between">
                <div>
                  <h3 class="font-bold text-slate-900 text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-200 mb-2">
                    {{ item.name }}
                  </h3>
                </div>

                <div class="pt-3 border-t border-slate-100 flex items-center justify-between mt-3">
                  <div>
                    <span class="block text-[11px] text-slate-400 font-medium uppercase tracking-wider">Precio</span>
                    @if (item.price != null) {
                      <span class="text-base sm:text-lg font-extrabold text-slate-900">
                        {{ item.price | currency: 'COP' : 'symbol' : '1.0-0' }}
                      </span>
                    } @else {
                      <span class="text-sm font-semibold text-slate-500">Consultar</span>
                    }
                  </div>

                  <span class="product-cta-pill inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full text-white shadow-xs">
                    <span>Comprar</span>
                    <app-icon name="arrow-right" [size]="12" color="white" />
                  </span>
                </div>
              </div>
            </a>
          }
        </div>
      } @else {
        <!-- Mock Skeleton for Preview -->
        <div class="products-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-white rounded-2xl border border-slate-200/70 p-4 animate-pulse">
              <div class="w-full aspect-square bg-slate-100 rounded-xl mb-4"></div>
              <div class="h-4 bg-slate-200 rounded-md w-3/4 mb-2"></div>
              <div class="h-3 bg-slate-100 rounded-md w-1/2 mb-4"></div>
              <div class="h-6 bg-slate-200 rounded-md w-1/3"></div>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .products-badge {
        background: rgba(37, 99, 235, 0.08);
        color: var(--crm-primary, #2563eb);
      }
      .product-card {
        background: #ffffff;
      }
      .product-cta-pill {
        background: var(--crm-primary, #2563eb);
        transition: transform 0.2s ease, filter 0.2s ease;
      }
      .product-card:hover .product-cta-pill {
        transform: translateX(2px);
        filter: brightness(1.1);
      }
    `,
  ],
})
export class ProductsGridBlockComponent {
  readonly props = input.required<Record<string, unknown>>();
  readonly baseUrl = input<string | null>(null);

  readonly items = computed<ProductItem[]>(() => {
    const raw = this.props()['items'];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (i): i is ProductItem =>
        !!i && typeof i === 'object' && typeof i.slug === 'string',
    );
  });

  productUrl(slug: string): string {
    const base = this.baseUrl();
    return base ? `${base}/products/${slug}` : `/products/${slug}`;
  }
}
