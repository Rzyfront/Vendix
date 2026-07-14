import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CheckoutService } from '../../services/checkout.service';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  BadgeComponent,
  BadgeVariant,
} from '../../../../../shared/components/badge/badge.component';
import { IconName } from '../../../../../shared/components/icon/icons.registry';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

// ============================================================================
// PAYLOAD CONTRACT — enriched guest order summary endpoint
// ============================================================================

interface GuestOrderItem {
  product_name: string;
  variant_sku?: string | null;
  variant_attributes?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  tax_amount_item?: number | null;
  image_url?: string | null;
  variant_image_url?: string | null;
}

interface GuestOrderPromotion {
  name?: string | null;
  code?: string | null;
  type?: string | null;
  scope?: string | null;
  value?: number | null;
  discount_amount: number;
}

interface GuestOrderCoupon {
  code: string;
  name?: string | null;
  discount_type?: string | null;
  discount_value?: number | null;
  discount_applied: number;
}

interface GuestOrderAddress {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  country_code?: string | null;
  postal_code?: string | null;
  phone_number?: string | null;
}

interface GuestOrderPayment {
  state: string;
  amount?: number | null;
  paid_at?: string | null;
  method?: string | null;
}

interface GuestOrderInvoice {
  invoice_number: string;
  status: string;
}

interface GuestOrderData {
  order_number: string | number;
  state: string;
  channel?: string | null;
  created_at?: string | null;
  placed_at?: string | null;
  currency?: string | null;
  items: GuestOrderItem[];
  applied_promotions?: GuestOrderPromotion[];
  applied_coupons?: GuestOrderCoupon[];
  discount_amount: number;
  subtotal_amount: number;
  tax_amount: number;
  shipping_cost: number;
  grand_total: number;
  shipping_address?: GuestOrderAddress | null;
  payments?: GuestOrderPayment[];
  invoice?: GuestOrderInvoice | null;
}

interface GuestOrderCustomer {
  first_name?: string;
  last_name?: string;
  document_type?: string;
  document_number?: string;
  email?: string;
  phone?: string;
}

interface GuestOrderStore {
  id?: number;
  name?: string;
  logo_url?: string;
}

interface GuestOrderSummary {
  token: string;
  order: GuestOrderData;
  customer?: GuestOrderCustomer;
  store?: GuestOrderStore;
}

@Component({
  selector: 'app-guest-order-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CurrencyPipe,
    ButtonComponent,
    IconComponent,
    BadgeComponent,
  ],
  template: `
    <div class="guest-order-page">
      @if (loading()) {
        <div class="guest-order-card state-card">
          <div class="spinner"></div>
          <p class="muted">Cargando resumen...</p>
        </div>
      } @else if (error()) {
        <div class="guest-order-card state-card">
          <span class="state-icon error">
            <app-icon name="circle-alert" [size]="30" />
          </span>
          <h1 class="state-title">No encontramos esta orden</h1>
          <p class="muted">Verifica el enlace o contacta a la tienda.</p>
          <app-button routerLink="/cart" variant="primary"
            >Volver al carrito</app-button
          >
        </div>
      } @else if (summary(); as data) {
        <div
          class="guest-order-card printable-order"
          [attr.data-currency]="currencyCode()"
        >
          <!-- HERO HEADER (mirror del checkout, estado completado) -->
          <div class="order-header-hero is-complete" [style.--fill]="'100%'">
            <span class="hero-badge">
              <app-icon [name]="getStateIcon(data.order.state)" [size]="20" />
            </span>
            <span class="hero-text">
              <span class="hero-eyebrow">
                <app-icon name="check" [size]="11" />
                {{ justPurchased() ? '¡Pedido confirmado!' : 'Resumen de compra' }}
              </span>
              <h1 class="hero-title">Orden #{{ data.order.order_number }}</h1>
              <span class="hero-store">{{ data.store?.name || 'Tienda' }}</span>
            </span>
            <app-badge
              [variant]="getStateVariant(data.order.state)"
              size="sm"
              badgeStyle="outline"
              >{{ getStateLabel(data.order.state) }}</app-badge
            >
          </div>

          <!-- SUCCESS BANNER -->
          @if (justPurchased()) {
            <div class="success-banner">
              <app-icon name="check-circle" [size]="20" />
              <span
                >¡Gracias por tu compra! Registramos tu pedido con éxito.</span
              >
            </div>
          }

          <!-- META GRID -->
          <div class="meta-grid">
            <div class="meta-cell">
              <span class="meta-label">Fecha</span>
              <strong class="meta-value">{{
                data.order.created_at | date: 'dd/MM/yyyy HH:mm'
              }}</strong>
            </div>
            <div class="meta-cell">
              <span class="meta-label">Canal</span>
              <strong class="meta-value">{{
                data.order.channel === 'whatsapp' ? 'WhatsApp' : 'E-commerce'
              }}</strong>
            </div>
            @if (data.order.payments?.length) {
              <div class="meta-cell">
                <span class="meta-label">Estado de pago</span>
                <app-badge
                  [variant]="
                    getPaymentStateVariant(data.order.payments![0].state)
                  "
                  size="xs"
                  badgeStyle="outline"
                  >{{
                    getPaymentStateLabel(data.order.payments![0].state)
                  }}</app-badge
                >
              </div>
            }
            <div class="meta-cell">
              <span class="meta-label">Total</span>
              <strong class="meta-value accent">{{
                data.order.grand_total | currency
              }}</strong>
            </div>
          </div>

          <!-- ENTREGA -->
          @if (data.order.shipping_address; as addr) {
            <section class="order-section">
              <div class="section-header">
                <app-icon name="map-pin" [size]="18" />
                <h2>Entrega</h2>
              </div>
              <div class="address-block">
                @if (addr.address_line1) {
                  <p class="addr-line strong">{{ addr.address_line1 }}</p>
                }
                @if (addr.address_line2) {
                  <p class="addr-line">{{ addr.address_line2 }}</p>
                }
                <p class="addr-line muted">
                  {{ addr.city
                  }}@if (addr.state_province) {, {{ addr.state_province }}}@if (
                    addr.country_code
                  ) {
                    · {{ addr.country_code }}}
                </p>
                @if (addr.postal_code) {
                  <p class="addr-line muted">C.P. {{ addr.postal_code }}</p>
                }
                @if (addr.phone_number) {
                  <p class="addr-line muted phone">
                    <app-icon name="phone" [size]="13" />{{
                      addr.phone_number
                    }}
                  </p>
                }
              </div>
            </section>
          }

          <!-- PRODUCTOS -->
          <section class="order-section">
            <div class="section-header">
              <app-icon name="shopping-bag" [size]="18" />
              <h2>Productos</h2>
            </div>
            <div class="items">
              @for (
                item of data.order.items;
                track item.product_name + item.variant_sku
              ) {
                <div class="item-row">
                  <div class="item-thumb">
                    @if (item.variant_image_url || item.image_url) {
                      <img
                        [src]="item.variant_image_url || item.image_url"
                        [alt]="item.product_name"
                      />
                    } @else {
                      <div class="thumb-placeholder">
                        <app-icon name="image" [size]="18" />
                      </div>
                    }
                  </div>
                  <div class="item-info">
                    <span class="item-name">{{ item.product_name }}</span>
                    @if (item.variant_sku || item.variant_attributes) {
                      <span class="item-variant">
                        @if (item.variant_sku) {
                          SKU: {{ item.variant_sku }}
                        }
                        @if (item.variant_sku && item.variant_attributes) {
                          ·
                        }
                        @if (item.variant_attributes) {
                          {{ item.variant_attributes }}
                        }
                      </span>
                    }
                    <span class="item-qty"
                      >{{ item.quantity }} × {{ item.unit_price | currency }}</span
                    >
                  </div>
                  <strong class="item-total">{{
                    item.total_price | currency
                  }}</strong>
                </div>
              }
            </div>
          </section>

          <!-- MÉTODO DE PAGO -->
          @if (data.order.payments?.length) {
            <section class="order-section">
              <div class="section-header">
                <app-icon name="credit-card" [size]="18" />
                <h2>Método de pago</h2>
              </div>
              <div class="payment-block">
                <span class="payment-method">{{
                  data.order.payments![0].method || 'Pago'
                }}</span>
                <app-badge
                  [variant]="
                    getPaymentStateVariant(data.order.payments![0].state)
                  "
                  size="sm"
                  badgeStyle="outline"
                  >{{
                    getPaymentStateLabel(data.order.payments![0].state)
                  }}</app-badge
                >
              </div>
            </section>
          }

          <!-- TOTALES -->
          <section class="order-section totals-panel">
            <div class="total-row">
              <span>Subtotal</span>
              <span>{{ data.order.subtotal_amount | currency }}</span>
            </div>

            @for (
              p of data.order.applied_promotions || [];
              track p.code ?? p.name ?? $index
            ) {
              <div class="total-row discount">
                <span class="discount-label">
                  <app-icon name="tag" [size]="14" />
                  {{ p.name || p.code }}
                </span>
                <span>-{{ p.discount_amount | currency }}</span>
              </div>
            }

            @for (
              c of data.order.applied_coupons || [];
              track c.code
            ) {
              <div class="total-row discount">
                <span class="discount-label">
                  <app-icon name="ticket" [size]="14" />
                  {{ c.code }}
                </span>
                <span>-{{ c.discount_applied | currency }}</span>
              </div>
            }

            @if (
              data.order.discount_amount > 0 &&
              !data.order.applied_promotions?.length &&
              !data.order.applied_coupons?.length
            ) {
              <div class="total-row discount">
                <span class="discount-label">
                  <app-icon name="tag" [size]="14" />
                  Descuento
                </span>
                <span>-{{ data.order.discount_amount | currency }}</span>
              </div>
            }

            <div class="total-row">
              <span>Impuestos</span>
              <span>{{ data.order.tax_amount | currency }}</span>
            </div>
            <div class="total-row">
              <span>Envío</span>
              <span>{{
                data.order.shipping_cost === 0
                  ? 'Gratis'
                  : (data.order.shipping_cost | currency)
              }}</span>
            </div>
            <div class="total-row grand">
              <span>Total</span>
              <span>{{ data.order.grand_total | currency }}</span>
            </div>
          </section>

          <!-- FACTURA ELECTRÓNICA -->
          @if (invoicingEnabled()) {
            <section class="order-section invoice-panel">
              <div class="section-header">
                <app-icon name="file-text" [size]="18" />
                <h2>Factura electrónica</h2>
              </div>
              @if (data.order.invoice) {
                <p class="invoice-line">
                  Factura {{ data.order.invoice.invoice_number }}:
                  <strong>{{ data.order.invoice.status }}</strong>
                </p>
              } @else {
                <p class="invoice-line muted">
                  Si la tienda tiene facturación configurada, la factura será
                  procesada según su flujo actual.
                </p>
              }
              <a class="invoice-link" [routerLink]="['/factura', data.token]"
                >Agregar o actualizar datos de facturación</a
              >
            </section>
          }

          <!-- ACTIONS -->
          <div class="actions no-print">
            <app-button variant="outline" (clicked)="print()">
              <app-icon name="printer" [size]="16" slot="icon" />
              Imprimir
            </app-button>
            <app-button variant="primary" (clicked)="sendToWhatsApp(data)">
              <app-icon name="message-circle" [size]="16" slot="icon" />
              Enviar por WhatsApp
            </app-button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .guest-order-page {
        min-height: 60vh;
        display: flex;
        justify-content: center;
        padding: 1rem;
      }

      .guest-order-card {
        width: min(760px, 100%);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: clamp(1rem, 3vw, 2rem);
        box-shadow: var(--shadow-sm);
      }

      .printable-order {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      /* ---- Loading / Error states ---- */
      .state-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.75rem;
        text-align: center;
      }

      .state-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: var(--radius-md);
      }

      .state-icon.error {
        color: var(--color-error);
        background: var(--color-error-light);
      }

      .state-title {
        margin: 0;
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }

      .muted {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
      }

      /* ---- Hero header (mirror del checkout) ---- */
      .order-header-hero {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-surface);
        transition: border-color 0.4s ease;
      }

      .order-header-hero::before {
        content: '';
        position: absolute;
        inset: 0;
        width: var(--fill, 0%);
        background: linear-gradient(
          90deg,
          rgba(var(--color-success-rgb), 0.06),
          rgba(var(--color-success-rgb), 0.2)
        );
        transition:
          width 0.6s cubic-bezier(0.22, 1, 0.36, 1),
          background 0.4s ease;
        pointer-events: none;
        z-index: 0;
      }

      .order-header-hero > * {
        position: relative;
        z-index: 1;
      }

      .order-header-hero.is-complete {
        border-color: rgba(var(--color-success-rgb), 0.5);
      }

      .order-header-hero.is-complete::before {
        width: 100%;
        background: linear-gradient(
          90deg,
          rgba(var(--color-success-rgb), 0.16),
          rgba(var(--color-success-rgb), 0.3)
        );
      }

      .hero-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 44px;
        height: 44px;
        border-radius: var(--radius-md);
        color: var(--color-primary);
        background: var(--color-primary-light);
        transition:
          color 0.4s ease,
          background 0.4s ease;
      }

      .is-complete .hero-badge {
        color: var(--color-success);
        background: var(--color-success-light);
      }

      .hero-text {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        min-width: 0;
      }

      .hero-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--color-text-secondary);
      }

      .is-complete .hero-eyebrow {
        color: var(--color-success);
      }

      .hero-title {
        margin: 0;
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        line-height: 1.1;
        color: var(--color-text-primary);
      }

      .hero-store {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }

      .order-header-hero app-badge {
        margin-left: auto;
        flex-shrink: 0;
      }

      /* ---- Success banner ---- */
      .success-banner {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--color-success);
        border-radius: var(--radius-md);
        background: var(--color-success-light);
        color: var(--color-text-primary);
        font-size: var(--fs-sm);
      }

      .success-banner app-icon {
        color: var(--color-success);
        flex-shrink: 0;
      }

      /* ---- Meta grid (recessed) ---- */
      .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        padding: 1rem 1.25rem;
        border-radius: var(--radius-lg);
        background: var(--color-background);
      }

      .meta-cell {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        align-items: flex-start;
      }

      .meta-label {
        font-size: var(--fs-xs);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
      }

      .meta-value {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .meta-value.accent {
        color: var(--color-primary);
        font-size: var(--fs-lg);
      }

      /* ---- Section header ---- */
      .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
        color: var(--color-primary);
      }

      .section-header h2 {
        margin: 0;
        font-size: var(--fs-lg);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      /* ---- Address ---- */
      .address-block {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .addr-line {
        margin: 0;
        color: var(--color-text-primary);
        font-size: var(--fs-sm);
      }

      .addr-line.strong {
        font-weight: var(--fw-semibold);
      }

      .addr-line.muted {
        color: var(--color-text-secondary);
      }

      .addr-line.phone {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      /* ---- Items ---- */
      .items {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
      }

      .item-row {
        display: flex;
        align-items: center;
        gap: 0.875rem;
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--color-border);
      }

      .item-row:last-child {
        border-bottom: 0;
      }

      .item-thumb {
        flex-shrink: 0;
        width: 60px;
        height: 60px;
        border-radius: var(--radius-md);
        overflow: hidden;
        border: 1px solid var(--color-border);
        background: var(--color-background);
      }

      .item-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .thumb-placeholder {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        color: var(--color-text-muted);
      }

      .item-info {
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        flex: 1;
        min-width: 0;
      }

      .item-name {
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }

      .item-variant {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
      }

      .item-qty {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }

      .item-total {
        flex-shrink: 0;
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        white-space: nowrap;
      }

      /* ---- Payment ---- */
      .payment-block {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-background);
      }

      .payment-method {
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
      }

      /* ---- Totals ---- */
      .totals-panel {
        padding: 1.25rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-background);
      }

      .total-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 0.4rem 0;
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }

      .total-row.discount {
        color: var(--color-success);
      }

      .discount-label {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .total-row.grand {
        margin-top: 0.4rem;
        padding-top: 0.85rem;
        border-top: 1px solid var(--color-border);
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }

      .total-row.grand span:last-child {
        color: var(--color-primary);
      }

      /* ---- Invoice ---- */
      .invoice-panel {
        padding: 1.25rem;
        border-radius: var(--radius-md);
        background: var(--color-primary-light);
      }

      .invoice-line {
        margin: 0 0 0.5rem;
        font-size: var(--fs-sm);
        color: var(--color-text-primary);
      }

      .invoice-line.muted {
        color: var(--color-text-secondary);
      }

      .invoice-link {
        font-size: var(--fs-sm);
        font-weight: var(--fw-medium);
        color: var(--color-primary);
        text-decoration: underline;
      }

      /* ---- Actions ---- */
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
      }

      /* ---- Spinner ---- */
      .spinner {
        width: 42px;
        height: 42px;
        border: 4px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* ---- Responsive ---- */
      @media (max-width: 720px) {
        .meta-grid {
          grid-template-columns: 1fr;
        }

        .actions {
          flex-direction: column;
        }

        .order-header-hero {
          flex-wrap: wrap;
        }

        .order-header-hero app-badge {
          margin-left: 0;
        }
      }

      /* ---- Print ---- */
      @media print {
        .no-print {
          display: none !important;
        }
        .guest-order-page {
          padding: 0;
        }
        .guest-order-card {
          box-shadow: none;
          border: 0;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GuestOrderSummaryComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly checkoutService = inject(CheckoutService);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly summary = signal<GuestOrderSummary | null>(null);
  readonly invoicingEnabled = signal(false);
  readonly justPurchased = signal(false);

  // Signal de moneda: forzamos change detection en el card (data-currency)
  // para que el pipe impuro `| currency` no se quede pegado en el fallback `$`.
  readonly currencyCode = this.currencyService.currencyCode;

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.justPurchased.set(
      this.route.snapshot.queryParamMap.get('success') === 'true',
    );

    const token = this.route.snapshot.paramMap.get('token') || '';
    if (!token) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }

    this.checkoutService
      .getGuestOrderSummary(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.summary.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });

    this.checkoutService
      .getInvoicingEligibility()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => this.invoicingEnabled.set(result.invoicing_enabled),
        error: () => this.invoicingEnabled.set(false),
      });
  }

  print(): void {
    window.print();
  }

  sendToWhatsApp(data: GuestOrderSummary): void {
    const config = this.tenantFacade.getCurrentDomainConfig();
    const phone = (
      config?.customConfig?.ecommerce?.checkout?.whatsapp_number || ''
    ).replace(/\D/g, '');
    if (!phone) {
      this.toast.warning('La tienda no tiene un WhatsApp configurado');
      return;
    }

    const fmt = (value: number) =>
      this.currencyService.format(Number(value || 0));
    const items = data.order.items
      .map(
        (item: GuestOrderItem) =>
          `- ${item.product_name} x${item.quantity}: ${fmt(item.total_price)}`,
      )
      .join('\n');
    const message = encodeURIComponent(
      `Hola, quiero compartir la orden ${data.order.order_number}\n\n${items}\n\nTotal: ${fmt(data.order.grand_total)}`,
    );
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  }

  // ==========================================================================
  // STATE HELPERS — order_state_enum (9 estados)
  // ==========================================================================

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      created: 'Creada',
      pending_payment: 'Pendiente de pago',
      processing: 'En proceso',
      shipped: 'Enviada',
      delivered: 'Entregada',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
    };
    return labels[state] || state;
  }

  getStateVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      delivered: 'success',
      finished: 'success',
      processing: 'primary',
      shipped: 'primary',
      pending_payment: 'warning',
      created: 'warning',
      draft: 'warning',
      cancelled: 'error',
      refunded: 'info',
    };
    return variants[state] || 'neutral';
  }

  getStateIcon(state: string): IconName {
    const icons: Record<string, IconName> = {
      draft: 'clock',
      created: 'clock',
      pending_payment: 'clock',
      processing: 'loader-2',
      shipped: 'truck',
      delivered: 'check-circle',
      finished: 'check-circle',
      cancelled: 'circle-x',
      refunded: 'coins',
    };
    return icons[state] || 'clock';
  }

  getPaymentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      paid: 'Pagado',
      pending: 'Pendiente',
      partial: 'Parcial',
      failed: 'Fallido',
      refunded: 'Reembolsado',
    };
    return labels[state] || state;
  }

  getPaymentStateVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      paid: 'success',
      pending: 'warning',
      partial: 'info',
      failed: 'error',
      refunded: 'info',
    };
    return variants[state] || 'neutral';
  }
}
