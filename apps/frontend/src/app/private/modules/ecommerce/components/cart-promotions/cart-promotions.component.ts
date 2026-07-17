import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Cart } from '../../services/cart.service';
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
                Agrega
                <span class="font-semibold">{{ tier.remaining_quantity }} und</span>
                más y obtén
                <span class="font-semibold">{{ tier.benefitLabel }}</span>
                en '{{ tier.name }}'.
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
                  Agrega
                  <span class="font-semibold"
                    >{{ tier.remaining_quantity }} und</span
                  >
                  más y obtén
                  <span class="font-semibold">{{ tier.benefitLabel }}</span>
                  en '{{ tier.name }}'.
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
   */
  readonly appliedPromotions = computed<
    Array<{
      promotion_id: number;
      name: string;
      discount_amount: number;
      typeLabel: string;
      typeVariant: BadgeVariant;
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
    })),
  );

  /**
   * Next-tier nudge view. `benefitLabel` mirrors the POS `formatTierBenefit`:
   * percentage → `-<value>%`, fixed_amount → `-<currency>` via the tenant
   * `CurrencyFormatService`.
   */
  readonly tierProgress = computed<
    Array<{
      promotion_id: number;
      name: string;
      remaining_quantity: number;
      benefitLabel: string;
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
    })),
  );
}
