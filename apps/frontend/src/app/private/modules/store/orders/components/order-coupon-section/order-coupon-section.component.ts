import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes';
import type { Order } from '../../interfaces/order.interface';

export interface OrderAppliedCouponView {
  code: string;
  name: string | null;
  percent: string | null;
  discountAmount: number;
}

/**
 * Reusable coupon apply/replace/remove block for existing editable orders
 * (used in both Order Details and the Register Payment modal).
 *
 * Mirrors the POS coupon UX (`pos-cart-modal.component.ts`) using Vendix
 * Soft UI tokens and zoneless Angular 20 signals.
 */
@Component({
  selector: 'app-order-coupon-section',
  standalone: true,
  imports: [ButtonComponent, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-xl border border-border bg-surface/60"
      [class.p-2.5]="compact()"
      [class.p-3]="!compact()"
    >
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="flex items-center gap-1.5">
          <app-icon
            name="ticket"
            [size]="14"
            class="text-primary flex-shrink-0"
          ></app-icon>
          <span class="text-xs font-semibold text-text-primary">
            Cupón o código promocional
          </span>
        </div>
        @if (appliedCoupon() && !showReplaceInput()) {
          <button
            type="button"
            class="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
            [disabled]="isLoading() || disabled()"
            (click)="openReplace()"
          >
            Cambiar
          </button>
        }
      </div>

      @if (appliedCoupon(); as coupon) {
        <div
          class="p-2.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between gap-2"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span
                class="text-xs font-bold text-primary uppercase tracking-wider truncate"
              >
                {{ coupon.code }}
              </span>
              @if (coupon.percent) {
                <span class="text-[11px] font-semibold text-primary/80">
                  ({{ coupon.percent }} %)
                </span>
              }
              @if (coupon.name) {
                <span class="text-[11px] text-text-secondary truncate">
                  — {{ coupon.name }}
                </span>
              }
            </div>
            @if (coupon.discountAmount > 0) {
              <span class="block text-xs font-semibold text-success mt-0.5">
                Descuento aplicado: -{{ coupon.discountAmount | currency }}
              </span>
            }
          </div>

          <app-button
            variant="outline-danger"
            size="sm"
            [loading]="isLoading()"
            [disabled]="isLoading() || disabled()"
            (clicked)="onRemove()"
          >
            <app-icon name="trash-2" [size]="13" class="mr-1"></app-icon>
            Quitar
          </app-button>
        </div>

        @if (showReplaceInput()) {
          <div class="mt-2 pt-2 border-t border-border">
            <div class="flex gap-2">
              <input
                type="text"
                [value]="couponCode()"
                (input)="onInput($event)"
                (keydown.enter)="onApply()"
                placeholder="Nuevo código"
                aria-label="Nuevo código de cupón"
                maxlength="50"
                [disabled]="isLoading() || disabled()"
                class="flex-1 min-w-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-text-muted placeholder:normal-case"
              />
              <app-button
                variant="primary"
                size="sm"
                [loading]="isLoading()"
                [disabled]="!couponCode().trim() || isLoading() || disabled()"
                (clicked)="onApply()"
              >
                Aplicar
              </app-button>
              <app-button
                variant="ghost"
                size="sm"
                [disabled]="isLoading()"
                (clicked)="cancelReplace()"
              >
                Cancelar
              </app-button>
            </div>
          </div>
        }
      } @else {
        <div class="flex gap-2">
          <input
            type="text"
            [value]="couponCode()"
            (input)="onInput($event)"
            (keydown.enter)="onApply()"
            placeholder="Ej: PROMO10"
            aria-label="Código de cupón o promoción"
            maxlength="50"
            [disabled]="isLoading() || disabled()"
            class="flex-1 min-w-0 px-3 py-2 text-xs font-semibold uppercase tracking-wider rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-text-muted placeholder:normal-case"
          />
          <app-button
            variant="primary"
            size="sm"
            [loading]="isLoading()"
            [disabled]="!couponCode().trim() || isLoading() || disabled()"
            (clicked)="onApply()"
          >
            Aplicar
          </app-button>
        </div>
      }

      @if (errorMessage(); as err) {
        <p class="mt-1.5 text-xs font-medium text-error" role="alert">
          {{ err }}
        </p>
      }
    </div>
  `,
})
export class OrderCouponSectionComponent {
  readonly order = input<Order | null>(null);
  readonly disabled = input<boolean>(false);
  readonly isLoading = input<boolean>(false);
  readonly errorMessage = input<string | null>(null);
  readonly compact = input<boolean>(false);

  readonly applyCoupon = output<string>();
  readonly removeCoupon = output<void>();

  readonly couponCode = signal<string>('');
  readonly showReplaceInput = signal<boolean>(false);

  readonly appliedCoupon = computed<OrderAppliedCouponView | null>(() => {
    const order = this.order();
    if (!order) return null;

    const firstUse = order.coupon_uses?.[0];
    if (firstUse) {
      const c = firstUse.coupon ?? order.coupon;
      return {
        code: c?.code ?? order.coupon_code ?? `CUP-${firstUse.coupon_id}`,
        name: c?.name ?? null,
        percent:
          c?.discount_type === 'PERCENTAGE' && c?.discount_value != null
            ? Number(c.discount_value).toLocaleString('es-CO')
            : null,
        discountAmount: Number(firstUse.discount_applied || 0),
      };
    }

    const code = (order.coupon?.code ?? order.coupon_code ?? '').trim();
    if (!code && order.coupon_id == null) return null;

    const promoDiscount = (order.order_promotions ?? []).reduce(
      (sum, p) => sum + Number(p.discount_amount || 0),
      0,
    );
    const activeItems = (order.order_items ?? []).filter(
      (i) => i.cancelled_at == null,
    );
    let totalGrossDiscount = Number(order.discount_amount || 0);
    if (activeItems.length > 0 && order.subtotal_amount != null) {
      const preGross = activeItems.reduce(
        (sum, i) => sum + Number(i.final_total_price ?? i.total_price ?? 0),
        0,
      );
      const postGross =
        Number(order.subtotal_amount || 0) -
        Number(order.discount_amount || 0) +
        Number(order.tax_amount || 0);
      const computedGross = Math.round((preGross - postGross) * 100) / 100;
      if (computedGross > 0) {
        totalGrossDiscount = computedGross;
      }
    }
    const derivedDiscount = Math.max(
      0,
      Math.round((totalGrossDiscount - promoDiscount) * 100) / 100,
    );
    const c = order.coupon;
    return {
      code: code || `CUP-${order.coupon_id}`,
      name: c?.name ?? null,
      percent:
        c?.discount_type === 'PERCENTAGE' && c?.discount_value != null
          ? Number(c.discount_value).toLocaleString('es-CO')
          : null,
      discountAmount: derivedDiscount,
    };
  });

  private readonly lastOrderRef = signal<Order | null>(null);

  constructor() {
    effect(() => {
      const currentOrder = this.order();
      untracked(() => {
        if (currentOrder !== this.lastOrderRef()) {
          this.lastOrderRef.set(currentOrder);
          this.couponCode.set('');
          this.showReplaceInput.set(false);
        }
      });
    });
  }

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.couponCode.set(target.value);
  }

  openReplace(): void {
    this.couponCode.set('');
    this.showReplaceInput.set(true);
  }

  cancelReplace(): void {
    this.couponCode.set('');
    this.showReplaceInput.set(false);
  }

  onApply(): void {
    const code = this.couponCode().trim().toUpperCase();
    if (!code || this.isLoading() || this.disabled()) return;
    this.applyCoupon.emit(code);
  }

  onRemove(): void {
    if (this.isLoading() || this.disabled()) return;
    this.removeCoupon.emit();
  }
}
