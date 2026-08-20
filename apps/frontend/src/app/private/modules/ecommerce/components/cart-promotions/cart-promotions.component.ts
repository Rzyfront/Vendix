import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Cart } from '../../services/cart.service';
import {
  PromotionStackComponent,
  PromotionStackItem,
} from '../../../../../shared/components/promotion-stack/promotion-stack.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';

/**
 * Shared, presentational promotions block for the ecommerce cart.
 *
 * Phase E.1 of `CP-ECOM-PROMO-UX-001`: this wrapper now delegates the
 * per-promo and per-tier rendering to the shared `<app-promotion-stack>`
 * component (Phase B) and ONLY owns the projection from
 * `cart.applied_promotions` / `cart.tier_progress` into the
 * `PromotionStackItem[]` shape, plus the inline-vs-block mode switch:
 *
 *  - `mode='compact-pills'`  → inline banner, ONLY the tier nudge;
 *  - `mode='expanded-cards'` → block layout, applied promos first then
 *                             the tier nudge as compact pills.
 *
 * Purely presentational: it derives everything from the injected `cart`
 * signal and performs NO data fetching. The `CartService` already enriches
 * the shared `cart` signal centrally with `applied_promotions` +
 * `tier_progress`, so every consumer (dropdown, page, checkout, mobile
 * footer) shares the same source of truth. Money is formatted with the
 * tenant custom `CurrencyPipe` (Vendix pipe, NOT `@angular/common`).
 *
 * Renders nothing when both sections are empty.
 */
@Component({
  selector: 'app-cart-promotions',
  standalone: true,
  imports: [CommonModule, PromotionStackComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (inline()) {
      <!-- Modo inline: SOLO el nudge de próximo tramo, como pill compacto
           (para el bannersito del carrito). -->
      @if (showTier() && tierProgressItems().length > 0) {
        <app-promotion-stack
          mode="compact-pills"
          [items]="tierProgressItems()"
          [ariaLabel]="'Próximo tramo de descuento'"
          data-testid="cart-promotions-inline-pills"
        />
      }
    } @else if (
      (showApplied() && appliedPromotionItems().length > 0) ||
      (showTier() && tierProgressItems().length > 0)
    ) {
      <div
        class="flex flex-col"
        [ngClass]="compact() ? 'gap-2' : 'gap-3'"
        [attr.data-currency]="currencyCode()"
      >
        <!-- Promociones aplicadas -->
        @if (showApplied() && appliedPromotionItems().length > 0) {
          <app-promotion-stack
            mode="expanded-cards"
            [items]="appliedPromotionItems()"
            [ariaLabel]="'Promociones aplicadas'"
            data-testid="cart-promotions-applied"
          />
        }

        <!-- Próximo tramo (nudge) -->
        @if (showTier() && tierProgressItems().length > 0) {
          <div
            class="border-t border-border/30 pt-2"
            [class.mt-1]="appliedPromotionItems().length > 0"
          >
            <app-promotion-stack
              mode="compact-pills"
              [items]="tierProgressItems()"
              [ariaLabel]="'Próximo tramo de descuento'"
              data-testid="cart-promotions-tier"
            />
          </div>
        }
      </div>
    }
  `,
})
export class CartPromotionsComponent {
  /** Source cart. Promotions/tier data are read reactively from this signal. */
  readonly cart = input<Cart | null>(null);
  /** Denser layout for the header dropdown; relaxed for page/checkout. */
  readonly compact = input<boolean>(false);
  /** Show the "Promociones aplicadas" section (block layout only). */
  readonly showApplied = input<boolean>(true);
  /** Show the next-tier "Agrega N más…" nudge. */
  readonly showTier = input<boolean>(true);
  /** Inline layout: render ONLY the tier nudge as compact pill(s) — banner use. */
  readonly inline = input<boolean>(false);

  private readonly currencyFormat = inject(CurrencyFormatService);

  /**
   * Tenant currency code, read in the template so this OnPush component's
   * change detection is tied to the async currency load. Without it, the
   * impure `| currency` pipe used for applied-promo amounts could stay on the
   * "$12,300.00" fallback if the currency resolves after first render and no
   * other input changes (the nudge already reacts via the tierProgress computed).
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  // ── Primary projections (Phase E.1) ───────────────────────────────────

  /**
   * Next-tier nudge → `PromotionStackItem[]` for `mode="compact-pills"`.
   *
   * Each item encodes the customer's current line quantity
   * (`min_quantity = currentQty`) and the next-tier threshold
   * (`max_quantity = currentQty + remaining_quantity`) so the shared
   * `<app-promotion-stack>` can label the pill with "Desde N und: <benefit>"
   * via its own `pillText()` helper.
   *
   * `target_product_name` is resolved against `cart.items[]` so the cart
   * dropdown can surface the SKU name when the engine publishes
   * `target_product_id` (per_product promos).
   */
  readonly tierProgressItems = computed<PromotionStackItem[]>(() => {
    const cart = this.cart();
    if (!cart) return [];
    return (cart.tier_progress ?? []).map((tier) => {
      const label =
        tier.benefit_type === 'percentage'
          ? `-${tier.benefit_value}%`
          : `-${this.currencyFormat.format(tier.benefit_value)}`;
      const targetName = this.resolveProductName(tier.target_product_id);
      const currentQty = this.resolveProductQuantity(tier.target_product_id);
      return {
        id: tier.promotion_id,
        label,
        type: tier.benefit_type,
        value: tier.benefit_value,
        // Sentinel: anchor at the customer's actual line count so the pill
        // reads "Desde {currentQty} und: <benefit>". Falls back to
        // `undefined` when the cart line is missing — `<app-promotion-stack>`
        // then drops the "Desde N und:" prefix and renders the bare label.
        min_quantity: currentQty ?? undefined,
        // Span = current + remaining = next-tier threshold.
        max_quantity:
          currentQty != null ? currentQty + tier.remaining_quantity : undefined,
        target_product_name: targetName,
      };
    });
  });

  /**
   * Applied promotions → `PromotionStackItem[]` for `mode="expanded-cards"`.
   *
   * `min_quantity` is set to `1` (NOT `undefined`) as a sentinel so the
   * `<app-promotion-stack>` expanded-cards filter — which requires
   * `tier_index !== undefined || min_quantity !== undefined` to render any
   * item — actually surfaces the applied promo as a tier card. Without this
   * sentinel the cart would silently render ZERO applied-promo cards because
   * applied promos carry no tier ladder of their own.
   *
   * The resulting card header shows "Desde 1 und: <name>"; that wording is
   * the known limitation of routing order-level promos through a tier-aware
   * component, accepted deliberately while Phase F (cart summary polish)
   * lands the bespoke applied-promo card. See E.1 acceptance item 3.
   */
  readonly appliedPromotionItems = computed<PromotionStackItem[]>(() => {
    // CP-ECOM-PROMO-UX-001 R2-B (Minor #8): whitelist `promo.type` and
    // `promo.scope` before casting — never silently coerce unknown values
    // into the union. CP-ECOM-PROMO-UX-001 R2-B (Minor #2): when type is
    // missing/invalid, drop the promo and warn (don't project a
    // misleading default).
    const validTypes: Array<'percentage' | 'fixed_amount'> = [
      'percentage',
      'fixed_amount',
    ];
    const validScopes: Array<'order' | 'product' | 'category'> = [
      'order',
      'product',
      'category',
    ];

    const items: PromotionStackItem[] = [];
    for (const promo of this.cart()?.applied_promotions ?? []) {
      const safeType: 'percentage' | 'fixed_amount' | undefined =
        promo.type && validTypes.includes(promo.type as 'percentage' | 'fixed_amount')
          ? (promo.type as 'percentage' | 'fixed_amount')
          : undefined;

      if (!safeType) {
        // eslint-disable-next-line no-console
        console.warn(
          `[cart-promotions] Skipping applied promo ${promo.promotion_id} with invalid/missing type:`,
          promo.type,
        );
        continue;
      }

      const safeScope:
        | 'order'
        | 'product'
        | 'category'
        | undefined =
        promo.scope &&
        validScopes.includes(
          promo.scope as 'order' | 'product' | 'category',
        )
          ? (promo.scope as 'order' | 'product' | 'category')
          : undefined;

      items.push({
        id: promo.promotion_id,
        label: promo.name,
        type: safeType,
        value: promo.discount_amount,
        scope: safeScope,
        // Sentinel so the expanded-cards filter renders this row. See JSDoc above.
        min_quantity: 1,
      });
    }
    return items;
  });

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Look up a single `product_id` against the cart's items and return the
   * product's display name (or null if absent / backend didn't supply an id).
   * Shared by `tierProgressItems` so the projection cannot drift apart.
   */
  private resolveProductName(productId: number | null | undefined): string | null {
    if (productId == null) return null;
    const item = this.cart()?.items.find((i) => i.product_id === productId);
    return item?.product?.name ?? null;
  }

  /**
   * Sum the customer's CURRENT quantity across every cart line matching
   * `product_id`. Used by `tierProgressItems` to anchor `min_quantity` /
   * `max_quantity` at the customer's actual line count (NOT the tier
   * threshold), so the pill labels encode "current state → target state"
   * instead of "tier 1 → tier 2".
   *
   * Returns `null` when the line is missing — `<app-promotion-stack>` then
   * falls back to its bare-label pill without the "Desde N und:" prefix.
   */
  private resolveProductQuantity(
    productId: number | null | undefined,
  ): number | null {
    if (productId == null) return null;
    const items = this.cart()?.items ?? [];
    let total = 0;
    let matched = false;
    for (const item of items) {
      if (item.product_id === productId) {
        total += item.quantity;
        matched = true;
      }
    }
    return matched ? total : null;
  }

  /**
   * Format the list of product names that unlocked an applied promotion
   * under `quantity_grouping='per_product'`.
   *
   * @deprecated Replaced by the per-item "en: ..." badge inside
   * `<app-promotion-stack mode="expanded-cards">` (Phase F). Kept for any
   * external consumer still reading this through a test harness.
   */
  protected formatTargetProductNames(names: string[]): string {
    return names.join(', ');
  }
}
