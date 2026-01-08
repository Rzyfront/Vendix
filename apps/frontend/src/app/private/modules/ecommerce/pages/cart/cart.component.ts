import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { AuthFacade } from '../../../../../core/store';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './cart.component.html',
  styleUrls: ['./cart.component.scss'],
})
export class CartComponent implements OnInit, OnDestroy {
  cart: Cart | null = null;
  is_loading = true;
  is_authenticated = false;
  updating_item_id: number | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private cart_service: CartService,
    private auth_facade: AuthFacade,
    private router: Router,
  ) { }

  ngOnInit(): void {
    this.auth_facade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe((is_auth: boolean) => {
      this.is_authenticated = is_auth;
      if (is_auth) {
        this.loadCart();
      } else {
        this.loadLocalCart();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCart(): void {
    this.is_loading = true;
    this.cart_service.getCart().subscribe({
      next: () => {
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
      },
    });

    this.cart_service.cart$.pipe(takeUntil(this.destroy$)).subscribe((cart) => {
      this.cart = cart;
    });
  }

  loadLocalCart(): void {
    this.cart_service.cart$.pipe(takeUntil(this.destroy$)).subscribe((cart) => {
      this.cart = cart;
      this.is_loading = false;
    });
  }

  updateQuantity(item: CartItem, delta: number): void {
    const new_quantity = item.quantity + delta;
    if (new_quantity < 1) return;

    this.updating_item_id = item.id;

    if (this.is_authenticated) {
      this.cart_service.updateItem(item.id, new_quantity).subscribe({
        next: () => {
          this.updating_item_id = null;
        },
        error: () => {
          this.updating_item_id = null;
        },
      });
    } else {
      this.cart_service.updateLocalCartItem(item.product_id, new_quantity, item.product_variant_id || undefined);
      this.updating_item_id = null;
    }
  }

  removeItem(item: CartItem): void {
    if (this.is_authenticated) {
      this.cart_service.removeItem(item.id).subscribe();
    } else {
      this.cart_service.removeFromLocalCart(item.product_id, item.product_variant_id || undefined);
    }
  }

  clearCart(): void {
    if (this.is_authenticated) {
      this.cart_service.clearCart().subscribe(() => {
        this.cart = null;
      });
    } else {
      this.cart_service.clearLocalCart();
    }
  }

  proceedToCheckout(): void {
    if (!this.is_authenticated) {
      // Redirect to login with return URL
      this.router.navigate(['/auth/login'], { queryParams: { returnUrl: '/checkout' } });
    } else {
      this.router.navigate(['/checkout']);
    }
  }

  continueShopping(): void {
    this.router.navigate(['/catalog']);
  }
}
