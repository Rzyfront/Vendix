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
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TenantFacade } from '../../core/store';
import { CartService } from '../../private/modules/ecommerce/services/cart.service';
import { StoreUiService } from '../../private/modules/ecommerce/services/store-ui.service';
import { StoreSeoService } from '../../private/modules/ecommerce/services/store-seo';
import { AuthModalComponent } from '../../private/layouts/store-ecommerce/components/auth-modal/auth-modal.component';
import { ServicePageViewComponent } from './service-page-view.component';
import { ServicePageService } from './service-page.service';

/**
 * Shell of the service page domain (Apps · STORE_SERVICE_PAGE). Same slim
 * frame as the product page: the store's brand, a link back to the services,
 * the shared cart and the login modal the booking and the checkout open when
 * the customer must sign in. The pages inside are the service list and the
 * ecommerce detail, booking, cart and checkout, unchanged.
 */
@Component({
  selector: 'app-service-page-layout',
  standalone: true,
  imports: [RouterModule, AuthModalComponent, ServicePageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-service-page-view
      [page]="page()"
      [storeName]="storeName()"
      [storeLogo]="storeLogo()"
      [cartCount]="cartCount()"
    >
      <router-outlet />
    </app-service-page-view>

    <app-auth-modal
      [isOpen]="authModalOpen()"
      [initialMode]="authModalMode()"
      [storeLogo]="storeLogo()"
      [storeName]="storeName()"
      (closed)="authModalOpen.set(false)"
    />
  `,
})
export class ServicePageLayoutComponent {
  private readonly tenant = inject(TenantFacade);
  private readonly cartService = inject(CartService);
  private readonly storeUi = inject(StoreUiService);
  private readonly storeSeo = inject(StoreSeoService);
  private readonly servicePage = inject(ServicePageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly storeName = signal('Tienda');
  readonly storeLogo = signal<string | null>(null);
  readonly authModalOpen = signal(false);
  readonly authModalMode = signal<'login' | 'register' | 'forgot'>('login');

  /** The owner's own page; `null` keeps the layout exactly as it was. */
  readonly page = computed(() => this.servicePage.config()?.page ?? null);

  readonly cartCount = computed(() => this.cartService.cart()?.item_count ?? 0);

  constructor() {
    this.servicePage.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

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

    // Booking and checkout ask for login when the customer must sign in.
    this.storeUi.openAuthModal$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.authModalMode.set(mode);
      this.authModalOpen.set(true);
    });
  }
}
