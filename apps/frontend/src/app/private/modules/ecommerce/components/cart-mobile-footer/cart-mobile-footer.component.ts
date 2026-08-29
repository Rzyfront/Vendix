import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { CartPromotionsComponent } from '../cart-promotions/cart-promotions.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { Cart } from '../../services/cart.service';

/**
 * POS-style fixed mobile footer for the ecommerce cart.
 *
 * Shows a compact, always-visible summary bar pinned to the bottom on phones /
 * tablets (`<1024px`) with the order total, an item badge and a "Ver detalle"
 * trigger, plus the primary checkout CTA (and an optional WhatsApp CTA). The
 * "Ver detalle" trigger opens a bottom drawer that slides up from the bottom
 * edge (POS/POP style, not a centered modal) with the full order breakdown —
 * subtotal, applied promotions (reusing `app-cart-promotions`), shipping
 * placeholder and the grand total — repeating the CTAs.
 *
 * Purely presentational: all data comes from the `cart` input signal and the
 * auth/whatsapp flags; checkout intent is emitted upward via outputs. Hidden on
 * desktop (`≥1024px`), where the standard cart page layout takes over.
 *
 * Money is rendered with the tenant `CurrencyPipe` (custom Vendix pipe, NOT
 * `@angular/common`). Because that pipe is impure and reads the tenant currency
 * signal internally, we bind `[attr.data-currency]="currencyCode()"` on the
 * root nodes (same guard as `app-cart-promotions`) so this OnPush component
 * re-renders when the currency resolves asynchronously after first paint.
 */
@Component({
  selector: 'app-cart-mobile-footer',
  standalone: true,
  imports: [
    CommonModule,
    IconComponent,
    ButtonComponent,
    CartPromotionsComponent,
    CurrencyPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Barra fija (solo móvil / tablet, oculta en desktop vía :host) -->
    <div class="cart-mobile-footer" [attr.data-currency]="currencyCode()">
      <!-- Fila 1: resumen + Ver detalle -->
      <div class="summary-row">
        <div class="cart-summary">
          <div class="cart-icon-wrapper">
            <app-icon name="shopping-cart" [size]="20" />
            @if (itemCount() > 0) {
              <span class="cart-badge">
                {{ itemCount() > 99 ? '99+' : itemCount() }}
              </span>
            }
          </div>
          <div class="cart-totals">
            <span class="total-label">Total</span>
            <span class="total-amount">{{ total() | currency }}</span>
            <span class="tax-hint">Imp. incluido</span>
          </div>
        </div>

        <button
          type="button"
          class="view-detail-btn"
          (click)="openDetail()"
          [disabled]="itemCount() === 0"
        >
          <span>Ver detalle</span>
          <app-icon name="chevron-up" [size]="16" />
        </button>
      </div>

      <!-- Fila 2: CTA primaria -->
      <button
        type="button"
        class="checkout-btn-full"
        (click)="onCheckout()"
        [disabled]="itemCount() === 0"
      >
        <span class="checkout-label">{{ checkoutLabel() }}</span>
      </button>

      <!-- Fila 3 (opcional): WhatsApp -->
      @if (whatsappEnabled()) {
        <app-button
          variant="success"
          [fullWidth]="true"
          [loading]="whatsappLoading()"
          [disabled]="itemCount() === 0"
          customClasses="!bg-[#25D366] hover:!bg-[#1da851] !border-[#25D366] !text-white"
          (clicked)="onWhatsapp()"
        >
          <app-icon slot="icon" name="message-circle" [size]="18" />
          Pagar por WhatsApp
        </app-button>
      }
    </div>

    <!-- Cajón desplegable con el detalle del pedido: sube desde el borde
         inferior (estilo POS/POP), NO un modal centrado. -->
    @if (detailOpen()) {
      <div class="sheet-overlay" (click)="closeDetail()" aria-hidden="true"></div>
      <div
        class="sheet-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Resumen del pedido"
        [attr.data-currency]="currencyCode()"
      >
        <button
          type="button"
          class="sheet-handle"
          (click)="closeDetail()"
          aria-label="Cerrar detalle"
        ></button>

        <div class="sheet-header">
          <h3 class="sheet-title">Resumen del pedido</h3>
          <button
            type="button"
            class="sheet-close"
            (click)="closeDetail()"
            aria-label="Cerrar"
          >
            <app-icon name="x" [size]="20" />
          </button>
        </div>

        <div class="sheet-body">
          <!-- Subtotal -->
          <div class="sheet-row">
            <span class="sheet-label">
              Subtotal
              <span class="sheet-count">({{ itemCount() }} art.)</span>
            </span>
            <span class="sheet-value">{{ (cart()?.subtotal ?? 0) | currency }}</span>
          </div>

          <!-- Promociones aplicadas (el nudge de tramo vive ahora en el
               bannersito del carrito, no aquí). -->
          <app-cart-promotions [cart]="cart()" [showTier]="false" />

          <!-- Envío -->
          <div class="sheet-row">
            <span class="sheet-label">Envío</span>
            <span class="sheet-value shipping-pending">Por calcular</span>
          </div>

          <div class="sheet-divider"></div>

          <!-- Total -->
          <div class="sheet-row total-row">
            <div class="sheet-total-block">
              <span class="sheet-total-label">Total</span>
              <span class="sheet-total-hint">Imp. incluido</span>
            </div>
            <span class="sheet-total-value">{{ total() | currency }}</span>
          </div>
        </div>

        <div class="sheet-footer">
          <button
            type="button"
            class="checkout-btn-full"
            (click)="closeDetail(); onCheckout()"
            [disabled]="itemCount() === 0"
          >
            <span class="checkout-label">{{ checkoutLabel() }}</span>
          </button>

          @if (whatsappEnabled()) {
            <app-button
              variant="success"
              [fullWidth]="true"
              [loading]="whatsappLoading()"
              [disabled]="itemCount() === 0"
              customClasses="!bg-[#25D366] hover:!bg-[#1da851] !border-[#25D366] !text-white"
              (clicked)="closeDetail(); onWhatsapp()"
            >
              <app-icon slot="icon" name="message-circle" [size]="18" />
              Pagar por WhatsApp
            </app-button>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* ---------- Barra fija ---------- */
      .cart-mobile-footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 40;
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-top: 1px solid var(--color-border);
        padding: 10px 12px;
        padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .summary-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .cart-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
      }

      .cart-icon-wrapper {
        position: relative;
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        background: var(--color-primary);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-on-primary, #fff);
      }

      .cart-badge {
        position: absolute;
        top: -5px;
        right: -5px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        background: var(--color-destructive, #ef4444);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        border-radius: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border: 2px solid var(--color-surface);
      }

      .cart-totals {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .total-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--color-text-secondary);
        line-height: 1;
      }

      .total-amount {
        font-size: 18px;
        font-weight: 800;
        color: var(--color-text-primary);
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tax-hint {
        margin-top: 2px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary);
        line-height: 1.1;
      }

      .view-detail-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 8px 16px;
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        border-radius: 22px;
        color: var(--color-text-primary);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background-color 0.2s ease,
          border-color 0.2s ease,
          color 0.2s ease,
          transform 0.15s ease;
        flex-shrink: 0;
        white-space: nowrap;
      }

      .view-detail-btn:hover:not(:disabled) {
        background: var(--color-primary-light, rgba(var(--color-primary-rgb), 0.08));
        border-color: var(--color-primary);
        color: var(--color-primary);
      }

      .view-detail-btn:active:not(:disabled) {
        transform: scale(0.97);
      }

      .view-detail-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* ---------- CTA primaria (paridad POS .checkout-btn-full) ---------- */
      .checkout-btn-full {
        width: 100%;
        height: 46px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border: none;
        border-radius: 12px;
        background: var(--color-primary);
        color: var(--color-text-on-primary, #fff);
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(var(--color-primary-rgb), 0.3);
        transition:
          filter 0.2s ease,
          transform 0.15s ease;
      }

      .checkout-btn-full:hover:not(:disabled) {
        filter: brightness(1.1);
      }

      .checkout-btn-full:active:not(:disabled) {
        transform: scale(0.97);
      }

      .checkout-btn-full:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        box-shadow: none;
      }

      .checkout-btn-full:focus-visible {
        outline: 2px solid var(--color-ring, var(--color-primary));
        outline-offset: 2px;
      }

      .checkout-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* ---------- Cajón desplegable (sube desde el borde inferior) ---------- */
      .sheet-overlay {
        position: fixed;
        inset: 0;
        z-index: 50;
        background: rgba(15, 23, 42, 0.5);
        animation: sheet-fade 0.2s ease;
      }

      .sheet-drawer {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 51;
        display: flex;
        flex-direction: column;
        max-height: 85vh;
        background: var(--color-surface);
        border-radius: 20px 20px 0 0;
        box-shadow: 0 -12px 40px -12px rgba(15, 23, 42, 0.35);
        padding: 6px 16px calc(16px + env(safe-area-inset-bottom, 0px));
        animation: sheet-slide-up 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }

      .sheet-handle {
        width: 44px;
        height: 5px;
        padding: 0;
        border: none;
        border-radius: 999px;
        background: var(--color-border);
        margin: 6px auto 10px;
        cursor: pointer;
        flex-shrink: 0;
      }

      .sheet-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding-bottom: 12px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
      }

      .sheet-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--color-text-primary);
      }

      .sheet-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
        flex-shrink: 0;
        transition:
          background-color 0.2s ease,
          color 0.2s ease;
      }

      .sheet-close:hover {
        background: var(--color-muted);
        color: var(--color-text-primary);
      }

      .sheet-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
      }

      @keyframes sheet-fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes sheet-slide-up {
        from {
          transform: translateY(100%);
        }
        to {
          transform: translateY(0);
        }
      }

      .sheet-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .sheet-label {
        font-size: 14px;
        color: var(--color-text-secondary);
      }

      .sheet-count {
        font-size: 12px;
        color: var(--color-text-muted, var(--color-text-secondary));
      }

      .sheet-value {
        font-size: 14px;
        font-weight: 600;
        color: var(--color-text-primary);
        white-space: nowrap;
      }

      .shipping-pending {
        color: var(--color-success);
        font-weight: 600;
      }

      .sheet-divider {
        height: 1px;
        background: var(--color-border);
        margin: 2px 0;
      }

      .total-row {
        align-items: flex-end;
      }

      .sheet-total-block {
        display: flex;
        flex-direction: column;
      }

      .sheet-total-label {
        font-size: 16px;
        font-weight: 800;
        color: var(--color-text-primary);
        line-height: 1.2;
      }

      .sheet-total-hint {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary);
      }

      .sheet-total-value {
        font-size: 22px;
        font-weight: 800;
        color: var(--color-primary);
        white-space: nowrap;
      }

      .sheet-footer {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
        flex-shrink: 0;
        padding-top: 12px;
        margin-top: 4px;
      }

      /* ---------- Responsivo ---------- */
      /* Desktop: la página de carrito estándar toma el control */
      @media (min-width: 1024px) {
        :host {
          display: none;
        }
      }

      @media (max-width: 340px) {
        .total-amount {
          font-size: 16px;
        }

        .view-detail-btn {
          padding: 8px 12px;
          font-size: 12px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .view-detail-btn,
        .checkout-btn-full {
          transition: none;
        }

        .sheet-overlay,
        .sheet-drawer {
          animation: none;
        }
      }
    `,
  ],
})
export class CartMobileFooterComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);

  /** Source cart. Totals/promotions are read reactively from this signal. */
  readonly cart = input<Cart | null>(null);
  /** Whether the customer is logged in. Drives the CTA label. */
  readonly isAuthenticated = input<boolean>(false);
  /** Store requires registration before checkout (with `!isAuthenticated`). */
  readonly requiresRegistration = input<boolean>(false);
  /** WhatsApp checkout available for this store. */
  readonly whatsappEnabled = input<boolean>(false);
  /** WhatsApp CTA in-flight state. */
  readonly whatsappLoading = input<boolean>(false);

  /** Emitted when the primary checkout CTA is pressed. */
  readonly checkout = output<void>();
  /** Emitted when the WhatsApp CTA is pressed. */
  readonly whatsapp = output<void>();

  /** Bottom-drawer visibility. Toggled by openDetail()/closeDetail(); drives the
   *  `@if`-rendered slide-up sheet (overlay + drawer) in the template. */
  readonly detailOpen = signal(false);

  /**
   * Tenant currency code, referenced in the template (`[attr.data-currency]`)
   * so this OnPush component's change detection is tied to the async currency
   * load. Mirrors the guard in `app-cart-promotions` and prevents the impure
   * `| currency` pipe from getting stuck on its fallback formatting.
   */
  protected readonly currencyCode = this.currencyFormat.currencyCode;

  /** Payable total: promotional subtotal when a discount applies, else subtotal. */
  readonly total = computed<number>(() => {
    const c = this.cart();
    if (!c) return 0;
    return (c.promotion_discount ?? 0) > 0
      ? (c.promotional_subtotal ?? c.subtotal ?? 0)
      : (c.subtotal ?? 0);
  });

  /** Number of items in the cart (drives badge + disabled states). */
  readonly itemCount = computed<number>(() => this.cart()?.item_count ?? 0);

  /** Primary CTA label: login prompt when registration is required and guest. */
  readonly checkoutLabel = computed<string>(() =>
    !this.isAuthenticated() && this.requiresRegistration()
      ? 'Iniciar sesión para comprar'
      : 'Finalizar compra',
  );

  openDetail(): void {
    this.detailOpen.set(true);
  }

  closeDetail(): void {
    this.detailOpen.set(false);
  }

  onCheckout(): void {
    this.checkout.emit();
  }

  onWhatsapp(): void {
    this.whatsapp.emit();
  }
}
