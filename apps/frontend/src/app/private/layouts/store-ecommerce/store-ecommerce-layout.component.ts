import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  HostListener,
  DestroyRef,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../core/store';
import { TenantFacade } from '../../../core/store';
import { CartService } from '../../modules/ecommerce/services/cart.service';
import { StoreUiService } from '../../modules/ecommerce/services/store-ui.service';
import { SearchAutocompleteComponent } from '../../modules/ecommerce/components/search-autocomplete';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';
import { QuantityControlComponent } from '../../../shared/components/quantity-control/quantity-control.component';
import { InfoModalComponent } from './components/info-modal';
import { FaqModalComponent } from './components/faq-modal';

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
    CommonModule,
    RouterModule,
    SearchAutocompleteComponent,
    IconComponent,
    AuthModalComponent,
    QuantityControlComponent,
    InfoModalComponent,
    FaqModalComponent,
  ],
  templateUrl: './store-ecommerce-layout.component.html',
  styleUrls: ['./store-ecommerce-layout.component.scss'],
})
export class StoreEcommerceLayoutComponent implements OnInit {
  store_name = 'Tienda';
  store_logo: string | null = null;
  show_user_menu = false;
  show_mobile_menu = false;
  is_auth_modal_open = false;
  auth_modal_mode: 'login' | 'register' = 'login';

  // Footer settings
  footer_settings: FooterSettings | null = null;
  show_about_modal = false;
  show_faq_modal = false;
  show_shipping_modal = false;
  show_returns_modal = false;

  // Default links when no footer config exists
  default_links: FooterLink[] = [
    { label: 'Productos', url: '/products', is_external: false },
    { label: 'Novedades', url: '/new', is_external: false },
    { label: 'Ofertas', url: '/sale', is_external: false },
  ];

  // Current year for copyright
  current_year = new Date().getFullYear();

  // Inject dependencies first, then create observables
  private auth_facade = inject(AuthFacade);
  private domain_service = inject(TenantFacade);
  private cart_service = inject(CartService);
  private store_ui_service = inject(StoreUiService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy_ref = inject(DestroyRef);
  private title_service = inject(Title); // Inject Title service

  // Expose observables for AsyncPipe (after injection)
  is_authenticated$ = this.auth_facade.isAuthenticated$;
  user_name$ = this.auth_facade.user$.pipe(
    map((user) => (user ? `${user.first_name} ${user.last_name}`.trim() : '')),
  );
  cart_badge$ = this.cart_service.cart$.pipe(
    map((cart) => {
      const count = cart?.item_count || 0;
      return { show: count > 0, count };
    }),
  );
  cart$ = this.cart_service.cart$;
  show_cart_dropdown = false;

  // Animation and tooltip state
  is_animating = false;
  show_added_tooltip = false;
  private animation_timeout: any;
  private tooltip_timeout: any;
  private close_timer: any;

  ngOnInit(): void {
    // Get store info from domain resolution reactively
    this.domain_service.domainConfig$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((domainConfig: any) => {
        if (!domainConfig) return;

        // Intentar obtener configuración desde customConfig (prioridad) o config
        const config = domainConfig.customConfig || domainConfig.config || {};
        const tenantConfig =
          this.domain_service.getCurrentTenantConfig() || ({} as any);

        // Resolver nombre de la tienda
        this.store_name =
          domainConfig.store_slug ||
          this.domain_service.getCurrentStore()?.name ||
          'Tienda';

        // Update Browser Tab Title
        if (this.store_name && this.store_name !== 'Tienda') {
          this.title_service.setTitle(this.store_name);
        }

        // Resolver Logo con prioridad:
        // 1. customConfig.inicio.logo_url (configuración específica del layout e-commerce)
        // 2. customConfig.branding.logo_url (configuración de branding)
        // 3. tenantConfig.branding.logo_url (standardizer backend)
        // 4. legacy branding
        const inicioLogo = config.inicio?.logo_url;
        const brandingLogo =
          config.branding?.logo_url || config.branding?.logo?.url;
        const tenantLogo =
          tenantConfig.branding?.logo_url || tenantConfig.branding?.logo?.url;

        this.store_logo = inicioLogo || brandingLogo || tenantLogo || null;

        // Load footer settings
        const ecommerceSettings = domainConfig.ecommerce || config;
        if (ecommerceSettings?.footer) {
          this.footer_settings = ecommerceSettings.footer;
        }

        console.log('Layout Resolved Config:', {
          storeName: this.store_name,
          storeLogo: this.store_logo,
          footerSettings: this.footer_settings ? 'loaded' : 'not configured',
          source: inicioLogo
            ? 'inicio.logo_url'
            : brandingLogo
              ? 'branding.logo_url'
              : 'legacy',
        });
      });

    // Subscribe to auth modal requests
    this.store_ui_service.openAuthModal$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((mode) => {
        this.auth_modal_mode = mode;
        this.is_auth_modal_open = true;
        this.cdr.detectChanges();
      });

    // Subscribe to cart item added events
    this.cart_service.itemAdded$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe(() => {
        this.triggerCartAnimation();
      });
  }

  private triggerCartAnimation(): void {
    // Reset if already playing
    this.is_animating = false;
    this.show_added_tooltip = false;
    clearTimeout(this.animation_timeout);
    clearTimeout(this.tooltip_timeout);
    this.cdr.detectChanges(); // Force update to reset classes

    // Trigger animation
    requestAnimationFrame(() => {
      this.is_animating = true;
      this.show_added_tooltip = true;
      this.cdr.detectChanges();

      // Stop shaking after 500ms
      this.animation_timeout = setTimeout(() => {
        this.is_animating = false;
        this.cdr.detectChanges();
      }, 500);

      // Hide tooltip after 3000ms
      this.tooltip_timeout = setTimeout(() => {
        this.show_added_tooltip = false;
        this.cdr.detectChanges();
      }, 3000);
    });
  }

  toggleUserMenu(): void {
    this.show_user_menu = !this.show_user_menu;
  }

  onCartEnter(): void {
    clearTimeout(this.close_timer);
    this.show_cart_dropdown = true;
  }

  onCartLeave(): void {
    this.close_timer = setTimeout(() => {
      this.show_cart_dropdown = false;
      this.cdr.detectChanges();
    }, 300);
  }

  toggleMobileMenu(): void {
    this.show_mobile_menu = !this.show_mobile_menu;
  }

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  goToWishlist(): void {
    this.router.navigate(['/wishlist']);
  }

  goToAccount(): void {
    this.router.navigate(['/account']);
    this.show_user_menu = false;
  }

  goToOrders(): void {
    this.router.navigate(['/account/orders']);
    this.show_user_menu = false;
  }


  logout(): void {
    this.auth_facade.logout({ redirect: false });
    this.show_user_menu = false;
    this.router.navigate(['/']);
  }

  login(): void {
    this.auth_modal_mode = 'login';
    this.is_auth_modal_open = true;
    this.show_user_menu = false;
    this.cdr.detectChanges();
  }

  register(): void {
    this.auth_modal_mode = 'register';
    this.is_auth_modal_open = true;
    this.show_user_menu = false;
    this.cdr.detectChanges();
  }

  // Close user menu when clicking outside (same pattern as admin layouts)
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const userMenuContainer = document.querySelector('.user-menu-container');
    if (
      this.show_user_menu &&
      userMenuContainer &&
      !userMenuContainer.contains(target)
    ) {
      this.show_user_menu = false;
    }
  }

  // Close user menu on Escape key
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.show_user_menu) {
      this.show_user_menu = false;
    }
  }

  updateCartQuantity(item: any, newQuantity: number): void {
    if (newQuantity === item.quantity) return;
    if (newQuantity <= 0) {
      this.removeCartItem(item);
    } else {
      const sub = this.is_authenticated$.subscribe(isAuth => {
        if (isAuth) {
          this.cart_service.updateItem(item.id, newQuantity).subscribe();
        } else {
          this.cart_service.updateLocalCartItem(item.product_id, newQuantity, item.product_variant_id || undefined);
        }
      });
      sub.unsubscribe();
    }
  }

  removeCartItem(item: any): void {
    const sub = this.is_authenticated$.subscribe(isAuth => {
      if (isAuth) {
        this.cart_service.removeItem(item.id).subscribe();
      } else {
        this.cart_service.removeFromLocalCart(item.product_id, item.product_variant_id || undefined);
      }
    });
    sub.unsubscribe();
  }

  clearCart(): void {
    const sub = this.is_authenticated$.subscribe(isAuth => {
      if (isAuth) {
        this.cart_service.clearCart().subscribe();
      } else {
        this.cart_service.clearLocalCart();
      }
    });
    sub.unsubscribe();
  }

  // Footer helper methods
  hasValidSocialLink(platform: 'facebook' | 'instagram' | 'tiktok'): boolean {
    const account = this.footer_settings?.social?.[platform];
    return !!(account?.url && account.url.trim() !== '' && account.url !== '#');
  }

  getFooterLinks(): FooterLink[] {
    return this.footer_settings?.links?.length
      ? this.footer_settings.links
      : this.default_links;
  }

  hasAboutUs(): boolean {
    return !!(
      this.footer_settings?.store_info?.about_us &&
      this.footer_settings.store_info.about_us.trim() !== ''
    );
  }

  hasFaq(): boolean {
    return !!(
      this.footer_settings?.help?.faq && this.footer_settings.help.faq.length > 0
    );
  }

  hasShippingInfo(): boolean {
    return !!(
      this.footer_settings?.help?.shipping_info &&
      this.footer_settings.help.shipping_info.trim() !== ''
    );
  }

  hasReturnsInfo(): boolean {
    return !!(
      this.footer_settings?.help?.returns_info &&
      this.footer_settings.help.returns_info.trim() !== ''
    );
  }

  getTagline(): string {
    return (
      this.footer_settings?.store_info?.tagline || 'Tu tienda de confianza'
    );
  }
}
