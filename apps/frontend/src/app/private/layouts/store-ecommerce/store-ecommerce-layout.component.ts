import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { map } from 'rxjs/operators';
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
    // Get store info from domain resolution
    const tenantConfig = this.domain_service.getCurrentTenantConfig();
    const storeConfig = this.domain_service.getCurrentStore();
    if (tenantConfig && storeConfig) {
      this.store_name = storeConfig.name || 'Tienda';
      this.store_logo = tenantConfig.branding?.logo?.url || null;
    }
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
}
