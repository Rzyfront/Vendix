import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef,
  HostListener,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthFacade } from '../../../core/store';
import { TenantFacade } from '../../../core/store';
import { CartService } from '../../modules/ecommerce/services/cart.service';
import { SearchAutocompleteComponent } from '../../modules/ecommerce/components/search-autocomplete';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AuthModalComponent } from './components/auth-modal/auth-modal.component';

@Component({
  selector: 'app-store-ecommerce-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SearchAutocompleteComponent,
    IconComponent,
    AuthModalComponent,
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

  // Inject dependencies first, then create observables
  private auth_facade = inject(AuthFacade);
  private domain_service = inject(TenantFacade);
  private cart_service = inject(CartService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);
  private destroy_ref = inject(DestroyRef);

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

        console.log('Layout Resolved Config:', {
          storeName: this.store_name,
          storeLogo: this.store_logo,
          source: inicioLogo
            ? 'inicio.logo_url'
            : brandingLogo
              ? 'branding.logo_url'
              : 'legacy',
        });
      });
  }

  toggleUserMenu(): void {
    this.show_user_menu = !this.show_user_menu;
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
    this.auth_facade.logout();
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
}
