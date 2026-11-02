import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CatalogService,
  EcommerceProduct,
} from '../../private/modules/ecommerce/services/catalog.service';
import { ProductCardComponent } from '../../private/modules/ecommerce/components/product-card/product-card.component';
import { ProductQuickViewModalComponent } from '../../private/modules/ecommerce/components/product-quick-view-modal';
import type { LandingOffer } from './landing-page.service';

/**
 * Offer block of the landing on its own domain (Apps · Fase 6). `info` only
 * invites to leave the data in the contact form; `product` shows the product
 * with the ecommerce card and a buy button that opens the shared product
 * detail → cart → checkout of this domain.
 */
@Component({
  selector: 'app-landing-offer',
  standalone: true,
  imports: [RouterLink, ProductCardComponent, ProductQuickViewModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="mx-auto w-full max-w-4xl px-4 py-12"
      data-testid="landing-offer"
      aria-labelledby="landing-offer-title"
    >
      <div class="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg sm:p-9">
        <h2 id="landing-offer-title" class="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
          {{ offer().title }}
        </h2>
        @if (offer().description) {
          <p class="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-600 sm:text-base">
            {{ offer().description }}
          </p>
        }

        @if (product(); as p) {
          <div class="mx-auto mt-6 grid max-w-xs gap-4">
            <app-product-card [product]="p" (quick_view)="quickViewSlug.set($event.slug)" />
            <a
              class="crm-submit-btn inline-flex w-full items-center justify-center rounded-full px-6 py-3.5 text-sm font-bold text-white shadow-md"
              data-testid="landing-offer-buy"
              [routerLink]="['/products', p.slug]"
            >
              Comprar ahora
            </a>
          </div>
        } @else if (offer().mode === 'info') {
          <div class="mt-6 flex justify-center">
            <button
              type="button"
              class="crm-submit-btn rounded-full px-6 py-3.5 text-sm font-bold text-white shadow-md"
              data-testid="landing-offer-cta"
              (click)="interested.emit()"
            >
              Me interesa
            </button>
          </div>
        }
      </div>
    </section>
    <app-product-quick-view-modal
      [isOpen]="quickViewSlug() !== null"
      [productSlug]="quickViewSlug()"
      (closed)="quickViewSlug.set(null)"
      (addedToCart)="quickViewSlug.set(null)"
    />
  `,
  styles: [
    `
      .crm-submit-btn {
        background: var(--crm-primary, #2563eb);
      }
    `,
  ],
})
export class LandingOfferComponent {
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly offer = input.required<LandingOffer>();
  /** The visitor wants the informative offer: the page scrolls to the form. */
  readonly interested = output<void>();

  readonly product = signal<EcommerceProduct | null>(null);
  readonly quickViewSlug = signal<string | null>(null);

  private readonly productId = computed(() =>
    this.offer().mode === 'product' ? (this.offer().product?.id ?? null) : null,
  );

  constructor() {
    effect((onCleanup) => {
      const id = this.productId();
      if (id === null) {
        this.product.set(null);
        return;
      }
      const sub = this.catalog
        .getProducts({ ids: String(id), limit: 1 })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          // A product the catalog no longer sells leaves only title and text.
          next: (res) => this.product.set(res.data.find((p) => p.id === id) ?? null),
          error: () => this.product.set(null),
        });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
