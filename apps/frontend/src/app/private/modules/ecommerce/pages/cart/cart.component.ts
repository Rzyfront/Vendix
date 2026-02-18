import { Component, OnInit, OnDestroy, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { CheckoutService, WhatsappCheckoutResponse } from '../../services/checkout.service';
import { AuthFacade } from '../../../../../core/store';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { StoreUiService } from '../../services/store-ui.service';
import { CatalogService, EcommerceProduct } from '../../services/catalog.service';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ProductCarouselComponent } from '../../components/product-carousel/product-carousel.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal/product-quick-view-modal.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../shared/pipes/currency';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, QuantityControlComponent, ButtonComponent, ProductCarouselComponent, ProductQuickViewModalComponent, CurrencyPipe],
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
  private checkoutService = inject(CheckoutService);
  private tenantFacade = inject(TenantFacade);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);

  constructor(
    private cart_service: CartService,
    private auth_facade: AuthFacade,
    private router: Router,
    private store_ui_service: StoreUiService,
  ) { }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();

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

  // WhatsApp checkout
  is_whatsapp_loading = false;

  get whatsappEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.whatsapp_checkout;
  }

  whatsappCheckout(): void {
    const config = this.tenantFacade.getCurrentDomainConfig();
    const requiresRegistration = !!config?.customConfig?.ecommerce?.checkout?.require_registration;

    if (requiresRegistration && !this.is_authenticated) {
      this.store_ui_service.openLoginModal();
      return;
    }

    this.is_whatsapp_loading = true;

    // For guests: send localStorage cart items in the request
    const items = !this.is_authenticated
      ? this.cart?.items.map(i => ({
          product_id: i.product_id,
          product_variant_id: i.product_variant_id ?? undefined,
          quantity: i.quantity,
        }))
      : undefined;

    this.checkoutService.whatsappCheckout(undefined, items).pipe(takeUntil(this.destroy$)).subscribe({
      next: (response) => {
        this.is_whatsapp_loading = false;
        // Clear local cart for guests
        if (!this.is_authenticated) {
          this.cart_service.clearAllCart();
        }
        this.openWhatsApp(response.data);
      },
      error: () => {
        this.is_whatsapp_loading = false;
      },
    });
  }

  private openWhatsApp(order: WhatsappCheckoutResponse): void {
    const config = this.tenantFacade.getCurrentDomainConfig();
    const phone = (config?.customConfig?.ecommerce?.checkout?.whatsapp_number || '').replace(/\D/g, '');
    const storeName = config?.customConfig?.branding?.name || 'la tienda';
    const fmt = (v: number) => this.currencyService.format(v);

    const itemLines = order.items.map(i =>
      `  - ${i.name}${i.variant_sku ? ' (' + i.variant_sku + ')' : ''} x${i.quantity} — ${fmt(i.total_price)}`
    ).join('\n');

    const message = encodeURIComponent(
      `Hola! Quiero confirmar mi pedido en *${storeName}* 🛒\n\n` +
      `*Pedido:* ${order.order_number}\n\n` +
      `*Productos:*\n${itemLines}\n\n` +
      `*Total:* ${fmt(Number(order.total))}\n\n` +
      `Quedo atento para coordinar el pago y la entrega!`
    );

    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
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
