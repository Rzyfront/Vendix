import { Component, OnInit, inject, DestroyRef, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CatalogService, ProductDetail, ProductVariantDetail, EcommerceProduct, CatalogQuery } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { EcommerceReviewsService } from '../../services/reviews.service';
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
    
              @if (p.avg_rating) {
                <div class="rating-line">
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
              }
    
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
    
                @if (p.description) {
                  <div class="info-section">
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
                }
              </div>
            </div>
          </div>
    
          <!-- Recommendations Carousel -->
          <app-product-carousel
            title="Productos sugeridos"
            [products]="recommendedProducts()"
            (quick_view)="onQuickView($event)"
            />
    
          <!-- Reviews Section -->
          <div class="reviews-section">
            <h3 class="rv-section-title">Opiniones ({{ reviewsTotalCount() }})</h3>
    
            <!-- Rating Summary -->
            @if (reviewsTotalCount() > 0) {
              <div class="rv-summary">
                <div class="rv-summary-left">
                  <span class="rv-avg">{{ avgRating() }}</span>
                  <div class="rv-avg-stars">
                    @for (s of [1,2,3,4,5]; track s) {
                      <app-icon name="star" [size]="16" [class]="s <= avgRating() ? 'text-warning fill-warning' : 'text-gray-300'" />
                    }
                  </div>
                  <span class="rv-total">{{ reviewsTotalCount() }} opiniones</span>
                </div>
                <div class="rv-bars">
                  @for (star of [5,4,3,2,1]; track star) {
                    <div class="rv-bar-row">
                      <span class="rv-bar-label">{{ star }}</span>
                      <app-icon name="star" [size]="10" class="text-warning fill-warning" />
                      <div class="rv-bar-track">
                        <div class="rv-bar-fill" [style.width.%]="reviewsTotalCount() > 0 ? (ratingDistribution()[star] / reviewsTotalCount() * 100) : 0"></div>
                      </div>
                      <span class="rv-bar-count">{{ ratingDistribution()[star] }}</span>
                    </div>
                  }
                </div>
              </div>
            }
    
            <!-- Sort controls -->
            @if (reviewsTotalCount() > 0) {
              <div class="rv-sort">
                <button [class.active]="reviewsSortBy() === 'recent'" (click)="onReviewsSortChange('recent')">Más recientes</button>
                <button [class.active]="reviewsSortBy() === 'helpful'" (click)="onReviewsSortChange('helpful')">Más útiles</button>
              </div>
            }
    
            <!-- Reviews List -->
            <div class="rv-list">
              @if (reviewsLoading()) {
                <div class="rv-loading">Cargando opiniones...</div>
              } @else {
                @for (review of latestReviews(); track review.id) {
                  <div class="rv-card">
                    <div class="rv-top">
                      <div class="rv-user-info">
                        <span class="rv-user">{{ review.users?.first_name }} {{ review.users?.last_name }}</span>
                        @if (review.verified_purchase) {
                          <span class="rv-verified">Compra verificada</span>
                        }
                      </div>
                      <div class="rv-stars">
                        @for (s of [1,2,3,4,5]; track s) {
                          <app-icon name="star" [size]="12" [class]="s <= review.rating ? 'text-warning fill-warning' : 'text-gray-300'" />
                        }
                      </div>
                    </div>
                    @if (review.title) {
                      <p class="rv-title-text">{{ review.title }}</p>
                    }
                    <p class="rv-text">{{ review.comment }}</p>
                    <div class="rv-footer">
                      <span class="rv-date">{{ review.created_at | date:'mediumDate' }}</span>
                      <div class="rv-helpful">
                        <span>{{ review.helpful_count || 0 }} útil</span>
                        <button class="rv-vote-btn" (click)="onVoteReview(review.id, true)" title="Útil">
                          <app-icon name="thumbs-up" [size]="14" />
                        </button>
                        <button class="rv-vote-btn" (click)="onVoteReview(review.id, false)" title="No útil">
                          <app-icon name="thumbs-down" [size]="14" />
                        </button>
                      </div>
                    </div>
                    @if (review.review_responses) {
                      <div class="rv-response">
                        <span class="rv-response-label">Respuesta del vendedor:</span>
                        <p>{{ review.review_responses.content }}</p>
                      </div>
                    }
                  </div>
                }
                @empty {
                <p class="rv-empty">Aún no hay opiniones para este producto.</p>
              }
            }
          </div>
    
          <!-- Pagination -->
          @if (reviewsTotalPages() > 1) {
            <div class="rv-pagination">
              @for (pg of [].constructor(reviewsTotalPages()); track $index) {
                <button
                  class="rv-page-btn"
                  [class.active]="reviewsPage() === $index + 1"
                  (click)="onReviewsPageChange($index + 1)"
                >{{ $index + 1 }}</button>
              }
            </div>
          }
    
          <!-- Write Review Form -->
          <div class="rv-form-section">
            @if (reviewSubmitted()) {
              <div class="rv-submitted">
                <app-icon name="check-circle" [size]="24" class="text-green-500" />
                <p>Tu reseña fue enviada y está pendiente de moderación.</p>
              </div>
            } @else if (canWriteReview()?.can_review) {
              <h4 class="rv-form-title">Escribe tu opinión</h4>
              <form [formGroup]="reviewForm" (ngSubmit)="onSubmitReview()">
                <div class="star-picker">
                  @for (s of [1,2,3,4,5]; track s) {
                    <app-icon
                      name="star"
                      [size]="24"
                      [class]="s <= (reviewForm.get('rating')?.value ?? 0) ? 'text-warning fill-warning cursor-pointer' : 'text-gray-300 cursor-pointer'"
                      (click)="reviewForm.get('rating')?.setValue(s)"
                      />
                  }
                </div>
                <input type="text" formControlName="title" placeholder="Título (opcional)" class="rv-input" />
                <textarea formControlName="comment" placeholder="Comparte tu opinión..." class="rv-textarea"></textarea>
                <app-button
                  type="submit"
                  variant="primary"
                  size="sm"
                  [fullWidth]="true"
                  [disabled]="reviewForm.invalid || reviewSubmitting()"
                  >
                  {{ reviewSubmitting() ? 'Enviando...' : 'Publicar opinión' }}
                </app-button>
              </form>
            } @else if (canWriteReview()?.reason === 'already_reviewed') {
              <p class="rv-info">Ya has dejado una reseña para este producto.</p>
            } @else if (canWriteReview()?.reason === 'no_purchase') {
              <p class="rv-info">Compra este producto para dejar una reseña.</p>
            }
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

    .reviews-section {
      margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--color-border);
      .rv-section-title { font-size: 1.25rem; font-weight: 800; margin-bottom: 1.5rem; }
      .rv-summary { display: flex; gap: 2rem; margin-bottom: 2rem; padding: 1.5rem; background: var(--color-surface); border-radius: var(--radius-lg); }
      .rv-summary-left { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; min-width: 100px; }
      .rv-avg { font-size: 2.5rem; font-weight: 800; line-height: 1; }
      .rv-avg-stars { display: flex; gap: 2px; }
      .rv-total { font-size: 0.75rem; color: var(--color-text-muted); }
      .rv-bars { flex: 1; display: flex; flex-direction: column; gap: 0.35rem; justify-content: center; }
      .rv-bar-row { display: flex; align-items: center; gap: 0.5rem; }
      .rv-bar-label { font-size: 0.75rem; font-weight: 600; width: 12px; text-align: right; }
      .rv-bar-track { flex: 1; height: 8px; background: var(--color-border-light); border-radius: 4px; overflow: hidden; }
      .rv-bar-fill { height: 100%; background: var(--color-warning); border-radius: 4px; transition: width 0.3s ease; }
      .rv-bar-count { font-size: 0.7rem; color: var(--color-text-muted); width: 20px; }
      .rv-sort { display: flex; gap: 0.5rem; margin-bottom: 1.5rem;
        button { padding: 0.4rem 0.8rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: transparent; font-size: 0.8rem; cursor: pointer; color: var(--color-text-secondary);
          &.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
        }
      }
      .rv-list { display: flex; flex-direction: column; }
      .rv-card { padding: 1rem 0; border-bottom: 1px solid var(--color-border-light); }
      .rv-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.4rem; }
      .rv-user-info { display: flex; flex-direction: column; gap: 0.15rem; }
      .rv-user { font-weight: 700; font-size: 0.9rem; }
      .rv-verified { font-size: 0.65rem; color: var(--color-success); font-weight: 600; }
      .rv-stars { display: flex; gap: 1px; }
      .rv-title-text { font-weight: 700; font-size: 0.875rem; margin: 0.25rem 0; }
      .rv-text { font-size: 0.875rem; color: var(--color-text-secondary); margin: 0.25rem 0 0; }
      .rv-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; }
      .rv-date { font-size: 0.7rem; color: var(--color-text-muted); }
      .rv-helpful { display: flex; align-items: center; gap: 0.5rem; font-size: 0.7rem; color: var(--color-text-muted); }
      .rv-vote-btn { background: none; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.2rem 0.4rem; cursor: pointer; display: flex; align-items: center; color: var(--color-text-muted);
        &:hover { background: var(--color-surface); color: var(--color-text-primary); }
      }
      .rv-response { margin-top: 0.75rem; padding: 0.75rem; background: var(--color-surface); border-radius: var(--radius-md); border-left: 3px solid var(--color-primary); }
      .rv-response-label { font-size: 0.75rem; font-weight: 700; color: var(--color-primary); display: block; margin-bottom: 0.25rem; }
      .rv-response p { font-size: 0.8rem; margin: 0; color: var(--color-text-secondary); }
      .rv-empty { text-align: center; padding: 2rem; color: var(--color-text-muted); font-size: 0.9rem; }
      .rv-loading { text-align: center; padding: 2rem; color: var(--color-text-muted); }
      .rv-pagination { display: flex; justify-content: center; gap: 0.5rem; margin-top: 1.5rem; }
      .rv-page-btn { width: 32px; height: 32px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: transparent; cursor: pointer; font-size: 0.8rem;
        &.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
      }
      .rv-form-section { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--color-border-light); }
      .rv-form-title { font-size: 1rem; font-weight: 700; margin-bottom: 1rem; }
      .rv-input { width: 100%; padding: 0.6rem 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 0.75rem; font-size: 0.875rem; background: var(--color-background); }
      .rv-textarea { width: 100%; height: 80px; padding: 0.75rem; border-radius: var(--radius-md); border: 1px solid var(--color-border); margin-bottom: 0.75rem; font-size: 0.875rem; resize: none; background: var(--color-background); }
      .star-picker { display: flex; gap: 0.25rem; margin-bottom: 1rem; }
      .rv-submitted { display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: var(--color-surface); border-radius: var(--radius-md);
        p { margin: 0; font-size: 0.875rem; color: var(--color-success); }
      }
      .rv-info { font-size: 0.875rem; color: var(--color-text-muted); padding: 1rem; background: var(--color-surface); border-radius: var(--radius-md); }
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
      .reviews-section { margin-top: 2rem; padding-top: 1rem; }
      .reviews-section .rv-section-title { font-size: 1rem; margin-bottom: 0.75rem; }
      .reviews-section .rv-summary { flex-direction: column; gap: 1rem; padding: 1rem; }
      .reviews-section .rv-summary-left { flex-direction: row; gap: 0.75rem; }
      .reviews-section .rv-avg { font-size: 1.75rem; }
      .reviews-section .rv-textarea { height: 60px; font-size: 0.8rem; }
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
  private reviewsService = inject(EcommerceReviewsService);

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
    title: [''],
    comment: ['', [Validators.required, Validators.minLength(10)]],
  });

  // Reviews state
  reviewsList = signal<any[]>([]);
  reviewsLoading = signal(false);
  reviewsPage = signal(1);
  reviewsTotalPages = signal(1);
  reviewsTotalCount = signal(0);
  reviewsSortBy = signal<'recent' | 'helpful'>('recent');
  ratingDistribution = signal<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  avgRating = signal(0);
  canWriteReview = signal<{ can_review: boolean; reason?: string } | null>(null);
  reviewSubmitting = signal(false);
  reviewSubmitted = signal(false);

  // Computed
  latestReviews = computed(() => this.reviewsList());

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
          this.loadReviews(product.id);
          this.checkCanReview(product.id);
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

  loadReviews(productId: number): void {
    this.reviewsLoading.set(true);
    this.reviewsService.getProductReviews(productId, {
      page: this.reviewsPage(),
      limit: 5,
      sort_by: this.reviewsSortBy(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success !== false) {
          this.reviewsList.set(res.reviews || []);
          this.reviewsTotalPages.set(res.meta?.totalPages || 1);
          this.reviewsTotalCount.set(res.total_count || 0);
          this.ratingDistribution.set(res.rating_distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
          this.avgRating.set(res.avg_rating || 0);
        }
        this.reviewsLoading.set(false);
      },
      error: () => this.reviewsLoading.set(false),
    });
  }

  checkCanReview(productId: number): void {
    this.reviewsService.canReview(productId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        if (res.success !== false) {
          this.canWriteReview.set(res.data);
        }
      },
    });
  }

  onReviewsPageChange(page: number): void {
    this.reviewsPage.set(page);
    const p = this.product();
    if (p) this.loadReviews(p.id);
  }

  onReviewsSortChange(sortBy: 'recent' | 'helpful'): void {
    this.reviewsSortBy.set(sortBy);
    this.reviewsPage.set(1);
    const p = this.product();
    if (p) this.loadReviews(p.id);
  }

  onVoteReview(reviewId: number, isHelpful: boolean): void {
    this.reviewsService.voteReview(reviewId, isHelpful).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        const p = this.product();
        if (p) this.loadReviews(p.id);
      },
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
    // For services that require booking, redirect to booking page
    if ('requires_booking' in product && product.requires_booking &&
        'product_type' in product && product.product_type === 'service') {
      this.router.navigate(['/book', product.id]);
      return;
    }
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
    // For services that require booking, go to booking page
    if (this.isService() && product.requires_booking) {
      this.router.navigate(['/book', product.id]);
      return;
    }
    // For regular products or services without booking, add to cart and go to cart
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
    const p = this.product();
    if (!p) return;
    this.reviewSubmitting.set(true);
    this.reviewsService.submitReview({
      product_id: p.id,
      rating: this.reviewForm.get('rating')?.value ?? 5,
      title: this.reviewForm.get('title')?.value || undefined,
      comment: this.reviewForm.get('comment')?.value ?? '',
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.reviewSubmitting.set(false);
        this.reviewSubmitted.set(true);
        this.reviewForm.reset({ rating: 5, comment: '', title: '' });
        this.loadReviews(p.id);
        this.checkCanReview(p.id);
      },
      error: () => this.reviewSubmitting.set(false),
    });
  }
}
