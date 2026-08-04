import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { AppliedPromotion, Cart } from '../../services/cart.service';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import type { BadgeVariant } from '../../../../../shared/components/badge/badge.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';

/**
 * Shared, presentational promotions block for the ecommerce cart.
 *
 * Renders two POS-parity sections from a `Cart` signal:
 *  1. "Promociones aplicadas" — per-promotion discount lines with a type badge
 *     (reuses the exact classification logic from the cart page).
 *  2. Próximo tramo (nudge) — "Agrega N und más y obtén <benefit> en 'name'."
 *     for reachable `quantity_tiered` tiers, mirroring the POS cart nudge.
 *
 * Purely presentational: it derives everything from the injected `cart` signal
 * and performs NO data fetching. The `CartService` already enriches the shared
 * `cart` signal centrally with `applied_promotions` + `tier_progress`, so every
 * consumer (dropdown, page, checkout) can drop this component in and share the
 * same source of truth. Money is formatted here with the tenant `CurrencyPipe`
 * (custom Vendix pipe, NOT `@angular/common`); `benefit_value` arrives raw.
 *
 * Renders nothing when both sections are empty.
 */
@Component({
  selector: 'app-cart-promotions',
  standalone: true,
  imports: [CommonModule, IconComponent, BadgeComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (inline()) {
      <!-- Modo inline: SOLO el nudge de próximo tramo, como pill compacto
           (para el bannersito del carrito). -->
      @if (showTier() && tierProgress().length > 0) {
        <span
          class="flex min-w-0 flex-wrap items-center gap-1.5"
          [attr.data-currency]="currencyCode()"
        >
          @for (tier of tierProgress(); track tier.promotion_id) {
            <span
              class="nudge-pill inline-flex min-w-0 max-w-full items-center gap-1 rounded-xl px-2 py-0.5 text-[11px] font-medium leading-tight text-primary"
            >
              <app-icon
                name="trending-up"
                [size]="12"
                class="shrink-0 text-primary"
              />
              <span>
                @if (tier.target_product_name) {
                  Agrega
                  <span class="font-semibold"
                    >{{ tier.remaining_quantity }} und</span
                  >
                  más de
                  <span class="font-semibold"
                    >'{{ tier.target_product_name }}'</span
                  >
                  y obtén
                  <span class="font-semibold">{{ tier.benefitLabel }}</span>
                  en '{{ tier.name }}'.
                } @else {
                  Agrega
                  <span class="font-semibold"
                    >{{ tier.remaining_quantity }} und</span
                  >
                  más y obtén
                  <span class="font-semibold">{{ tier.benefitLabel }}</span>
                  en '{{ tier.name }}'.
                }
              </span>
            </span>
          }
        </span>
      }
    } @else if (
      (showApplied() && appliedPromotions().length > 0) ||
      (showTier() && tierProgress().length > 0)
    ) {
      <div
        class="flex flex-col"
        [ngClass]="compact() ? 'gap-2' : 'gap-3'"
        [attr.data-currency]="currencyCode()"
      >
        <!-- Promociones aplicadas -->
        @if (showApplied() && appliedPromotions().length > 0) {
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1.5">
              <app-icon name="tag" [size]="14" class="shrink-0 text-green-600" />
              <span
                class="font-semibold text-text-primary"
                [ngClass]="compact() ? 'text-xs' : 'text-sm'"
                >Promociones aplicadas</span
              >
              <span
                class="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-green-600/10 px-1.5 text-[10px] font-semibold text-green-600"
                >{{ appliedPromotions().length }}</span
              >
            </div>

            @for (promo of appliedPromotions(); track promo.promotion_id) {
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <span
                      class="truncate text-text-secondary"
                      [ngClass]="compact() ? 'text-[11px]' : 'text-sm'"
                      >{{ promo.name }}</span
                    >
                    <app-badge
                      [variant]="promo.typeVariant"
                      size="xs"
                      badgeStyle="outline"
                    >
                      {{ promo.typeLabel }}
                    </app-badge>
                    <app-badge
                      variant="success"
                      size="xs"
                      badgeStyle="solid"
                      title="Esta es la promoción aplicada. El motor descartó las demás promos elegibles porque solo se permite una promoción por orden."
                    >
                      Aplicada
                    </app-badge>
                  </div>
                  <span
                    class="shrink-0 font-semibold text-green-600"
                    [ngClass]="compact() ? 'text-[11px]' : 'text-sm'"
                    >-{{ promo.discount_amount | currency }}</span
                  >
                </div>
                <!-- Phase 2d: cuando la promo es per_product el backend nos
                     dice qué SKUs la activaron. Mostrar esta línea evita la
                     confusión clásica del bug "tengo 3 productos distintos y
                     solo uno califica" - el cliente ve exactamente a quién se
                     le aplicó el descuento. -->
                @if (promo.target_product_names.length > 0) {
                  <span
                    class="text-text-secondary/80"
                    [ngClass]="compact() ? 'text-[10px]' : 'text-[11px]'"
                  >
                    en:
                    <span class="font-medium text-text-primary">
                      {{ formatTargetProductNames(promo.target_product_names) }}
                    </span>
                  </span>
                }
              </div>
            }
          </div>
        }

        <!-- Próximo tramo (nudge) -->
        @if (showTier() && tierProgress().length > 0) {
          <div
            class="flex flex-col gap-1 border-t border-border/30 pt-2"
            [class.mt-1]="showApplied() && appliedPromotions().length > 0"
          >
            @for (tier of tierProgress(); track tier.promotion_id) {
              <div
                class="flex items-start gap-1.5 leading-tight text-primary"
                [ngClass]="compact() ? 'text-[10px]' : 'text-xs'"
              >
                <app-icon
                  name="trending-up"
                  [size]="12"
                  class="mt-0.5 shrink-0 text-primary"
                />
                <span>
                  @if (tier.target_product_name) {
                    Agrega
                    <span class="font-semibold"
                      >{{ tier.remaining_quantity }} und</span
                    >
                    más de
                    <span class="font-semibold"
                      >'{{ tier.target_product_name }}'</span
                    >
                    y obtén
                    <span class="font-semibold">{{ tier.benefitLabel }}</span>
                    en '{{ tier.name }}'.
                  } @else {
                    Agrega
                    <span class="font-semibold"
                      >{{ tier.remaining_quantity }} und</span
                    >
                    más y obtén
                    <span class="font-semibold">{{ tier.benefitLabel }}</span>
                    en '{{ tier.name }}'.
                  }
                </span>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      /* Pill del nudge inline (modo banner). Fondo/borde vía token RGB para
         evitar el defecto de bg-primary/opacity que no compone (ver
         reference_primary_token_defect). */
      .nudge-pill {
        background: rgba(var(--color-primary-rgb), 0.1);
        border: 1px solid rgba(var(--color-primary-rgb), 0.2);
      }
    `,
  ],
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

  /**
   * Per-promotion applied-discount view. Reuses the EXACT classification logic
   * from the cart page (`cart.component.ts`): percentage → Porcentaje/success,
   * fixed_amount → Monto fijo/primary, otherwise → Promoción/success.
   *
   * Also resolves `target_product_ids` (set by the backend under
   * `quantity_grouping='per_product'`) against `cart.items[]` so the UI can
   * show "en: Kit de freno, Kit de arrastre" without an extra round-trip.
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
   */
  private resolveAffectedNames(promo: AppliedPromotion): string[] {
    const targeted = this.resolveProductNames(promo.target_product_ids);
    if (targeted.length > 0) return targeted;
    return (promo.applicable_descriptions ?? [])
      .map((d) => d.label?.trim())
      .filter((label): label is string => !!label && label.length > 0);
  }

  /**
   * Next-tier nudge view. `benefitLabel` mirrors the POS `formatTierBenefit`:
   * percentage → `-<value>%`, fixed_amount → `-<currency>` via the tenant
   * `CurrencyFormatService`.
   *
   * Also resolves `target_product_id` (the SKU closest to qualifying under
   * `quantity_grouping='per_product'`) against `cart.items[]` so the
   * banner can say "Agrega 1 und más de 'Kit de freno NKD'" instead of a
   * generic SKU-less nudge.
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
   * Look up a single `product_id` against the cart's items and return the
   * product's display name (or null if absent / backend didn't supply an id).
   * Kept as an instance method so the two computed signals above can share it
   * without rebuilding the lookup Map on every recompute.
   */
  private resolveProductName(productId: number | null | undefined): string | null {
    if (productId == null) return null;
    const item = this.cart()?.items.find((i) => i.product_id === productId);
    return item?.product?.name ?? null;
  }

  /**
   * Bulk variant of `resolveProductName` for the applied-promotions list.
   * Preserves the input order and drops ids that aren't in the cart (e.g.
   * stale product_ids from a removed line) so the UI never renders "en: "
   * followed by an empty string.
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
   * under `quantity_grouping='per_product'`. Receives 1..N names already
   * resolved against `cart.items[]` and must return a single string the
   * template inserts between `en: <strong>...</strong>`.
   *
   * Contract:
   *   - Never return an empty string (caller already guards with
   *     `@if (promo.target_product_names.length > 0)`).
   *   - Preserve the order the backend returned (it reflects which products
   *     actually received the discount, not arbitrary cart order).
   *
   * Current policy (conservative for QA): comma-join without truncation. The
   * cart summary already lives inside a narrow column and Tailwind's
   * `text-text-secondary/80` line breaks naturally when the string is long.
   * Product owner / David can refine this (e.g. truncate to "+N más") in a
   * follow-up UX pass once we see real cart shapes in production.
   *
   * @see cart-promotions.component.html (the `@if` block that calls this).
   */
  protected formatTargetProductNames(names: string[]): string {
    return names.join(', ');
  }
}
