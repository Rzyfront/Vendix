import { Component, OnInit, DestroyRef, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
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
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, QuantityControlComponent, ButtonComponent, ProductCarouselComponent, ProductQuickViewModalComponent, CurrencyPipe],
  templateUrl: './cart.component.html',
  styleUrls: ['./cart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartComponent implements OnInit {
  readonly cart = signal<Cart | null>(null);
  readonly is_loading = signal(true);
  readonly is_authenticated = signal(false);
  readonly updating_item_id = signal<number | null>(null);

  // Recommendations
  recommendedProducts = signal<EcommerceProduct[]>([]);
  readonly quickViewOpen = signal(false);
  readonly selectedProductSlug = signal<string | null>(null);

  readonly is_whatsapp_loading = signal(false);

  whatsappEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.whatsapp_checkout;
  }

  private catalogService = inject(CatalogService);
  private checkoutService = inject(CheckoutService);
  private tenantFacade = inject(TenantFacade);
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private toast = inject(ToastService);

  constructor(
    private cart_service: CartService,
    private auth_facade: AuthFacade,
    private router: Router,
    private store_ui_service: StoreUiService,
  ) { }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();

    this.auth_facade.isAuthenticated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((is_auth: boolean) => {
      this.is_authenticated.set(is_auth);
      if (is_auth) {
        this.loadCart();
      } else {
        this.loadLocalCart();
      }
    });

    this.loadRecommendations();
  }

  private extractErrorMessage(err: any): string {
    const msg = err?.error?.message;
    if (typeof msg === 'string') return msg;
    if (msg?.message) return msg.message;
    return 'Ocurrió un error inesperado';
  }

  loadCart(): void {
    this.is_loading.set(true);
    this.cart_service.getCart().subscribe({
      next: () => {
        this.is_loading.set(false);
      },
      error: (err) => {
        this.is_loading.set(false);
        this.toast.error('No pudimos cargar tu carrito. Intenta de nuevo.', 'Error');
      },
    });

    this.cart_service.cart$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cart) => {
      this.cart.set(cart);
    });
  }

  loadLocalCart(): void {
    this.cart_service.cart$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((cart) => {
      this.cart.set(cart);
      this.is_loading.set(false);
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

    this.updating_item_id.set(item.id);

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
        next: () => { this.updating_item_id.set(null); },
        error: (err: any) => {
          this.updating_item_id.set(null);
          this.toast.error(this.extractErrorMessage(err), 'Error al actualizar');
        },
      });
    } else {
      this.updating_item_id.set(null);
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
    if (!this.is_authenticated()) {
      this.store_ui_service.openLoginModal();
    } else {
      this.router.navigate(['/checkout']);
    }
  }

  continueShopping(): void {
    this.router.navigate(['/catalog']);
  }

  whatsappCheckout(): void {
    const config = this.tenantFacade.getCurrentDomainConfig();
    const requiresRegistration = !!config?.customConfig?.ecommerce?.checkout?.require_registration;

    if (requiresRegistration && !this.is_authenticated()) {
      this.store_ui_service.openLoginModal();
      return;
    }

    this.is_whatsapp_loading.set(true);

    // Always send items from frontend cart (localStorage) so the backend
    // can fallback to them if the backend cart is empty (e.g. user logged
    // in after adding items as guest and cart wasn't synced)
    const items = this.cart()?.items.map(i => ({
      product_id: i.product_id,
      product_variant_id: i.product_variant_id ?? undefined,
      quantity: i.quantity,
    }));

    this.checkoutService.whatsappCheckout(undefined, items).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.is_whatsapp_loading.set(false);
        // Clear local cart for guests
        if (!this.is_authenticated()) {
          this.cart_service.clearAllCart();
        }
        this.openWhatsApp(response.data);
      },
      error: (err: any) => {
        this.is_whatsapp_loading.set(false);
        const msg = this.extractErrorMessage(err);
        this.toast.error(msg, 'No se pudo procesar tu pedido');
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

    const customer = order.customer;
    const customerName = customer ? `${customer.first_name} ${customer.last_name}`.trim() : '';

    let message: string;

    if (customerName) {
      // Authenticated user with profile data
      let contactLines = '';
      if (customer!.phone) {
        contactLines += `\n*Teléfono:* ${customer!.phone}`;
      }
      if (customer!.address) {
        const addr = customer!.address;
        const parts = [addr.address_line1, addr.address_line2, addr.city, addr.state_province].filter(Boolean);
        contactLines += `\n*Dirección de envío:* ${parts.join(', ')}`;
      }

      message = encodeURIComponent(
        `Hola, soy *${customerName}*! Quiero confirmar mi pedido en *${storeName}* 🛒\n\n` +
        `*Pedido:* ${order.order_number}\n\n` +
        `*Productos:*\n${itemLines}\n\n` +
        `*Total:* ${fmt(Number(order.total))}` +
        (contactLines ? `\n${contactLines}` : '') +
        `\n\nQuedo atento para coordinar!`
      );
    } else {
      // Guest or user without name — generic message
      message = encodeURIComponent(
        `Hola! Quiero confirmar mi pedido en *${storeName}* 🛒\n\n` +
        `*Pedido:* ${order.order_number}\n\n` +
        `*Productos:*\n${itemLines}\n\n` +
        `*Total:* ${fmt(Number(order.total))}\n\n` +
        `Quedo atento para coordinar el pago y la entrega!`
      );
    }

    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  onAddToCartFromSlider(product: EcommerceProduct): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) result.subscribe();
  }
}
