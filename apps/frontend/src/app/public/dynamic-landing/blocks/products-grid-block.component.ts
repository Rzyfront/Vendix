import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { CrmBlock } from './landing-blocks.types';

interface ProductItem {
  name: string;
  slug: string;
  price: number | null;
  image_url: string | null;
}

/**
 * Grilla de productos destacados. Props: title?, subtitle?, items?.
 * `items` lo inyecta el backend al leer la landing pública (top ventas o
 * catálogo reciente, solo campos públicos); cada tarjeta enlaza al detalle
 * del producto en el ecommerce de la tienda (deep-link cross-host).
 */
@Component({
  selector: 'app-products-grid-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
  template: `
    <section class="products">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      @if (props()['subtitle']) {
        <p class="products-subtitle">{{ props()['subtitle'] }}</p>
      }

      @if (items().length > 0) {
        <div class="products-grid">
          @for (item of items(); track item.slug) {
            <a
              class="product-card"
              [href]="productUrl(item.slug)"
              rel="noopener"
            >
              @if (item.image_url) {
                <img
                  [src]="item.image_url"
                  [alt]="item.name"
                  loading="lazy"
                  class="product-image"
                />
              } @else {
                <div class="product-image product-image-empty"></div>
              }
              <span class="product-name">{{ item.name }}</span>
              @if (item.price != null) {
                <span class="product-price">
                  {{ item.price | currency: 'COP' : 'symbol' : '1.0-0' }}
                </span>
              }
            </a>
          }
        </div>
      } @else {
        <!-- Sin productos inyectados (preview del editor): esqueleto -->
        <div class="products-grid">
          @for (i of [1, 2, 3]; track i) {
            <div class="product-card">
              <div class="product-image product-image-empty"></div>
              <div class="product-line"></div>
              <div class="product-line short"></div>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    `
      .products {
        padding: 32px 16px;
        background: rgba(0, 0, 0, 0.02);
      }
      h2 {
        text-align: center;
        font-size: 1.4rem;
        margin: 0 0 6px;
      }
      .products-subtitle {
        text-align: center;
        color: #4b5563;
        margin: 0 0 20px;
      }
      .products-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 12px;
        max-width: 860px;
        margin: 0 auto;
      }
      a.product-card {
        text-decoration: none;
        color: inherit;
      }
      .product-card {
        background: var(--bg-surface, #fff);
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      a.product-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
      }
      .product-image {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 8px;
        object-fit: cover;
      }
      .product-image-empty {
        background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
      }
      .product-name {
        font-size: 0.85rem;
        font-weight: 600;
        line-height: 1.3;
      }
      .product-price {
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--crm-primary, #3b82f6);
      }
      .product-line {
        height: 10px;
        border-radius: 5px;
        background: #e5e7eb;
        margin-top: 10px;
      }
      .product-line.short {
        width: 60%;
      }
    `,
  ],
})
export class ProductsGridBlockComponent {
  readonly props = input.required<Record<string, unknown>>();
  /** Base del ecommerce de la tienda para los deep-links (ej. https://shop.tienda.com). */
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
