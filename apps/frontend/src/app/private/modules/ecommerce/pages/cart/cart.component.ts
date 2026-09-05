import {
  Component,
  OnInit,
  DestroyRef,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { cartLineKey } from '../../utils/cart-line-key.util';
import { TableContextService } from '../../services/table-context.service';
import { AuthFacade } from '../../../../../core/store';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { StoreUiService } from '../../services/store-ui.service';
import { StoreSettingsService } from '../../../store/settings/general/services/store-settings.service';
import {
  CatalogService,
  EcommerceProduct,
} from '../../services/catalog.service';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ProductCarouselComponent } from '../../components/product-carousel/product-carousel.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal/product-quick-view-modal.component';
import { CartPromotionsComponent } from '../../components/cart-promotions/cart-promotions.component';
import { CartItemCardComponent } from '../../components/cart-item-card/cart-item-card.component';
import { CartMobileFooterComponent } from '../../components/cart-mobile-footer/cart-mobile-footer.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IconComponent,
    ButtonComponent,
    ProductCarouselComponent,
    ProductQuickViewModalComponent,
    CartPromotionsComponent,
    CartItemCardComponent,
    CartMobileFooterComponent,
    CurrencyPipe,
  ],
  templateUrl: './cart.component.html',
  styleUrls: ['./cart.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartComponent implements OnInit {
  readonly cart = signal<Cart | null>(null);
  readonly is_loading = signal(true);

  readonly is_authenticated = signal(false);
  /**
   * Línea ocupada por una mutación en curso, identificada por su `line_key`.
   *
   * Antes era el `id` numérico, pero en el carrito invitado `id` vale
   * `product_id`: con dos presentaciones del mismo producto ambas filas se
   * marcaban "actualizando" a la vez (y el `@for` lanzaba NG0955 por claves
   * duplicadas).
   */
  readonly updating_line_key = signal<string | null>(null);

  // Recommendations
  recommendedProducts = signal<EcommerceProduct[]>([]);
  readonly quickViewOpen = signal(false);
  readonly selectedProductSlug = signal<string | null>(null);

  // `is_whatsapp_loading` eliminado en CP-tienda-checkout-whatsapp: ya no hay
  // POST directo a /whatsapp desde el cart (ver `finalizeViaWhatsApp`).

  whatsappEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.whatsapp_checkout;
  }

  requiresRegistration(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.require_registration;
  }

  relatedProductsEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return (
      config?.customConfig?.ecommerce?.catalog?.show_related_products === true
    );
  }

  maxQuantityPerItem(): number | null {
    return this.cart_service.getMaxQuantityPerItem();
  }

  private catalogService = inject(CatalogService);
  private tenantFacade = inject(TenantFacade);
  private destroyRef = inject(DestroyRef);
  // QR dine-in (Step 8): slider must NOT re-add in mesa-mode — the
  // originating product-card has already routed via the mesa chokepoint.
  private tableContext = inject(TableContextService);
  private currencyService = inject(CurrencyFormatService);
  private toast = inject(ToastService);
  private storeSettingsService = inject(StoreSettingsService);

  /**
   * Toggle "Experiencia de Alta Conversión (Visualización Promocional)"
   * leído de settings.promotions.enable_high_conversion_ui.
   * Default `true` mientras el endpoint no responda o el campo esté ausente
   * (back-compat con stores que aún no tienen la sección promotions).
   */
  readonly highConversionEnabled = signal<boolean>(true);

  constructor(
    private cart_service: CartService,
    private auth_facade: AuthFacade,
    private router: Router,
    private store_ui_service: StoreUiService,
  ) {}

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();

    // Leer el toggle de badges dinámicos desde settings.promotions
    // forceRefresh: true para que un cambio en admin (toggle ON/OFF) se refleje
    // inmediatamente al recargar el cart, sin esperar al TTL del cache (60s).
    this.storeSettingsService
      .getSettings({ forceRefresh: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const enabled = response?.data?.promotions?.enable_high_conversion_ui;
          // eslint-disable-next-line no-console
          console.log('[CART-DEBUG] enable_high_conversion_ui:', enabled, '→ set signal to:', enabled);
          if (enabled !== undefined) {
            this.highConversionEnabled.set(enabled);
          }
        },
        error: () => {
          // Silenciar — default true ya está seteado
        },
      });

    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((is_auth: boolean) => {
        this.is_authenticated.set(is_auth);
        if (is_auth) {
          this.loadCart();
        } else {
          this.loadLocalCart();
        }
      });

    if (this.relatedProductsEnabled()) {
      this.loadRecommendations();
    }
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
        this.toast.error(
          'No pudimos cargar tu carrito. Intenta de nuevo.',
          'Error',
        );
      },
    });

    this.cart_service.cart$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cart) => {
        this.cart.set(cart);
      });
  }

  loadLocalCart(): void {
    this.cart_service.cart$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cart) => {
        this.cart.set(cart);
        this.is_loading.set(false);
      });
  }

  loadRecommendations(): void {
    this.catalogService
      .getProducts({ limit: 10, sort_by: 'newest', has_discount: true })
      .subscribe({
        next: (response) => {
          if (response.data.length > 0) {
            this.recommendedProducts.set(response.data);
          } else {
            // Fallback if no sales
            this.catalogService
              .getProducts({ limit: 10, sort_by: 'newest' })
              .subscribe((res) => {
                this.recommendedProducts.set(res.data);
              });
          }
        },
      });
  }

  updateQuantity(item: CartItem, new_quantity: number): void {
    if (new_quantity <= 0) {
      this.removeItem(item);
      return;
    }

    if (new_quantity === item.quantity) return;
    const maxQuantity = this.maxQuantityPerItem();
    if (maxQuantity && new_quantity > maxQuantity) {
      this.toast.warning(
        `Puedes agregar máximo ${maxQuantity} unidades por producto.`,
      );
      return;
    }

    this.updating_line_key.set(this.lineKey(item));

    const result = this.cart_service.updateCartItem(
      {
        item_id: item.id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || undefined,
        price_tier_id: item.price_tier?.id,
      },
      new_quantity,
    );

    if (result) {
      result.subscribe({
        next: () => {
          this.updating_line_key.set(null);
        },
        error: (err: any) => {
          this.updating_line_key.set(null);
          this.toast.error(
            this.extractErrorMessage(err),
            'Error al actualizar',
          );
        },
      });
    } else {
      this.updating_line_key.set(null);
    }
  }

  /**
   * Identidad de la línea. `CartService` ya la rellena en `line_key`; el
   * fallback recalcula por si llegara un payload construido fuera del
   * servicio, para que el `track` del `@for` nunca reciba `undefined`.
   */
  lineKey(item: CartItem): string {
    return (
      item.line_key ??
      cartLineKey(
        item.product_id,
        item.product_variant_id,
        item.price_tier?.id ?? null,
      )
    );
  }

  removeItem(item: CartItem): void {
    const result = this.cart_service.removeCartItem({
      item_id: item.id,
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined,
      price_tier_id: item.price_tier?.id,
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
    if (!this.is_authenticated() && this.requiresRegistration()) {
      this.store_ui_service.openLoginModal();
    } else {
      this.router.navigate(['/checkout']);
    }
  }

  continueShopping(): void {
    this.router.navigate(['/catalog']);
  }

  /**
   * CP-tienda-checkout-whatsapp (anotación 2): "Finalizar por WhatsApp" YA NO
   * crea la orden aquí. Navega al checkout con `?channel=whatsapp`, que
   * recorre EXACTAMENTE el mismo flujo que "Finalizar compra" (entrega,
   * dirección, pago) y al finalizar muestra el resumen + abre el WhatsApp de
   * la tienda con el automensaje. El endpoint legacy `POST /whatsapp` queda
   * solo por compatibilidad y el storefront no lo llama.
   */
  finalizeViaWhatsApp(): void {
    if (this.requiresRegistration() && !this.is_authenticated()) {
      this.store_ui_service.openLoginModal();
      return;
    }
    this.router.navigate(['/checkout'], {
      queryParams: { channel: 'whatsapp' },
    });
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  /**
   * Reacción POSTERIOR a una adición que YA ocurrió. NO agrega nada.
   *
   * Este handler cuelga de DOS fuentes y ambas agregan por su cuenta antes de
   * emitir, así que volver a llamar `addProduct` duplicaba la línea:
   *
   *  1. `(add_to_cart)` del `app-product-card` dentro del carrusel: la card ya
   *     llamó `cartService.addProduct(id, qtyToAdd())` (chokepoint D3).
   *  2. `(addedToCart)` del `app-product-quick-view-modal`: el modal ya llamó
   *     `addProduct(id, quantity(), variantId, variantInfo)`. Aquí era peor que
   *     una simple duplicación — el segundo `addProduct(product.id, 1)` perdía
   *     la variante elegida y la cantidad, creando una línea espuria del
   *     producto base. Home y catálogo ya lo resolvían bien con un handler
   *     aparte (`onModalAddedToCart`, que solo cierra el modal).
   *
   * El guard `tableContext.isActive()` solo cubría mesa QR, de modo que en
   * tienda normal la duplicación nunca estuvo protegida.
   *
   * La página se refresca sola: lee `cart_service.cart$`, que la adición del
   * chokepoint ya actualiza. NO restaurar `addProduct` aquí.
   */
  onAddToCartFromSlider(_product: EcommerceProduct): void {
    // Sin efectos por ahora: la adición ya ocurrió en la card o en el modal.
  }
}
