import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { Cart } from '../../services/cart.service';

/**
 * Barra mini fija (una línea) del carrito para el storefront móvil.
 *
 * Muestra cantidad de artículos, total y el CTA "Hacer pedido". Es redundante
 * a propósito con el ícono del carrito del header. Presentacional: los datos
 * vienen del input `cart` y las intenciones salen por `checkout` / `viewCart`.
 * Oculta en desktop (`>=1024px`).
 *
 * El `CurrencyPipe` propio es impuro y lee la señal de moneda internamente, por
 * eso se enlaza `[attr.data-currency]` (mismo guard que `app-cart-mobile-footer`).
 */
@Component({
  selector: 'app-cart-mini-bar',
  standalone: true,
  imports: [IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cart-mini-bar" [attr.data-currency]="currencyCode()">
      <button
        type="button"
        class="summary-btn"
        [attr.aria-label]="summaryAriaLabel()"
        (click)="viewCart.emit()"
      >
        <span class="count-badge" [class.count-badge--pulse]="pulse()">
          <app-icon name="shopping-bag" [size]="16" />
          <span class="count-badge__num">{{
            itemCount() > 99 ? '99+' : itemCount()
          }}</span>
        </span>
        <span class="summary-text">{{ itemsLabel() }}</span>
        <span class="summary-sep" aria-hidden="true">·</span>
        <span class="summary-total">{{ total() | currency }}</span>
      </button>

      <button type="button" class="checkout-btn" (click)="checkout.emit()">
        <app-icon name="banknote" [size]="16" />
        Hacer pedido
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cart-mini-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: var(--z-fixed, 30);
        box-sizing: border-box;
        min-height: calc(52px + env(safe-area-inset-bottom, 0px));
        padding: 0 12px env(safe-area-inset-bottom, 0px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        background: var(--color-surface);
        border-top: 1px solid var(--color-border);
        box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.08);
        animation: mini-bar-slide-up 0.26s ease-out;
      }

      .summary-btn {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0;
        background: transparent;
        border: 0;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
      }

      .summary-btn:focus-visible,
      .checkout-btn:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }

      .count-badge {
        flex: 0 0 auto;
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--color-background);
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
      }

      .count-badge__num {
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        box-sizing: border-box;
        border-radius: 9px;
        background: var(--color-primary);
        color: var(--color-text-on-primary, #fff);
        font-size: 11px;
        font-weight: 700;
        line-height: 18px;
        text-align: center;
      }

      .count-badge--pulse {
        animation: mini-bar-pulse 0.4s ease-out;
      }

      .summary-text {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text-secondary);
      }

      .summary-sep {
        flex: 0 0 auto;
        color: var(--color-text-muted);
      }

      .summary-total {
        flex: 0 0 auto;
        white-space: nowrap;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .checkout-btn {
        flex: 0 0 auto;
        min-height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: var(--color-primary);
        color: var(--color-text-on-primary, #fff);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      @keyframes mini-bar-slide-up {
        from {
          transform: translateY(100%);
        }
        to {
          transform: translateY(0);
        }
      }

      @keyframes mini-bar-pulse {
        0% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.18);
        }
        100% {
          transform: scale(1);
        }
      }

      @media (min-width: 1024px) {
        :host {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cart-mini-bar,
        .count-badge--pulse {
          animation: none;
        }
      }
    `,
  ],
})
export class CartMiniBarComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  /** Carrito de origen; total y cantidad se leen reactivamente de aquí. */
  readonly cart = input<Cart | null>(null);

  /** Se emite al pulsar "Hacer pedido". */
  readonly checkout = output<void>();
  /** Se emite al tocar el resumen (ir al carrito). */
  readonly viewCart = output<void>();

  /** Atado a la carga asíncrona de moneda (ver doc del componente). */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  /** Total a pagar: subtotal promocional si hay descuento, si no el subtotal. */
  readonly total = computed<number>(() => {
    const c = this.cart();
    if (!c) return 0;
    return (c.promotion_discount ?? 0) > 0
      ? (c.promotional_subtotal ?? c.subtotal ?? 0)
      : (c.subtotal ?? 0);
  });

  readonly itemCount = computed<number>(() => this.cart()?.item_count ?? 0);

  readonly itemsLabel = computed<string>(() => {
    const n = this.itemCount();
    return `${n} ${n === 1 ? 'artículo' : 'artículos'}`;
  });

  readonly summaryAriaLabel = computed<string>(
    () => `Ver carrito, ${this.itemsLabel()}`,
  );

  /** Clase de pulso del badge; se apaga con timeout. */
  readonly pulse = signal(false);

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCount: number | null = null;

  constructor() {
    effect(() => {
      const count = this.itemCount();
      untracked(() => {
        if (this.lastCount !== null && this.lastCount !== count) {
          this.pulse.set(true);
          if (this.pulseTimer) clearTimeout(this.pulseTimer);
          this.pulseTimer = setTimeout(() => {
            this.pulse.set(false);
            this.pulseTimer = null;
          }, 400);
        }
        this.lastCount = count;
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
    });
  }
}
