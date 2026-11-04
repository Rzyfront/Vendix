import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { ProductPagePreview } from './product-page-builder';

/**
 * F6-B — the main content of the product page in the editor's preview: a
 * summary of the featured product (photo, name, description, variants) and
 * the «Complementos» section. On the public page the first one is the
 * store's own product detail (prices, variant selector and buy button) and
 * the second the ecommerce product cards; the preview does not load them (it
 * is a picture and fetches nothing), it paints the same data in their place.
 */
@Component({
  selector: 'app-product-page-preview-body',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview().product; as product) {
      <section class="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 md:grid-cols-2" data-testid="preview-product">
        <div class="aspect-square overflow-hidden rounded-2xl bg-surface-secondary">
          @if (product.image_url) {
            <img [src]="product.image_url" [alt]="product.name" class="h-full w-full object-cover" />
          }
        </div>
        <div>
          <h1 class="text-2xl font-bold text-text-primary">{{ product.name }}</h1>
          @if (product.description) {
            <p class="mt-3 line-clamp-6 whitespace-pre-line text-sm text-text-secondary">{{ product.description }}</p>
          }
          @if (product.variants.length) {
            <ul class="mt-4 flex flex-wrap gap-2" data-testid="preview-variants">
              @for (variant of product.variants; track variant.id) {
                <li class="rounded-lg border border-border px-3 py-1.5 text-sm text-text-primary">{{ variant.name }}</li>
              }
            </ul>
          }
          <p class="mt-4 text-xs text-text-secondary">El precio y el botón de compra son los de tu tienda.</p>
        </div>
      </section>
    } @else {
      <section class="mx-auto w-full max-w-6xl px-4 py-16 text-center text-sm text-text-secondary" data-testid="preview-no-product">
        Elige el producto destacado en General: aquí se ve con su foto, sus variantes y su botón de compra.
      </section>
    }

    @if (preview().showComplements) {
      <section class="mx-auto w-full max-w-6xl px-4 py-8" data-testid="preview-complements"
               [attr.data-block-id]="preview().complementsBlockId">
        <h2 class="mb-4 text-lg font-semibold text-text-primary">{{ preview().complementsTitle }}</h2>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          @for (item of preview().complements; track item.id) {
            <article class="overflow-hidden rounded-xl border border-border bg-surface">
              <div class="aspect-square bg-surface-secondary">
                @if (item.image_url) {
                  <img [src]="item.image_url" [alt]="item.name" class="h-full w-full object-cover" />
                }
              </div>
              <p class="truncate px-3 py-2 text-sm font-medium text-text-primary">{{ item.name }}</p>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class ProductPagePreviewBodyComponent {
  readonly preview = input.required<ProductPagePreview>();
}
