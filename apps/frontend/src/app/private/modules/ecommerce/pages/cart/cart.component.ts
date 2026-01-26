import { Component, OnInit, OnDestroy, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { AuthFacade } from '../../../../../core/store';
import { StoreUiService } from '../../services/store-ui.service';
import { CatalogService, EcommerceProduct } from '../../services/catalog.service';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ProductCarouselComponent } from '../../components/product-carousel/product-carousel.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal/product-quick-view-modal.component';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, QuantityControlComponent, ProductCarouselComponent, ProductQuickViewModalComponent],
  templateUrl: './cart.component.html',
  styleUrls: ['./cart.component.scss'],
})
export class CartComponent implements OnInit, OnDestroy {
  cart: Cart | null = null;
  is_loading = true;
  is_authenticated = false;
  updating_item_id: number | null = null;

  // Recommendations
  recommendedProducts = signal<EcommerceProduct[]>([]);
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  private destroy$ = new Subject<void>();
  private catalogService = inject(CatalogService);
  private destroyRef = inject(DestroyRef);

  constructor(
    private cart_service: CartService,
    private auth_facade: AuthFacade,
    private router: Router,
    private store_ui_service: StoreUiService,
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

    this.loadRecommendations();
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

  loadRecommendations(): void {
    this.catalogService.getProducts({ limit: 10, sort_by: 'newest', has_discount: true }).subscribe({
      next: (response) => {
        if (response.data.length > 0) {
          this.recommendedProducts.set(response.data);
        } else {
          // Fallback if no sales
          this.catalogService.getProducts({ limit: 10, sort_by: 'newest' }).subscribe(res => {
            this.recommendedProducts.set(res.data);
          });
        }
      }
    });
  }

  updateQuantity(item: CartItem, new_quantity: number): void {
    if (new_quantity <= 0) {
      this.removeItem(item);
      return;
    }

    if (new_quantity === item.quantity) return;

    this.updating_item_id = item.id;

    const result = this.cart_service.updateCartItem(
      {
        item_id: item.id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || undefined
      },
      new_quantity
    );

    if (result) {
      result.subscribe({
        next: () => { this.updating_item_id = null; },
        error: () => { this.updating_item_id = null; },
      });
    } else {
      this.updating_item_id = null;
    }
  }

  removeItem(item: CartItem): void {
    const result = this.cart_service.removeCartItem({
      item_id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined
    });
    if (result) {
      result.subscribe();
    }
  }

  clearCart(): void {
    const result = this.cart_service.clearAllCart();
    if (result) {
      result.subscribe();
    }
  }

  proceedToCheckout(): void {
    if (!this.is_authenticated) {
      this.store_ui_service.openLoginModal();
    } else {
      this.router.navigate(['/checkout']);
    }
  }

  continueShopping(): void {
    this.router.navigate(['/catalog']);
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug = product.slug;
    this.quickViewOpen = true;
  }

  onAddToCartFromSlider(product: EcommerceProduct): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) result.subscribe();
  }
}
