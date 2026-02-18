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
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { CatalogService, ProductDetail, ProductVariantDetail, EcommerceProduct } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ShareModalComponent } from '../share-modal/share-modal.component';

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
    ButtonComponent,
    QuantityControlComponent,
    ShareModalComponent,
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
          <div class="quick-view-image-col">
            <div class="quick-view-image">
              @if (displayImageUrl) {
                <img [src]="displayImageUrl" [alt]="product.name" />
              } @else {
                <div class="no-image">
                  <app-icon name="image" [size]="48" />
                </div>
              }
              @if (product.is_on_sale && !selectedVariant?.price_override) {
                <span class="sale-badge">Oferta</span>
              }
            </div>
            <!-- Description below image -->
            @if (product.description) {
              <p class="product-description">{{ truncatedDescription }}</p>
            }
          </div>

          <!-- Info Section -->
          <div class="quick-view-info">
            <!-- Brand -->
            @if (product.brand) {
              <span class="product-brand">{{ product.brand.name }}</span>
            }

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
              <span class="current-price">{{ displayPrice | currency }}</span>
              @if (product.is_on_sale && !selectedVariant?.price_override) {
                <span class="original-price">
                  {{ product.base_price | currency }}
                </span>
              }
            </div>

            <!-- Variant Selector -->
            @if (product.variants && product.variants.length > 0) {
              <div class="variant-selector">
                <div class="variant-header">
                  <label class="variant-label">Variante:</label>
                  <span class="variant-info-icon" title="Este producto tiene diferentes opciones. Selecciona la que prefieras.">
                    <app-icon name="info" [size]="14" />
                  </span>
                </div>
                <div class="variant-chips">
                  @for (variant of product.variants; track variant.id) {
                    <button
                      class="variant-chip"
                      [class.selected]="selectedVariant?.id === variant.id"
                      [class.out-of-stock]="variant.stock_quantity === 0"
                      [disabled]="variant.stock_quantity === 0"
                      (click)="selectVariant(variant)"
                    >
                      {{ getVariantLabel(variant) }}
                    </button>
                  }
                </div>
              </div>
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
              @if (displayStock === 0) {
                <span class="out-of-stock">
                  <app-icon name="circle-x" [size]="14" /> Agotado
                </span>
              } @else if (displayStock !== null && displayStock <= 5) {
                <span class="low-stock">
                  <app-icon name="alert-triangle" [size]="14" /> ¡Solo quedan {{ displayStock }}!
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
                [max]="displayStock || 99"
                [size]="'sm'"
                (valueChange)="quantity = $event"
              />
            </div>

            <!-- Actions -->
            <div class="quick-view-actions">
              <app-button
                variant="secondary"
                size="sm"
                [fullWidth]="true"
                [disabled]="displayStock === 0 || (hasVariants && !selectedVariant)"
                (clicked)="onAddToCart()"
              >
                <app-icon slot="icon" name="shopping-cart" [size]="18" />
                Agregar al carrito
              </app-button>
              <app-button
                variant="outline"
                size="sm"
                customClasses="share-btn"
                (clicked)="onShareClick()"
              >
                <app-icon slot="icon" name="share" [size]="18" />
              </app-button>
            </div>

            <!-- Buy Now -->
            <app-button
              variant="primary"
              size="md"
              [fullWidth]="true"
              [disabled]="displayStock === 0 || (hasVariants && !selectedVariant)"
              (clicked)="onBuyNow()"
            >
              <app-icon slot="icon" name="shopping-bag" [size]="18" />
              Comprar ahora
            </app-button>

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
          <app-button variant="primary" size="sm" (clicked)="loadProduct()">
            Reintentar
          </app-button>
        </div>
      }
    </app-modal>

    <!-- Share Modal -->
    <app-share-modal
      [isOpen]="shareModalOpen"
      [product]="productForShare"
      (closed)="onShareModalClosed()"
    />
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

    .quick-view-image-col {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .product-description {
      font-size: var(--fs-sm);
      color: var(--color-text-secondary);
      line-height: 1.5;
      margin: 0;
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

    /* Variant Selector */
    .variant-selector {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;

      .variant-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }

      .variant-label {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-text-secondary);
      }

      .variant-info-icon {
        display: inline-flex;
        align-items: center;
        color: var(--color-text-muted);
        cursor: help;
      }
    }

    .variant-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .variant-chip {
      padding: 0.375rem 0.75rem;
      border-radius: var(--radius-pill);
      border: 1.5px solid var(--color-border);
      background: var(--color-surface);
      font-size: var(--fs-sm);
      font-weight: var(--fw-medium);
      color: var(--color-text-primary);
      cursor: pointer;
      transition: all var(--transition-fast);

      &:hover:not(:disabled) {
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      &.selected {
        border-color: var(--color-primary);
        background: var(--color-primary);
        color: white;
      }

      &.out-of-stock {
        opacity: 0.4;
        cursor: not-allowed;
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

      /* Botón principal ocupa el espacio */
      app-button:first-child {
        flex: 1;
      }

      /* Botón de compartir cuadrado */
      :host ::ng-deep .share-btn {
        width: 44px !important;
        min-width: 44px !important;
        padding: 0 !important;
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

      p {
        color: var(--color-text-secondary);
        margin: 0;
      }
    }

    .text-error {
      color: var(--color-error);
    }

    /* ─── Mobile Compact ─── */
    @media (max-width: 640px) {
      .quick-view-content { gap: 0.75rem; }
      .quick-view-image { aspect-ratio: 3/2; max-height: 200px; }
      .quick-view-image .sale-badge { padding: 0.15rem 0.5rem; font-size: 0.6rem; }
      .quick-view-info { gap: 0.35rem; }
      .product-brand { font-size: 0.6rem; }
      .product-price .current-price { font-size: 1.25rem; }
      .product-price .original-price { font-size: 0.8rem; }
      .variant-chips { gap: 0.35rem; }
      .variant-chip { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
      .category-badges { display: none; }
      .stock-status span { font-size: 0.7rem; }
      .quantity-selector { gap: 0.5rem; margin-bottom: 0.25rem; }
      .quantity-selector label { font-size: 0.7rem; }
      .quick-view-actions { gap: 0.5rem; margin-top: 0.25rem; }
      .view-details-link { padding: 0.35rem; font-size: 0.75rem; }
      .product-description { display: none; }
    }
  `],
})
export class ProductQuickViewModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() productSlug: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() addedToCart = new EventEmitter<ProductDetail>();

  product: ProductDetail | null = null;
  selectedVariant: ProductVariantDetail | null = null;
  isLoading = false;
  hasError = false;
  quantity = 1;
  shareModalOpen = false;

  private destroyRef = inject(DestroyRef);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private router = inject(Router);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen && this.productSlug) {
      this.loadProduct();
    }
    if (changes['productSlug'] && this.isOpen && this.productSlug) {
      this.loadProduct();
    }
  }

  get hasVariants(): boolean {
    return !!this.product?.variants && this.product.variants.length > 0;
  }

  get displayPrice(): number {
    if (this.selectedVariant) return this.selectedVariant.final_price;
    return this.product?.final_price || 0;
  }

  get displayStock(): number | null {
    if (this.selectedVariant) return this.selectedVariant.stock_quantity;
    return this.product?.stock_quantity ?? null;
  }

  get displayImageUrl(): string | null {
    if (this.selectedVariant?.image_url) return this.selectedVariant.image_url;
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

  // Convert ProductDetail to EcommerceProduct for ShareModal
  get productForShare(): EcommerceProduct | null {
    if (!this.product) return null;
    return {
      id: this.product.id,
      name: this.product.name,
      slug: this.product.slug,
      description: this.product.description,
      base_price: this.product.base_price,
      final_price: this.product.final_price,
      is_on_sale: this.product.is_on_sale,
      image_url: this.displayImageUrl,
      stock_quantity: this.product.stock_quantity,
      brand: this.product.brand,
      categories: this.product.categories,
    } as EcommerceProduct;
  }

  selectVariant(variant: ProductVariantDetail): void {
    this.selectedVariant = this.selectedVariant?.id === variant.id ? null : variant;
    this.quantity = 1;
  }

  getVariantLabel(variant: ProductVariantDetail): string {
    if (variant.attributes && typeof variant.attributes === 'object') {
      const values = Object.values(variant.attributes);
      if (values.length > 0) return values.join(' / ');
    }
    return variant.name || variant.sku;
  }

  loadProduct(): void {
    if (!this.productSlug) return;

    this.isLoading = true;
    this.hasError = false;
    this.product = null;
    this.selectedVariant = null;
    this.quantity = 1;

    this.catalogService
      .getProductBySlug(this.productSlug)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.product = response.data;
            // Auto-select first available variant
            if (this.product.variants?.length > 0) {
              const firstAvailable = this.product.variants.find(v => v.stock_quantity > 0);
              this.selectedVariant = firstAvailable || this.product.variants[0];
            }
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
    const variantId = this.selectedVariant?.id;
    const variantInfo = this.selectedVariant
      ? { name: this.selectedVariant.name, sku: this.selectedVariant.sku, price: this.selectedVariant.final_price }
      : undefined;
    const result = this.cartService.addToCart(this.product.id, this.quantity, variantId, variantInfo);
    if (result) {
      result.subscribe();
    }
    this.addedToCart.emit(this.product);
    this.onClose();
  }

  onBuyNow(): void {
    if (!this.product) return;
    const variantId = this.selectedVariant?.id;
    const variantInfo = this.selectedVariant
      ? { name: this.selectedVariant.name, sku: this.selectedVariant.sku, price: this.selectedVariant.final_price }
      : undefined;
    const result = this.cartService.addToCart(this.product.id, this.quantity, variantId, variantInfo);
    if (result) {
      result.subscribe({
        next: () => {
          this.onClose();
          this.router.navigate(['/cart']);
        },
        error: () => {
          this.onClose();
          this.router.navigate(['/cart']);
        },
      });
    } else {
      this.onClose();
      this.router.navigate(['/cart']);
    }
  }

  onShareClick(): void {
    if (!this.product) return;
    this.shareModalOpen = true;
  }

  onShareModalClosed(): void {
    this.shareModalOpen = false;
  }

  onClose(): void {
    this.isOpen = false;
    this.closed.emit();
    // Reset state
    this.product = null;
    this.selectedVariant = null;
    this.hasError = false;
    this.quantity = 1;
  }
}
