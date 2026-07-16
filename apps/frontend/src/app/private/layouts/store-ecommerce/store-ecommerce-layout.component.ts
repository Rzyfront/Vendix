import {
  Component,
  inject,
  HostListener,
  DestroyRef,
  signal,
  PLATFORM_ID,
  effect,
  computed,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { isPlatformBrowser, ViewportScroller } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../core/store';
import { TenantFacade } from '../../../core/store';
import { CartService } from '../../modules/ecommerce/services/cart.service';
import { CartPromotionsComponent } from '../../modules/ecommerce/components/cart-promotions/cart-promotions.component';
import { WishlistService } from '../../modules/ecommerce/services/wishlist.service';
import { StoreUiService } from '../../modules/ecommerce/services/store-ui.service';
import {
  TableContextService,
  PaymentMethodView,
  PaymentTablePendingView,
} from '../../modules/ecommerce/services/table-context.service';
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
import { CurrencyPipe, CurrencyFormatService } from '../../../shared/pipes/currency';
import { WompiCheckoutService } from '../../../core/services/wompi-checkout.service';

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
    CartPromotionsComponent,
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
  readonly auth_modal_mode = signal<'login' | 'register' | 'forgot'>('login');

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
  private wompi_checkout = inject(WompiCheckoutService); // shared widget opener
  private readonly is_browser = isPlatformBrowser(this.platform_id);

  // Tenant currency signal exposed so the cart dropdown template reactively
  // depends on it. The custom CurrencyPipe is impure and reads the currency
  // signal INSIDE transform(), which does not register a zoneless CD
  // dependency; binding this signal in the dropdown template ties change
  // detection to the async currency load, so prices refresh from the "$85,000.00"
  // fallback to the tenant format ("$85.000") once the currency resolves.
  protected readonly currency_code = inject(CurrencyFormatService).currencyCode;

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

  // ── QR-table diner UX (D6) ─────────────────────────────────────────
  /** Modal: "¿Seguro que quieres salir de la mesa?" */
  readonly show_leave_confirm = signal(false);
  /** Modal: mover carrito existente a la cuenta recién activada. */
  readonly show_move_cart_modal = signal(false);
  /** Modal: picker de métodos de pago de la cuenta compartida. */
  readonly show_payment_modal = signal(false);
  /** Loading del modal de pago mientras `loadPaymentMethods` viaja. */
  readonly loading_pay_methods = signal(false);
  /** Track each payment attempt so the UI can show the appropriate status. */
  readonly payment_attempt = signal<
    | { kind: 'cash'; pending: PaymentTablePendingView | null }
    | { kind: 'wompi'; pending: PaymentTablePendingView | null }
    | null
  >(null);
  /** One-shot guard to avoid re-prompting move-cart on every re-resolve. */
  private move_cart_prompted_for_token: string | null = null;
  /** Debounce timer for the "comensal joined" toast (D6: 3s). */
  private join_toast_timer: ReturnType<typeof setTimeout> | null = null;
  private join_toast_last_event_id = '';

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
            next: () => {
              // Resolve succeeded. If the diner already had items in their
              // ecommerce cart before scanning the QR, prompt them to fold
              // those items into the shared bill (plan D6: no silent data
              // loss). Guarded by token so a fresh scan doesn't re-trigger.
              this.maybePromptMoveCart(mesaToken);
            },
            error: () => {
              // Invalid/expired token — clear any stale context.
              this.table_context_service.clear();
            },
          });
      }
    }

    // D6 — "Otro comensal se unió a la mesa" toast, debounced 3s.
    // The signal updates on every `comensal_joined` or `comensal_left` event
    // that the SSE service routes through `TableContextService.recordDinerPresence`.
    // We only surface a toast when the change comes from a DIFFERENT device
    // (the diner doesn't need to be told they themselves joined) and after
    // a 3-second silence so a burst of joiners collapses to one notification.
    effect(() => {
      const event = this.table_context_service.lastJoinEvent();
      if (!event) return;
      const ownId = this.table_context_service.deviceUuid();
      if (!ownId || event.device_id === ownId) return;
      // event.device_id is the same across joined/left; the timestamp is the
      // only monotonically increasing discriminator. Coalesce repeats.
      if (String(event.timestamp) === this.join_toast_last_event_id) return;
      this.join_toast_last_event_id = String(event.timestamp);
      if (this.join_toast_timer) clearTimeout(this.join_toast_timer);
      this.join_toast_timer = setTimeout(() => {
        this.join_toast_timer = null;
        this.toast_service.info('Otro comensal se unió a la mesa');
      }, 3000);
    });

    // Clear the debounce timer on destroy so a navigation mid-debounce
    // doesn't fire a stale toast against a fresh table.
    this.destroy_ref.onDestroy(() => {
      if (this.join_toast_timer) clearTimeout(this.join_toast_timer);
    });
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

  toggleCart(): void {
    // El botón del carrito ya no navega: solo abre/cierra el dropdown.
    // Imprescindible en móvil, donde no existe hover para dispararlo.
    clearTimeout(this.close_timer);
    this.show_cart_dropdown.update((v) => !v);
  }

  goToCart(): void {
    // La navegación al carrito ahora vive en el header y footer del dropdown.
    this.show_cart_dropdown.set(false);
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

  // ── D6: mesa-aware layout UX ──────────────────────────────────────────

  /**
   * "Salir de la mesa" — surfaces the confirmation prompt. The actual
   * teardown happens in `confirmLeaveTable()` so a stray tap on a banner
   * button cannot silently disconnect the diner from the live stream.
   */
  promptLeaveTable(): void {
    this.show_leave_confirm.set(true);
    this.closeActionsSheet();
  }

  /**
   * Tear down the diner's table presence and route them back to the
   * storefront home. Re-scanning the QR re-joins — they never lose the
   * open tab itself (backend keeps it), only the live stream.
   */
  async confirmLeaveTable(): Promise<void> {
    this.show_leave_confirm.set(false);
    this.payment_attempt.set(null);
    this.table_context_service.leaveTable();
    await this.router.navigate(['/']);
  }

  /**
   * D6 — if a diner scanned a QR while their ecommerce cart had items,
   * surface a one-shot prompt to move those items into the shared bill
   * (so they don't silently vanish into a different person's tab).
   * Coalesces by token so re-resolves of the same table don't re-prompt.
   */
  private maybePromptMoveCart(token: string): void {
    if (!this.is_browser) return;
    if (this.move_cart_prompted_for_token === token) return;
    if (!this.table_context_service.isOpenTab()) return;
    const cart = this.cart();
    const items = cart?.items ?? [];
    if (items.length === 0) return;
    this.move_cart_prompted_for_token = token;
    this.show_move_cart_modal.set(true);
  }

  /** Diner chose to fold their ecommerce cart into the shared table bill. */
  async moveCartToBill(): Promise<void> {
    const items = this.cart()?.items ?? [];
    if (items.length === 0) {
      this.show_move_cart_modal.set(false);
      return;
    }
    // Build a single addOrder call — backend accepts an array of items.
    const tableOrderItems = items.map((item: any) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      product_variant_id: item.product_variant_id || undefined,
    }));
    try {
      await firstValueFrom(
        this.table_context_service.addOrder(tableOrderItems),
      );
      this.cart_service.clearAllCart();
      this.toast_service.success('Productos enviados a la cuenta de la mesa');
    } catch (err) {
      this.toast_service.error(parseApiError(err).userMessage);
    } finally {
      this.show_move_cart_modal.set(false);
    }
  }

  /** Diner chose to keep cart separate — close the prompt and continue. */
  keepCartSeparate(): void {
    this.show_move_cart_modal.set(false);
  }

  /** Open the diner-facing payment picker (loads methods on demand). */
  openPaymentModal(): void {
    const token = this.table_context_service.tableToken();
    if (!token) return;
    this.loading_pay_methods.set(true);
    this.table_context_service
      .loadPaymentMethods(token)
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: () => this.loading_pay_methods.set(false),
        error: (err) => {
          this.loading_pay_methods.set(false);
          this.toast_service.error(parseApiError(err).userMessage);
        },
      });
    this.show_payment_modal.set(true);
    this.closeActionsSheet();
  }

  closePaymentModal(): void {
    this.show_payment_modal.set(false);
  }

  /** Cash / bank transfer — backend keeps the payment `pending` until staff confirm. */
  payWithManualMethod(method: PaymentMethodView): void {
    const token = this.table_context_service.tableToken();
    if (!token) return;
    const amount = this.table_context_service.bill()?.grand_total;
    this.table_context_service
      .payTable(token, {
        store_payment_method_id: method.id,
        amount,
      })
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (result) => {
          this.payment_attempt.set({
            kind: 'cash',
            pending: this.table_context_service.paymentPending(),
          });
          if (result.state === 'pending') {
            this.toast_service.success(
              'Pago enviado, esperando confirmación del mesero',
            );
          }
        },
        error: (err) =>
          this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /** Wompi — backend returns widget data; we open the widget, then confirm. */
  payWithWompi(method: PaymentMethodView): void {
    const token = this.table_context_service.tableToken();
    if (!token) return;
    const amount = this.table_context_service.bill()?.grand_total;
    this.table_context_service
      .payTable(token, {
        store_payment_method_id: method.id,
        amount,
      })
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (result) => {
          if (result.next !== 'wompi_widget' || !result.wompi_data) {
            this.toast_service.error(
              'No se pudo abrir la pasarela de pago, intenta de nuevo',
            );
            return;
          }
          this.payment_attempt.set({
            kind: 'wompi',
            pending: this.table_context_service.paymentPending(),
          });
          const wd = result.wompi_data;
          void this.wompi_checkout.openWidget(
            {
              public_key: wd.public_key,
              currency: wd.currency,
              amount_in_cents: wd.amount_in_cents,
              reference: wd.reference,
              signature_integrity: wd.signature_integrity,
              redirect_url: wd.redirect_url,
              customer_email: wd.customer_email,
            },
            {
              onApproved: () => {
                this.table_context_service
                  .confirmWompi(token, result.payment_id)
                  .pipe(takeUntilDestroyed(this.destroy_ref))
                  .subscribe({
                    next: () =>
                      this.toast_service.success('Pago confirmado'),
                    error: (err) =>
                      this.toast_service.error(
                        parseApiError(err).userMessage,
                      ),
                  });
              },
              onDeclined: () =>
                this.toast_service.error('Pago rechazado por Wompi'),
              onError: (err) => {
                // eslint-disable-next-line no-console
                console.error('[pay-table] wompi widget error', err);
                this.toast_service.error('No se pudo abrir la pasarela');
              },
            },
          );
        },
        error: (err) =>
          this.toast_service.error(parseApiError(err).userMessage),
      });
  }

  /** Card icon for the method picker. */
  iconForPaymentMethod(type: string): string {
    switch (type) {
      case 'cash':
        return 'banknote';
      case 'bank_transfer':
        return 'building-2';
      case 'wompi':
        return 'credit-card';
      default:
        return 'circle-dollar-sign';
    }
  }

  /**
   * Comensales stepper label: when only the diner is on the table, surface
   * "Estás solo/a" instead of a 1-person stepper (avoids the dead-state UX
   * where the count would always read "1 comensal en la mesa").
   */
  readonly diners_label = computed(() => {
    const n = this.table_context_service.activeDevicesCount();
    if (n <= 1) return 'Estás solo/a';
    return `${n} comensales en la mesa`;
  });

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
