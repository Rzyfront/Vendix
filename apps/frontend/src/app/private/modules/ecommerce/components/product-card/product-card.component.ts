import { Component, ChangeDetectionStrategy, inject, input, output } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { EcommerceProduct } from '../../services/catalog.service';
import { TableContextService } from '../../services/table-context.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [RouterModule, IconComponent, CurrencyPipe, ButtonComponent, BadgeComponent],
  template: `
    <article class="product-card" (click)="onCardClick($event)">
      <div class="product-image">
        @if (product().image_url) {
          <img [src]="product().image_url" [alt]="product().name" loading="lazy">
        } @else {
          <div class="no-image">
            <app-icon name="image" [size]="24" class="text-muted"></app-icon>
          </div>
        }

        <!-- Service Badge -->
        @if (product().product_type === 'service') {
          <app-badge class="stock-badge-pos" variant="service" size="sm" badgeStyle="outline">
            Servicio
          </app-badge>
        } @else if (product().track_inventory !== false) {
          <!-- Stock Badge (POS style con backdrop-blur) — Solo para productos con inventario -->
          @if (!hasVariants()) {
            @if (product().available_stock !== null && product().available_stock! <= 5 && product().available_stock! > 0) {
              <app-badge class="stock-badge-pos" variant="warning" size="sm" badgeStyle="outline">
                ¡Últimas {{ product().available_stock }}!
              </app-badge>
            }
            @if (!product().is_available) {
              <app-badge class="stock-badge-pos" variant="error" size="sm" badgeStyle="outline">
                Agotado
              </app-badge>
            }
          }
        } @else {
          <app-badge class="stock-badge-pos" variant="success" size="sm" badgeStyle="outline">
            Disponible
          </app-badge>
        }

        <!-- Variant Badge -->
        @if (show_variants() && product().variant_count && product().variant_count! > 0) {
          <div class="variant-badge">
            {{ product().variant_count }} variantes
          </div>
        }

        <!-- Action buttons column -->
        <div class="card-actions">
          <app-button
            variant="ghost"
            size="sm"
            customClasses="action-btn"
            [class.active]="in_wishlist()"
            (clicked)="onWishlistClick($event)">
            <app-icon slot="icon" name="heart" [size]="18"></app-icon>
          </app-button>
          <app-button
            variant="ghost"
            size="sm"
            customClasses="action-btn"
            (clicked)="onShareClick($event)">
            <app-icon slot="icon" name="share" [size]="18"></app-icon>
          </app-button>
        </div>

        @if (!isUnavailable() && !tableContext.isRequireStaff()) {
          <button
            class="quick-cart-btn"
            type="button"
            [attr.aria-label]="quickActionLabel()"
            [title]="quickActionLabel()"
            (click)="onAddToCart($event)"
          >
            <app-icon [name]="quickActionIcon()" [size]="17"></app-icon>
          </button>
        }
      </div>
      <div class="product-info">
        @if (product().brand) {
          <span class="product-brand">{{ product().brand?.name }}</span>
        }
        <h3 class="product-name">{{ product().name }}</h3>
        @if (product().pricing_type === 'weight') {
          <div class="weight-indicator">
            <app-icon name="scale" [size]="12"></app-icon>
            <span>Venta por peso</span>
          </div>
        }
        @if (product().product_type === 'service') {
          <div class="service-indicators">
            @if (product().service_duration_minutes) {
              <div class="service-indicator">
                <app-icon name="clock" [size]="12"></app-icon>
                <span>{{ product().service_duration_minutes }} min</span>
              </div>
            }
            @if (product().service_modality) {
              <div class="service-indicator">
                <app-icon name="{{ product().service_modality === 'virtual' ? 'monitor' : product().service_modality === 'hybrid' ? 'repeat' : 'map-pin' }}" [size]="12"></app-icon>
                <span>{{ product().service_modality === 'virtual' ? 'Virtual' : product().service_modality === 'hybrid' ? 'Híbrido' : 'Presencial' }}</span>
              </div>
            }
          </div>
        }
        <div class="product-bottom">
          @if (show_shipping_badge()) {
            <div class="shipping-badge">
              <app-icon name="truck" [size]="12"></app-icon>
              <span>Envío disponible</span>
            </div>
          }
          <div class="product-price">
            <span class="price" [class.sale-price]="hasActiveDiscount()">
              {{ displayPrice() | currency }}
            </span>
            @if (product().pricing_type === 'weight') {
              <span class="weight-unit">/kg</span>
            }
            @if (hasActiveDiscount()) {
              <span class="original-price">{{ product().base_price | currency }}</span>
            }
            @if (hasActiveDiscount() || isQuantityTiered()) {
              <span class="discount-badge">{{ promotionBadgeLabel() }}</span>
            }
          </div>
        </div>
      </div>
    </article>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      min-width: 0;
    }

    .product-card {
      position: relative;
      height: 100%;
      background-color: var(--color-surface);
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      overflow: hidden;
      cursor: pointer;
      transition:
        border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      gap: 0;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
      -webkit-tap-highlight-color: transparent;

      &:hover,
      &:focus-within {
        background-color: var(--color-background);
        box-shadow: 0 18px 38px -28px rgba(15, 23, 42, 0.5);
        transform: translateY(-2px);
        border-color: rgba(148, 163, 184, 0.34);
      }

      &:active {
        transform: scale(0.97);
      }

      @media (hover: hover) {
        &:hover {
          transform: translateY(-2px);
        }
        &:active {
          transform: scale(0.98);
        }
      }
    }

    .product-image {
      position: relative;
      aspect-ratio: 1;
      background: var(--color-background);
      overflow: hidden;
      border-radius: 0;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        transition: transform 0.35s ease;
      }

      .no-image {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        background: var(--color-background);
        font-size: 3rem;
      }
    }

    .quick-cart-btn {
      position: absolute;
      right: 0.6rem;
      bottom: 0.6rem;
      z-index: 2;
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 999px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 10px 22px -18px rgba(15, 23, 42, 0.42);
      cursor: pointer;
      opacity: 0;
      transform: translateY(4px);
      transition:
        opacity 0.15s ease,
        background-color 0.15s ease,
        border-color 0.15s ease,
        color 0.15s ease,
        transform 0.15s ease;

      &:hover {
        color: var(--color-primary);
        background: #ffffff;
        border-color: rgba(var(--color-primary-rgb, 59, 130, 246), 0.32);
        transform: translateY(-1px) scale(1.02);
      }

      &:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.42);
        outline-offset: 2px;
      }
    }

    .product-card:hover .product-image img {
      transform: scale(1.025);
    }

    .product-card:hover .quick-cart-btn,
    .quick-cart-btn:focus-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .stock-badge-pos {
      position: absolute;
      top: 0.55rem;
      left: 0.55rem;
      z-index: 1;
    }

    .variant-badge {
      position: absolute;
      bottom: 0.58rem;
      left: 0.58rem;
      padding: 0.24rem 0.48rem;
      border-radius: 999px;
      font-size: 10px;
      font-weight: var(--fw-semibold);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      background: rgba(255, 255, 255, 0.88);
      color: var(--color-text-primary);
      border: 1px solid rgba(148, 163, 184, 0.24);
      z-index: 1;
    }

    .card-actions {
      position: absolute;
      top: 0.55rem;
      right: 0.55rem;
      display: flex;
      flex-direction: column;
      gap: 0.38rem;
      z-index: 1;
      opacity: 0;
      transform: translateY(-4px);
      transition: opacity var(--transition-fast), transform var(--transition-fast);
    }

    .product-card:hover .card-actions,
    .card-actions:focus-within {
      opacity: 1;
      transform: translateY(0);
    }

    :host ::ng-deep .action-btn {
      width: 34px !important;
      height: 34px !important;
      min-width: 34px !important;
      padding: 0 !important;
      border-radius: 50% !important;
      color: var(--color-text-secondary) !important;
      background: rgba(255, 255, 255, 0.88) !important;
      border: 1px solid rgba(148, 163, 184, 0.22) !important;
      box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);

      &:hover {
        background: #ffffff !important;
        color: var(--color-primary) !important;
      }

      &.active {
        color: var(--color-error) !important;
        background: var(--color-error-light) !important;
      }
    }

    .product-info {
      padding: 0.82rem 0.85rem 0.9rem;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.24rem;
    }

    .product-brand {
      font-size: var(--fs-xs);
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0;
      font-weight: var(--fw-semibold);
    }

    .product-name {
      font-size: var(--fs-sm);
      font-weight: 700;
      color: var(--color-text-primary);
      margin: 0;
      line-height: 1.28;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-bottom {
      margin-top: auto;
      padding-top: 0.28rem;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.14rem;
    }

    .product-price {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;

      .price {
        font-size: var(--fs-md);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);

        &.sale-price {
          color: var(--color-success);
        }
      }

      .original-price {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        text-decoration: line-through;
      }

      .discount-badge {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0.12rem 0.36rem;
        border-radius: 999px;
        background: var(--color-success-light);
        color: var(--color-success);
        font-size: 10px;
        font-weight: var(--fw-bold);
        line-height: 1;
        white-space: nowrap;
      }

      .weight-unit {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        font-weight: var(--fw-medium);
      }
    }

    .weight-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.5rem;
      border-radius: var(--radius-sm);
      background: rgba(59, 130, 246, 0.08);
      color: rgb(37, 99, 235);
      font-size: 11px;
      font-weight: 500;
    }

    .shipping-badge {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      gap: 0.25rem;
      max-width: 100%;
      padding: 0.18rem 0.46rem;
      border-radius: 999px;
      background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.08);
      color: var(--color-primary);
      font-size: 10.5px;
      font-weight: var(--fw-semibold);
      line-height: 1.1;

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .service-indicators {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .service-indicator {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.5rem;
      border-radius: var(--radius-sm);
      background: rgba(139, 92, 246, 0.08);
      color: rgb(109, 40, 217);
      font-size: 11px;
      font-weight: 500;
    }

    /* Mobile compact styles */
    @media (max-width: 480px) {
      .product-card {
        border-radius: 8px;
      }

      .variant-badge {
        padding: 0.15rem 0.35rem;
        font-size: 10px;
      }

      .card-actions {
        top: 0.45rem;
        right: 0.45rem;
        gap: 0.3rem;
        opacity: 1;
        transform: none;
      }

      :host ::ng-deep .action-btn {
        width: 34px !important;
        height: 34px !important;
        min-width: 34px !important;

        app-icon {
          font-size: 14px;
        }
      }

      .product-info {
        padding: 0.65rem 0.65rem 0.7rem;
        gap: 0.16rem;
      }

      .product-brand {
        font-size: 10px;
      }

      .product-name {
        font-size: 13px;
        -webkit-line-clamp: 2;
      }

      .product-price .price {
        font-size: var(--fs-sm);
      }

      .quick-cart-btn {
        width: 34px !important;
        height: 34px !important;
        opacity: 1;
        transform: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .product-card,
      .product-image img,
      .quick-cart-btn,
      .card-actions {
        transition: none;
      }
    }
  `],
})
export class ProductCardComponent {
  readonly product = input.required<EcommerceProduct>();
  readonly show_variants = input<boolean>(true);
  readonly show_shipping_badge = input<boolean>(false);
  readonly in_wishlist = input<boolean>(false);
  readonly add_to_cart = output<EcommerceProduct>();
  readonly toggle_wishlist = output<EcommerceProduct>();
  readonly quick_view = output<EcommerceProduct>();
  readonly share = output<EcommerceProduct>();

  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);
  public readonly tableContext = inject(TableContextService);
  private toastService = inject(ToastService);

  constructor() {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();
  }

  hasVariants(): boolean {
    return !!this.product().variant_count && this.product().variant_count! > 0;
  }

  hasActiveDiscount(): boolean {
    const product = this.product();
    const basePrice = Number(product.base_price) || 0;
    const promoPrice = this.promoPrice();

    // An active backend-resolved promotion ALWAYS wins, regardless of the
    // legacy `is_on_sale` flag. Without a promotion we still honour the
    // existing sale_price flow.
    if (product.active_promotion) {
      return basePrice > 0 && promoPrice > 0 && promoPrice < basePrice;
    }

    if (!product.is_on_sale) return false;
    return basePrice > 0 && promoPrice > 0 && promoPrice < basePrice;
  }

  /**
   * True when the active promotion is quantity-tiered. These promotions have
   * no single-unit discount (`promotional_price === unit price`), so
   * `hasActiveDiscount()` returns false and the price stays normal — but we
   * still want to surface the informative badge (e.g. "Desde 3 und:
   * descuento").
   */
  isQuantityTiered(): boolean {
    return this.product().active_promotion?.is_quantity_tiered === true;
  }

  discountPercentage(): number {
    const product = this.product();

    // Prefer the engine-provided percentage when the promotion is
    // percentage-typed; otherwise compute from prices for parity with the
    // sale_price path.
    if (
      product.active_promotion?.type === 'percentage' &&
      product.active_promotion.discount_percentage !== undefined
    ) {
      return Math.round(
        Number(product.active_promotion.discount_percentage) || 0,
      );
    }

    const basePrice = Number(product.base_price) || 0;
    const promoPrice = this.promoPrice();

    if (basePrice <= 0 || promoPrice <= 0 || promoPrice >= basePrice) return 0;

    return Math.round(((basePrice - promoPrice) / basePrice) * 100);
  }

  promotionBadgeLabel(): string {
    const promo = this.product().active_promotion;
    return promo?.badge_label ?? `-${this.discountPercentage()}% OFF`;
  }

  /**
   * Price shown front-and-center on the card. Falls back to the existing
   * `final_price` (already tax-inclusive) when there is no promotional
   * override so non-discounted products keep their previous layout.
   */
  displayPrice(): number {
    const product = this.product();
    const promo = product.active_promotion;
    const promoPrice = promo ? Number(promo.promotional_price) : NaN;
    if (Number.isFinite(promoPrice) && promoPrice > 0) {
      return promoPrice;
    }

    // sale_price path retained for backward compatibility — only when the
    // backend marks the product on sale and the sale price is lower.
    const salePrice = Number(product.sale_price) || 0;
    const basePrice = Number(product.base_price) || 0;
    if (product.is_on_sale && salePrice > 0 && salePrice < basePrice) {
      return Number(product.final_price);
    }

    return Number(product.final_price) || 0;
  }

  private promoPrice(): number {
    const product = this.product();

    // Backend-resolved promotion takes priority for the displayed final price.
    const promotionalPrice = Number(product.active_promotion?.promotional_price);
    if (Number.isFinite(promotionalPrice) && promotionalPrice > 0) {
      return promotionalPrice;
    }

    const salePrice = Number(product.sale_price) || 0;
    const finalPrice = Number(product.final_price) || 0;

    if (salePrice > 0) return salePrice;
    return finalPrice;
  }

  onCardClick(event: Event): void {
    // Let clicks on buttons/links propagate normally to their handlers
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) {
      return;
    }
    event.preventDefault();
    this.router.navigate(['/products', this.product().slug]);
  }

  onBuyNow(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.product().requires_booking && this.product().product_type === 'service') {
      this.router.navigate(['/book', this.product().id]);
      return;
    }
    if (this.hasVariants()) {
      this.router.navigate(['/products', this.product().slug]);
      return;
    }
    this.add_to_cart.emit(this.product());
    this.router.navigate(['/cart']);
  }

  onAddToCart(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.product().requires_booking && this.product().product_type === 'service') {
      this.router.navigate(['/book', this.product().id]);
      return;
    }
    if (this.hasVariants()) {
      this.router.navigate(['/products', this.product().slug]);
      return;
    }
    // QR table — open_tab: send item directly to the table's running order
    // instead of adding to the regular cart. No payment here (bill settles
    // at the table at the end).
    if (this.tableContext.isOpenTab()) {
      this.tableContext
        .addOrder([{ product_id: this.product().id, quantity: 1 }])
        .subscribe({
          next: (res) => {
            if (res.success) {
              const msg = res.data.fired
                ? `Agregado a la mesa ${this.tableContext.tableName()} — enviado a cocina`
                : `Agregado a la mesa ${this.tableContext.tableName()}`;
              this.toastService.success(msg);
            }
          },
          error: () => {
            this.toastService.error('No se pudo agregar a la cuenta de la mesa');
          },
        });
      return;
    }
    this.add_to_cart.emit(this.product());
  }

  isUnavailable(): boolean {
    const product = this.product();
    if (product.product_type === 'service') return false;
    if (product.track_inventory === false) return false;

    const variants = product.variants;
    if (variants && variants.length > 0) {
      return variants.every((v) => v.is_available === false);
    }

    return product.is_available === false;
  }

  quickActionIcon(): string {
    if (this.product().requires_booking && this.product().product_type === 'service') {
      return 'calendar-check';
    }
    if (this.hasVariants()) return 'eye';
    // QR table open_tab → cuenta icon
    if (this.tableContext.isOpenTab()) return 'concierge-bell';
    return 'shopping-cart';
  }

  quickActionLabel(): string {
    if (this.product().requires_booking && this.product().product_type === 'service') {
      return 'Agendar';
    }
    if (this.hasVariants()) return 'Ver opciones';
    // QR table open_tab → cuenta label
    if (this.tableContext.isOpenTab()) return 'Agregar a mi cuenta';
    return 'Agregar al carrito';
  }

  onWishlistClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.toggle_wishlist.emit(this.product());
  }

  onShareClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.share.emit(this.product());
  }
}
