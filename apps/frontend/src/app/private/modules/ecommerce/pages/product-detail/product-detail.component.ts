import { Component, OnInit, inject, DestroyRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogService, ProductDetail, ProductVariantDetail, EcommerceProduct, CatalogQuery } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCarouselComponent } from '../../components/product-carousel';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';

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
    ButtonComponent,
    ShareModalComponent,
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

              <!-- Service Info Section -->
              @if (p.product_type === 'service') {
                <div class="service-info-section">
                  <span class="service-badge-detail">Servicio</span>
                  <div class="service-details">
                    @if (p.service_duration_minutes) {
                      <div class="service-detail-item">
                        <app-icon name="clock" [size]="14" />
                        <span>{{ p.service_duration_minutes }} minutos</span>
                      </div>
                    }
                    @if (p.service_modality) {
                      <div class="service-detail-item">
                        <app-icon [name]="p.service_modality === 'virtual' ? 'monitor' : p.service_modality === 'hybrid' ? 'repeat' : 'map-pin'" [size]="14" />
                        <span>{{ p.service_modality === 'virtual' ? 'Virtual' : p.service_modality === 'hybrid' ? 'Híbrido' : 'Presencial' }}</span>
                      </div>
                    }
                    @if (p.requires_booking) {
                      <div class="service-detail-item">
                        <app-icon name="calendar-check" [size]="14" />
                        <span>Requiere reserva previa</span>
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="price-line">
                @if (displayPriceLabel(); as label) {
                  <span class="text-sm text-text-muted font-medium mr-1">{{ label }}</span>
                }
                <span class="current-price">{{ (displayPriceLabel() ? minVariantPrice() : displayPrice()) | currency }}</span>
                @if (selectedVariant(); as sv) {
                  @if (sv.is_on_sale || sv.price_override) {
                    <span class="original-price" style="text-decoration: line-through; opacity: 0.6; margin-left: 10px;">{{ p.base_price | currency }}</span>
                  }
                } @else if (p.is_on_sale) {
                  <span class="original-price" style="text-decoration: line-through; opacity: 0.6; margin-left: 10px;">{{ p.base_price | currency }}</span>
                }
              </div>

              <!-- Options: Attribute-based groups -->
              @if (hasAttributeGroups()) {
                <div class="options-group">
                  @for (group of attributeGroups(); track group.name) {
                    <div class="attr-group">
                      <label class="attr-group-label">{{ group.name }}</label>
                      <div class="variants-btns">
                        @for (val of group.values; track val) {
                          <app-button
                            [variant]="selectedAttributes()[group.name] === val ? 'primary' : 'outline'"
                            size="sm"
                            customClasses="v-btn"
                            [disabled]="!isOnDemand() && !getAvailableValues(group.name).includes(val)"
                            (clicked)="selectAttributeValue(group.name, val)"
                          >
                            {{ val }}
                            @if (getPriceDiffForValue(group.name, val); as diff) {
                              <span class="text-[10px] ml-1 opacity-80">
                                ({{ diff > 0 ? '+' : '' }}{{ diff | currency }})
                              </span>
                            }
                          </app-button>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else if (p.variants && p.variants.length > 0) {
                <!-- Fallback: flat variant buttons for products without attribute groups -->
                <div class="options-group">
                  <div class="variants-btns">
                    @for (v of p.variants; track v.id) {
                      <app-button
                        [variant]="selectedVariantId() === v.id ? 'primary' : 'outline'"
                        size="sm"
                        customClasses="v-btn"
                        [disabled]="!isOnDemand() && v.stock_quantity === 0"
                        (clicked)="selectVariant(v)"
                      >
                        {{ v.name }}
                        @if (v.final_price !== p.final_price) {
                          <span class="text-[10px] ml-1 opacity-80">
                            ({{ v.final_price > p.final_price ? '+' : '' }}{{ (v.final_price - p.final_price) | currency }})
                          </span>
                        }
                        @if (!isOnDemand() && v.stock_quantity === 0) {
                          <span class="text-[10px] opacity-60 ml-1">(Agotado)</span>
                        }
                      </app-button>
                    }
                  </div>
                </div>
              }

              <!-- Purchase Section -->
              <div class="purchase-box">
                <app-quantity-control
                  [value]="quantity()"
                  [min]="1"
                  [max]="isOnDemand() ? 999 : (displayStock() || 99)"
                  [size]="'sm'"
                  (valueChange)="quantity.set($event)"
                />

                <app-button
                  variant="primary"
                  size="sm"
                  customClasses="btn-cart"
                  [disabled]="!isService() && !isOnDemand() && displayStock() === 0"
                  (clicked)="onAddToCart(p)"
                >
                  <app-icon slot="icon" name="shopping-cart" [size]="18" />
                  {{ isService() ? 'Agendar' : (!isOnDemand() && displayStock() === 0 ? 'Agotado' : 'Añadir') }}
                </app-button>

                <app-button
                  variant="outline"
                  size="sm"
                  customClasses="btn-share"
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
                customClasses="btn-buy-now"
                [disabled]="!isService() && !isOnDemand() && displayStock() === 0"
                (clicked)="onBuyNow(p)"
              >
                {{ isService() ? 'Agendar ahora' : (!isOnDemand() && displayStock() === 0 ? 'Agotado' : 'Comprar ahora') }}
              </app-button>

              <!-- Stock Minimal -->
              <div class="stock-minimal">
                @if (isService()) {
                  <span class="s-dot service"></span>
                  <span class="s-text">Servicio disponible</span>
                } @else if (isOnDemand()) {
                  <span class="s-dot on-demand"></span>
                  <span class="s-text">Disponible bajo pedido</span>
                } @else if (displayStock() > 0) {
                  <span [class.warn]="displayStock() <= 5" class="s-dot"></span>
                  <span class="s-text">{{ displayStock() <= 5 ? 'Pocas unidades' : 'En stock' }}</span>
                } @else {
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
                      <app-button
                        variant="ghost"
                        size="sm"
                        customClasses="btn-more"
                        (clicked)="toggleDescription()"
                      >
                        {{ isDescriptionExpanded() ? 'Ver menos' : 'Leer más' }}
                      </app-button>
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
                  <app-button
                    type="submit"
                    variant="primary"
                    size="sm"
                    [fullWidth]="true"
                    [disabled]="reviewForm.invalid"
                  >
                    Publicar
                  </app-button>
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

    <!-- Share Modal -->
    <app-share-modal
      [isOpen]="shareModalOpen"
      [product]="productForShare()"
      (closed)="shareModalOpen = false"
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

    .options-group { display: flex; flex-direction: column; gap: 0.75rem; }
    .attr-group { display: flex; flex-direction: column; gap: 0.4rem; }
    .attr-group-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.5px; }
    .variants-btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }

    .purchase-box {
      display: flex; gap: 0.75rem; margin-top: 0.5rem; align-items: center;

      :host ::ng-deep .btn-cart {
        flex: 1;
      }

      :host ::ng-deep .btn-share {
        width: 40px !important;
        min-width: 40px !important;
        padding: 0 !important;
      }
    }

    :host ::ng-deep .btn-buy-now {
      font-weight: 700;
      font-size: 1rem;
      padding: 0.85rem 1.5rem;
    }

    .service-info-section {
      display: flex; flex-direction: column; gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: rgba(139, 92, 246, 0.06);
      border: 1px solid rgba(139, 92, 246, 0.15);
      border-radius: var(--radius-lg);
    }
    .service-badge-detail {
      display: inline-flex;
      align-self: flex-start;
      padding: 0.2rem 0.6rem;
      border-radius: var(--radius-pill);
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: rgba(139, 92, 246, 0.15);
      color: rgb(109, 40, 217);
    }
    .service-details {
      display: flex; flex-wrap: wrap; gap: 0.75rem;
    }
    .service-detail-item {
      display: flex; align-items: center; gap: 0.3rem;
      font-size: 0.8rem; color: var(--color-text-secondary);
    }

    .stock-minimal {
      display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem;
      .s-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; &.warn { background: #f59e0b; } &.err { background: #ef4444; } &.on-demand { background: #0ea5e9; } &.service { background: #8b5cf6; } }
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
      :host ::ng-deep .btn-more {
        padding: 0 !important;
        height: auto !important;
        margin-top: 0.4rem;
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
      }
    }

    /* ─── Mobile Compact ─── */
    @media (max-width: 640px) {
      .product-detail-page { padding: 0.75rem; }
      .breadcrumbs { margin-bottom: 0.75rem; font-size: 0.65rem; }
      .product-main-grid { gap: 1rem; margin-bottom: 1.5rem; }
      .main-image-wrapper { aspect-ratio: 3/2; border-radius: var(--radius-lg); }
      .main-image-wrapper img { padding: 0.75rem; }
      .thumbnail-list { gap: 0.4rem; margin-top: 0.5rem; }
      .thumbnail-list .thumbnail { width: 50px; height: 50px; }
      .product-info-panel { gap: 0.4rem; }
      .brand-name { font-size: 0.65rem; }
      .product-title { font-size: 1.25rem; font-weight: 700; }
      .price-line { margin: 0.25rem 0; }
      .price-line .current-price { font-size: 1.35rem; font-weight: 700; }
      .price-line .original-price { font-size: 0.85rem; }
      .variants-btns { gap: 0.35rem; }
      .purchase-box { gap: 0.5rem; margin-top: 0.25rem; }
      .stock-minimal { font-size: 0.65rem; }
      .product-content-flow { margin-top: 1rem; gap: 1rem; }
      .product-content-flow .info-label { font-size: 0.65rem; }
      .product-content-flow .cat-tag { font-size: 0.6rem; padding: 0.15rem 0.4rem; }
      .product-content-flow .desc-text { font-size: 0.8rem; line-height: 1.5; }
      .reviews-minimal { margin-top: 2rem; padding-top: 1rem; }
      .reviews-minimal .rv-title { font-size: 1rem; margin-bottom: 0.75rem; }
      .reviews-minimal .rv-grid { gap: 1.5rem; }
      .reviews-minimal .rv-form-mini { padding: 1rem; }
      .reviews-minimal .rv-form-mini textarea { height: 60px; padding: 0.5rem; font-size: 0.8rem; }
    }
  `],
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
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

  // Attribute-based variant selection
  selectedAttributes = signal<Record<string, string>>({});

  /** Extract unique attribute groups from variants: [{name: 'Color', values: ['Rojo', 'Azul']}, ...] */
  attributeGroups = computed(() => {
    const p = this.product();
    if (!p?.variants?.length) return [];
    const groups: Record<string, Set<string>> = {};
    for (const v of p.variants) {
      if (v.attributes && typeof v.attributes === 'object') {
        for (const [key, val] of Object.entries(v.attributes)) {
          if (!groups[key]) groups[key] = new Set();
          groups[key].add(String(val));
        }
      }
    }
    return Object.entries(groups).map(([name, valuesSet]) => ({
      name,
      values: Array.from(valuesSet),
    }));
  });

  /** Whether the product uses attribute-based variant selection */
  hasAttributeGroups = computed(() => this.attributeGroups().length > 0);

  /** Variant that matches the current full attribute selection */
  matchedVariant = computed((): ProductVariantDetail | null => {
    const p = this.product();
    const sel = this.selectedAttributes();
    const groups = this.attributeGroups();
    if (!p?.variants?.length || !groups.length) return null;
    // Only match when all groups have a selection
    if (Object.keys(sel).length < groups.length) return null;
    return p.variants.find(v => {
      if (!v.attributes || typeof v.attributes !== 'object') return false;
      return groups.every(g => String(v.attributes[g.name]) === sel[g.name]);
    }) || null;
  });

  /** Get available values for a group given current selections on other groups */
  getAvailableValues(groupName: string): string[] {
    const p = this.product();
    if (!p?.variants?.length) return [];
    const sel = this.selectedAttributes();
    const otherSelections = Object.entries(sel).filter(([k]) => k !== groupName);
    const matching = p.variants.filter(v => {
      if (!v.attributes || typeof v.attributes !== 'object') return false;
      return otherSelections.every(([k, val]) => String(v.attributes[k]) === val);
    });
    const available = new Set<string>();
    for (const v of matching) {
      if (v.attributes[groupName]) available.add(String(v.attributes[groupName]));
    }
    return Array.from(available);
  }

  /** Price difference badge for a variant value */
  getPriceDiffForValue(groupName: string, value: string): number | null {
    const p = this.product();
    if (!p?.variants?.length) return null;
    const sel = { ...this.selectedAttributes(), [groupName]: value };
    const groups = this.attributeGroups();
    // Only show price diff when selection would be complete
    if (Object.keys(sel).length < groups.length) return null;
    const variant = p.variants.find(v => {
      if (!v.attributes || typeof v.attributes !== 'object') return false;
      return groups.every(g => String(v.attributes[g.name]) === sel[g.name]);
    });
    if (!variant) return null;
    const diff = variant.final_price - p.final_price;
    return Math.abs(diff) > 0.01 ? diff : null;
  }

  // Variant-aware computed signals
  selectedVariant = computed((): ProductVariantDetail | null => {
    // Prefer attribute-based matching
    const matched = this.matchedVariant();
    if (matched) return matched;
    // Fallback to direct ID selection (for variants without attributes)
    const p = this.product();
    const vid = this.selectedVariantId();
    if (!p || !vid || !p.variants?.length) return null;
    return p.variants.find(v => v.id === vid) || null;
  });

  /** Minimum price across all variants */
  minVariantPrice = computed((): number => {
    const p = this.product();
    if (!p?.variants?.length) return p?.final_price || 0;
    return Math.min(...p.variants.map(v => v.final_price));
  });

  displayPrice = computed((): number => {
    const variant = this.selectedVariant();
    const p = this.product();
    if (variant) return variant.final_price;
    return p?.final_price || 0;
  });

  /** Show "Desde $X" when no variant is selected and prices differ */
  displayPriceLabel = computed((): string | null => {
    const variant = this.selectedVariant();
    const p = this.product();
    if (variant || !p?.variants?.length) return null;
    const prices = p.variants.map(v => v.final_price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (max - min < 0.01) return null;
    return 'Desde';
  });

  displayStock = computed((): number => {
    const variant = this.selectedVariant();
    const p = this.product();
    if (variant) return variant.stock_quantity;
    if (p?.variants?.length) {
      return p.variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
    }
    return p?.stock_quantity || 0;
  });

  /** True when the product does not track inventory (bajo pedido / made-to-order) */
  isOnDemand = computed((): boolean => {
    const p = this.product();
    return p?.track_inventory === false;
  });

  /** True when the product is a service */
  isService = computed((): boolean => {
    const p = this.product();
    return p?.product_type === 'service';
  });

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Share Modal
  shareModalOpen = false;

  // Recommendations
  recommendedProducts = signal<EcommerceProduct[]>([]);

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

  // Convert ProductDetail to EcommerceProduct for ShareModal
  productForShare = computed((): EcommerceProduct | null => {
    const p = this.product();
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      base_price: p.base_price,
      final_price: p.final_price,
      is_on_sale: p.is_on_sale,
      image_url: p.image_url,
      stock_quantity: p.stock_quantity,
      brand: p.brand,
      categories: p.categories,
    } as EcommerceProduct;
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
          if (product.variants?.length) {
            const firstVariant = product.variants[0];
            this.selectedVariantId.set(firstVariant.id);
            // Initialize attribute-based selection from first variant's attributes
            if (firstVariant.attributes && typeof firstVariant.attributes === 'object') {
              const attrs: Record<string, string> = {};
              for (const [k, v] of Object.entries(firstVariant.attributes)) {
                attrs[k] = String(v);
              }
              this.selectedAttributes.set(attrs);
            }
          }
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

  selectVariant(variant: ProductVariantDetail): void {
    this.selectedVariantId.set(variant.id);
    // Update main image if variant has its own image
    if (variant.image_url) {
      this.activeImageUrl.set(variant.image_url);
    }
    // Reset quantity if it exceeds variant stock (skip for on-demand products)
    if (!this.isOnDemand() && this.quantity() > variant.stock_quantity) {
      this.quantity.set(Math.max(1, variant.stock_quantity));
    }
  }

  selectAttributeValue(groupName: string, value: string): void {
    this.selectedAttributes.update(current => {
      const next = { ...current };
      // Toggle off if re-clicking the same value
      if (next[groupName] === value) {
        delete next[groupName];
      } else {
        next[groupName] = value;
      }
      return next;
    });
    // If the matched variant is resolved, update the selected variant ID and image
    const matched = this.matchedVariant();
    if (matched) {
      this.selectedVariantId.set(matched.id);
      if (matched.image_url) {
        this.activeImageUrl.set(matched.image_url);
      }
      if (!this.isOnDemand() && this.quantity() > matched.stock_quantity) {
        this.quantity.set(Math.max(1, matched.stock_quantity));
      }
    } else {
      this.selectedVariantId.set(null);
    }
  }

  toggleDescription(): void { this.isDescriptionExpanded.update(v => !v); }

  onAddToCart(product: EcommerceProduct | ProductDetail): void {
    const variantId = this.selectedVariantId() ?? undefined;
    const variant = this.selectedVariant();
    const variantInfo = variant
      ? { name: variant.name, sku: variant.sku, price: variant.final_price }
      : undefined;
    const result = this.cartService.addToCart(product.id, this.quantity(), variantId, variantInfo);
    if (result) { result.subscribe(); }
  }

  onQuickView(product: EcommerceProduct): void { this.selectedProductSlug = product.slug; this.quickViewOpen = true; }
  onShareClick(): void { this.shareModalOpen = true; }

  onBuyNow(product: ProductDetail): void {
    const variantId = this.selectedVariantId() ?? undefined;
    const variant = this.selectedVariant();
    const variantInfo = variant
      ? { name: variant.name, sku: variant.sku, price: variant.final_price }
      : undefined;
    const result = this.cartService.addToCart(product.id, this.quantity(), variantId, variantInfo);
    if (result) {
      result.subscribe(() => this.router.navigate(['/cart']));
    } else {
      this.router.navigate(['/cart']);
    }
  }

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
