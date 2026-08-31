import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Cart } from '../../services/cart.service';
import { PromotionsAnalyticsService } from '../../services/promotions-analytics.service';
import {
  PromotionStackComponent,
  PromotionStackItem,
} from '../../../../../shared/components/promotion-stack/promotion-stack.component';
import {
  GamifiedIncentiveBarComponent,
  IncentiveProgressData,
} from '../../../../../shared/components/gamified-incentive-bar/gamified-incentive-bar.component';
import {
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
  imports: [
    CommonModule,
    PromotionStackComponent,
    GamifiedIncentiveBarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- CP-ECOM-PROMO-UX-001 convergence-R5: degraded-load banner. When the
         backend exhausted its retries loading the promotions summary, the
         customer is staring at a cart WITHOUT automatic discounts and without
         the tier nudge. A yellow banner tells them why and what to do; without
         it the failure is silent and the customer assumes "no promos apply". -->
    @if (showDegradedBanner()) {
      <div
        role="alert"
        class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        data-testid="cart-promotions-degraded-banner"
      >
        <span aria-hidden="true" class="mt-0.5">⚠</span>
        <span>No pudimos cargar las promociones. Refresca para reintentar.</span>
      </div>
    }

    <!-- High-Conversion Gamified Incentive Bar (toggle enable_high_conversion_ui) -->
    @if (highConversionEnabled() && incentiveData().length > 0) {
      @for (data of incentiveData(); track $index) {
        <app-gamified-incentive-bar
          [data]="data"
          class="block mb-2.5"
        />
      }
    }

    @if (inline()) {
      <!-- Modo inline: SOLO el nudge de próximo tramo, como pill compacto
           (para el bannersito del carrito). -->
      @if (highConversionEnabled() && showTier() && tierProgressItems().length > 0) {
        <app-promotion-stack
          mode="compact-pills"
          [items]="tierProgressItems()"
          [ariaLabel]="'Próximo tramo de descuento'"
          data-testid="cart-promotions-inline-pills"
          (promotionViewed)="onPromotionViewed($event)"
          (promotionIntent)="onPromotionIntent($event)"
        />
      }
    } @else if (
      (showApplied() && appliedPromotionItems().length > 0) ||
      (highConversionEnabled() && showTier() && tierProgressItems().length > 0)
    ) {
      <div
        class="flex flex-col"
        [ngClass]="compact() ? 'gap-2' : 'gap-3'"
        [attr.data-currency]="currencyCode()"
      >
        <!-- Promociones aplicadas — SIEMPRE visible (info esencial, no afectada por el toggle) -->
        @if (showApplied() && appliedPromotionItems().length > 0) {
          <app-promotion-stack
            mode="expanded-cards"
            [items]="appliedPromotionItems()"
            [ariaLabel]="'Promociones aplicadas'"
            data-testid="cart-promotions-applied"
            (promotionViewed)="onPromotionViewed($event)"
            (promotionIntent)="onPromotionIntent($event)"
          />
        }

        <!-- Próximo tramo (nudge) — gated por enable_high_conversion_ui -->
        @if (highConversionEnabled() && showTier() && tierProgressItems().length > 0) {
          <div
            class="border-t border-border/30 pt-2"
            [class.mt-1]="appliedPromotionItems().length > 0"
          >
            <app-promotion-stack
              mode="compact-pills"
              [items]="tierProgressItems()"
              [ariaLabel]="'Próximo tramo de descuento'"
              data-testid="cart-promotions-tier"
              (promotionViewed)="onPromotionViewed($event)"
              (promotionIntent)="onPromotionIntent($event)"
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
  /**
   * Respetar el toggle "Experiencia de Alta Conversión (Visualización
   * Promocional)" del admin. Cuando es false, NO renderizamos las barras
   * gamificadas (celebraciones + tier nudges) — los montos por promo en
   * el expanded-cards siguen visibles porque son info esencial.
   *
   * Default `true` para no romper consumidores existentes que aún no
   * pasan el flag explícitamente.
   */
  readonly highConversionEnabled = input<boolean>(true);

  private readonly currencyFormat = inject(CurrencyFormatService);
  /** Sink for `<app-promotion-stack>` outputs (CP-ECOM-PROMO-UX-001 G.1). */
  private readonly promotionsAnalytics = inject(PromotionsAnalyticsService);

  constructor() {
    // DEBUG: log cada vez que highConversionEnabled cambia
    effect(() => {
      // eslint-disable-next-line no-console
      console.log(
        '[PROMO-DEBUG] highConversionEnabled cambió a:',
        this.highConversionEnabled(),
      );
    });
  }

  /**
   * Forward `promotionViewed` from the cart's promotion stacks (applied
   * expanded-cards + tier-progress compact-pills) to the analytics sink.
   * Both stacks co-exist (dropdown, page, checkout, mobile footer) and
   * funnel through the same shared `<app-promotion-stack>`, so a single
   * handler covers every surface.
   */
  onPromotionViewed(event: {
    promotion_id: string | number;
    mode: string;
  }): void {
    this.promotionsAnalytics.trackViewed(event.promotion_id, event.mode);
  }

  /**
   * Forward `promotionIntent` from the cart's promotion stacks when a
   * tier boundary is crossed (compact-pills mode does not emit intent,
   * but the bound output keeps the seam consistent across the 3 consumers).
   */
  onPromotionIntent(event: {
    promotion_id: string | number;
    tier_index: number;
    quantity: number;
  }): void {
    this.promotionsAnalytics.trackIntent(
      event.promotion_id,
      event.tier_index,
      event.quantity,
    );
  }

  /**
   * CP-ECOM-PROMO-UX-001 R3-M6: contract-drift breadcrumb.
   *
   * Persistent counter incremented every time an applied promo is dropped
   * because of an invalid `type` (or `scope`). Exposed as a read-only signal
   * so the operator surface (admin / debug panels) can read it without
   * granting write access. The component's own template does NOT need to
   * surface it — the cart telemetry does. We keep `console.warn` for
   * browser DevTools as a last-resort visibility path in production.
   */
  private readonly driftCount = signal(0);
  readonly cartPromoDriftCount = this.driftCount.asReadonly();

  /**
   * Tenant currency code, read in the template so this OnPush component's
   * change detection is tied to the async currency load. Without it, the
   * impure `| currency` pipe used for applied-promo amounts could stay on the
   * "$12,300.00" fallback if the currency resolves after first render and no
   * other input changes (the nudge already reacts via the tierProgress computed).
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  /**
   * CP-ECOM-PROMO-UX-001 convergence-R5: when the backend exhausts its
   * promotion-summary retries it returns `promotions_load_state: 'degraded'`.
   * Show a yellow banner so the customer knows the missing discount is a
   * transient failure and not "this cart has no promotions". Defaults to
   * `false` for the legacy response shape (older backend that doesn't emit
   * the field at all).
   */
  protected readonly showDegradedBanner = computed<boolean>(
    () => this.cart()?.promotions_load_state === 'degraded',
  );

  /**
   * Data for the gamified incentive progress bar.
   * Derives real-time progress towards the next reachable tier or highlights unlocked benefits.
   *
   * Returns an ARRAY so each applied promo gets its own celebration bar — antes solo
   * mostraba la primera promo aplicada, lo que hacía que promociones adicionales
   * (ej. una promo de orden completa sin tiers) quedaran sin notificación visual
   * aunque sí se aplicaran al carrito.
   */
  readonly incentiveData = computed<IncentiveProgressData[]>(() => {
    const currentCart = this.cart();
    const result: IncentiveProgressData[] = [];

    // 1) Una celebración por cada promo aplicada (no solo la primera).
    const applied = currentCart?.applied_promotions ?? [];
    for (const promo of applied) {
      result.push({
        benefit_label: `-${this.currencyFormat.format(promo.discount_amount)} Ahorro`,
        unlocked: true,
        progress_percentage: 100,
      });
    }

    // 2) Nudges de tier-progress para próximas metas (tiered promos con
    // cantidad objetivo).
    const tiers = currentCart?.tier_progress ?? [];
    for (const tier of tiers) {
      const benefitLabel =
        tier.benefit_type === 'percentage'
          ? `-${tier.benefit_value}% OFF`
          : `-${this.currencyFormat.format(tier.benefit_value)} OFF`;
      const remaining = tier.remaining_quantity;
      const targetName = this.resolveProductName(tier.target_product_id);

      result.push({
        remaining_quantity: remaining,
        benefit_label: benefitLabel,
        target_product_name: targetName,
        progress_percentage: Math.max(15, Math.min(90, 100 - remaining * 20)),
        unlocked: false,
      });
    }

    return result;
  });

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
    return (cart.tier_progress ?? [])
      .map((tier) => {
        const currentQty = this.resolveProductQuantity(tier.target_product_id);
        // CP-ECOM-PROMO-UX-001 R3-M5: skip tiers where the customer has no
        // current quantity (line is being set up, freshly added before
        // `cart.items` resolves, etc.). "Desde 0 und: -10%" is meaningless
        // and would otherwise surface in the cart dropdown.
        if (currentQty == null || currentQty <= 0) return null;
        const label =
          tier.benefit_type === 'percentage'
            ? `-${tier.benefit_value}%`
            : `-${this.currencyFormat.format(tier.benefit_value)}`;
        const targetName = this.resolveProductName(tier.target_product_id);
        const item: PromotionStackItem = {
          id: tier.promotion_id,
          label,
          type: tier.benefit_type,
          value: tier.benefit_value,
          // Sentinel: anchor at the customer's actual line count so the pill
          // reads "Desde {currentQty} und: <benefit>".
          min_quantity: currentQty,
          // Span = current + remaining = next-tier threshold.
          max_quantity: currentQty + tier.remaining_quantity,
          target_product_name: targetName,
        };
        return item;
      })
      .filter((it): it is PromotionStackItem => it !== null);
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
        // CP-ECOM-PROMO-UX-001 R3-M6: increment the contract-drift breadcrumb
        // BEFORE logging so an operator reading `cartPromoDriftCount()` sees
        // the same count the browser console will. Keep the warn as a
        // last-resort visibility path — production swallows the browser
        // console but the persistent counter survives.
        this.driftCount.set(this.driftCount() + 1);
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
}
