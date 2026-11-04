import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { TenantFacade } from '../../core/store';
import { CartService } from '../../private/modules/ecommerce/services/cart.service';
import { StoreUiService } from '../../private/modules/ecommerce/services/store-ui.service';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { AuthModalComponent } from '../../private/layouts/store-ecommerce/components/auth-modal/auth-modal.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import {
  effectiveMode,
  modeSells,
} from '../../private/modules/store/apps/templates/app-page.types';
import { AppPageViewComponent } from '../app-page/app-page-view.component';
import { ProductComplementsComponent } from './components/product-complements.component';
import { ProductPageService } from './product-page.service';

/**
 * Shell of the product page domain (Apps · STORE_PRODUCT_PAGE). Unlike the
 * ecommerce layout it has no catalog navigation: only the store's brand, the
 * shared cart and the "Complementa tu compra" block under the featured
 * product. The pages inside (detail, cart, checkout) are the ecommerce ones,
 * unchanged.
 */
@Component({
  selector: 'app-product-page-layout',
  standalone: true,
  imports: [
    RouterModule,
    AuthModalComponent,
    IconComponent,
    ProductComplementsComponent,
    AppPageViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

      @if (page() && isFeaturedRoute()) {
        <app-app-page-view kind="product_page" [page]="page()" part="hero" />
      }

      <main class="flex-1" [attr.id]="page() ? 'app-page-main' : null">
        <router-outlet />
        @if (showComplements()) {
          <app-product-complements [productIds]="complementIds()" [title]="complementsTitle()" />
        }
      </main>

      @if (page() && isFeaturedRoute()) {
        <app-app-page-view kind="product_page" [page]="page()" part="blocks" />
      }

      <footer class="border-t border-border py-6 text-center text-xs text-text-secondary">
        {{ storeName() }} · Hecho con Vendix
      </footer>
    </div>

    <app-auth-modal
      [isOpen]="authModalOpen()"
      [initialMode]="authModalMode()"
      [storeLogo]="storeLogo()"
      [storeName]="storeName()"
      (closed)="authModalOpen.set(false)"
    />
  `,
})
export class ProductPageLayoutComponent {
  private readonly tenant = inject(TenantFacade);
  private readonly cartService = inject(CartService);
  private readonly storeUi = inject(StoreUiService);
  private readonly storeSeo = inject(StoreSeoService);
  private readonly productPage = inject(ProductPageService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly storeName = signal('Tienda');
  readonly storeLogo = signal<string | null>(null);
  readonly authModalOpen = signal(false);
  readonly authModalMode = signal<'login' | 'register' | 'forgot'>('login');

  readonly cartCount = computed(() => this.cartService.cart()?.item_count ?? 0);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  readonly homeLink = computed(() => {
    const slug = this.productPage.config()?.product.slug;
    return slug ? ['/products', slug] : ['/'];
  });

  /** The owner's own page; `null` keeps the layout exactly as it was. */
  readonly page = computed(() => this.productPage.config()?.page ?? null);

  readonly headerLogo = computed(() => this.page()?.brand?.logo_url || this.storeLogo());

  /** Non-selling modes (or `show_cart: false`) hide the header cart link. */
  readonly showCartLink = computed(() => {
    const page = this.page();
    if (!page) return true;
    return modeSells(effectiveMode('product_page', page)) && page.sales?.show_cart !== false;
  });

  private readonly complementsBlock = computed(() =>
    this.page()?.blocks.find((b) => b.type === 'complements'),
  );

  readonly complementsTitle = computed(() => {
    const title = this.complementsBlock()?.props['title'];
    return typeof title === 'string' && title.trim() ? title.trim() : 'Complementa tu compra';
  });

  readonly complementIds = computed(
    () => this.productPage.config()?.complement_product_ids ?? [],
  );

  /** The featured product's own route (not cart, checkout or order pages). */
  readonly isFeaturedRoute = computed(() => {
    const slug = this.productPage.config()?.product.slug;
    if (!slug) return false;
    const path = this.url().split(/[?#]/)[0];
    return ['/products/', '/producto/', '/catalog/'].some((p) => path === p + slug);
  });

  /** Complements only under the featured product, not in cart or checkout. */
  readonly showComplements = computed(
    () =>
      this.complementIds().length > 0 &&
      this.isFeaturedRoute() &&
      this.complementsBlock()?.enabled !== false,
  );

  constructor() {
    this.productPage.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

    // Same guest-cart expiry the ecommerce layout applies (QUI-795).
    if (this.isBrowser) {
      this.cartService.purgeExpiredLocalCart();
      const onVisibility = () => {
        if (document.visibilityState === 'visible') this.cartService.purgeExpiredLocalCart();
      };
      document.addEventListener('visibilitychange', onVisibility);
      this.destroyRef.onDestroy(() =>
        document.removeEventListener('visibilitychange', onVisibility),
      );
    }

    // Brand: same name and logo fallback chain as the ecommerce layout.
    this.tenant.domainConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((domainConfig: any) => {
        if (!domainConfig) return;
        const customConfig = domainConfig.customConfig || {};
        const tenantConfig = (this.tenant.getCurrentTenantConfig() || {}) as any;
        const store = this.tenant.getCurrentStore();

        const name = store?.name || domainConfig.store_slug || 'Tienda';
        this.storeName.set(name);
        if (name !== 'Tienda') this.storeSeo.setStore(name, tenantConfig?.seo?.description);

        this.storeLogo.set(
          domainConfig.store_logo_url ||
            customConfig.ecommerce?.inicio?.logo_url ||
            customConfig.branding?.logo_url ||
            customConfig.branding?.logo?.url ||
            tenantConfig.branding?.logo_url ||
            tenantConfig.branding?.logo?.url ||
            'vlogomono.png',
        );
      });

    // Cart → checkout asks for login when the store requires registration.
    this.storeUi.openAuthModal$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.authModalMode.set(mode);
      this.authModalOpen.set(true);
    });
  }
}
