import { Component, OnInit, inject, DestroyRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogService, ProductDetail, Product, CatalogQuery } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCarouselComponent } from '../../components/product-carousel';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    ProductCarouselComponent,
    SpinnerComponent,
    ProductQuickViewModalComponent,
    IconComponent,
    QuantityControlComponent,
  ],
  template: `
    <div class="product-detail-page">
      @if (isLoading()) {
        <div class="loading-state">
          <app-spinner size="xl" text="Cargando producto..." [center]="true"></app-spinner>
        </div>
      } @else if (product(); as p) {
        <div class="product-container">
          <!-- Breadcrumbs Compact -->
          <nav class="breadcrumbs">
            <a routerLink="/catalog">Catálogo</a>
            @if (p.categories && p.categories.length > 0) {
              <app-icon name="chevron-right" [size]="10" />
              <span>{{ p.categories[0].name }}</span>
            }
          </nav>

          <!-- Main Product Layout -->
          <div class="product-main-grid">
            <!-- Gallery -->
            <div class="product-gallery">
              <div class="main-image-wrapper">
                <img [src]="activeImageUrl() || p.image_url" [alt]="p.name" class="main-image" />
              </div>
              @if (p.images && p.images.length > 1) {
                <div class="thumbnail-list">
                  @for (img of p.images; track img.id) {
                    <div
                      class="thumbnail"
                      [class.active]="activeImageUrl() === img.image_url"
                      (click)="setActiveImage(img.image_url)"
                    >
                      <img [src]="img.image_url" [alt]="p.name" />
                    </div>
                  }
                </div>
              }
            </div>

            <!-- Info Panel Minimalist -->
            <div class="product-info-panel">
              <div class="brand-line">
                @if (p.brand) {
                  <span class="brand-name">{{ p.brand.name }}</span>
                }
              </div>
              
              <h1 class="product-title">{{ p.name }}</h1>
              
              <div class="rating-line" *ngIf="p.avg_rating">
                <div class="stars">
                   @for (s of [1,2,3,4,5]; track s) {
                    <app-icon
                      name="star"
                      [size]="14"
                      [class]="s <= p.avg_rating ? 'text-warning fill-warning' : 'text-gray-300'"
                    />
                  }
                </div>
                <span class="count">({{ p.review_count }})</span>
              </div>

              <div class="price-line">
                @if (p.is_on_sale && p.sale_price) {
                  <span class="sale-price">{{ p.sale_price | currency }}</span>
                  <span class="original-price">{{ p.base_price | currency }}</span>
                } @else {
                  <span class="current-price">{{ p.base_price | currency }}</span>
                }
              </div>

              <!-- Options -->
              @if (p.variants && p.variants.length > 0) {
                <div class="options-group">
                  <div class="variants-btns">
                    @for (v of p.variants; track v.id) {
                      <button class="v-btn" [class.active]="selectedVariantId() === v.id" (click)="selectVariant(v)">
                        {{ v.name }}
                      </button>
                    }
                  </div>
                </div>
              }

              <!-- Purchase Section -->
              <div class="purchase-box">
                <app-quantity-control
                  [value]="quantity()"
                  [min]="1"
                  [max]="p.stock_quantity || 99"
                  [size]="'md'"
                  (valueChange)="quantity.set($event)"
                />
                
                <button
                  class="btn-cart"
                  (click)="onAddToCart(p)"
                  [disabled]="p.stock_quantity === 0"
                >
                  <app-icon name="shopping-cart" [size]="18" />
                  {{ p.stock_quantity === 0 ? 'Agotado' : 'Añadir' }}
                </button>
              </div>

              <!-- Stock Minimal -->
              <div class="stock-minimal">
                @if (p.stock_quantity !== null && p.stock_quantity > 0) {
                  <span [class.warn]="p.stock_quantity <= 5" class="s-dot"></span>
                  <span class="s-text">{{ p.stock_quantity <= 5 ? 'Pocas unidades' : 'En stock' }}</span>
                } @else if (p.stock_quantity === 0) {
                  <span class="s-dot err"></span>
                  <span class="s-text">Sin stock</span>
                }
              </div>

              <!-- Vertical Flow: Categories & Description -->
              <div class="product-content-flow">
                <div class="info-section">
                  <h4 class="info-label">Categorías</h4>
                  <div class="cat-tags">
                    @for (cat of p.categories; track cat.id) {
                      <span class="cat-tag">{{ cat.name }}</span>
                    }
                  </div>
                </div>

                <div class="info-section" *ngIf="p.description">
                  <h4 class="info-label">Descripción</h4>
                  <div class="desc-box">
                    <p class="desc-text" [class.expanded]="isDescriptionExpanded()">
                      {{ p.description }}
                    </p>
                    @if (p.description && p.description.length > 150) {
                      <button class="btn-more" (click)="toggleDescription()">
                        {{ isDescriptionExpanded() ? 'Ver menos' : 'Leer más' }}
                      </button>
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Recommendations Carousel -->
          <app-product-carousel
            title="Productos sugeridos"
            [products]="recommendedProducts()"
            (quick_view)="onQuickView($event)"
          />

          <!-- Reviews Integrated -->
          <div class="reviews-minimal">
            <h3 class="rv-title">Opiniones ({{ p.review_count || 0 }})</h3>
            <div class="rv-grid">
              <div class="rv-list">
                @for (review of latestReviews(); track review.id) {
                  <div class="rv-card">
                    <div class="rv-top">
                      <span class="rv-user">{{ review.user_name }}</span>
                      <div class="rv-stars">
                        @for (s of [1,2,3,4,5]; track s) {
                          <app-icon name="star" [size]="10" [class]="s <= review.rating ? 'text-warning fill-warning' : 'text-gray-300'" />
                        }
                      </div>
                    </div>
                    <p class="rv-text">{{ review.comment }}</p>
                  </div>
                }
              </div>
              
              <div class="rv-form-mini">
                <form [formGroup]="reviewForm" (ngSubmit)="onSubmitReview()">
                  <div class="star-picker">
                    @for (s of [1,2,3,4,5]; track s) {
                      <app-icon
                        name="star"
                        [size]="20"
                        [class]="s <= (reviewForm.get('rating')?.value ?? 0) ? 'text-warning fill-warning' : 'text-gray-300'"
                        (click)="reviewForm.get('rating')?.setValue(s)"
                        class="cursor-pointer"
                      />
                    }
                  </div>
                  <textarea formControlName="comment" placeholder="Comparte tu opinión..."></textarea>
                  <button type="submit" [disabled]="reviewForm.invalid">Publicar</button>
                </form>
              </div>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Quick View Modal -->
    <app-product-quick-view-modal
      [isOpen]="quickViewOpen"
      [productSlug]="selectedProductSlug"
      (closed)="quickViewOpen = false"
      (addedToCart)="onAddToCart($event)"
    />
  `,
  styles: [`
    .product-detail-page {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.5rem;
      font-family: inherit;
    }

    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 1.5rem;
      font-size: 0.75rem;
      color: var(--color-text-muted);
      a { color: inherit; text-decoration: none; &:hover { color: var(--color-primary); } }
    }

    .product-main-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3rem;
      margin-bottom: 3rem;
      @media (max-width: 800px) { grid-template-columns: 1fr; gap: 2rem; }
    }

    .main-image-wrapper {
      width: 100%;
      aspect-ratio: 1;
      background: white;
      border-radius: var(--radius-xl);
      overflow: hidden;
      img { width: 100%; height: 100%; object-fit: contain; padding: 1.5rem; }
    }

    .thumbnail-list {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
      .thumbnail {
        width: 70px; height: 70px; border-radius: var(--radius-md); overflow: hidden;
        border: 1px solid var(--color-border); cursor: pointer; transition: 0.2s;
        img { width: 100%; height: 100%; object-fit: contain; padding: 0.2rem; }
        &.active { border-color: var(--color-primary); }
      }
    }

    .product-info-panel { display: flex; flex-direction: column; gap: 0.75rem; }

    .brand-name { font-size: 0.8rem; color: var(--color-primary); font-weight: 700; text-transform: uppercase; }
    .product-title { font-size: 2.25rem; font-weight: 800; color: var(--color-text-primary); margin: 0; line-height: 1.2; }

    .rating-line { display: flex; align-items: center; gap: 0.5rem; .stars { display: flex; } .count { font-size: 0.75rem; color: var(--color-text-muted); } }

    .price-line {
      display: flex; align-items: baseline; gap: 1rem; margin: 0.5rem 0;
      .current-price, .sale-price { font-size: 2rem; font-weight: 800; }
      .sale-price { color: var(--color-error); }
      .original-price { font-size: 1.25rem; color: var(--color-text-muted); text-decoration: line-through; }
    }

    .variants-btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .v-btn {
      padding: 0.5rem 1rem; border: 1px solid var(--color-border); background: white;
      border-radius: var(--radius-md); cursor: pointer; font-size: 0.85rem;
      &.active { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
    }

    .purchase-box {
      display: flex; gap: 1rem; margin-top: 0.5rem; align-items: center;
      .btn-cart {
        flex: 1; height: 36px; background: var(--color-primary); color: white; border: none; border-radius: var(--radius-md);
        font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 0.5rem;
        cursor: pointer; transition: 0.2s; &:hover { background: var(--color-secondary); } &:disabled { background: var(--color-text-muted); }
      }
    }

    .stock-minimal {
      display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; 
      .s-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; &.warn { background: #f59e0b; } &.err { background: #ef4444; } }
      .s-text { color: var(--color-text-muted); }
    }

    .product-content-flow {
      margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;
      .info-section { display: flex; flex-direction: column; gap: 0.5rem; }
      .info-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; margin: 0; }
      .cat-tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .cat-tag { 
        background: var(--color-background); 
        padding: 0.2rem 0.6rem; 
        border-radius: var(--radius-pill); 
        font-size: 0.65rem; 
        font-weight: 600;
        color: var(--color-text-secondary); 
        border: 1px solid var(--color-border);
        white-space: nowrap;
      }
      .desc-box { position: relative; }
      .desc-text {
        font-size: 0.95rem; line-height: 1.6; color: var(--color-text-secondary); margin: 0;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        &.expanded { display: block; -webkit-line-clamp: unset; }
      }
      .btn-more {
        background: none; border: none; color: var(--color-primary); font-weight: 700; font-size: 0.85rem;
        padding: 0; margin-top: 0.4rem; cursor: pointer; &:hover { text-decoration: underline; }
      }
    }

    .reviews-minimal {
      margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--color-border);
      .rv-title { font-size: 1.25rem; font-weight: 800; margin-bottom: 1.5rem; }
      .rv-grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 3rem; @media (max-width: 800px) { grid-template-columns: 1fr; } }
      .rv-card { padding-bottom: 1rem; border-bottom: 1px solid var(--color-border-light); margin-bottom: 1rem; }
      .rv-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; }
      .rv-user { font-weight: 700; font-size: 0.9rem; }
      .rv-text { font-size: 0.875rem; color: var(--color-text-secondary); margin: 0; }
      .rv-form-mini {
        background: var(--color-surface); padding: 1.5rem; border-radius: var(--radius-lg); height: fit-content;
        .star-picker { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
        textarea { width: 100%; height: 80px; padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 1rem; font-size: 0.875rem; resize: none; background: var(--color-background); }
        button { width: 100%; background: var(--color-primary); color: white; border: none; padding: 0.6rem; border-radius: var(--radius-md); font-weight: 700; cursor: pointer; transition: 0.2s; &:hover { background: var(--color-secondary); } }
      }
    }
  `],
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);

  // States
  product = signal<ProductDetail | null>(null);
  isLoading = signal(true);
  hasError = signal(false);
  activeImageUrl = signal<string | null>(null);
  selectedVariantId = signal<number | null>(null);
  isDescriptionExpanded = signal(false);
  quantity = signal(1);

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Recommendations
  recommendedProducts = signal<Product[]>([]);

  // Review Form
  reviewForm = this.fb.group({
    rating: [5, [Validators.required, Validators.min(1), Validators.max(5)]],
    comment: ['', [Validators.required, Validators.minLength(10)]],
  });

  // Computed
  latestReviews = computed(() => {
    const p = this.product();
    if (!p || !p.reviews) return [];
    return [...p.reviews]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);
  });

  ngOnInit(): void {
    this.route.params.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const slug = params['slug'];
      if (slug) this.loadProduct(slug);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  loadProduct(slug: string): void {
    this.isLoading.set(true);
    this.hasError.set(false);
    this.catalogService.getProductBySlug(slug).subscribe({
      next: (response) => {
        if (response.success) {
          const product = response.data;
          this.product.set(product);
          this.activeImageUrl.set(product.image_url);
          if (product.variants?.length) this.selectedVariantId.set(product.variants[0].id);
          this.loadRecommendations(product);
        } else {
          this.hasError.set(true);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.hasError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  loadRecommendations(product: ProductDetail): void {
    const query: CatalogQuery = { limit: 10, sort_by: 'newest' };
    if (product.categories?.length) query.category_id = product.categories[0].id;
    this.catalogService.getProducts(query).subscribe({
      next: (response) => {
        this.recommendedProducts.set(response.data.filter(p => p.id !== product.id));
      }
    });
  }

  setActiveImage(url: string): void { this.activeImageUrl.set(url); }
  selectVariant(variant: any): void { this.selectedVariantId.set(variant.id); }
  toggleDescription(): void { this.isDescriptionExpanded.update(v => !v); }
  onAddToCart(product: Product | ProductDetail): void { const result = this.cartService.addToCart(product.id, this.quantity()); if (result) { result.subscribe(); } }
  onQuickView(product: Product): void { this.selectedProductSlug = product.slug; this.quickViewOpen = true; }

  onSubmitReview(): void {
    if (this.reviewForm.invalid) return;
    const currentProduct = this.product();
    if (currentProduct) {
      const newReview = {
        id: Math.floor(Math.random() * 10000),
        rating: this.reviewForm.get('rating')?.value ?? 5,
        comment: this.reviewForm.get('comment')?.value ?? '',
        created_at: new Date().toISOString(),
        user_name: 'Comprador'
      };
      this.product.set({
        ...currentProduct,
        reviews: [newReview, ...(currentProduct.reviews || [])],
        review_count: (currentProduct.review_count || 0) + 1
      });
    }
    this.reviewForm.reset({ rating: 5, comment: '' });
  }
}
