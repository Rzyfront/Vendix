import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CheckoutService } from '../../services/checkout.service';
import { GuestOrderSseService } from '../../services/guest-order-sse.service';
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
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { FileUploadDropzoneComponent } from '../../../../../shared/components/file-upload-dropzone/file-upload-dropzone.component';
import { IconName } from '../../../../../shared/components/icon/icons.registry';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { OrderTrackingProgressComponent } from '../../../../../shared/components/order-tracking-progress/order-tracking-progress.component';
import { GuestOrderPrintService } from '../../services/guest-order-print.service';

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
  // Paso 3/8 (roku-shop-checkout): `kitchen_status` ya viene resuelto por el
  // backend con la regla in-flight (`kitchenStatusFor`); null = nunca disparado.
  // `preparation_time_minutes` = variante ?? producto (null si ninguno).
  kitchen_status?: string | null;
  preparation_time_minutes?: number | null;
  // E2 (Carril B) — fecha de cancelación y motivo del soft-cancel D2.
  // Nullable: el grueso de líneas no están canceladas.
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
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
  // Paso 3 (roku-shop-checkout): `payment_id` identifica el pago para los
  // endpoints guest de comprobante (paso 9); `has_receipt` + content-type
  // alimentan el visor de comprobante.
  payment_id?: number | null;
  state: string;
  amount?: number | null;
  paid_at?: string | null;
  method?: string | null;
  has_receipt?: boolean;
  receipt_content_type?: string | null;
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
  // Paso 3/8 (roku-shop-checkout): ETA persistido + MAX en vivo + entrega.
  estimated_ready_at?: string | null;
  estimated_delivered_at?: string | null;
  prep_minutes_max?: number | null;
  delivery_type?: string | null;
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

/**
 * Paso 9 (roku-shop-checkout-tarifa-detalle-orden) — visor de comprobante.
 * Mismo patrón que el admin (`order-details-page`): `kind` distingue
 * imagen (tag `img`) de PDF (`iframe` con URL sanitizada).
 */
interface GuestReceiptPreview {
  url: string;
  safeUrl: SafeResourceUrl;
  kind: 'image' | 'pdf';
}

interface GuestOrderSummary {
  token: string;
  order: GuestOrderData;
  customer?: GuestOrderCustomer;
  store?: GuestOrderStore;
  /**
   * C.7 (CP-pos-exclusive-tax-double-charge, ADR-12) — gate fiscal resuelto
   * por el backend (`resolvePrintsVatBreakdownForPrint`, fail-closed). Sin
   * esto en `true` la sección de totales no muestra Subtotal/Impuestos
   * juntos, aunque `order.tax_amount` sea positivo (regla anti-huérfana
   * §5.3: o van los dos, o ninguno).
   */
  prints_vat_breakdown?: boolean;
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
    ModalComponent,
    FileUploadDropzoneComponent,
    OrderTrackingProgressComponent,
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
          [class.card-enter]="justPurchased()"
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

          <!-- LIVE PILL (paso 9: estado del stream SSE guest) -->
          @if (sseLiveVisible()) {
            <div
              class="live-pill"
              [class.live-pill--reduced]="sse.prefersReducedMotion()"
              [attr.data-state]="sse.connectionState()"
            >
              <span
                class="live-dot"
                [class.is-open]="sse.connectionState() === 'open'"
              ></span>
              {{ sseLiveLabel() }}
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
            @if (worstPaymentState(data.order.payments); as payState) {
              <div class="meta-cell">
                <span class="meta-label">Estado de pago</span>
                <app-badge
                  [variant]="getPaymentStateVariant(payState)"
                  size="xs"
                  badgeStyle="outline"
                  >{{ getPaymentStateLabel(payState) }}</app-badge
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

          <!-- ETA DE PREPARACIÓN (paso 8: tras hide_prep_eta) -->
          @if (etaVisible()) {
            <div class="eta-banner">
              <app-icon name="timer" [size]="20" />
              <div class="eta-text">
                <strong class="eta-line">{{ etaLabel(data.order) }}</strong>
                @if (isPaymentPending(data.order)) {
                  <span class="eta-note"
                    >Tu pago está pendiente de confirmación; la cocina inicia al
                    confirmarse y el tiempo puede variar.</span
                  >
                }
              </div>
            </div>
          }

          <!-- SEGUIMIENTO (paso 10: tras hide_tracking_progress) -->
          @if (trackingShown()) {
            <app-order-tracking-progress
              [orderState]="data.order.state"
              [hasShippingAddress]="data.order.shipping_address != null"
              [animateFromZero]="justPurchased()"
              [baseMinutes]="data.order.prep_minutes_max ?? 15"
              [reducedMotion]="sse.prefersReducedMotion()"
            />
          }

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
                <!--
                  E2 — el item cancelado se queda en su posicion original
                  (Nancy: "el cliente necesita ver que cancelo en el sitio
                  donde lo pidio"). Precio y total OCULTOS: un numero tachado
                  sigue siendo un numero que el ojo suma. El nombre va
                  tachado pero legible (sin bajar el contraste al maximo).
                  El motivo solo se pinta si aporta — vacio o prefijo
                  "legacy:" de la ruta vieja de compatibilidad, oculto.
                -->
                <div
                  class="item-row"
                  [class.item-row--cancelled]="isItemCancelled(item)"
                >
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
                    <div class="item-name-row">
                      <span class="item-name">{{ item.product_name }}</span>
                      @if (isItemCancelled(item)) {
                        <app-badge variant="warning" size="sm">
                          <app-icon name="x-circle" [size]="11" />
                          Cancelado
                        </app-badge>
                      }
                    </div>
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
                    @if (!isItemCancelled(item)) {
                      <span class="item-qty"
                        >{{ item.quantity }} ×
                        {{ item.unit_price | currency }}</span
                      >
                    }
                    @if (
                      isItemCancelled(item) && hasVisibleCancellationReason(item)
                    ) {
                      <span class="item-cancellation-reason">
                        {{ item.cancellation_reason }}
                      </span>
                    }
                    @if (kitchenStateFor(item); as ks) {
                      <span
                        class="kitchen-line"
                        [class.kitchen-line--flash]="
                          isKitchenFlashing(item.product_name)
                        "
                      >
                        <app-badge
                          [variant]="kitchenBadgeVariant(ks)"
                          size="xs"
                        >
                          <app-icon name="flame" [size]="10" />
                          Cocina: {{ kitchenStateLabel(ks) }}
                        </app-badge>
                      </span>
                    }
                  </div>
                  @if (!isItemCancelled(item)) {
                    <strong class="item-total">{{
                      item.total_price | currency
                    }}</strong>
                  }
                </div>
              }
            </div>
          </section>

          <!-- MÉTODO DE PAGO (multipago ordenado peor-primero) -->
          @if (paymentsWorstFirst(data.order.payments); as payments) {
            @if (payments.length) {
              <section class="order-section">
                <div class="section-header">
                  <app-icon name="credit-card" [size]="18" />
                  <h2>Método de pago</h2>
                </div>
                <div class="payment-list">
                  @for (p of payments; track p.payment_id ?? p.method ?? $index) {
                    <div class="payment-block">
                      <div class="payment-head">
                        <span class="payment-method">{{
                          p.method || 'Pago'
                        }}</span>
                        <app-badge
                          [variant]="getPaymentStateVariant(p.state)"
                          size="sm"
                          badgeStyle="outline"
                          >{{ getPaymentStateLabel(p.state) }}</app-badge
                        >
                      </div>
                      <!-- COMPROBANTE (paso 9): ver si has_receipt, cargar si falta -->
                      @if (p.payment_id != null) {
                        <div class="payment-receipt">
                          @if (p.has_receipt) {
                            <app-button
                              variant="outline"
                              size="sm"
                              (clicked)="viewReceipt(p)"
                              [disabled]="
                                loadingReceiptId() === p.payment_id
                              "
                              [loading]="loadingReceiptId() === p.payment_id"
                            >
                              <app-icon
                                slot="icon"
                                name="receipt"
                                [size]="14"
                              />
                              {{
                                loadingReceiptId() === p.payment_id
                                  ? 'Cargando...'
                                  : 'Ver comprobante'
                              }}
                            </app-button>
                          } @else {
                            <div class="receipt-upload">
                              <span class="receipt-upload-label">
                                ¿Pagaste por transferencia? Adjunta tu
                                comprobante para acelerar la confirmación:
                              </span>
                              <app-file-upload-dropzone
                                label="Toca aquí o arrastra tu comprobante"
                                helperText="JPG, PNG, WebP o PDF · máximo 5 MB"
                                accept=".jpg,.jpeg,.png,.webp,.pdf"
                                icon="upload-cloud"
                                [disabled]="uploadingReceiptId() !== null"
                                (fileSelected)="onReceiptFile(p, $event)"
                              />
                              @if (uploadingReceiptId() === p.payment_id) {
                                <span class="receipt-uploading"
                                  >Subiendo comprobante…</span
                                >
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </section>
            }
          }

          <!-- TOTALES -->
          <!-- C.7 (§5.3, base taxable): sin impuesto, Subtotal solo alcanza.
               Con impuesto, Subtotal e Impuestos van JUNTOS o NINGUNO —
               nunca un Subtotal huérfano sin su fila de IVA al lado — y el
               gate lo trae ahora prints_vat_breakdown (backend, C.7). -->
          <section class="order-section totals-panel">
            @if ((data.order.tax_amount || 0) === 0) {
              <div class="total-row">
                <span>Subtotal</span>
                <span>{{ data.order.subtotal_amount | currency }}</span>
              </div>
            } @else if (data.prints_vat_breakdown) {
              <div class="total-row">
                <span>Subtotal</span>
                <span>{{ data.order.subtotal_amount | currency }}</span>
              </div>
              <div class="total-row">
                <span>Impuestos</span>
                <span>{{ data.order.tax_amount | currency }}</span>
              </div>
            }

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

          <!-- ACTIONS -->
          <div class="actions no-print">
            <app-button variant="outline" (clicked)="print()">
              <app-icon name="printer" [size]="16" slot="icon" />
              Imprimir
            </app-button>
            @if (whatsappEnabled()) {
              <app-button variant="primary" (clicked)="sendToWhatsApp(data)">
                <app-icon name="message-circle" [size]="16" slot="icon" />
                Preguntar por mi pedido
              </app-button>
            }
          </div>
        </div>

        <!-- VISOR DE COMPROBANTE (paso 9, patrón admin order-details) -->
        <app-modal
          [isOpen]="showReceiptModal()"
          (closed)="closeReceiptModal()"
          title="Comprobante de pago"
          size="xl"
          customClasses="guest-receipt-preview-modal"
        >
          @if (receiptPreview(); as receipt) {
            <div class="guest-receipt-preview-shell">
              @if (receipt.kind === 'image') {
                <img
                  [src]="receipt.url"
                  alt="Comprobante de pago adjunto"
                  class="guest-receipt-image"
                />
              } @else {
                <iframe
                  [src]="receipt.safeUrl"
                  title="Comprobante de pago adjunto"
                  class="guest-receipt-frame"
                ></iframe>
              }
            </div>
          } @else {
            <div class="guest-receipt-empty">
              <app-icon name="file-text" [size]="28" />
              <p>No hay un comprobante cargado para previsualizar.</p>
            </div>
          }

          <div slot="footer" class="guest-receipt-footer">
            <app-button variant="outline" (clicked)="closeReceiptModal()">
              Cerrar
            </app-button>
          </div>
        </app-modal>
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

      // E2 — soft cancel: precio OCULTO (no tachado), nombre tachado pero
      // legible. Sin bajar el contraste al maximo para que el cliente pueda
      // seguir leyendo que ese es el plato que pidio.
      .item-row--cancelled .item-name {
        text-decoration: line-through;
        text-decoration-color: color-mix(
          in srgb,
          var(--color-text-secondary) 70%,
          transparent
        );
        text-decoration-thickness: 1.5px;
      }

      .item-cancellation-reason {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
        font-style: italic;
        margin-top: 0.125rem;
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

      /* ---- Live pill (paso 9: estado del stream SSE) ---- */
      .live-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        align-self: flex-start;
        padding: 0.3rem 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 999px;
        background: var(--color-background);
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
      }

      .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--color-warning);
        animation: live-pulse 1.6s ease-in-out infinite;
      }

      .live-dot.is-open {
        background: var(--color-success);
      }

      @keyframes live-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      /* ---- Payment ---- */
      .payment-block {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        padding: 0.875rem 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-background);
      }

      .payment-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .payment-method {
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
      }

      .payment-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      /* ---- Comprobante (paso 9) ---- */
      .payment-receipt {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-top: 0.75rem;
        border-top: 1px dashed var(--color-border);
      }

      .receipt-upload {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .receipt-upload-label {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
      }

      .receipt-uploading {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-primary);
      }

      .guest-receipt-preview-shell {
        display: flex;
        justify-content: center;
        max-height: 70vh;
        overflow: auto;
      }

      .guest-receipt-image {
        max-width: 100%;
        max-height: 70vh;
        object-fit: contain;
        border-radius: var(--radius-md);
      }

      .guest-receipt-frame {
        width: 100%;
        min-height: 70vh;
        border: 0;
        border-radius: var(--radius-md);
      }

      .guest-receipt-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 2rem 1rem;
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
        text-align: center;
      }

      .guest-receipt-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      /* ---- ETA banner (paso 8) ---- */
      .eta-banner {
        display: flex;
        align-items: flex-start;
        gap: 0.6rem;
        padding: 0.75rem 1rem;
        border: 1px solid var(--color-primary);
        border-radius: var(--radius-md);
        background: var(--color-primary-light);
        color: var(--color-text-primary);
        font-size: var(--fs-sm);
      }

      .eta-banner app-icon {
        color: var(--color-primary);
        flex-shrink: 0;
        margin-top: 0.1rem;
      }

      .eta-text {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .eta-line {
        font-weight: var(--fw-semibold);
      }

      .eta-note {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
      }

      /* ---- Kitchen badge per dish (paso 8, paleta KDS vía app-badge) ---- */
      .kitchen-line {
        display: flex;
        margin-top: 0.2rem;
      }

      /* Paso 9: pulso breve cuando el SSE cambia el estado del plato. Se
         apaga vía clase (signal prefersReducedMotion) y vía media query. */
      .kitchen-line--flash {
        animation: kitchen-flash 2.4s ease-out 1;
        border-radius: var(--radius-sm);
      }

      @keyframes kitchen-flash {
        0% {
          background: rgba(var(--color-warning-rgb), 0.35);
        }
        100% {
          background: transparent;
        }
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

      /* Paso 10: entrada de la tarjeta solo en compra recién
         confirmada ('justPurchased'). Curva tw-card-in de
         table-welcome-wizard, con keyframes propios porque los estilos de
         aquel componente no cargan en esta ruta. */
      .card-enter {
        animation: guest-card-in 0.35s ease-out;
      }

      @keyframes guest-card-in {
        from {
          opacity: 0;
          transform: translateY(12px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      /* Paso 9: respeta prefers-reduced-motion en spinner y pulsos en
         vivo (el flash de cocina además no se marca vía signal). */
      @media (prefers-reduced-motion: reduce) {
        .spinner,
        .live-dot,
        .card-enter,
        .kitchen-line--flash {
          animation: none !important;
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
  private readonly voucherPrint = inject(GuestOrderPrintService);
  private readonly sanitizer = inject(DomSanitizer);
  /** Público: el template lee `connectionState()` / `prefersReducedMotion()`. */
  readonly sse = inject(GuestOrderSseService);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly summary = signal<GuestOrderSummary | null>(null);
  readonly justPurchased = signal(false);

  // Paso 9 — visor de comprobante (patrón admin order-details).
  readonly receiptPreview = signal<GuestReceiptPreview | null>(null);
  readonly showReceiptModal = signal(false);
  readonly loadingReceiptId = signal<number | null>(null);
  // Paso 9 — subida tardía (un pago a la vez).
  readonly uploadingReceiptId = signal<number | null>(null);
  // Paso 9 — platos con pulso "actualizado" (product_name → visible).
  readonly kitchenFlash = signal<Readonly<Record<string, boolean>>>({});

  /**
   * Contrato de archivo idéntico al checkout (`payment-instructions-modal`):
   * JPEG/PNG/WebP/PDF, 5 MB. El backend re-valida (413/422); esto es UX
   * temprana con los mismos mensajes.
   */
  private readonly RECEIPT_ALLOWED_MIME = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];
  private readonly RECEIPT_MAX_SIZE = 5 * 1024 * 1024;

  private token = '';
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  // Signal de moneda: forzamos change detection en el card (data-currency)
  // para que el pipe impuro `| currency` no se quede pegado en el fallback `$`.
  readonly currencyCode = this.currencyService.currencyCode;

  constructor() {
    // Paso 9 — fusión SSE→summary. El effect solo depende de los signals
    // vivos del servicio; `summary` se lee/escribe vía `untracked` para no
    // crear un loop (escribir summary no re-dispara el effect).
    effect(() => {
      // Deps deliberadas: cualquier evento vivo re-ejecuta la fusión.
      this.sse.orderState();
      this.sse.deliveryType();
      this.sse.kitchenByProduct();
      this.sse.paymentsLive();
      this.sse.eta();
      untracked(() => this.fuseLiveState());
    });
  }

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
    this.token = token;

    // Sin token válido no hay suscripción (el servicio también lo exige).
    const storeId =
      this.tenantFacade.getCurrentDomainConfig()?.store_id ?? null;
    this.sse.connect(token, storeId);
    this.destroyRef.onDestroy(() => {
      this.sse.disconnect();
      this.clearFlashTimer();
    });

    this.checkoutService
      .getGuestOrderSummary(token)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.summary.set(response.data);
          // El snapshot SSE pudo llegar ANTES que el REST: la fusión del
          // effect ya se saltó ese caso (summary null), así que se re-aplica
          // explícitamente sobre el summary recién llegado.
          this.fuseLiveState();
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  print(): void {
    const summary = this.summary();
    if (!summary) return;
    this.voucherPrint.printVoucher(summary);
  }

  whatsappEnabled(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    return !!config?.customConfig?.ecommerce?.checkout?.whatsapp_checkout;
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

    const storeName =
      config?.store_name || data.store?.name || 'la tienda';
    // CP-tienda-checkout-whatsapp (anotación 7): mensaje de CONSULTA con los
    // datos de la orden para que la tienda la identifique sin repreguntar.
    const itemLines = (data.order.items ?? [])
      .map(
        (i) =>
          `  - ${i.product_name}${i.variant_sku ? ' (' + i.variant_sku + ')' : ''} x${i.quantity}`,
      )
      .join('\n');
    const message = encodeURIComponent(
      `¡Hola! 👋 Quisiera consultar el estado de mi pedido en ${storeName}.\n\n` +
        `*Pedido:* #${data.order.order_number}\n` +
        `*Estado:* ${this.getStateLabel(data.order.state)}\n` +
        (itemLines ? `\n*Productos:*\n${itemLines}\n` : '') +
        `\n*Total:* ${this.currencyService.format(Number(data.order.grand_total || 0))}\n\n¡Muchas gracias!`,
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
      pending_delivery: 'Pendiente de entrega',
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
      pending_delivery: 'primary',
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
      pending_delivery: 'truck',
      delivered: 'check-circle',
      finished: 'check-circle',
      cancelled: 'circle-x',
      refunded: 'coins',
    };
    return icons[state] || 'clock';
  }

  // ==========================================================================
  // PAGO — mapa completo de 8 estados + multipago peor-primero (paso 8)
  // ==========================================================================

  getPaymentStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente de confirmación',
      authorized: 'Autorizado',
      succeeded: 'Pagado',
      captured: 'Pagado',
      paid: 'Pagado',
      failed: 'Fallido',
      partially_refunded: 'Reembolso parcial',
      refunded: 'Reembolsado',
      cancelled: 'Cancelado',
      // Alias legacy: el enum anterior usaba `partial`.
      partial: 'Parcial',
    };
    return labels[state] || state;
  }

  getPaymentStateVariant(state: string): BadgeVariant {
    const variants: Record<string, BadgeVariant> = {
      succeeded: 'success',
      captured: 'success',
      paid: 'success',
      pending: 'warning',
      authorized: 'primary',
      partially_refunded: 'info',
      refunded: 'info',
      partial: 'info',
      failed: 'error',
      cancelled: 'neutral',
    };
    return variants[state] || 'neutral';
  }

  /**
   * Severidad peor-primero para multipago. `captured`/`paid`/`partial` no
   * están en la lista del plan: se rankean junto a `succeeded` (pagado) y
   * `partially_refunded` respectivamente para que ningún estado quede sin
   * ranking y el badge agregado nunca elija al azar.
   */
  private paymentSeverity(state: string): number {
    const order = [
      'failed',
      'pending',
      'authorized',
      'partially_refunded',
      'cancelled',
      'refunded',
      'succeeded',
    ];
    const legacyAlias: Record<string, string> = {
      captured: 'succeeded',
      paid: 'succeeded',
      partial: 'partially_refunded',
    };
    const idx = order.indexOf(legacyAlias[state] ?? state);
    return idx === -1 ? order.length : idx;
  }

  /** Pagos ordenados peor-primero (copia; no muta el summary). */
  paymentsWorstFirst(
    payments?: GuestOrderPayment[] | null,
  ): GuestOrderPayment[] {
    return [...(payments ?? [])].sort(
      (a, b) => this.paymentSeverity(a.state) - this.paymentSeverity(b.state),
    );
  }

  /** Estado agregado del pago: el peor de todos (o null sin pagos). */
  worstPaymentState(payments?: GuestOrderPayment[] | null): string | null {
    const sorted = this.paymentsWorstFirst(payments);
    return sorted.length ? sorted[0].state : null;
  }

  /** True si el pago sigue pendiente (dispara la nota del ETA). */
  isPaymentPending(order: GuestOrderData): boolean {
    const worst = this.worstPaymentState(order.payments);
    if (worst) return worst === 'pending';
    // Sin filas de pago (p.ej. canal WhatsApp): el estado de la orden manda.
    return order.state === 'pending_payment';
  }

  // ==========================================================================
  // ETA — persistido o prep_minutes_max, tras hide_prep_eta (paso 8)
  // ==========================================================================

  /**
   * Opt-out `ecommerce.orders.hide_prep_eta` (paso 7): ausente ⇒ visible,
   * se lee con `!== true`. Además exige al menos una fuente de ETA.
   */
  etaVisible(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    if (config?.customConfig?.ecommerce?.orders?.hide_prep_eta === true) {
      return false;
    }
    const order = this.summary()?.order;
    if (!order) return false;
    return order.estimated_ready_at != null || this.etaMinutes(order) != null;
  }

  /**
   * Paso 10 — opt-out `ecommerce.orders.hide_tracking_progress` (paso 7):
   * ausente ⇒ la barra se muestra, se lee con `!== true`.
   */
  trackingShown(): boolean {
    const config = this.tenantFacade.getCurrentDomainConfig();
    if (
      config?.customConfig?.ecommerce?.orders?.hide_tracking_progress === true
    ) {
      return false;
    }
    return this.summary() != null;
  }

  private etaMinutes(order: GuestOrderData): number | null {
    const m = order.prep_minutes_max;
    return typeof m === 'number' && Number.isFinite(m) ? m : null;
  }

  /** "Tiempo estimado: ~X min" + hora persistida si existe. */
  etaLabel(order: GuestOrderData): string {
    const parts: string[] = [];
    const minutes = this.etaMinutes(order);
    if (minutes != null) parts.push(`~${minutes} min`);
    const readyAt = this.formatReadyTime(order.estimated_ready_at);
    if (readyAt) parts.push(`listo aprox. ${readyAt}`);
    return `Tiempo estimado: ${parts.join(' · ') || '—'}`;
  }

  /**
   * `estimated_ready_at` es un instante: se muestra en la hora local del
   * lector (quien consulta su pedido), igual que el voucher impreso.
   */
  private formatReadyTime(iso?: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('es-CO', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  // ==========================================================================
  // COCINA — port del admin order-details (kitchenStateFor/Label/Badge) (paso 8)
  // ==========================================================================

  /**
   * El backend ya resolvió la regla in-flight (`kitchenStatusFor`, paso 3),
   * así que aquí solo se desempaqueta: null/ausente = plato no disparado,
   * sin badge. Sin deep-link al KDS: el guest no ve nada interno.
   */
  kitchenStateFor(item: GuestOrderItem): string | null {
    return item.kitchen_status ?? null;
  }

  /** 5 labels ES, idénticos al admin. */
  kitchenStateLabel(status: string): string {
    switch (status) {
      case 'pending':
        return 'Pendiente';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listo';
      case 'delivered':
        return 'Entregado';
      case 'cancelled':
        return 'Cancelado';
      default:
        return status;
    }
  }

  /**
   * Paleta KDS del admin mapeada a variantes de `app-badge`:
   * pending→neutral, in_preparation→warning, ready→success,
   * delivered→info, cancelled→error.
   */
  kitchenBadgeVariant(status: string): BadgeVariant {
    switch (status) {
      case 'pending':
        return 'neutral';
      case 'in_preparation':
        return 'warning';
      case 'ready':
        return 'success';
      case 'delivered':
        return 'info';
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  }

  // === E2 — helpers de cancelación de línea =================================

  /**
   * True si el item fue cancelado (soft cancel vía D2). El backend persiste
   * `cancelled_at` en order_items; el cliente ve el item en su posición
   * original, tachado, con distintivo 'Cancelado'.
   */
  isItemCancelled(item: GuestOrderItem): boolean {
    return !!item.cancelled_at;
  }

  /**
   * El motivo se muestra al cliente SOLO si aporta. Filtra:
   *  - Vacío / null / solo espacios.
   *  - Marcador interno `legacy:` que dejó la ruta vieja de compatibilidad
   *    (no aporta al cliente, le confunde más).
   *  - Marcadores internos equivalentes que un operador con prisa haya podido
   *    dejar y que NO comunican al cliente por qué se canceló.
   */
  hasVisibleCancellationReason(item: GuestOrderItem): boolean {
    const reason = (item.cancellation_reason ?? '').trim();
    if (!reason) return false;
    if (reason.startsWith('legacy:')) return false;
    return true;
  }

  // ==========================================================================
  // PASO 9 — SSE en vivo: fusión de signals + pill + flash de cocina
  // ==========================================================================

  /** La pill solo existe mientras el stream está activo o reintentando. */
  sseLiveVisible(): boolean {
    const state = this.sse.connectionState();
    return (
      state === 'open' ||
      state === 'connecting' ||
      state === 'reconnecting' ||
      state === 'error'
    );
  }

  sseLiveLabel(): string {
    switch (this.sse.connectionState()) {
      case 'open':
        return 'En vivo';
      case 'connecting':
        return 'Conectando…';
      case 'reconnecting':
      case 'error':
        return 'Reconectando…';
      default:
        return '';
    }
  }

  isKitchenFlashing(productName: string): boolean {
    if (this.sse.prefersReducedMotion()) return false;
    return this.kitchenFlash()[productName] === true;
  }

  /**
   * Funde los signals vivos del SSE en una COPIA del summary (nunca muta en
   * sitio: zoneless reacciona al `set`). Sin summary aún (REST pendiente) no
   * hay nada que fusionar — el `ngOnInit` re-aplica al llegar el REST.
   *
   * Solo toca estado vivo: `order.state`, `delivery_type`, ETA, cocina por
   * plato y pagos. Totales/cliente/tienda/factura son inmutables del REST.
   */
  private fuseLiveState(): void {
    const current = untracked(() => this.summary());
    if (!current) return;

    const liveState = this.sse.orderState();
    const liveDelivery = this.sse.deliveryType();
    const liveKitchen = this.sse.kitchenByProduct();
    const livePayments = this.sse.paymentsLive();
    const liveEta = this.sse.eta();

    const order: GuestOrderData = {
      ...current.order,
      items: current.order.items.map((item) => {
        const live = liveKitchen[item.product_name];
        if (live == null || live === item.kitchen_status) return item;
        return { ...item, kitchen_status: live };
      }),
      payments: (current.order.payments ?? []).map((p) => {
        const live = livePayments.find((l) => l.payment_id === p.payment_id);
        if (!live) return p;
        if (live.state === p.state && live.has_receipt === !!p.has_receipt) {
          return p;
        }
        return { ...p, state: live.state, has_receipt: live.has_receipt };
      }),
    };
    if (liveState) order.state = liveState;
    if (liveDelivery) order.delivery_type = liveDelivery;
    if (liveEta) {
      order.estimated_ready_at = liveEta.estimated_ready_at;
      order.estimated_delivered_at = liveEta.estimated_delivered_at;
      order.prep_minutes_max = liveEta.prep_minutes_max;
    }

    // Pulso "actualizado" en los platos cuyo estado SÍ cambió (no en el
    // primer snapshot: ahí REST y SSE coinciden y no hay nada que anunciar).
    const changed = order.items
      .filter((item, i) => {
        const prev = current.order.items[i];
        return (
          prev &&
          prev.product_name === item.product_name &&
          prev.kitchen_status !== item.kitchen_status
        );
      })
      .map((item) => item.product_name);
    if (changed.length > 0) {
      this.markKitchenFlash(changed);
    }

    this.summary.set({ ...current, order });
  }

  private markKitchenFlash(productNames: string[]): void {
    if (this.sse.prefersReducedMotion()) return;
    const next: Record<string, boolean> = { ...this.kitchenFlash() };
    for (const name of productNames) next[name] = true;
    this.kitchenFlash.set(next);
    this.clearFlashTimer();
    this.flashTimer = setTimeout(() => {
      this.flashTimer = null;
      this.kitchenFlash.set({});
    }, 2500);
  }

  private clearFlashTimer(): void {
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }
  }

  // ==========================================================================
  // PASO 9 — Comprobante: visor (URL firmada) + carga tardía
  // ==========================================================================

  /**
   * Abre el visor con URL firmada fresca (TTL 5 min — se pide en cada
   * apertura, igual que el admin). `kind` por content-type del HEAD.
   */
  async viewReceipt(payment: GuestOrderPayment): Promise<void> {
    const paymentId = payment.payment_id;
    if (paymentId == null || !this.token) return;

    this.loadingReceiptId.set(paymentId);
    try {
      const res = await firstValueFrom(
        this.checkoutService.getGuestPaymentReceiptUrl(this.token, paymentId),
      );
      this.receiptPreview.set({
        url: res.data.url,
        safeUrl: this.sanitizer.bypassSecurityTrustResourceUrl(res.data.url),
        kind: this.receiptPreviewKind(res.data.content_type, res.data.url),
      });
      this.showReceiptModal.set(true);
    } catch {
      this.toast.error(
        'No se pudo abrir el comprobante. Inténtalo de nuevo.',
        'Error',
      );
    } finally {
      this.loadingReceiptId.set(null);
    }
  }

  closeReceiptModal(): void {
    this.showReceiptModal.set(false);
    this.receiptPreview.set(null);
  }

  private receiptPreviewKind(
    contentType: string | null,
    url: string,
  ): 'image' | 'pdf' {
    const ct = (contentType ?? '').toLowerCase();
    if (ct.startsWith('image/')) return 'image';
    if (ct.includes('pdf')) return 'pdf';
    // Fallback por extensión (misma regla del admin).
    const source = url.split('?')[0].toLowerCase();
    if (/\.(jpe?g|png|webp)$/.test(source)) return 'image';
    return 'pdf';
  }

  /**
   * Carga tardía desde el dropzone inline. Valida el mismo contrato del
   * checkout (MIME/5MB, mismos mensajes) antes de subir; al éxito refresca
   * `has_receipt` en el summary sin refetch y el botón "Ver comprobante"
   * reemplaza al dropzone.
   */
  async onReceiptFile(
    payment: GuestOrderPayment,
    file: File,
  ): Promise<void> {
    const paymentId = payment.payment_id;
    if (paymentId == null || !this.token) return;

    if (file.size > this.RECEIPT_MAX_SIZE) {
      this.toast.error('El archivo supera los 5 MB permitidos.', 'Error');
      return;
    }
    if (!this.RECEIPT_ALLOWED_MIME.includes(file.type)) {
      this.toast.error(
        'Formato no admitido. Usa JPG, PNG, WebP o PDF.',
        'Error',
      );
      return;
    }

    this.uploadingReceiptId.set(paymentId);
    try {
      const res = await firstValueFrom(
        this.checkoutService.uploadGuestPaymentReceipt(
          this.token,
          paymentId,
          file,
        ),
      );
      this.refreshPaymentReceipt(
        paymentId,
        res.data.has_receipt,
        res.data.receipt_content_type,
      );
      this.toast.success(
        res.message ??
          'Comprobante recibido. La tienda lo revisará para confirmar tu pago.',
        'Comprobante adjunto',
      );
    } catch (err: unknown) {
      this.toast.error(this.uploadErrorMessage(err), 'Error');
    } finally {
      this.uploadingReceiptId.set(null);
    }
  }

  /**
   * Refresca `has_receipt` del pago en una copia del summary (inmutable).
   * El template reacciona: el dropzone se reemplaza por "Ver comprobante".
   */
  private refreshPaymentReceipt(
    paymentId: number,
    hasReceipt: boolean,
    contentType: string | null,
  ): void {
    const current = this.summary();
    if (!current) return;
    this.summary.set({
      ...current,
      order: {
        ...current.order,
        payments: (current.order.payments ?? []).map((p) =>
          p.payment_id === paymentId
            ? { ...p, has_receipt: hasReceipt, receipt_content_type: contentType }
            : p,
        ),
      },
    });
  }

  /**
   * El backend habla claro (400 "Este medio de pago no recibe comprobante",
   * 413/422 de tamaño/MIME): se propaga su mensaje cuando existe.
   */
  private uploadErrorMessage(err: unknown): string {
    const message = (err as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (err instanceof Error && err.message) return err.message;
    return 'No se pudo subir el comprobante. Inténtalo de nuevo.';
  }
}
