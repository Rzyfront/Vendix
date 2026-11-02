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
import { AuthModalComponent } from '../../private/layouts/store-ecommerce/components/auth-modal/auth-modal.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

/**
 * Shell of the purchase pages of the landing domain (Apps · Fase 6): the
 * product of the offer, cart and checkout are the ecommerce pages unchanged,
 * inside the store brand with a way back to the landing (`/`).
 */
@Component({
  selector: 'app-landing-shop-layout',
  standalone: true,
  imports: [RouterModule, AuthModalComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen flex-col bg-background">
      <header class="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4">
          <a routerLink="/" class="flex min-w-0 items-center gap-3">
            @if (storeLogo()) {
              <img [src]="storeLogo()" [alt]="storeName()" class="h-9 w-auto max-w-[8rem] object-contain" />
            }
            <span class="truncate text-base font-semibold text-text-primary">{{ storeName() }}</span>
          </a>
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
        </div>
      </header>

      <main class="flex-1">
        <router-outlet />
      </main>

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
export class LandingShopLayoutComponent {
  private readonly tenant = inject(TenantFacade);
  private readonly cartService = inject(CartService);
  private readonly storeUi = inject(StoreUiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly storeName = signal('Tienda');
  readonly storeLogo = signal<string | null>(null);
  readonly authModalOpen = signal(false);
  readonly authModalMode = signal<'login' | 'register' | 'forgot'>('login');

  readonly cartCount = computed(() => this.cartService.cart()?.item_count ?? 0);

  constructor() {
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

    // Brand: same name and logo fallback chain as the product page layout.
    this.tenant.domainConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((domainConfig: any) => {
        if (!domainConfig) return;
        const customConfig = domainConfig.customConfig || {};
        const tenantConfig = (this.tenant.getCurrentTenantConfig() || {}) as any;
        const store = this.tenant.getCurrentStore();
        this.storeName.set(store?.name || domainConfig.store_slug || 'Tienda');
        this.storeLogo.set(
          domainConfig.store_logo_url ||
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
