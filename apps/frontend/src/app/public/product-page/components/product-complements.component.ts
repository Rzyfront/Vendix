import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CatalogService,
  EcommerceProduct,
} from '../../../private/modules/ecommerce/services/catalog.service';
import { ProductCardComponent } from '../../../private/modules/ecommerce/components/product-card/product-card.component';
import { ProductQuickViewModalComponent } from '../../../private/modules/ecommerce/components/product-quick-view-modal';

/**
 * "Complementa tu compra": the extra products the owner picked for the page.
 * Cards and quick view are the ecommerce components as they are, so adding a
 * complement goes through the same `CartService` as the main product and both
 * land in one shared cart.
 */
@Component({
  selector: 'app-product-complements',
  standalone: true,
  imports: [ProductCardComponent, ProductQuickViewModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (products().length > 0) {
      <section class="mx-auto w-full max-w-6xl px-4 py-8" aria-labelledby="complements-title">
        <h2 id="complements-title" class="mb-4 text-lg font-semibold text-text-primary">
          Complementa tu compra
        </h2>
        <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
          @for (product of products(); track product.id) {
            <app-product-card
              [product]="product"
              (quick_view)="openQuickView($event)"
            />
          }
        </div>
      </section>
    }
    <app-product-quick-view-modal
      [isOpen]="quickViewSlug() !== null"
      [productSlug]="quickViewSlug()"
      (closed)="quickViewSlug.set(null)"
      (addedToCart)="quickViewSlug.set(null)"
    />
  `,
})
export class ProductComplementsComponent {
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly productIds = input<number[]>([]);

  readonly products = signal<EcommerceProduct[]>([]);
  readonly quickViewSlug = signal<string | null>(null);

  constructor() {
    effect(() => {
      const ids = this.productIds();
      if (ids.length === 0) {
        this.products.set([]);
        return;
      }
      this.catalog
        .getProducts({ ids: ids.join(','), limit: ids.length })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          // Keep the owner's order; drop anything the catalog no longer sells.
          next: (res) => {
            const byId = new Map(res.data.map((p) => [p.id, p]));
            this.products.set(
              ids.map((id) => byId.get(id)).filter((p): p is EcommerceProduct => !!p),
            );
          },
          error: () => this.products.set([]),
        });
    });
  }

  openQuickView(product: EcommerceProduct): void {
    this.quickViewSlug.set(product.slug);
  }
}
