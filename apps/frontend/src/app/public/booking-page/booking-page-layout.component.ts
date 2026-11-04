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
import { BookingPageViewComponent } from './booking-page-view.component';
import { BookingPageService } from './booking-page.service';

/**
 * Shell of the hotel booking domain (Apps · STORE_BOOKING). Same slim frame
 * as the product and service pages: the hotel's brand, a link back to the
 * booking, the shared cart (amenities) and the login modal the booking engine
 * and the checkout open when the guest must sign in. The pages inside are the
 * PMS booking engine screens of the ecommerce and its cart and checkout,
 * unchanged.
 */
@Component({
  selector: 'app-booking-page-layout',
  standalone: true,
  imports: [RouterModule, AuthModalComponent, BookingPageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-booking-page-view
      [page]="page()"
      [storeName]="storeName()"
      [storeLogo]="storeLogo()"
      [cartCount]="cartCount()"
    >
      <router-outlet />
    </app-booking-page-view>

    <app-auth-modal
      [isOpen]="authModalOpen()"
      [initialMode]="authModalMode()"
      [storeLogo]="storeLogo()"
      [storeName]="storeName()"
      (closed)="authModalOpen.set(false)"
    />
  `,
})
export class BookingPageLayoutComponent {
  private readonly tenant = inject(TenantFacade);
  private readonly cartService = inject(CartService);
  private readonly storeUi = inject(StoreUiService);
  private readonly storeSeo = inject(StoreSeoService);
  private readonly bookingPage = inject(BookingPageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly storeName = signal('Hotel');
  readonly storeLogo = signal<string | null>(null);
  readonly authModalOpen = signal(false);
  readonly authModalMode = signal<'login' | 'register' | 'forgot'>('login');

  /** The owner's own page; `null` keeps the layout exactly as it was. */
  readonly page = computed(() => this.bookingPage.config()?.page ?? null);

  readonly cartCount = computed(() => this.cartService.cart()?.item_count ?? 0);

  constructor() {
    this.bookingPage.load().pipe(takeUntilDestroyed(this.destroyRef)).subscribe();

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

        const name = store?.name || domainConfig.store_slug || 'Hotel';
        this.storeName.set(name);
        if (name !== 'Hotel') this.storeSeo.setStore(name, tenantConfig?.seo?.description);

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

    // The booking engine and the checkout ask for login when the guest must sign in.
    this.storeUi.openAuthModal$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((mode) => {
      this.authModalMode.set(mode);
      this.authModalOpen.set(true);
    });
  }
}
