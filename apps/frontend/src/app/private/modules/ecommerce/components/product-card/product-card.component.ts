import { Component, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { EcommerceProduct } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyPipe, ButtonComponent],
  template: `
    <article class="product-card" (click)="onQuickView($event)">
      <div class="product-image">
        @if (product.image_url) {
          <img [src]="product.image_url" [alt]="product.name" loading="lazy">
        } @else {
          <div class="no-image">
            <app-icon name="image" [size]="24" class="text-muted"></app-icon>
          </div>
        }

        <!-- Stock Badge (POS style con backdrop-blur) — Solo para productos con inventario -->
        @if (product.track_inventory !== false) {
          @if (product.stock_quantity !== null && product.stock_quantity <= 5 && product.stock_quantity > 0) {
            <div class="stock-badge stock-badge--warning">
              ¡Últimas {{ product.stock_quantity }}!
            </div>
          }
          @if (product.stock_quantity === 0) {
            <div class="stock-badge stock-badge--error">
              Agotado
            </div>
          }
        } @else {
          <div class="stock-badge stock-badge--on-demand">
            Bajo pedido
          </div>
        }

        <!-- Variant Badge -->
        @if (product.variant_count && product.variant_count > 0) {
          <div class="variant-badge">
            {{ product.variant_count }} variantes
          </div>
        }

        <!-- Action buttons column -->
        <div class="card-actions">
          <app-button
            variant="ghost"
            size="sm"
            customClasses="action-btn"
            [class.active]="in_wishlist"
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
      </div>
      <div class="product-info">
        @if (product.brand) {
          <span class="product-brand">{{ product.brand.name }}</span>
        }
        <h3 class="product-name">{{ product.name }}</h3>
        <div class="product-price">
          <span class="price">{{ product.final_price | currency }}</span>
          @if (product.is_on_sale) {
            <span class="original-price">{{ product.base_price | currency }}</span>
          }
        </div>
      </div>
      <div class="actions-container">
        <app-button
          variant="primary"
          size="sm"
          customClasses="buy-btn"
          [disabled]="product.track_inventory !== false && product.stock_quantity === 0"
          (clicked)="onBuyNow($event)">
          Comprar
        </app-button>
        <app-button
          variant="secondary"
          size="sm"
          customClasses="add-to-cart-btn"
          [disabled]="product.track_inventory !== false && product.stock_quantity === 0"
          title="Agregar al carrito"
          (clicked)="onAddToCart($event)">
          <app-icon slot="icon" name="shopping-cart" [size]="16"></app-icon>
        </app-button>
      </div>
    </article>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
    }

    /* iOS-style Product Card */
    .product-card {
      background: var(--color-surface);
      border-radius: 1rem;
      border: 1px solid var(--color-border);
      overflow: hidden;
      cursor: pointer;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      flex-direction: column;
      -webkit-tap-highlight-color: transparent;

      &:hover {
        box-shadow: 0 8px 25px -8px rgba(0, 0, 0, 0.15);
        transform: translateY(-2px);
        border-color: var(--color-primary);
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

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .no-image {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
        font-size: 3rem;
      }
    }

    /* Stock Badge con backdrop-blur (POS style) */
    .stock-badge {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-md);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid;
      z-index: 1;

      &--warning {
        background: rgba(251, 146, 60, 0.8);
        color: white;
        border-color: rgba(251, 146, 60, 0.6);
      }

      &--error {
        background: rgba(239, 68, 68, 0.8);
        color: white;
        border-color: rgba(239, 68, 68, 0.6);
      }

      &--on-demand {
        background: rgba(14, 165, 233, 0.8);
        color: white;
        border-color: rgba(14, 165, 233, 0.6);
      }
    }

    /* Variant Badge */
    .variant-badge {
      position: absolute;
      bottom: 0.5rem;
      left: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-md);
      font-size: var(--fs-xs);
      font-weight: var(--fw-semibold);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.8);
      color: white;
      border: 1px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.6);
      z-index: 1;
    }

    /* Card action buttons column */
    .card-actions {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      z-index: 1;
    }

    /* Circular action buttons */
    :host ::ng-deep .action-btn {
      width: 36px !important;
      height: 36px !important;
      min-width: 36px !important;
      padding: 0 !important;
      border-radius: 50% !important;
      background: var(--color-surface) !important;
      box-shadow: var(--shadow-sm);

      &:hover {
        background: var(--color-background) !important;
      }

      &.active {
        color: var(--color-error) !important;
        background: var(--color-error-light) !important;
      }
    }

    .product-info {
      padding: 1rem;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .product-brand {
      font-size: var(--fs-xs);
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .product-name {
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
      color: var(--color-text-primary);
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .product-price {
      margin-top: 0.5rem;
      display: flex;
      align-items: baseline;
      gap: 0.5rem;

      .price {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }

      .original-price {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        text-decoration: line-through;
      }
    }

    .actions-container {
      margin: 0 1rem 1rem;
      display: flex;
      gap: 0.5rem;

      /* Botón Comprar (primer app-button) - ocupa todo el espacio */
      app-button:first-child {
        flex: 1;
        min-width: 0;
      }

      /* Botón Carrito (segundo app-button) - cuadrado fijo */
      app-button:last-child {
        flex-shrink: 0;
      }
    }

    /* Botón Comprar - misma altura que carrito */
    :host ::ng-deep .buy-btn {
      width: 100% !important;
      height: 32px !important;

      @media (min-width: 640px) {
        height: 36px !important;
      }
    }

    /* Botón Carrito - cuadrado simétrico */
    :host ::ng-deep .add-to-cart-btn {
      width: 32px !important;
      min-width: 32px !important;
      height: 32px !important;
      padding: 0 !important;

      @media (min-width: 640px) {
        width: 36px !important;
        min-width: 36px !important;
        height: 36px !important;
      }
    }

    /* Mobile compact styles */
    @media (max-width: 480px) {
      .product-card {
        border-radius: 0.75rem;
      }

      .stock-badge,
      .variant-badge {
        padding: 0.15rem 0.35rem;
        font-size: 10px;
      }

      .card-actions {
        top: 0.4rem;
        right: 0.4rem;
        gap: 0.3rem;
      }

      :host ::ng-deep .action-btn {
        width: 28px !important;
        height: 28px !important;
        min-width: 28px !important;

        app-icon {
          font-size: 14px;
        }
      }

      .product-info {
        padding: 0.5rem 0.6rem;
        gap: 0.15rem;
      }

      .product-brand {
        font-size: 10px;
      }

      .product-name {
        font-size: 12px;
        -webkit-line-clamp: 1;
      }

      .product-price .price {
        font-size: var(--fs-sm);
      }

      .actions-container {
        margin: 0 0.5rem 0.5rem;
        gap: 0.35rem;
      }

      :host ::ng-deep .buy-btn {
        height: 28px !important;
      }

      :host ::ng-deep .add-to-cart-btn {
        width: 28px !important;
        min-width: 28px !important;
        height: 28px !important;
      }
    }
  `],
})
export class ProductCardComponent implements OnInit {
  @Input() product!: EcommerceProduct;
  @Input() in_wishlist = false;
  @Output() add_to_cart = new EventEmitter<EcommerceProduct>();
  @Output() toggle_wishlist = new EventEmitter<EcommerceProduct>();
  @Output() quick_view = new EventEmitter<EcommerceProduct>();
  @Output() share = new EventEmitter<EcommerceProduct>();

  private router = inject(Router);
  private currencyService = inject(CurrencyFormatService);

  private get hasVariants(): boolean {
    return !!this.product.variant_count && this.product.variant_count > 0;
  }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();
  }

  onQuickView(event: Event): void {
    // Let clicks on buttons/links propagate normally to their handlers
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('a')) {
      return;
    }
    event.preventDefault();
    this.quick_view.emit(this.product);
  }

  onBuyNow(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.hasVariants) {
      this.router.navigate(['/catalog', this.product.slug]);
      return;
    }
    this.add_to_cart.emit(this.product);
    this.router.navigate(['/cart']);
  }

  onAddToCart(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.hasVariants) {
      this.router.navigate(['/catalog', this.product.slug]);
      return;
    }
    this.add_to_cart.emit(this.product);
  }

  onWishlistClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.toggle_wishlist.emit(this.product);
  }

  onShareClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.share.emit(this.product);
  }
}
