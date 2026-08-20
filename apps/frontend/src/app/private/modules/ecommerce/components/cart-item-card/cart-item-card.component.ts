import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Cart, CartItem } from '../../services/cart.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { QuantityControlComponent } from '../../../../../shared/components/quantity-control/quantity-control.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { CartService } from '../../services/cart.service';

/**
 * Shape of `cart.per_product_tier_ladder` as emitted by the backend from
 * Phase A.2 of `CP-ECOM-PROMO-UX-001`. Defined locally because the
 * `Cart` interface lives in `cart.service.ts` and the SCOPE of Phase E.2
 * forbids modifying it; when A.2 is wired through the central
 * enrichment, the cast in `itemTierProgress`/`progressPercent` will start
 * returning real data without any further change here.
 */
type CartTierLadder = {
  promotion_id: number;
  target_product_id: number;
  tiers: Array<{
    min_quantity: number;
    max_quantity: number | null;
    type: 'percentage' | 'fixed_amount';
    value: number;
    sort_order: number;
  }>;
  current_tier_index: number | null;
};

type CartWithTierLadder = Cart & {
  per_product_tier_ladder?: CartTierLadder[];
};

/**
 * Presentational, horizontal cart-item card for the ecommerce cart.
 *
 * Renders a single `CartItem` as a compact, detailed row that stays coherent
 * between mobile and desktop: product image on the left; in the middle a title
 * row (name + a ghost remove button pinned to the top-right corner), then
 * variant/attribute metadata, then SKU + unit price; and a bottom action row
 * (quantity stepper + prominent line total). Moving the remove button out of
 * the action row keeps that row to two items so it can't overflow on narrow
 * screens. Unit price is hidden when qty is 1 (equals the total) and the SKU
 * collapses below 360px — the row degrades gracefully instead of breaking.
 *
 * Purely presentational — it derives everything from the `item` signal and
 * emits `quantityChange` / `remove`; the parent owns all cart mutations. Money
 * is formatted with the tenant custom `CurrencyPipe` (Vendix pipe, NOT
 * `@angular/common`). The impure `| currency` pipe is kept reactive under
 * OnPush by reading `currencyCode()` into a `data-currency` attribute (same
 * technique as `app-cart-promotions`), so amounts re-render if the tenant
 * currency resolves after first paint.
 */
@Component({
  selector: 'app-cart-item-card',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    BadgeComponent,
    QuantityControlComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="cart-item"
      [class.updating]="updating()"
      [attr.data-currency]="currencyCode()"
    >
      <!-- Image -->
      <div class="ci-image">
        @if (item().product.image_url) {
          <img
            [src]="item().product.image_url"
            [alt]="item().product.name"
            loading="lazy"
          />
        } @else {
          <div class="no-image">
            <app-icon name="image" [size]="22" class="text-muted"></app-icon>
          </div>
        }
      </div>

      <!-- Body -->
      <div class="ci-body">
        <div class="ci-head">
          <div class="ci-title-row">
            <h3 class="ci-name">{{ item().product.name }}</h3>

            <div class="ci-remove-slot">
              <app-button
                variant="ghost"
                size="sm"
                customClasses="ci-remove"
                [disabled]="updating()"
                [attr.aria-label]="'Eliminar'"
                [title]="'Eliminar'"
                (clicked)="onRemove()"
              >
                <app-icon slot="icon" name="trash-2" [size]="18"></app-icon>
              </app-button>
            </div>
          </div>

          <!-- Variant + attribute + type metadata -->
          @if (
            isService() ||
            item().variant?.name ||
            attributeChips().length > 0 ||
            serviceDuration()
          ) {
            <div class="ci-meta">
              @if (isService()) {
                <app-badge variant="service" size="xs" badgeStyle="outline">
                  Servicio
                </app-badge>
              }
              @if (serviceDuration()) {
                <app-badge variant="service" size="xs">
                  {{ serviceDuration() }} min
                </app-badge>
              }
              @if (item().variant?.name) {
                <span class="ci-variant">{{ item().variant?.name }}</span>
              }
              @for (chip of attributeChips(); track chip) {
                <app-badge variant="neutral" size="xs">{{ chip }}</app-badge>
              }
            </div>
          }

          <!-- SKU + unit price. Unit price only shows when qty > 1 (with qty 1
               it equals the line total, so it is redundant); the SKU collapses
               on very narrow screens (see max-width media query below).
               Bug 8: si el item tiene price_tier (multitarifa 'sale_unit'),
               se muestra la presentación comercial ("Caja 12 und — $X")
               en vez del unit_price plano. -->
          <div class="ci-sub">
            <span class="ci-sku">SKU: {{ item().variant?.sku || item().product.sku }}</span>
            @if (item().price_tier; as tier) {
              <span class="ci-tier" [title]="'Presentación: ' + tier.label">
                {{ tier.label }}@if (tier.units_per_package > 1) {
                  <!-- El "(N und)" sólo informa cuando el paquete AGRUPA
                       varias unidades. Con packSize 1 ("Metro", "Unidad")
                       pintar "(1 und)" sólo añade ruido. -->
                  <span> ({{ tier.units_per_package }} und)</span>
                } —
                {{ tier.presentation_price | currency }}
              </span>
            } @else if (item().quantity > 1) {
              <span class="ci-unit">
                {{ item().unit_price | currency }}
                <span class="ci-tax">c/u</span>
              </span>
            }
          </div>

          <!-- Phase E.2 / CP-ECOM-PROMO-UX-001: per-line tier nudge.
               Shows a slim progress bar ("Faltan N und para -X%") under the
               price chip whenever this line's product is sitting on a
               quantity_tiered promotion tier AND there is a next tier
               reachable. Sourced from cart.per_product_tier_ladder (A.2)
               so the bar is consistent with the global nudge already shown
               by app-cart-promotions. -->
          @if (itemTierProgress(); as progress) {
            <div class="cart-item-progress" data-testid="cart-item-progress-bar">
              <div class="cart-item-progress__label">
                Faltan <strong>{{ progress.remaining }}</strong>
                und para <strong>{{ progress.benefit }}</strong>
              </div>
              <div
                class="cart-item-progress__track"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="progressPercent()"
                aria-label="Progreso hacia el próximo descuento"
              >
                <div
                  class="cart-item-progress__fill"
                  [style.width.%]="progressPercent()"
                ></div>
              </div>
            </div>
          }
        </div>

        <!-- Actions -->
        <div class="ci-actions">
          <app-quantity-control
            [value]="item().quantity"
            [min]="1"
            [max]="maxQuantity()"
            size="sm"
            [disabled]="updating()"
            (valueChange)="onQuantityChange($event)"
          ></app-quantity-control>

          <span class="ci-total">{{ item().total_price | currency }}</span>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .cart-item {
        position: relative;
        display: flex;
        align-items: stretch;
        gap: 0.7rem;
        padding: 0.7rem;
        background: var(--color-surface);
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: var(--radius-lg);
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
        transition:
          border-color 0.15s ease,
          box-shadow 0.15s ease,
          opacity 0.15s ease;
      }

      .cart-item:hover {
        border-color: rgba(148, 163, 184, 0.32);
        box-shadow: 0 12px 30px -26px rgba(15, 23, 42, 0.45);
      }

      .cart-item.updating {
        opacity: 0.5;
        pointer-events: none;
      }

      /* Image */
      .ci-image {
        position: relative;
        flex-shrink: 0;
        /* Stretch to the full card height so the image block is symmetric with
           the text column instead of leaving dead space below a small square. */
        align-self: stretch;
        width: 92px;
        min-height: 92px;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--color-background);
        border: 1px solid rgba(148, 163, 184, 0.14);
      }

      .ci-image img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
      }

      .ci-image .no-image {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-muted);
      }

      /* Body */
      .ci-body {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .ci-head {
        display: flex;
        flex-direction: column;
        gap: 0.28rem;
        min-width: 0;
      }

      /* Title row: product name (flexes/clamps) + remove button pinned to the
         top-right corner. Keeping the button in normal flow next to the name
         avoids absolute-positioning overlap and reserves its width naturally. */
      .ci-title-row {
        display: flex;
        align-items: flex-start;
        gap: 0.4rem;
        min-width: 0;
      }

      .ci-name {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: var(--fs-sm);
        font-weight: var(--fw-bold);
        line-height: 1.3;
        color: var(--color-text-primary);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .ci-remove-slot {
        flex-shrink: 0;
        /* Pull the ghost button flush into the card's top-right corner without
           nudging the name baseline. */
        margin: -0.25rem -0.3rem 0 0;
      }

      .ci-meta {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.3rem;
        min-width: 0;
      }

      .ci-variant {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .ci-sub {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 0.5rem;
        min-width: 0;
      }

      .ci-sku {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .ci-unit {
        display: inline-flex;
        align-items: baseline;
        gap: 0.28rem;
        flex-shrink: 0;
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
        white-space: nowrap;
      }

      .ci-tax {
        font-size: 10px;
        font-weight: var(--fw-medium);
        text-transform: uppercase;
        letter-spacing: 0.02em;
        color: var(--color-text-muted);
      }

      /* Actions — now just the quantity stepper + line total, so the row can
         never overflow the way it did with the remove button competing here. */
      .ci-actions {
        margin-top: auto;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
      }

      .ci-total {
        margin-left: auto;
        font-size: var(--fs-base);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        white-space: nowrap;
      }

      :host ::ng-deep .ci-remove {
        width: 40px !important;
        height: 40px !important;
        min-width: 40px !important;
        padding: 0 !important;
        border-radius: var(--radius-pill) !important;
        color: var(--color-text-muted) !important;
      }

      /* Phase E.2 / CP-ECOM-PROMO-UX-001 — per-line tier progress bar.
         Slim track under the price chip; uses the success palette so it
         visually rhymes with the green discount chips above. The track
         width is intentionally capped at 120px so the bar never stretches
         across the full card width on desktop. */
      .cart-item-progress {
        margin-top: 0.25rem;
        font-size: 0.75rem;
        color: var(--color-text-secondary, #6b7280);
      }

      .cart-item-progress__label {
        margin-bottom: 0.25rem;
        line-height: 1.3;
      }

      .cart-item-progress__track {
        width: 120px;
        height: 4px;
        background: rgba(var(--color-success-rgb, 34 197 94), 0.15);
        border-radius: 9999px;
        overflow: hidden;
      }

      .cart-item-progress__fill {
        height: 100%;
        background: var(--color-success, #22c55e);
        transition: width 200ms ease-out;
      }

      @media (prefers-reduced-motion: reduce) {
        .cart-item-progress__fill {
          transition: none;
        }
      }

      :host ::ng-deep .ci-remove:hover:not(:disabled) {
        color: var(--color-destructive) !important;
        background: rgba(var(--color-destructive-rgb), 0.1) !important;
      }

      /* Very narrow screens — drop the SKU (rarely useful to shoppers) so the
         SKU/price row can never force horizontal overflow. Placed after the
         base .ci-sku rule so it wins the cascade. */
      @media (max-width: 360px) {
        .ci-sku {
          display: none;
        }
      }

      /* Desktop — larger image, more breathing room, same horizontal layout */
      @media (min-width: 1024px) {
        .cart-item {
          gap: 0.9rem;
          padding: 0.9rem;
        }

        .ci-image {
          width: 112px;
        }

        .ci-name {
          font-size: var(--fs-base);
        }

        .ci-total {
          font-size: var(--fs-lg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cart-item {
          transition: none;
        }
      }
    `,
  ],
})
export class CartItemCardComponent {
  /** The cart line this card renders. */
  readonly item = input.required<CartItem>();
  /** When true, dims the card and blocks interaction during a pending update. */
  readonly updating = input<boolean>(false);
  /** Optional stock cap forwarded to the quantity stepper. */
  readonly maxQuantity = input<number | null>(null);

  /** Emits the new quantity when the user changes the stepper. */
  readonly quantityChange = output<number>();
  /** Emits when the user requests removal of this line. */
  readonly remove = output<void>();

  private readonly currencyFormat = inject(CurrencyFormatService);
  // Phase E.2 — read `cart.per_product_tier_ladder` (A.2 backend emission)
  // to drive the per-line progress bar. Injected here so the bar is wired
  // to the SAME central signal the rest of the cart consumes — no separate
  // fetch, no drift from `<app-cart-promotions>`'s global nudge.
  private readonly cartService = inject(CartService);

  /**
   * Tenant currency code, read in the template (via `data-currency`) so this
   * OnPush component re-renders when the async currency load resolves — keeping
   * the impure `| currency` pipe from sticking on the fallback format.
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  /** True when the line is a service / bookable product. */
  readonly isService = computed<boolean>(() => {
    const product = this.item().product;
    return product.product_type === 'service' || product.requires_booking === true;
  });

  /** Service duration in minutes, only when this is a service line. */
  readonly serviceDuration = computed<number | null>(() => {
    if (!this.isService()) return null;
    const minutes = this.item().product.service_duration_minutes;
    return typeof minutes === 'number' && minutes > 0 ? minutes : null;
  });

  /**
   * Human-readable chips derived from the variant's free-form `attributes`
   * map (`{ key -> value }`, may be null). Keeps only primitive
   * string/number values (skips booleans, nested objects, and empties) and
   * returns their display values. Empty when there are no usable attributes.
   */
  readonly attributeChips = computed<string[]>(() => {
    const attrs = this.item().variant?.attributes as
      | Record<string, unknown>
      | null
      | undefined;
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return [];
    return Object.values(attrs)
      .filter(
        (value): value is string | number =>
          (typeof value === 'string' && value.trim() !== '') ||
          (typeof value === 'number' && Number.isFinite(value)),
      )
      .map((value) => String(value));
  });

  /**
   * Phase E.2 / CP-ECOM-PROMO-UX-001 — per-line tier progress.
   *
   * Reads `cart.per_product_tier_ladder` (emitted by the backend from
   * Phase A.2) and returns the units still needed to unlock the NEXT tier
   * for THIS line's product, plus a formatted benefit label
   * ("-10%", "-$5.000"). Returns `null` when the line is NOT sitting on a
   * `quantity_tiered` promotion OR the customer has already crossed the
   * top tier — both cases are "no nudge to show".
   *
   * The cast to `CartWithTierLadder` is necessary because
   * `Cart.per_product_tier_ladder` is not yet declared on the shared
   * `Cart` interface (the central enrichment in `CartService` doesn't pass
   * it through yet). When that wiring lands, the cast becomes a no-op and
   * the bar will start rendering automatically.
   */
  readonly itemTierProgress = computed<{
    remaining: number;
    benefit: string;
  } | null>(() => {
    const cart = this.cartService.cart() as CartWithTierLadder | null;
    if (!cart) return null;
    const ladder = (cart.per_product_tier_ladder ?? []).find(
      (l) => l.target_product_id === this.item().product_id,
    );
    if (!ladder) return null;
    // Per the E.2 spec, only surface the bar when the customer has already
    // landed on a tier (`current_tier_index !== null`) AND a next tier
    // exists. This avoids painting a "Faltan N und" hint on lines that
    // haven't even reached the first threshold — `<app-cart-promotions>`
    // owns the global nudge for that case.
    if (ladder.current_tier_index === null) return null;
    const nextTier = ladder.tiers[ladder.current_tier_index + 1];
    if (!nextTier) return null;
    const currentQty = this.item().quantity;
    const remaining = nextTier.min_quantity - currentQty;
    if (remaining <= 0) return null;
    return {
      remaining,
      benefit: this.formatTierBenefit(nextTier.type, nextTier.value),
    };
  });

  /**
   * Width (0–100) of the per-line tier progress bar.
   *
   * CP-ECOM-PROMO-UX-001 R3-M4: anchor at the LOWER BOUND MINUS ONE of the
   * customer's current tier (NOT at `min_quantity` exactly). With the exact
   * threshold, `currentQuantity === min_quantity` reported `0%` — which
   * looked broken the instant a tier was unlocked. Anchoring one unit below
   * the threshold means "0% only when BELOW the tier" and the bar starts
   * showing movement as soon as the customer lands on the tier.
   *
   * When the customer is below the first tier's threshold, or they already
   * sit on the last one, the bar is pinned to a fixed extreme so it never
   * overshoots. The middle span is linear — same math the POS cart summary
   * uses for the same ladder.
   */
  readonly progressPercent = computed<number>(() => {
    const cart = this.cartService.cart() as CartWithTierLadder | null;
    if (!cart) return 0;
    const ladder = (cart.per_product_tier_ladder ?? []).find(
      (l) => l.target_product_id === this.item().product_id,
    );
    if (!ladder || ladder.current_tier_index === null) return 0;
    const currentTier = ladder.tiers[ladder.current_tier_index];
    const nextTier = ladder.tiers[ladder.current_tier_index + 1];
    const currentQty = this.item().quantity;
    // No upper bound reached yet — either customer is below the first
    // tier's threshold, or they already sit on the last one. Both cases
    // pin to a fixed extreme so the bar never overshoots.
    if (!currentTier || !nextTier) return currentQty > 0 ? 100 : 0;
    if (currentQty >= nextTier.min_quantity) return 100;
    // Anchor at min_quantity - 1 so 0% only when BELOW the tier.
    const lowerBound = currentTier.min_quantity - 1;
    if (currentQty <= lowerBound) return 0;
    const span = nextTier.min_quantity - lowerBound;
    if (span <= 0) return 100;
    return Math.min(100, Math.round(((currentQty - lowerBound) / span) * 100));
  });

  /**
   * Format a tier benefit into the user-facing label shown on the
   * progress bar ("-10%", "-$5.000"). Mirrors the same labels used by
   * `<app-cart-promotions>`'s tierProgressItems so the two nudges can
   * never drift apart.
   */
  private formatTierBenefit(
    type: 'percentage' | 'fixed_amount',
    value: number,
  ): string {
    if (type === 'percentage') return `-${value}%`;
    return `-${this.currencyFormat.format(value)}`;
  }

  constructor() {
    // Ensure tenant currency is loaded so amounts format correctly.
    this.currencyFormat.loadCurrency();
  }

  onQuantityChange(quantity: number): void {
    this.quantityChange.emit(quantity);
  }

  onRemove(): void {
    this.remove.emit();
  }
}
