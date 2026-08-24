import {
  Component,
  inject,
  DestroyRef,
  input,
  output,
  effect,
  signal,
  computed,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { resolvePackSize } from '../../../../../shared/services/pricing';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { SpinnerComponent } from '../../../../../shared/components/spinner/spinner.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { CatalogService, ProductDetail, ProductVariantDetail, EcommerceProduct, SaleUnitOption, formatMenuNextAvailable } from '../../services/catalog.service';
import { AddProductOptions, CartService } from '../../services/cart.service';
import { SaleUnitSelectorComponent } from '../sale-unit-selector/sale-unit-selector.component';
import { TableContextService } from '../../services/table-context.service';
import { ShareModalComponent } from '../share-modal/share-modal.component';
import {
  PromotionStackComponent,
  PromotionStackItem,
} from '../../../../../shared/components/promotion-stack/promotion-stack.component';

@Component({
  selector: 'app-product-quick-view-modal',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    ModalComponent,
    SpinnerComponent,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    QuantityControlComponent,
    ShareModalComponent,
    CurrencyPipe,
    SaleUnitSelectorComponent,
    PromotionStackComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (closed)="onClose()"
      size="md"
      [title]="product()?.name || 'Vista Rápida'"
      [overlayCloseButton]="true"
    >
      <!-- Loading State -->
      @if (isLoading()) {
        <div class="quick-view-loading">
          <app-spinner size="lg" text="Cargando producto..." [center]="true"></app-spinner>
        </div>
      }

      <!-- Product Content -->
      @if (!isLoading() && product(); as prod) {
        <div class="quick-view-content" [attr.data-currency]="currencyCode()">
          <!-- Image Section -->
          <div class="quick-view-image-col">
            <div class="quick-view-image">
              @if (displayImageUrl()) {
                <img [src]="displayImageUrl()" [alt]="prod.name" />
              } @else {
                <div class="no-image">
                  <app-icon name="image" [size]="48" />
                </div>
              }
              @if (prod.is_on_sale && !selectedVariant()?.price_override) {
                <span class="sale-badge">Oferta</span>
              }
            </div>
            <!-- Description below image -->
            @if (prod.description) {
              <p class="product-description">{{ truncatedDescription() }}</p>
            }
          </div>

          <!-- Info Section -->
          <div class="quick-view-info">
            <!-- Brand -->
            @if (prod.brand) {
              <span class="product-brand">{{ prod.brand.name }}</span>
            }

            <!-- Rating -->
            @if (prod.avg_rating) {
              <div class="product-rating">
                <span class="stars">
                  @for (star of [1,2,3,4,5]; track star) {
                    <app-icon
                      [name]="star <= prod.avg_rating ? 'star' : 'star'"
                      [size]="14"
                      [class]="star <= prod.avg_rating ? 'text-warning fill-warning' : 'text-gray-300'"
                    />
                  }
                </span>
                <span class="rating-count">({{ prod.review_count }} reseñas)</span>
              </div>
            }

            <!-- Price -->
            <div class="product-price flex items-baseline flex-wrap gap-2">
              <span class="current-price text-xl md:text-2xl font-extrabold text-text-primary">
                {{ (hasActiveDiscount() ? effectiveUnitPrice() : displayPrice()) | currency }}
              </span>
              @if (selectedPresentation(); as unit) {
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  / {{ unit.name }}
                </span>
              }
              @if (hasActiveDiscount() || (prod.is_on_sale && !selectedVariant()?.price_override)) {
                <span class="original-price text-sm text-text-muted line-through opacity-70">
                  {{ (hasActiveDiscount() ? displayPrice() : prod.base_price) | currency }}
                </span>
              }
              @if (hasActiveDiscount() && activePromoDiscount()?.type === 'percentage') {
                <span class="savings-pill inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white shadow-xs">
                  -{{ activePromoDiscount()?.value }}% OFF
                </span>
              } @else if (promotionBadgeLabel()) {
                <span class="discount-badge">{{ promotionBadgeLabel() }}</span>
              }
            </div>

            <!-- Dynamic Live Total & Savings breakdown when quantity > 1 or discount is active -->
            @if ((quantity() > 1) || hasActiveDiscount()) {
              <div class="total-breakdown-card p-2.5 rounded-lg bg-surface border border-border/70 flex items-center justify-between gap-3 shadow-xs my-2">
                <div class="flex flex-col">
                  <span class="text-[11px] text-text-secondary font-medium">
                    Total por {{ quantity() }} {{ quantity() === 1 ? (selectedPresentation()?.name || 'unidad') : (selectedPresentation()?.name ? quantity() + ' ' + selectedPresentation()?.name : 'unidades') }}:
                  </span>
                  <div class="flex items-baseline gap-2">
                    <span class="text-lg font-bold text-primary dark:text-primary-light">
                      {{ totalFinalPrice() | currency }}
                    </span>
                    @if (hasActiveDiscount()) {
                      <span class="text-xs text-text-muted line-through">
                        {{ totalUndiscountedPrice() | currency }}
                      </span>
                    }
                  </div>
                </div>

                @if (hasActiveDiscount()) {
                  <div class="flex flex-col items-end">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      🎉 ¡Ahorro!
                    </span>
                    <span class="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                      -{{ totalSavingsAmount() | currency }}
                    </span>
                  </div>
                }
              </div>
            }

            @if (
              prod.active_promotion?.quantity_tiers?.length ||
              prod.active_promotion?.badge_label
            ) {
              <div class="quick-view-promotions mb-3">
                <app-promotion-stack
                  mode="expanded-cards"
                  [items]="expandedTierItems()"
                  [currentQuantity]="quantity()"
                  [unitsPerPackage]="packSize()"
                  [ariaLabel]="'Niveles de descuento por cantidad'"
                  (tierSelected)="quantity.set($event.package_quantity)"
                />
              </div>
            }

            <!-- Presentaciones de venta (multitarifa). Por QUI-648 un
                 producto tiene presentaciones O variantes, nunca ambas: los
                 dos selectores no coexisten. -->
            @if (hasSaleUnitChoice()) {
              <div class="sale-unit-selector-wrap">
                <label class="variant-label">Presentación:</label>
                <app-sale-unit-selector
                  [options]="saleUnits()"
                  [selectedTierId]="selectedTierId()"
                  (selectedTierIdChange)="onSaleUnitChange($event)"
                />
              </div>
            }

            <!-- Variant Selector -->
            @if (prod.variants && prod.variants.length > 0) {
              <div class="variant-selector">
                <div class="variant-header">
                  <label class="variant-label">Variante:</label>
                  <span class="variant-info-icon" title="Este producto tiene diferentes opciones. Selecciona la que prefieras.">
                    <app-icon name="info" [size]="14" />
                  </span>
                </div>
                <div class="variant-chips">
                  @for (variant of prod.variants; track variant.id) {
                    <button
                      class="variant-chip"
                      [class.selected]="selectedVariant()?.id === variant.id"
                      [class.out-of-stock]="!isVariantAvailable(variant)"
                      [disabled]="!isVariantAvailable(variant)"
                      (click)="selectVariant(variant)"
                    >
                      {{ getVariantLabel(variant) }}
                    </button>
                  }
                </div>
              </div>
            }

            <!-- Categories Mini Badges -->
            @if (prod.categories && prod.categories.length > 0) {
              <div class="category-badges">
                @for (cat of prod.categories; track cat.id) {
                  <span class="cat-badge">{{ cat.name }}</span>
                }
              </div>
            }

            <!-- Stock Status -->
            <div class="stock-status">
              @if (isOffSchedule()) {
                <app-badge variant="warning">
                  Disponible {{ formatNextAvailable() }}
                </app-badge>
              } @else if (isOnDemand()) {
                <span class="on-demand">
                  <app-icon name="package" [size]="14" /> Disponible bajo pedido
                </span>
              } @else if (displayStock() === 0) {
                <span class="out-of-stock">
                  <app-icon name="circle-x" [size]="14" /> Agotado
                </span>
              } @else if (displayStock() !== null && displayStock()! <= 5) {
                <span class="low-stock">
                  <app-icon name="alert-triangle" [size]="14" /> ¡Solo quedan {{ displayStock() }}!
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
              <!-- Cuenta PAQUETES; unitsPerPackage sólo pinta el hint
                   "= N u." y jamás multiplica dinero. -->
              <app-quantity-control
                [value]="quantity()"
                [min]="1"
                [max]="isOnDemand() ? 999 : (displayStock() || 99)"
                [unitsPerPackage]="packSize()"
                [size]="'sm'"
                (valueChange)="quantity.set($event)"
              />
            </div>

            @if (selectedPresentation(); as unit) {
              <!-- Nombre VERBATIM ("2 Rollo 20 m"): derivar el plural español
                   de un nombre libre produce "Rollo 20 ms". -->
              <p class="sale-unit-line">{{ quantity() }} {{ unit.name }}</p>
            }

            <!-- Actions -->
            @if (!hideDineInPurchase()) {
              <div class="quick-view-actions">
                <app-button
                  variant="secondary"
                  size="sm"
                  [fullWidth]="true"
                  [disabled]="purchaseDisabled()"
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
                [disabled]="purchaseDisabled()"
                (clicked)="onBuyNow()"
              >
                <app-icon slot="icon" [name]="prod.requires_booking && prod.product_type === 'service' ? 'calendar-check' : 'shopping-bag'" [size]="18" />
                {{ prod.requires_booking && prod.product_type === 'service' ? 'Agendar ahora' : 'Comprar ahora' }}
              </app-button>
            }

            <!-- View Full Details Link -->
            <a class="view-details-link" [routerLink]="['/catalog', prod.slug]" (click)="onClose()">
              Ver todos los detalles
              <app-icon name="chevron-right" [size]="14" />
            </a>
          </div>
        </div>
      }

      <!-- Error State -->
      @if (!isLoading() && !product() && hasError()) {
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
      [isOpen]="shareModalOpen()"
      [product]="productForShare()"
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

      .discount-badge {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 0.2rem 0.5rem;
        border-radius: 999px;
        background: var(--color-success-light);
        color: var(--color-success);
        font-size: var(--fs-xs);
        font-weight: var(--fw-bold);
        line-height: 1;
        white-space: nowrap;
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

      .on-demand {
        color: #0ea5e9;
      }
    }

    .sale-unit-selector-wrap {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
    }

    .sale-unit-line {
      margin: 0.35rem 0 0;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--color-text-secondary);
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
export class ProductQuickViewModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly productSlug = input<string | null>(null);
  readonly closed = output<void>();
  readonly addedToCart = output<ProductDetail>();

  readonly product = signal<ProductDetail | null>(null);
  readonly selectedVariant = signal<ProductVariantDetail | null>(null);
  readonly isLoading = signal(false);
  readonly hasError = signal(false);
  readonly quantity = signal(1);
  readonly shareModalOpen = signal(false);

  // ── Multitarifa: presentaciones de venta ──────────────────────────────
  /**
   * Presentación elegida. Se siembra en el `next` del subscribe de
   * `loadProduct`, NUNCA desde un `effect()`: escribirla en un effect
   * alimentaría `selectedSaleUnit` / `packSize` / `displayPrice` en el mismo
   * tick en que se leen, que es lo que zoneless prohíbe.
   */
  readonly selectedTierId = signal<number | null>(null);

  readonly saleUnits = computed<SaleUnitOption[]>(
    () => this.product()?.available_sale_units ?? [],
  );

  /** El comprador DEBE elegir presentación. Mismo criterio que el detalle. */
  readonly hasSaleUnitChoice = computed<boolean>(() => {
    const p = this.product();
    if (!p) return false;
    const count = p.sale_unit_count ?? this.saleUnits().length;
    return count > 1 && this.saleUnits().length > 1;
  });

  /**
   * Opción elegida. `selectedTierId() === null` es la UNIDAD SUELTA —una opción
   * publicada por el backend con `price_tier_id: null`—, no "sin elección".
   * Mismo contrato que el detalle de producto.
   */
  readonly selectedSaleUnit = computed<SaleUnitOption | null>(() => {
    const tierId = this.selectedTierId();
    return (
      this.saleUnits().find((unit) => unit.price_tier_id === tierId) ?? null
    );
  });

  /** La elección solo cuando es una presentación real (nunca la unidad suelta). */
  readonly selectedPresentation = computed<SaleUnitOption | null>(() => {
    const unit = this.selectedSaleUnit();
    return unit && unit.price_tier_id !== null ? unit : null;
  });

  /** packSize efectivo (>= 1). Sólo stock/envío/texto — nunca dinero. */
  readonly packSize = computed<number>(() =>
    resolvePackSize(this.selectedSaleUnit()?.units_per_package ?? null),
  );

  readonly hasVariants = computed(() => {
    const p = this.product();
    return !!p?.variants && p.variants.length > 0;
  });

  readonly displayPrice = computed(() => {
    // El `price` de la presentación YA es el del PAQUETE ENTERO con impuesto,
    // resuelto por el backend. El frontend nunca resuelve precios.
    const unit = this.selectedSaleUnit();
    if (unit) return unit.price;
    const v = this.selectedVariant();
    if (v) return v.final_price;
    return this.product()?.final_price || 0;
  });

  /**
   * True when the active promotion is quantity-tiered. No single-unit discount
   * (price stays normal); we only surface the informative badge (e.g. "Desde 3
   * und: descuento"). Mirrors ProductCardComponent.isQuantityTiered().
   */
  readonly isQuantityTiered = computed(
    () => this.product()?.active_promotion?.is_quantity_tiered === true,
  );

  /** Informative label for the active promotion badge. */
  readonly promotionBadgeLabel = computed(
    () => this.product()?.active_promotion?.badge_label ?? '',
  );

  /** Unidades base acumuladas considerando unidades por presentación */
  readonly effectiveBaseUnits = computed<number>(() => {
    return (this.quantity() || 1) * this.packSize();
  });

  /** Subtotal sin descuentos por la cantidad seleccionada */
  readonly totalUndiscountedPrice = computed<number>(() => {
    return this.displayPrice() * (this.quantity() || 1);
  });

  /** Porcentaje o monto de descuento activo según el tramo alcanzado */
  readonly activePromoDiscount = computed<{
    type: 'percentage' | 'fixed_amount';
    value: number;
    amount: number;
    tierLabel?: string;
  } | null>(() => {
    const promo = this.product()?.active_promotion;
    if (!promo) return null;
    const baseQty = this.effectiveBaseUnits();
    const undiscounted = this.totalUndiscountedPrice();

    if (promo.quantity_tiers && Array.isArray(promo.quantity_tiers) && promo.quantity_tiers.length > 0) {
      const sorted = [...promo.quantity_tiers].sort((a, b) => b.min_quantity - a.min_quantity);
      const match = sorted.find((t) => baseQty >= t.min_quantity && (!t.max_quantity || baseQty <= t.max_quantity));
      if (match) {
        const isFixed = match.type === 'fixed_amount';
        const amount = isFixed
          ? match.value * (this.quantity() || 1)
          : (undiscounted * match.value) / 100;
        return {
          type: isFixed ? 'fixed_amount' : 'percentage',
          value: match.value,
          amount: Math.min(undiscounted, amount),
          tierLabel: promo.badge_label,
        };
      }
      return null;
    }

    if (promo.discount_percentage && promo.discount_percentage > 0) {
      const amount = (undiscounted * promo.discount_percentage) / 100;
      return {
        type: 'percentage',
        value: promo.discount_percentage,
        amount: Math.min(undiscounted, amount),
        tierLabel: promo.badge_label,
      };
    }

    if (promo.discount_amount && promo.discount_amount > 0) {
      const amount = Math.min(undiscounted, promo.discount_amount * (this.quantity() || 1));
      return {
        type: 'fixed_amount',
        value: promo.discount_amount,
        amount,
        tierLabel: promo.badge_label,
      };
    }

    return null;
  });

  /** Total final a pagar tras aplicar el descuento del tramo */
  readonly totalFinalPrice = computed<number>(() => {
    const discount = this.activePromoDiscount()?.amount ?? 0;
    return Math.max(0, this.totalUndiscountedPrice() - discount);
  });

  /** Precio unitario efectivo con el descuento aplicado */
  readonly effectiveUnitPrice = computed<number>(() => {
    const qty = this.quantity() || 1;
    return this.totalFinalPrice() / qty;
  });

  /** Ahorro total acumulado */
  readonly totalSavingsAmount = computed<number>(() => {
    return this.activePromoDiscount()?.amount ?? 0;
  });

  /** ¿Hay descuento activo aplicado en la cantidad actual? */
  readonly hasActiveDiscount = computed<boolean>(() => {
    return this.totalSavingsAmount() > 0.01;
  });

  readonly expandedTierItems = computed<PromotionStackItem[]>(() => {
    const promo = this.product()?.active_promotion;
    if (!promo) return [];

    const tiers = promo.quantity_tiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
      return sorted.map((tier, index) => ({
        id: `${promo.id}-modal-tier-${index}`,
        original_promotion_id: promo.id,
        label: promo.badge_label,
        type: promo.type,
        value: tier.value,
        scope: promo.scope,
        min_quantity: tier.min_quantity,
        max_quantity: tier.max_quantity ?? null,
        tier_index: index,
      }));
    }

    if (promo.badge_label) {
      return [
        {
          id: promo.id,
          label: promo.badge_label,
          type: promo.type,
          value:
            promo.discount_percentage ?? promo.discount_amount ?? undefined,
          scope: promo.scope,
        },
      ];
    }

    return [];
  });

  readonly displayStock = computed<number | null>(() => {
    // Con presentación elegida el stock son PAQUETES de ESA presentación.
    // `available_packages === null` = no rastrea inventario (NO agotado).
    const unit = this.selectedSaleUnit();
    if (unit) return unit.available_packages ?? 999;

    const v = this.selectedVariant();
    if (v && !this.variantTracksInventory(v)) return 999;
    if (v) return v.stock_quantity;
    return this.product()?.stock_quantity ?? null;
  });

  readonly isOnDemand = computed(() => {
    const variant = this.selectedVariant();
    if (variant) return !this.variantTracksInventory(variant);
    return this.product()?.track_inventory === false;
  });

  /** True when a menu (carta) schedule marks the dish unavailable right now. */
  readonly isOffSchedule = computed(
    () => this.product()?.is_available_now === false,
  );

  readonly purchaseDisabled = computed(() => {
    if (this.isOffSchedule()) return true;
    // Sin presentación elegida no hay precio ni escala que cobrar.
    if (this.hasSaleUnitChoice() && !this.selectedSaleUnit()) return true;
    if (this.hasVariants() && !this.selectedVariant()) return true;
    const variant = this.selectedVariant();
    if (variant && !this.isVariantAvailable(variant)) return true;
    return !this.isOnDemand() && this.displayStock() === 0;
  });

  /** True when the QR-mode forbids ordering right now — keeps the
   *  quick-view CTAs gated by the same rule as the other 4 surfaces.
   *  The template hides them outright (UX decision: ocultar > bloquear). */
  readonly hideDineInPurchase = computed(
    () => this.tableContext.hideDineInPurchase(),
  );

  /** Short "Disponible Vie 08:00" label for the off-schedule badge. */
  formatNextAvailable(): string {
    return formatMenuNextAvailable(this.product()?.next_available ?? null);
  }

  readonly displayImageUrl = computed<string | null>(() => {
    const v = this.selectedVariant();
    if (v?.image_url) return v.image_url;
    const p = this.product();
    if (!p) return null;
    const mainImage = p.images?.find((img) => img.is_main);
    if (mainImage) return mainImage.image_url;
    if (p.images?.length) return p.images[0].image_url;
    return p.image_url;
  });

  readonly truncatedDescription = computed(() => {
    const p = this.product();
    if (!p?.description) return '';
    const maxLength = 150;
    if (p.description.length <= maxLength) return p.description;
    return p.description.substring(0, maxLength) + '...';
  });

  readonly productForShare = computed<EcommerceProduct | null>(() => {
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
      image_url: this.displayImageUrl(),
      stock_quantity: p.stock_quantity,
      brand: p.brand,
      categories: p.categories,
    } as EcommerceProduct;
  });

  private destroyRef = inject(DestroyRef);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private router = inject(Router);
  private currencyFormat = inject(CurrencyFormatService);
  /**
   * Moneda del tenant, leída por la plantilla vía `data-currency`. El
   * `CurrencyPipe` de Vendix es IMPURO: sin este atributo el modal OnPush se
   * queda con el formato de fallback si la moneda resuelve tras el primer
   * paint.
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;
  /** QR-mode-aware visibility (Step 7) — Hides purchase CTAs when the
   *  active scan mode (`menu_only` / pre-session `mark_occupied` /
   *  pre-session `require_staff`) forbids ordering right now. */
  protected readonly tableContext = inject(TableContextService);

  constructor() {
    this.currencyFormat.loadCurrency();
    effect(() => {
      if (this.isOpen() && this.productSlug()) {
        this.loadProduct();
      }
    });
  }

  selectVariant(variant: ProductVariantDetail): void {
    if (!this.isVariantAvailable(variant)) return;

    this.selectedVariant.set(
      this.selectedVariant()?.id === variant.id ? null : variant,
    );
    this.quantity.set(1);
  }

  getVariantLabel(variant: ProductVariantDetail): string {
    if (variant.attributes && typeof variant.attributes === 'object') {
      const values = Object.values(variant.attributes);
      if (values.length > 0) return values.join(' / ');
    }
    return variant.name || variant.sku;
  }

  private variantTracksInventory(variant: ProductVariantDetail): boolean {
    if (typeof variant.effective_track_inventory === 'boolean') {
      return variant.effective_track_inventory;
    }

    const productTracksInventory = this.product()?.track_inventory ?? true;
    return variant.track_inventory_override ?? productTracksInventory;
  }

  isVariantAvailable(variant: ProductVariantDetail): boolean {
    if (typeof variant.is_available === 'boolean') return variant.is_available;
    if (!this.variantTracksInventory(variant)) return true;
    return (variant.stock_quantity ?? 0) > 0;
  }

  loadProduct(): void {
    if (!this.productSlug()) return;

    this.isLoading.set(true);
    this.hasError.set(false);
    this.product.set(null);
    this.selectedVariant.set(null);
    this.selectedTierId.set(null);
    this.quantity.set(1);

    this.catalogService
      .getProductBySlug(this.productSlug()!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            const prod = response.data;
            this.product.set(prod);
            // Preselección de presentación AQUÍ, en el `next` de la carga, y
            // no en un `effect()` (ver `selectedTierId`).
            this.seedSaleUnit(prod);
            // Auto-select first available variant
            if (prod.variants?.length > 0) {
              const firstAvailable = prod.variants.find((variant) =>
                this.isVariantAvailable(variant),
              );
              this.selectedVariant.set(firstAvailable || prod.variants[0]);
            }
          } else {
            this.hasError.set(true);
          }
          this.isLoading.set(false);
        },
        error: () => {
          this.hasError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  /**
   * Siembra `selectedTierId` con la presentación por defecto DISPONIBLE.
   * Si ninguna es usable se deja en `null` y `purchaseDisabled` bloquea el
   * CTA — más honesto que preseleccionar algo que no se puede comprar.
   */
  private seedSaleUnit(product: ProductDetail): void {
    const units = product.available_sale_units ?? [];
    if (units.length === 0) {
      this.selectedTierId.set(null);
      return;
    }
    // `available_packages === null` = no rastrea inventario, NO agotado.
    const usable = (u: SaleUnitOption) =>
      u.is_available !== false && u.available_packages !== 0;
    const chosen =
      units.find((u) => u.is_default && usable(u)) ?? units.find(usable);
    this.selectedTierId.set(chosen?.price_tier_id ?? null);
    this.quantity.set(1);
  }

  /**
   * Cambio de presentación: la cantidad SIEMPRE vuelve a 1, sin convertir
   * magnitudes (el POS convierte porque el cajero ya capturó una medida
   * física; aquí el comprador sólo tocó un chip). El par
   * `[selectedTierId]` + `(selectedTierIdChange)` — en vez del azúcar
   * `[(...)]` — es lo que da el seam para hacer ese reset sin un `effect()`.
   */
  onSaleUnitChange(tierId: number | null): void {
    if (this.selectedTierId() === tierId) return;
    this.selectedTierId.set(tierId);
    this.quantity.set(1);
  }

  /**
   * Opciones de adición: variante O presentación (QUI-648 garantiza que nunca
   * coexisten). `saleUnitInfo.price` es el precio del PAQUETE ENTERO.
   */
  private buildAddOptions(): AddProductOptions {
    const sv = this.selectedVariant();
    // Unidad suelta ⇒ línea sin tarifa ni etiqueta de presentación.
    const unit = this.selectedPresentation();
    return {
      variantId: sv?.id,
      variantInfo: sv
        ? { name: sv.name, sku: sv.sku, price: sv.final_price }
        : undefined,
      priceTierId: unit?.price_tier_id ?? undefined,
      saleUnitInfo: unit
        ? {
            name: unit.name,
            units_per_package: unit.units_per_package,
            price: unit.price,
          }
        : undefined,
    };
  }

  onAddToCart(): void {
    const product = this.product();
    if (!product) return;
    // Guard: bookable services go to booking page
    if (product.requires_booking && product.product_type === 'service') {
      const productId = product.id;
      this.onClose();
      this.router.navigate(['/book', productId], {
        queryParams: this.selectedVariant()?.id
          ? { variant_id: this.selectedVariant()?.id }
          : undefined,
      });
      return;
    }
    // Chokepoint (D3): mesa-vs-cart routing lives in `cartService.addProduct`.
    // Sobrecarga de objeto para poder mandar la presentación elegida.
    const result = this.cartService.addProduct(
      product.id,
      this.quantity(),
      this.buildAddOptions(),
    );
    if (result) {
      result.subscribe();
    }
    this.addedToCart.emit(product);
    this.onClose();
  }

  onBuyNow(): void {
    const product = this.product();
    if (!product) return;
    // Guard: bookable services go to booking page
    if (product.requires_booking && product.product_type === 'service') {
      const productId = product.id;
      this.onClose();
      this.router.navigate(['/book', productId], {
        queryParams: this.selectedVariant()?.id
          ? { variant_id: this.selectedVariant()?.id }
          : undefined,
      });
      return;
    }
    // Chokepoint (D3): mesa-vs-cart routing lives in `cartService.addProduct`.
    // Sobrecarga de objeto para poder mandar la presentación elegida.
    const result = this.cartService.addProduct(
      product.id,
      this.quantity(),
      this.buildAddOptions(),
    );
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
    if (!this.product()) return;
    this.shareModalOpen.set(true);
  }

  onShareModalClosed(): void {
    this.shareModalOpen.set(false);
  }

  onClose(): void {
    this.closed.emit();
    // Reset state
    this.product.set(null);
    this.selectedVariant.set(null);
    this.selectedTierId.set(null);
    this.hasError.set(false);
    this.quantity.set(1);
  }
}
