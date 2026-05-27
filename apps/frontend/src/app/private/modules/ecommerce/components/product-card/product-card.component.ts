import { Component, ChangeDetectionStrategy, inject, input, output } from '@angular/core';
import { RouterModule, Router } from '@angular/router';
import { EcommerceProduct } from '../../services/catalog.service';
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
          @if (product().stock_quantity !== null && product().stock_quantity! <= 5 && product().stock_quantity! > 0) {
            <app-badge class="stock-badge-pos" variant="warning" size="sm" badgeStyle="outline">
              ¡Últimas {{ product().stock_quantity }}!
            </app-badge>
          }
          @if (product().stock_quantity === 0) {
            <app-badge class="stock-badge-pos" variant="error" size="sm" badgeStyle="outline">
              Agotado
            </app-badge>
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

        @if (!isUnavailable()) {
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
        <div class="product-price">
          <span class="price">{{ product().final_price | currency }}</span>
          @if (product().pricing_type === 'weight') {
            <span class="weight-unit">/kg</span>
          }
          @if (product().is_on_sale) {
            <span class="original-price">{{ product().base_price | currency }}</span>
          }
        </div>
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
      </div>
    </article>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    .product-card {
      position: relative;
      height: 100%;
      background-color: transparent;
      border-radius: 8px;
      border: 1px solid transparent;
      overflow: visible;
      cursor: pointer;
      transition:
        border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1),
        transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      gap: 0.72rem;
      -webkit-tap-highlight-color: transparent;

      &:hover,
      &:focus-within {
        background-color: var(--color-background);
        box-shadow: 0 22px 44px -36px rgba(15, 23, 42, 0.55);
        transform: translateY(-2px);
        border-color: rgba(148, 163, 184, 0.28);
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
      background: var(--color-surface);
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid rgba(148, 163, 184, 0.16);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);

      img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        object-position: center;
        padding: 0.72rem;
        transition: transform 0.35s ease;
      }

      .no-image {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        background: var(--color-surface);
        font-size: 3rem;
      }
    }

    .quick-cart-btn {
      position: absolute;
      right: 0.55rem;
      bottom: 0.55rem;
      z-index: 2;
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--color-text-primary);
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 999px;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 8px 20px -18px rgba(15, 23, 42, 0.4);
      cursor: pointer;
      opacity: 1;
      transition:
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
      padding: 0 0.16rem 0.16rem;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.28rem;
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
      line-height: 1.3;
      min-height: 2.6em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-price {
      margin-top: 0.35rem;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.35rem;

      .price {
        font-size: var(--fs-base);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }

      .original-price {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        text-decoration: line-through;
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
        gap: 0.5rem;
      }

      .product-image img {
        padding: 0.55rem;
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
        padding: 0 0.1rem 0.05rem;
        gap: 0.15rem;
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
        width: 36px !important;
        height: 36px !important;
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
  readonly in_wishlist = input<boolean>(false);
  readonly add_to_cart = output<EcommerceProduct>();
  readonly toggle_wishlist = output<EcommerceProduct>();
  readonly quick_view = output<EcommerceProduct>();
  readonly share = output<EcommerceProduct>();

  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();
  }

  private get hasVariants(): boolean {
    return !!this.product().variant_count && this.product().variant_count! > 0;
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
    if (this.hasVariants) {
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
    if (this.hasVariants) {
      this.router.navigate(['/products', this.product().slug]);
      return;
    }
    this.add_to_cart.emit(this.product());
  }

  isUnavailable(): boolean {
    return (
      this.product().product_type !== 'service' &&
      this.product().track_inventory !== false &&
      this.product().stock_quantity === 0
    );
  }

  quickActionIcon(): string {
    if (this.product().requires_booking && this.product().product_type === 'service') {
      return 'calendar-check';
    }
    if (this.hasVariants) return 'eye';
    return 'shopping-cart';
  }

  quickActionLabel(): string {
    if (this.product().requires_booking && this.product().product_type === 'service') {
      return 'Agendar';
    }
    if (this.hasVariants) return 'Ver opciones';
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
