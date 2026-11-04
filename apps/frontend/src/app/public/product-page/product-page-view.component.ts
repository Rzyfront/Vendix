import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import {
  AppPageDocument,
  effectiveMode,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from '../app-page/app-page-view.component';

/** Heading of the complements section when the owner left it empty. */
export const DEFAULT_COMPLEMENTS_TITLE = 'Complementa tu compra';

/** Title of the «Complementos» block of the page (or the default one). */
export function complementsTitleOf(page: AppPageDocument | null | undefined): string {
  const title = page?.blocks.find((b) => b.type === 'complements')?.props['title'];
  return typeof title === 'string' && title.trim() ? title.trim() : DEFAULT_COMPLEMENTS_TITLE;
}

/**
 * The product page as it is drawn (F6-B): the store's brand and cart link,
 * the owner's hero, the main content (the featured product and its
 * complements, projected), the owner's blocks and the footer. The public
 * layout (`ProductPageLayoutComponent`) feeds it the router outlet of the
 * product detail; the editor's preview feeds it the draft and a summary of
 * the same product, so both paint the same page.
 *
 * `blockIds` (off on the public page: no extra attributes) marks the hero and
 * each section with `data-block-id` for the editor's preview.
 */
@Component({
  selector: 'app-product-page-view',
  standalone: true,
  imports: [RouterModule, IconComponent, AppPageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex min-h-screen flex-col bg-background">
      <header class="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <a [routerLink]="homeLink()" class="flex min-w-0 items-center gap-3">
            @if (headerLogo()) {
              <img [src]="headerLogo()" [alt]="storeName()" class="h-9 w-auto max-w-[8rem] object-contain" />
            }
            <span class="truncate text-base font-semibold text-text-primary">{{ storeName() }}</span>
          </a>
          @if (showCartLink()) {
            <a
              routerLink="/cart"
              class="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-text-primary hover:bg-surface-secondary"
              [attr.aria-label]="'Carrito, ' + cartCount() + ' producto(s)'"
            >
              <app-icon name="shopping-cart" [size]="22" />
              @if (cartCount() > 0) {
                <span
                  class="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-white"
                >
                  {{ cartCount() }}
                </span>
              }
            </a>
          }
        </div>
      </header>

      @if (page() && featuredRoute()) {
        <app-app-page-view kind="product_page" [page]="page()" part="hero" [blockIds]="blockIds()" />
      }

      <main class="flex-1" [attr.id]="page() ? 'app-page-main' : null">
        <ng-content />
      </main>

      @if (page() && featuredRoute()) {
        <app-app-page-view kind="product_page" [page]="page()" part="blocks" [blockIds]="blockIds()" />
      }

      <footer class="border-t border-border py-6 text-center text-xs text-text-secondary">
        {{ storeName() }} · Hecho con Vendix
      </footer>
    </div>
  `,
})
export class ProductPageViewComponent {
  /** The owner's own page; `null` keeps the layout exactly as it was. */
  readonly page = input<AppPageDocument | null>(null);
  readonly storeName = input('Tienda');
  /** The store's logo; the page's own logo (`page.brand.logo_url`) wins. */
  readonly storeLogo = input<string | null>(null);
  readonly homeLink = input<string | unknown[]>('/');
  readonly cartCount = input(0);
  /** Whether the featured product's own route is shown (not cart, checkout or orders). */
  readonly featuredRoute = input(true);
  readonly blockIds = input(false);

  readonly headerLogo = computed(() => this.page()?.brand?.logo_url || this.storeLogo());

  /** Non-selling modes (or `show_cart: false`) hide the header cart link. */
  readonly showCartLink = computed(() => {
    const page = this.page();
    if (!page) return true;
    return modeSells(effectiveMode('product_page', page)) && page.sales?.show_cart !== false;
  });
}
