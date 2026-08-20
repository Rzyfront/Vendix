import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import {
  AppliedPromotion,
  Cart,
  CartTierProgress,
} from '../../services/cart.service';
import {
  PromotionStackComponent,
  PromotionStackItem,
} from '../../../../../shared/components/promotion-stack/promotion-stack.component';
import type { BadgeVariant } from '../../../../../shared/components/badge/badge.component';
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
  readonly appliedPromotionItems = computed<PromotionStackItem[]>(() =>
    (this.cart()?.applied_promotions ?? []).map((promo) => ({
      id: promo.promotion_id,
      label: promo.name,
      type: (promo.type ?? 'percentage') as PromotionStackItem['type'],
      value: promo.discount_amount,
      scope: (promo.scope ?? 'order') as PromotionStackItem['scope'],
      // Sentinel so the expanded-cards filter renders this row. See JSDoc above.
      min_quantity: 1,
    })),
  );

  // ── Backward-compat surface (Phase D- era consumers) ──────────────────
  //
  // The computeds below used to drive this component's OWN template. Phase
  // E.1 replaced the inline template with `<app-promotion-stack>`, so the
  // primary projection path is `tierProgressItems` + `appliedPromotionItems`
  // above. The legacy fields are KEPT (marked `@deprecated`) because:
  //
  //   * they were `public readonly` so any test, storybook story, or
  //     external consumer that read them would silently break otherwise;
  //   * they expose the SAME classification logic the POS nudge uses, so
  //     future QA harnesses can compare web vs POS parity through one
  //     stable surface.
  //
  // They will be removed in a follow-up cleanup once Phase F's bespoke
  // applied-promo card lands (acceptance item 10 of E.1).

  /**
   * @deprecated Use `tierProgressItems()` instead — it returns the same
   * shape consumed by `<app-promotion-stack mode="compact-pills">`. Kept for
   * backward compatibility with test/storybook consumers that read this
   * signal directly. Will be removed after Phase F lands.
   */
  readonly tierProgress = computed<
    Array<{
      promotion_id: number;
      name: string;
      remaining_quantity: number;
      benefitLabel: string;
      target_product_name: string | null;
    }>
  >(() =>
    (this.cart()?.tier_progress ?? []).map((tier) => ({
      promotion_id: tier.promotion_id,
      name: tier.name,
      remaining_quantity: tier.remaining_quantity,
      benefitLabel:
        tier.benefit_type === 'percentage'
          ? `-${tier.benefit_value}%`
          : `-${this.currencyFormat.format(tier.benefit_value)}`,
      target_product_name: this.resolveProductName(tier.target_product_id),
    })),
  );

  /**
   * @deprecated Use `appliedPromotionItems()` instead — it returns the same
   * shape consumed by `<app-promotion-stack mode="expanded-cards">`. Kept for
   * backward compatibility with test/storybook consumers. Will be removed
   * after Phase F lands.
   */
  readonly appliedPromotions = computed<
    Array<{
      promotion_id: number;
      name: string;
      discount_amount: number;
      typeLabel: string;
      typeVariant: BadgeVariant;
      target_product_names: string[];
    }>
  >(() =>
    (this.cart()?.applied_promotions ?? []).map((promo) => ({
      promotion_id: promo.promotion_id,
      name: promo.name,
      discount_amount: promo.discount_amount,
      typeLabel:
        promo.type === 'percentage'
          ? 'Porcentaje'
          : promo.type === 'fixed_amount'
            ? 'Monto fijo'
            : 'Promoción',
      typeVariant: promo.type === 'fixed_amount' ? 'primary' : 'success',
      target_product_names: this.resolveAffectedNames(promo),
    })),
  );

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Look up a single `product_id` against the cart's items and return the
   * product's display name (or null if absent / backend didn't supply an id).
   * Shared by `tierProgressItems` (Phase E.1 primary) and the deprecated
   * `tierProgress` so they cannot drift apart.
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
   * Nombres que se muestran en la línea "en: ..." debajo de la promo aplicada.
   *
   * QUI-515: hay DOS fuentes y no son intercambiables, así que se consultan en
   * orden de especificidad:
   *
   *  1. `target_product_ids` — sólo lo llena el engine para promos
   *     `per_product`, y dice exactamente qué SKU alcanzó la escala por su
   *     cuenta. Es la información más precisa: los productos que NO calificaron
   *     quedan fuera aunque compartan el scope.
   *  2. `applicable_descriptions` — a qué líneas se aplicó el descuento. Es la
   *     única fuente disponible para promos `cart_total` de scope
   *     producto/categoría, donde el punto 1 viene vacío por definición.
   *
   * Sin el fallback al punto 2, toda promo que no sea `per_product` perdería la
   * etiqueta que hoy ya se muestra, y el cliente dejaría de ver sobre qué se le
   * aplicó el descuento. Para `scope: 'order'` ambas vienen vacías y la línea no
   * se pinta, que es lo correcto: el descuento va sobre todo el carrito.
   *
   * Kept for the deprecated `appliedPromotions` computed above.
   */
  private resolveAffectedNames(promo: AppliedPromotion): string[] {
    const targeted = this.resolveProductNames(promo.target_product_ids);
    if (targeted.length > 0) return targeted;
    return (promo.applicable_descriptions ?? [])
      .map((d) => d.label?.trim())
      .filter((label): label is string => !!label && label.length > 0);
  }

  /**
   * Bulk variant of `resolveProductName` for the applied-promotions list.
   * Preserves the input order and drops ids that aren't in the cart (e.g.
   * stale product_ids from a removed line) so the UI never renders "en: "
   * followed by an empty string.
   *
   * Kept for the deprecated `appliedPromotions` computed above.
   */
  private resolveProductNames(productIds: number[] | undefined): string[] {
    if (!productIds || productIds.length === 0) return [];
    const items = this.cart()?.items ?? [];
    const names: string[] = [];
    for (const id of productIds) {
      const item = items.find((i) => i.product_id === id);
      if (item?.product?.name) names.push(item.product.name);
    }
    return names;
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
