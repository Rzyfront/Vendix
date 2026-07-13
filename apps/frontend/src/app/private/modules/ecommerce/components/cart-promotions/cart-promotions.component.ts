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
    @if (appliedPromotions().length > 0 || tierProgress().length > 0) {
      <div class="flex flex-col" [ngClass]="compact() ? 'gap-2' : 'gap-3'">
        <!-- Promociones aplicadas -->
        @if (appliedPromotions().length > 0) {
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
        @if (tierProgress().length > 0) {
          <div
            class="flex flex-col gap-1 border-t border-border/30 pt-2"
            [class.mt-1]="appliedPromotions().length > 0"
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
})
export class CartPromotionsComponent {
  /** Source cart. Promotions/tier data are read reactively from this signal. */
  readonly cart = input<Cart | null>(null);
  /** Denser layout for the header dropdown; relaxed for page/checkout. */
  readonly compact = input<boolean>(false);

  private readonly currencyFormat = inject(CurrencyFormatService);

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
