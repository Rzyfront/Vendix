import {
  Component,
  inject,
  HostListener,
  DestroyRef,
  signal,
  PLATFORM_ID,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import {
  CurrencyPipe,
  isPlatformBrowser,
  ViewportScroller,
} from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../core/store';
import { TenantFacade } from '../../../core/store';
import { CartService } from '../../modules/ecommerce/services/cart.service';
import { WishlistService } from '../../modules/ecommerce/services/wishlist.service';
import { StoreUiService } from '../../modules/ecommerce/services/store-ui.service';
import { TableContextService } from '../../modules/ecommerce/services/table-context.service';
import { SearchAutocompleteComponent } from '../../modules/ecommerce/components/search-autocomplete';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { QuantityControlComponent } from '../../../shared/components/quantity-control/quantity-control.component';
import { InfoModalComponent } from './components/info-modal';
import { FaqModalComponent } from './components/faq-modal';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { ModalComponent } from '../../../shared/components/modal/modal.component';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { TableSessionSseService } from '../../modules/ecommerce/services/table-session-sse.service';
import { parseApiError } from '../../../core/utils/parse-api-error';

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
    ModalComponent,
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
  private table_context_service = inject(TableContextService);
  private table_sse_service = inject(TableSessionSseService);
  private toast_service = inject(ToastService);
  private router = inject(Router);
  private viewport_scroller = inject(ViewportScroller);
  private destroy_ref = inject(DestroyRef);
  private title_service = inject(Title); // Inject Title service
  private platform_id = inject(PLATFORM_ID);
  private readonly is_browser = isPlatformBrowser(this.platform_id);

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

  // Table QR context (exposed read-only for template)
  readonly table_context = this.table_context_service;
  // Live table-session stream (auto-connects on active table token)
  readonly table_sse = this.table_sse_service;

  // QR dine-in — "Mi cuenta" modal + guest count (GAP-5)
  readonly is_bill_modal_open = signal(false);
  readonly guest_count = signal(1);
  // QR dine-in — bottom-sheet de acciones (móvil). Sólo activo en flujo de mesa.
  readonly is_actions_sheet_open = signal(false);

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
    // Restore body scroll if the actions sheet is torn down mid-open.
    this.destroy_ref.onDestroy(() => this.setBodyScrollLock(false));

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
          storeLogo || inicioLogo || brandingLogo || tenantLogo || 'vlogomono.png',
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

    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(this.destroy_ref),
      )
      .subscribe((event) => {
        if (this.shouldScrollToTopOnNavigation(event.urlAfterRedirects)) {
          this.scrollToTop();
        }
      });

    // QR-por-mesa: hydrate persisted table context, then check ?mesa= token.
    // Router is NOT configured with withComponentInputBinding (see
    // reference_route_input_binding memory), so we read query params via
    // URLSearchParams on window.location.search with is_browser guard.
    if (this.is_browser) {
      this.table_context_service.hydrate();
      const params = new URLSearchParams(window.location.search);
      const mesaToken = params.get('mesa');
      // A fresh `?mesa=` token must OVERRIDE a stale hydrated context (a diner
      // scanning a NEW table's QR). Guarding on `!isActive()` would keep the
      // old table because hydrate() already made it active. Re-resolve only
      // when the scanned token differs from the current one (idempotent).
      if (mesaToken && mesaToken !== this.table_context_service.tableToken()) {
        this.table_context_service
          .resolve(mesaToken)
          .pipe(takeUntilDestroyed(this.destroy_ref))
          .subscribe({
            error: () => {
              // Invalid/expired token — clear any stale context.
              this.table_context_service.clear();
            },
          });
      }
    }
  }

  private triggerCartAnimation(): void {
    // Reset if already playing
    this.is_animating.set(false);
    this.show_added_tooltip.set(false);
    clearTimeout(this.animation_timeout);
    clearTimeout(this.tooltip_timeout);

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

  private previous_path: string | null = null;

  private shouldScrollToTopOnNavigation(url: string): boolean {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    const changed = path !== this.previous_path;
    this.previous_path = path;
    return changed;
  }

  private scrollToTop(): void {
    if (!this.is_browser) return;

    requestAnimationFrame(() => {
      this.viewport_scroller.scrollToPosition([0, 0]);
    });
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

  // ── QR dine-in diner actions (GAP-5) ─────────────────────────────

  /** Notify staff that the table needs a waiter. */
  callWaiter(): void {
    this.table_context_service
      .callWaiter()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: () => this.toast_service.success('El mesero fue notificado'),
        error: (err) => this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /** Ask staff to bring the bill to the table. */
  requestBill(): void {
    this.table_context_service
      .requestBill()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: () =>
          this.toast_service.success('Pedimos tu cuenta, un mesero se acerca'),
        error: (err) => this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /**
   * Ask staff to split the bill. Uses the declared guest count as the number
   * of equal splits (min 2, as required by the backend contract).
   */
  requestSplit(): void {
    const splits = Math.max(2, this.guest_count());
    this.table_context_service
      .requestSplit(splits, 'equal')
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: () =>
          this.toast_service.success(
            `Le avisamos al mesero para dividir la cuenta en ${splits}`,
          ),
        error: (err) => this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /** Load the current bill (called when the "Mi cuenta" modal opens). */
  loadBill(): void {
    this.table_context_service
      .getMyBill()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        error: (err) => this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /** Open the mobile bottom-sheet of table actions (locks body scroll). */
  openActionsSheet(): void {
    this.is_actions_sheet_open.set(true);
    this.setBodyScrollLock(true);
  }

  /** Close the mobile bottom-sheet and release the body scroll lock. */
  closeActionsSheet(): void {
    this.is_actions_sheet_open.set(false);
    this.setBodyScrollLock(false);
  }

  private setBodyScrollLock(locked: boolean): void {
    if (!this.is_browser) return;
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  /** Persist the number of guests at the table (422 if over capacity). */
  onGuestCountChange(count: number): void {
    this.guest_count.set(count);
    this.table_context_service
      .setGuests(count)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        error: (err) => this.toast_service.error(parseApiError(err).userMessage),
      });
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
