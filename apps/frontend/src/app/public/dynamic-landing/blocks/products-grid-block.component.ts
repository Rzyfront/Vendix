import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CrmBlock } from './landing-blocks.types';

/**
 * Grilla de productos destacados. Props: title?, subtitle?.
 * Los productos reales los inyecta el host (render público Fase 4 con datos
 * del ecommerce); en el editor se muestra el esqueleto de la sección.
 */
@Component({
  selector: 'app-products-grid-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="products">
      @if (props()['title']) {
        <h2>{{ props()['title'] }}</h2>
      }
      @if (props()['subtitle']) {
        <p class="products-subtitle">{{ props()['subtitle'] }}</p>
      }
      <div class="products-skeleton">
        @for (i of [1, 2, 3]; track i) {
          <div class="product-card">
            <div class="product-image"></div>
            <div class="product-line"></div>
            <div class="product-line short"></div>
          </div>
        }
      </div>
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
      .products-skeleton {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
        max-width: 860px;
        margin: 0 auto;
      }
      .product-card {
        background: var(--bg-surface, #fff);
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 12px;
      }
      .product-image {
        aspect-ratio: 1;
        border-radius: 8px;
        background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
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
  readonly props = input.required<Record<string, string>>();
}
