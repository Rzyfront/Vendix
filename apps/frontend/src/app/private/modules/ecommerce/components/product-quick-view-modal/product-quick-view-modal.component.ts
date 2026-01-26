import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { CatalogService, ProductDetail, EcommerceProduct } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-product-quick-view-modal',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ModalComponent,
    SpinnerComponent,
    IconComponent,
    QuantityControlComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      (closed)="onClose()"
      size="md"
      [title]="product?.name || 'Vista Rápida'"
      [overlayCloseButton]="true"
    >
      <!-- Loading State -->
      @if (isLoading) {
        <div class="quick-view-loading">
          <app-spinner size="lg" text="Cargando producto..." [center]="true"></app-spinner>
        </div>
      }

      <!-- Product Content -->
      @if (!isLoading && product) {
        <div class="quick-view-content">
          <!-- Image Section -->
          <div class="quick-view-image">
            @if (mainImageUrl) {
              <img [src]="mainImageUrl" [alt]="product.name" />
            } @else {
              <div class="no-image">
                <app-icon name="image" [size]="48" />
              </div>
            }
            @if (product.is_on_sale) {
              <span class="sale-badge">Oferta</span>
            }
          </div>

          <!-- Info Section -->
          <div class="quick-view-info">
            <!-- Brand -->
            @if (product.brand) {
              <span class="product-brand">{{ product.brand.name }}</span>
            }

            <!-- Name (Hidden if modal title shows it) -->
            <!-- <h2 class="product-name">{{ product.name }}</h2> -->

            <!-- Rating -->
            @if (product.avg_rating) {
              <div class="product-rating">
                <span class="stars">
                  @for (star of [1,2,3,4,5]; track star) {
                    <app-icon
                      [name]="star <= product.avg_rating ? 'star' : 'star'"
                      [size]="14"
                      [class]="star <= product.avg_rating ? 'text-warning fill-warning' : 'text-gray-300'"
                    />
                  }
                </span>
                <span class="rating-count">({{ product.review_count }} reseñas)</span>
              </div>
            }

            <!-- Price -->
            <div class="product-price">
              <span class="current-price text-2xl font-bold">{{ product.final_price | currency }}</span>
              @if (product.is_on_sale) {
                <span class="original-price text-lg text-text-muted line-through ml-3" style="text-decoration: line-through;">
                  {{ product.base_price | currency }}
                </span>
              }
            </div>

            <!-- Description (short) -->
            @if (product.description) {
              <p class="product-description">{{ truncatedDescription }}</p>
            }

            <!-- Categories Mini Badges -->
            @if (product.categories && product.categories.length > 0) {
              <div class="category-badges">
                @for (cat of product.categories; track cat.id) {
                  <span class="cat-badge">{{ cat.name }}</span>
                }
              </div>
            }

            <!-- Stock Status -->
            <div class="stock-status">
              @if (product.stock_quantity === 0) {
                <span class="out-of-stock">
                  <app-icon name="circle-x" [size]="14" /> Agotado
                </span>
              } @else if (product.stock_quantity !== null && product.stock_quantity <= 5) {
                <span class="low-stock">
                  <app-icon name="alert-triangle" [size]="14" /> ¡Solo quedan {{ product.stock_quantity }}!
                </span>
              } @else {
                <span class="in-stock">
                  <app-icon name="check-circle" [size]="14" /> En stock
                </span>
              }
            </div>

            <!-- Quantity Selector -->
            <div class="quantity-selector">
              <label>Cantidad:</label>
              <app-quantity-control
                [value]="quantity"
                [min]="1"
                [max]="product.stock_quantity || 99"
                [size]="'md'"
                (valueChange)="quantity = $event"
              />
            </div>

            <!-- Actions -->
            <div class="quick-view-actions">
              <button
                class="btn-add-cart"
                (click)="onAddToCart()"
                [disabled]="product.stock_quantity === 0"
              >
                <app-icon name="shopping-cart" [size]="18" />
                Agregar
              </button>
              <button class="btn-share" (click)="onShare()">
                <app-icon name="link-2" [size]="18" />
              </button>
            </div>

            <!-- View Full Details Link -->
            <a class="view-details-link" [routerLink]="['/catalog', product.slug]" (click)="onClose()">
              Ver todos los detalles
              <app-icon name="chevron-right" [size]="14" />
            </a>
          </div>
        </div>
      }

      <!-- Error State -->
      @if (!isLoading && !product && hasError) {
        <div class="quick-view-error">
          <app-icon name="alert-circle" [size]="48" class="text-error" />
          <p>No se pudo cargar el producto</p>
          <button (click)="loadProduct()">Reintentar</button>
        </div>
      }
    </app-modal>
  `,
  styles: [`
    .quick-view-loading {
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .quick-view-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;

      @media (max-width: 640px) {
        grid-template-columns: 1fr;
      }
    }

    .quick-view-image {
      position: relative;
      aspect-ratio: 1;
      border-radius: var(--radius-lg);
      overflow: hidden;
      background: var(--color-background);

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
        font-size: 4rem;
      }

      .sale-badge {
        position: absolute;
        top: 0.75rem;
        left: 0.75rem;
        background: var(--color-error);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: var(--radius-pill);
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
      }
    }

    .quick-view-info {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .product-brand {
      font-size: var(--fs-xs);
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .product-name {
      font-size: var(--fs-xl);
      font-weight: var(--fw-bold);
      color: var(--color-text-primary);
      margin: 0;
      line-height: 1.3;
    }

    .product-rating {
      display: flex;
      align-items: center;
      gap: 0.5rem;

      .stars {
        display: flex;
        gap: 0.125rem;
        color: var(--color-warning);
      }

      .rating-count {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }
    }

    .product-price {
      display: flex;
      align-items: center;
      gap: 0.75rem;

      .current-price,
      .sale-price {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }

      .sale-price {
        color: var(--color-error);
      }

      .original-price {
        font-size: var(--fs-lg);
        color: var(--color-text-muted);
        text-decoration: line-through;
      }
    }

    .category-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin: 0.25rem 0;

      .cat-badge {
        font-size: 0.65rem;
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
        background: var(--color-background);
        border: 1px solid var(--color-border);
        padding: 0.125rem 0.5rem;
        border-radius: var(--radius-pill);
      }
    }

    .stock-status {
      span {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
      }

      .in-stock {
        color: var(--color-success);
      }

      .low-stock {
        color: var(--color-warning);
      }

      .out-of-stock {
        color: var(--color-error);
      }
    }

    .quantity-selector {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;

      label {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }
    }

    .quick-view-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;

      .btn-add-cart {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.875rem 1.5rem;
        background: var(--color-primary);
        color: var(--color-text-on-primary);
        border: none;
        border-radius: var(--radius-md);
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover:not(:disabled) {
          background: var(--color-secondary);
          transform: translateY(-1px);
        }

        &:disabled {
          background: var(--color-text-muted);
          cursor: not-allowed;
        }
      }

      .btn-share {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-background);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background: var(--color-border);
          color: var(--color-primary);
        }
      }
    }

    .view-details-link {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 0.75rem;
      color: var(--color-primary);
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
      text-decoration: none;
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);

      &:hover {
        background: var(--color-primary-light, rgba(var(--color-primary-rgb), 0.1));
        text-decoration: none;
      }

      i {
        font-size: 0.75rem;
      }
    }

    .quick-view-error {
      min-height: 200px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      text-align: center;

      i {
        font-size: 3rem;
        color: var(--color-error);
      }

      p {
        color: var(--color-text-secondary);
        margin: 0;
      }

      button {
        padding: 0.5rem 1rem;
        background: var(--color-primary);
        color: var(--color-text-on-primary);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;

        &:hover {
          background: var(--color-secondary);
        }
      }
    }
  `],
})
export class ProductQuickViewModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() productSlug: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() addedToCart = new EventEmitter<ProductDetail>();

  product: ProductDetail | null = null;
  isLoading = false;
  hasError = false;
  quantity = 1;

  private destroyRef = inject(DestroyRef);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.productSlug) {
      this.loadProduct();
    }
    if (changes['productSlug'] && this.isOpen && this.productSlug) {
      this.loadProduct();
    }
  }

  get mainImageUrl(): string | null {
    if (!this.product) return null;
    const mainImage = this.product.images?.find((img) => img.is_main);
    if (mainImage) return mainImage.image_url;
    if (this.product.images?.length) return this.product.images[0].image_url;
    return this.product.image_url;
  }

  get truncatedDescription(): string {
    if (!this.product?.description) return '';
    const maxLength = 150;
    if (this.product.description.length <= maxLength) {
      return this.product.description;
    }
    return this.product.description.substring(0, maxLength) + '...';
  }

  loadProduct(): void {
    if (!this.productSlug) return;

    this.isLoading = true;
    this.hasError = false;
    this.product = null;
    this.quantity = 1;

    this.catalogService
      .getProductBySlug(this.productSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.product = response.data;
          } else {
            this.hasError = true;
          }
          this.isLoading = false;
        },
        error: () => {
          this.hasError = true;
          this.isLoading = false;
        },
      });
  }

  onAddToCart(): void {
    if (!this.product) return;
    const result = this.cartService.addToCart(this.product.id, this.quantity);
    if (result) {
      result.subscribe();
    }
    this.addedToCart.emit(this.product);
    // Optionally close modal after adding
    // this.onClose();
  }

  onShare(): void {
    if (!this.product) return;
    const url = `${window.location.origin}/catalog/${this.product.slug}`;

    if (navigator.share) {
      navigator.share({
        title: this.product.name,
        text: this.product.description || `Mira este producto: ${this.product.name}`,
        url: url,
      }).catch(() => {
        // Fallback to clipboard
        this.copyToClipboard(url);
      });
    } else {
      this.copyToClipboard(url);
    }
  }

  private copyToClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(() => {
      // TODO: Show toast notification "URL copiada"
    });
  }

  onClose(): void {
    this.isOpen = false;
    this.closed.emit();
    // Reset state
    this.product = null;
    this.hasError = false;
    this.quantity = 1;
  }
}
