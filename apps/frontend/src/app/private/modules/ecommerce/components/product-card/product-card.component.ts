import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { Product } from '../../services/catalog.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

@Component({
    selector: 'app-product-card',
    standalone: true,
    imports: [CommonModule, RouterModule],
    template: `
    <article class="product-card" [routerLink]="['/catalog', product.slug]">
      <div class="product-image">
        @if (product.image_url) {
          <img [src]="product.image_url" [alt]="product.name" loading="lazy">
        } @else {
          <div class="no-image">
            <i class="pi pi-image"></i>
          </div>
        }
        <button class="wishlist-btn" (click)="onWishlistClick($event)" [class.active]="in_wishlist">
          <i class="pi" [class.pi-heart-fill]="in_wishlist" [class.pi-heart]="!in_wishlist"></i>
        </button>
      </div>
      <div class="product-info">
        @if (product.brand) {
          <span class="product-brand">{{ product.brand.name }}</span>
        }
        <h3 class="product-name">{{ product.name }}</h3>
        <div class="product-price">
          <span class="price">{{ product.base_price | currency }}</span>
        </div>
        @if (product.stock_quantity !== null && product.stock_quantity <= 5 && product.stock_quantity > 0) {
          <span class="low-stock">¡Últimas {{ product.stock_quantity }} unidades!</span>
        }
        @if (product.stock_quantity === 0) {
          <span class="out-of-stock">Agotado</span>
        }
      </div>
      <button class="add-to-cart-btn" (click)="onAddToCart($event)" [disabled]="product.stock_quantity === 0">
        <i class="pi pi-shopping-cart"></i>
        Agregar
      </button>
    </article>
  `,
    styles: [`
    .product-card {
      background: var(--color-surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--color-border);
      overflow: hidden;
      cursor: pointer;
      transition: all var(--transition-fast);
      display: flex;
      flex-direction: column;

      &:hover {
        box-shadow: var(--shadow-lg);
        transform: translateY(-4px);
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
        transition: transform 0.3s ease;
      }

      .product-card:hover & img {
        transform: scale(1.05);
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

      .wishlist-btn {
        position: absolute;
        top: 0.75rem;
        right: 0.75rem;
        width: 36px;
        height: 36px;
        border-radius: var(--radius-pill);
        border: none;
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary);
        transition: all var(--transition-fast);

        &:hover, &.active {
          color: var(--color-error);
          background: var(--color-error-light);
        }
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

      .price {
        font-size: var(--fs-lg);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }
    }

    .low-stock {
      font-size: var(--fs-xs);
      color: var(--color-warning);
      font-weight: var(--fw-medium);
    }

    .out-of-stock {
      font-size: var(--fs-xs);
      color: var(--color-error);
      font-weight: var(--fw-medium);
    }

    .add-to-cart-btn {
      margin: 0 1rem 1rem;
      padding: 0.75rem 1rem;
      background: var(--color-primary);
      color: var(--color-text-on-primary);
      border: none;
      border-radius: var(--radius-md);
      font-weight: var(--fw-medium);
      font-size: var(--fs-sm);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: background var(--transition-fast);

      &:hover:not(:disabled) {
        background: var(--color-secondary);
      }

      &:disabled {
        background: var(--color-text-muted);
        cursor: not-allowed;
      }
    }
  `],
})
export class ProductCardComponent {
  @Input() product!: Product;
  @Input() in_wishlist = false;
  @Output() add_to_cart = new EventEmitter<Product>();
  @Output() toggle_wishlist = new EventEmitter<Product>();
  @Output() quick_view = new EventEmitter<Product>();

    onAddToCart(event: Event): void {
        event.stopPropagation();
        event.preventDefault();
        this.add_to_cart.emit(this.product);
    }

    onWishlistClick(event: Event): void {
        event.stopPropagation();
        event.preventDefault();
        this.toggle_wishlist.emit(this.product);
    }
}
