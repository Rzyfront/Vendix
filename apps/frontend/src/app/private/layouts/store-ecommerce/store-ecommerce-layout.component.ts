import {
  Component,
  inject,
  HostListener,
  DestroyRef,
  signal,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { CurrencyPipe } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../core/store';
import { TenantFacade } from '../../../core/store';
import { CartService } from '../../modules/ecommerce/services/cart.service';
import { WishlistService } from '../../modules/ecommerce/services/wishlist.service';
import { StoreUiService } from '../../modules/ecommerce/services/store-ui.service';
import { SearchAutocompleteComponent } from '../../modules/ecommerce/components/search-autocomplete';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { QuantityControlComponent } from '../../../shared/components/quantity-control/quantity-control.component';
import { InfoModalComponent } from './components/info-modal';
import { FaqModalComponent } from './components/faq-modal';
import { ButtonComponent } from '../../../shared/components/button/button.component';

// Footer types (matching backend interfaces)
interface FooterStoreInfo {
  about_us?: string;
  support_email?: string;
  tagline?: string;
}

interface FooterLink {
  label: string;
  url: string;
  is_external?: boolean;
}

interface FooterFaqItem {
  question: string;
  answer: string;
}

interface FooterHelp {
  faq?: FooterFaqItem[];
  shipping_info?: string;
  returns_info?: string;
}

interface FooterSocialAccount {
  username?: string;
  url?: string;
}

interface FooterSocial {
  facebook?: FooterSocialAccount;
  instagram?: FooterSocialAccount;
  tiktok?: FooterSocialAccount;
}

interface FooterSettings {
  store_info?: FooterStoreInfo;
  links?: FooterLink[];
  help?: FooterHelp;
  social?: FooterSocial;
}

@Component({
  selector: 'app-store-ecommerce-layout',
  standalone: true,
  imports: [
    RouterModule,
    SearchAutocompleteComponent,
    IconComponent,
    AuthModalComponent,
    QuantityControlComponent,
    InfoModalComponent,
    FaqModalComponent,
    ButtonComponent,
    CurrencyPipe,
  ],
  templateUrl: './store-ecommerce-layout.component.html',
  styleUrls: ['./store-ecommerce-layout.component.scss'],
})
export class StoreEcommerceLayoutComponent {
  readonly store_name = signal('Tienda');
  readonly store_logo = signal<string | null>(null);
  readonly show_user_menu = signal(false);
  readonly show_mobile_menu = signal(false);
  readonly is_auth_modal_open = signal(false);
  readonly auth_modal_mode = signal<'login' | 'register'>('login');

  // Footer settings
  readonly footer_settings = signal<FooterSettings | null>(null);
  readonly show_about_modal = signal(false);
  readonly show_faq_modal = signal(false);
  readonly show_shipping_modal = signal(false);
  readonly show_returns_modal = signal(false);

  // Default links when no footer config exists
  readonly default_links: FooterLink[] = [
    { label: 'Productos', url: '/products', is_external: false },
    { label: 'Novedades', url: '/new', is_external: false },
    { label: 'Ofertas', url: '/sale', is_external: false },
  ];

  // Current year for copyright
  readonly current_year = new Date().getFullYear();

  // Inject dependencies first, then create observables
  private auth_facade = inject(AuthFacade);
  private domain_service = inject(TenantFacade);
  private cart_service = inject(CartService);
  private wishlist_service = inject(WishlistService);
  private store_ui_service = inject(StoreUiService);
  private router = inject(Router);
  private destroy_ref = inject(DestroyRef);
  private title_service = inject(Title); // Inject Title service

  // Expose observables for AsyncPipe (after injection)
  is_authenticated$ = this.auth_facade.isAuthenticated$;
  readonly is_authenticated = toSignal(this.is_authenticated$, { initialValue: false });
  user_name$ = this.auth_facade.user$.pipe(
    map((user) => (user ? `${user.first_name} ${user.last_name}`.trim() : '')),
  );
  readonly user_name = toSignal(this.user_name$, { initialValue: '' });
  cart_badge$ = this.cart_service.cart$.pipe(
    map((cart) => {
      const count = cart?.item_count || 0;
      return { show: count > 0, count };
    }),
  );
  readonly cart_badge = toSignal(this.cart_badge$, { initialValue: { show: false, count: 0 } });
  cart$ = this.cart_service.cart$;
  readonly cart = toSignal(this.cart$, { initialValue: null as any });
  readonly show_cart_dropdown = signal(false);

  // Wishlist badge observable
  wishlist_badge$ = this.wishlist_service.wishlist$.pipe(
    map((wishlist) => ({
      show: (wishlist?.item_count || 0) > 0,
      count: wishlist?.item_count || 0,
    })),
  );
  readonly wishlist_badge = toSignal(this.wishlist_badge$, { initialValue: { show: false, count: 0 } });

  // Cart animation and tooltip state
  readonly is_animating = signal(false);
  readonly show_added_tooltip = signal(false);
  private animation_timeout: any;
  private tooltip_timeout: any;
  private close_timer: any;

  // Wishlist animation and tooltip state
  readonly is_wishlist_animating = signal(false);
  readonly show_wishlist_added_tooltip = signal(false);
  private wishlist_animation_timeout: any;
  private wishlist_tooltip_timeout: any;

  constructor() {
    // Get store info from domain resolution reactively
    this.domain_service.domainConfig$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((domainConfig: any) => {
        if (!domainConfig) return;

        const customConfig = domainConfig.customConfig || {};
        const ecommerceConfig = customConfig.ecommerce || {};
        const tenantConfig =
          this.domain_service.getCurrentTenantConfig() || ({} as any);

        const resolvedName =
          domainConfig.store_slug ||
          this.domain_service.getCurrentStore()?.name ||
          'Tienda';
        this.store_name.set(resolvedName);

        if (resolvedName && resolvedName !== 'Tienda') {
          this.title_service.setTitle(resolvedName);
        }

        const storeLogo = domainConfig.store_logo_url;
        const inicioLogo = ecommerceConfig.inicio?.logo_url;
        const brandingLogo =
          customConfig.branding?.logo_url || customConfig.branding?.logo?.url;
        const tenantLogo =
          tenantConfig.branding?.logo_url || tenantConfig.branding?.logo?.url;

        this.store_logo.set(
          storeLogo || inicioLogo || brandingLogo || tenantLogo || null,
        );

        if (ecommerceConfig.footer) {
          this.footer_settings.set(ecommerceConfig.footer);
        }
      });

    // Subscribe to auth modal requests
    this.store_ui_service.openAuthModal$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((mode) => {
        this.auth_modal_mode.set(mode);
        this.is_auth_modal_open.set(true);
      });

    // Subscribe to cart item added events
    this.cart_service.itemAdded$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe(() => {
        this.triggerCartAnimation();
      });

    // Subscribe to wishlist item added events
    this.wishlist_service.itemAdded$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe(() => {
        this.triggerWishlistAnimation();
      });
  }

  private triggerCartAnimation(): void {
    // Reset if already playing
    this.is_animating.set(false);
    this.show_added_tooltip.set(false);
    clearTimeout(this.animation_timeout);
    clearTimeout(this.tooltip_timeout);

    // Trigger animation
    // Zoneless: setTimeout se usa aqui por duracion real (CSS animation timing).
    // No se requiere NgZone: los signals disparan CD automaticamente al mutar.
    requestAnimationFrame(() => {
      this.is_animating.set(true);
      this.show_added_tooltip.set(true);

      // Stop shaking after 500ms
      this.animation_timeout = setTimeout(() => {
        this.is_animating.set(false);
      }, 500);

      // Hide tooltip after 3000ms
      this.tooltip_timeout = setTimeout(() => {
        this.show_added_tooltip.set(false);
      }, 3000);
    });
  }

  private triggerWishlistAnimation(): void {
    // Reset if already playing
    this.is_wishlist_animating.set(false);
    this.show_wishlist_added_tooltip.set(false);
    clearTimeout(this.wishlist_animation_timeout);
    clearTimeout(this.wishlist_tooltip_timeout);

    // Trigger animation
    // Zoneless: setTimeout se usa aqui por duracion real (CSS animation timing).
    // No se requiere NgZone: los signals disparan CD automaticamente al mutar.
    requestAnimationFrame(() => {
      this.is_wishlist_animating.set(true);
      this.show_wishlist_added_tooltip.set(true);

      // Stop shaking after 500ms
      this.wishlist_animation_timeout = setTimeout(() => {
        this.is_wishlist_animating.set(false);
      }, 500);

      // Hide tooltip after 3000ms
      this.wishlist_tooltip_timeout = setTimeout(() => {
        this.show_wishlist_added_tooltip.set(false);
      }, 3000);
    });
  }

  toggleUserMenu(): void {
    this.show_user_menu.update((v) => !v);
  }

  onCartEnter(): void {
    clearTimeout(this.close_timer);
    this.show_cart_dropdown.set(true);
  }

  onCartLeave(): void {
    // Zoneless: setTimeout valido para debounce real (300ms evita parpadeo del dropdown).
    // La mutacion del signal show_cart_dropdown dispara CD automaticamente.
    this.close_timer = setTimeout(() => {
      this.show_cart_dropdown.set(false);
    }, 300);
  }

  toggleMobileMenu(): void {
    this.show_mobile_menu.update((v) => !v);
  }

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  goToWishlist(): void {
    this.router.navigate(['/wishlist']);
  }

  goToAccount(): void {
    this.router.navigate(['/account']);
    this.show_user_menu.set(false);
  }

  goToOrders(): void {
    this.router.navigate(['/account/orders']);
    this.show_user_menu.set(false);
  }

  logout(): void {
    this.auth_facade.logout({ redirect: false });
    this.show_user_menu.set(false);
    this.router.navigate(['/']);
  }

  login(): void {
    this.auth_modal_mode.set('login');
    this.is_auth_modal_open.set(true);
    this.show_user_menu.set(false);
  }

  register(): void {
    this.auth_modal_mode.set('register');
    this.is_auth_modal_open.set(true);
    this.show_user_menu.set(false);
  }

  closeAuthModal(): void {
    this.is_auth_modal_open.set(false);
  }

  // Close user menu when clicking outside (same pattern as admin layouts)
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const userMenuContainer = document.querySelector('.user-menu-container');
    if (
      this.show_user_menu() &&
      userMenuContainer &&
      !userMenuContainer.contains(target)
    ) {
      this.show_user_menu.set(false);
    }
  }

  // Close user menu on Escape key
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.show_user_menu()) {
      this.show_user_menu.set(false);
    }
  }

  updateCartQuantity(item: any, newQuantity: number): void {
    if (newQuantity === item.quantity) return;
    if (newQuantity <= 0) {
      this.removeCartItem(item);
      return;
    }
    if (this.is_authenticated()) {
      this.cart_service
        .updateItem(item.id, newQuantity)
        .pipe(takeUntilDestroyed(this.destroy_ref))
        .subscribe();
    } else {
      this.cart_service.updateLocalCartItem(
        item.product_id,
        newQuantity,
        item.product_variant_id || undefined,
      );
    }
  }

  removeCartItem(item: any): void {
    if (this.is_authenticated()) {
      this.cart_service
        .removeItem(item.id)
        .pipe(takeUntilDestroyed(this.destroy_ref))
        .subscribe();
    } else {
      this.cart_service.removeFromLocalCart(
        item.product_id,
        item.product_variant_id || undefined,
      );
    }
  }

  clearCart(): void {
    if (this.is_authenticated()) {
      this.cart_service
        .clearCart()
        .pipe(takeUntilDestroyed(this.destroy_ref))
        .subscribe();
    } else {
      this.cart_service.clearLocalCart();
    }
  }

  // Footer helper methods
  hasValidSocialLink(platform: 'facebook' | 'instagram' | 'tiktok'): boolean {
    const account = this.footer_settings()?.social?.[platform];
    return !!(account?.url && account.url.trim() !== '' && account.url !== '#');
  }

  getFooterLinks(): FooterLink[] {
    const settings = this.footer_settings();
    return settings?.links?.length ? settings.links : this.default_links;
  }

  hasAboutUs(): boolean {
    const settings = this.footer_settings();
    return !!(
      settings?.store_info?.about_us &&
      settings.store_info.about_us.trim() !== ''
    );
  }

  hasFaq(): boolean {
    const settings = this.footer_settings();
    return !!(settings?.help?.faq && settings.help.faq.length > 0);
  }

  hasShippingInfo(): boolean {
    const settings = this.footer_settings();
    return !!(
      settings?.help?.shipping_info &&
      settings.help.shipping_info.trim() !== ''
    );
  }

  hasReturnsInfo(): boolean {
    const settings = this.footer_settings();
    return !!(
      settings?.help?.returns_info &&
      settings.help.returns_info.trim() !== ''
    );
  }

  getTagline(): string {
    return this.footer_settings()?.store_info?.tagline || 'Tu tienda de confianza';
  }
}
