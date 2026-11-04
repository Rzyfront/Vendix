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
import { ProductComplementsComponent } from './components/product-complements.component';
import { ProductPageViewComponent, complementsTitleOf } from './product-page-view.component';
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
    ProductComplementsComponent,
    ProductPageViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-product-page-view
      [page]="page()"
      [storeName]="storeName()"
      [storeLogo]="storeLogo()"
      [homeLink]="homeLink()"
      [cartCount]="cartCount()"
      [featuredRoute]="isFeaturedRoute()"
    >
      <router-outlet />
      @if (showComplements()) {
        <app-product-complements [productIds]="complementIds()" [title]="complementsTitle()" />
      }
    </app-product-page-view>

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

  private readonly complementsBlock = computed(() =>
    this.page()?.blocks.find((b) => b.type === 'complements'),
  );

  readonly complementsTitle = computed(() => complementsTitleOf(this.page()));

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
