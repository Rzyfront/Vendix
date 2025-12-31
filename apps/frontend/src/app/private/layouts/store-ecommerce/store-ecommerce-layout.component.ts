import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthFacade } from '../../../core/auth/services/auth.facade';
import { DomainService } from '../../../core/services/domain.service';
import { CartService } from '../../modules/ecommerce/services/cart.service';

@Component({
    selector: 'app-store-ecommerce-layout',
    standalone: true,
    imports: [CommonModule, RouterModule],
    templateUrl: './store-ecommerce-layout.component.html',
    styleUrls: ['./store-ecommerce-layout.component.scss'],
})
export class StoreEcommerceLayoutComponent implements OnInit {
    store_name = 'Tienda';
    store_logo: string | null = null;
    cart_count = 0;
    is_authenticated = false;
    user_name = '';
    show_user_menu = false;
    show_mobile_menu = false;

    constructor(
        private auth_facade: AuthFacade,
        private domain_service: DomainService,
        private cart_service: CartService,
        private router: Router,
    ) { }

    ngOnInit(): void {
        // Get store info from domain resolution
        const domain_config = this.domain_service.getCurrentDomainConfig();
        if (domain_config) {
            this.store_name = domain_config.store?.name || 'Tienda';
            this.store_logo = domain_config.store?.logo_url || null;
        }

        // Check authentication
        this.auth_facade.isAuthenticated$.subscribe((is_auth) => {
            this.is_authenticated = is_auth;
            if (is_auth) {
                this.auth_facade.currentUser$.subscribe((user) => {
                    if (user) {
                        this.user_name = `${user.first_name} ${user.last_name}`.trim();
                    }
                });
            }
        });

        // Subscribe to cart changes
        this.cart_service.cart$.subscribe((cart) => {
            this.cart_count = cart?.item_count || 0;
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
        this.router.navigate(['/auth/login']);
    }

    register(): void {
        this.router.navigate(['/auth/register']);
    }
}
