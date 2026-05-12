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
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-guest-order-summary',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CurrencyPipe,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <div class="guest-order-page">
      @if (loading()) {
        <div class="guest-order-card center">
          <div class="spinner"></div>
          <p>Cargando resumen...</p>
        </div>
      } @else if (error()) {
        <div class="guest-order-card center">
          <app-icon name="circle-alert" [size]="42" />
          <h1>No encontramos esta orden</h1>
          <p>Verifica el enlace o contacta a la tienda.</p>
          <app-button routerLink="/cart" variant="primary"
            >Volver al carrito</app-button
          >
        </div>
      } @else if (summary(); as data) {
        <div class="guest-order-card printable-order">
          <div class="order-header">
            <div>
              <p class="eyebrow">Resumen de compra</p>
              <h1>Orden #{{ data.order.order_number }}</h1>
              <p class="muted">{{ data.store?.name || 'Tienda' }}</p>
            </div>
            <span class="state-badge">{{
              getStateLabel(data.order.state)
            }}</span>
          </div>

          <div class="summary-grid">
            <div>
              <span>Fecha</span>
              <strong>{{
                data.order.created_at | date: 'dd/MM/yyyy HH:mm'
              }}</strong>
            </div>
            <div>
              <span>Canal</span>
              <strong>{{
                data.order.channel === 'whatsapp' ? 'WhatsApp' : 'E-commerce'
              }}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{{ data.order.grand_total | currency }}</strong>
            </div>
          </div>

          @if (data.order.shipping_address) {
            <section>
              <h2>Entrega</h2>
              <p>{{ data.order.shipping_address.address_line1 }}</p>
              @if (data.order.shipping_address.address_line2) {
                <p>{{ data.order.shipping_address.address_line2 }}</p>
              }
              <p>
                {{ data.order.shipping_address.city }}
                @if (data.order.shipping_address.state_province) {
                  , {{ data.order.shipping_address.state_province }}
                }
              </p>
            </section>
          }

          <section>
            <h2>Productos</h2>
            <div class="items">
              @for (
                item of data.order.items;
                track item.product_name + item.variant_sku
              ) {
                <div class="item-row">
                  <div>
                    <strong>{{ item.product_name }}</strong>
                    @if (item.variant_sku) {
                      <span>SKU: {{ item.variant_sku }}</span>
                    }
                  </div>
                  <span
                    >{{ item.quantity }} x
                    {{ item.unit_price | currency }}</span
                  >
                  <strong>{{ item.total_price | currency }}</strong>
                </div>
              }
            </div>
          </section>

          <section class="totals">
            <div>
              <span>Subtotal</span
              ><strong>{{ data.order.subtotal_amount | currency }}</strong>
            </div>
            <div>
              <span>Impuestos</span
              ><strong>{{ data.order.tax_amount | currency }}</strong>
            </div>
            <div>
              <span>Envío</span
              ><strong>{{ data.order.shipping_cost | currency }}</strong>
            </div>
            <div class="grand-total">
              <span>Total</span
              ><strong>{{ data.order.grand_total | currency }}</strong>
            </div>
          </section>

          <section class="invoice-box">
            <h2>Factura electrónica</h2>
            @if (data.order.invoice) {
              <p>
                Factura {{ data.order.invoice.invoice_number }}:
                {{ data.order.invoice.status }}
              </p>
            } @else {
              <p>
                Si la tienda tiene facturación configurada, la factura será
                procesada según su flujo actual.
              </p>
            }
            <a [routerLink]="['/factura', data.token]"
              >Agregar o actualizar datos de facturación</a
            >
          </section>

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
        width: min(920px, 100%);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        padding: clamp(1rem, 3vw, 2rem);
        box-shadow: var(--shadow-sm);
      }

      .center {
        text-align: center;
      }

      .order-header,
      .summary-grid,
      .item-row,
      .totals div,
      .actions {
        display: flex;
        gap: 1rem;
      }

      .order-header {
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 1.5rem;
      }

      .eyebrow,
      .muted,
      .summary-grid span,
      .item-row span {
        color: var(--color-text-secondary);
        font-size: var(--fs-sm);
      }

      h1 {
        margin: 0.25rem 0;
        font-size: var(--fs-2xl);
      }

      h2 {
        margin: 1.5rem 0 0.75rem;
        font-size: var(--fs-lg);
      }

      .state-badge {
        padding: 0.35rem 0.75rem;
        border-radius: var(--radius-pill);
        background: var(--color-primary-light);
        color: var(--color-primary);
        font-weight: var(--fw-semibold);
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: var(--color-background);
      }

      .summary-grid div {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .items {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }

      .item-row {
        justify-content: space-between;
        align-items: center;
        padding: 0.875rem 1rem;
        border-bottom: 1px solid var(--color-border);
      }

      .item-row:last-child {
        border-bottom: 0;
      }

      .item-row div {
        display: flex;
        flex-direction: column;
      }

      .totals {
        margin-top: 1rem;
        margin-left: auto;
        max-width: 360px;
      }

      .totals div {
        justify-content: space-between;
        padding: 0.5rem 0;
      }

      .grand-total {
        border-top: 2px solid var(--color-border);
        font-size: var(--fs-lg);
      }

      .invoice-box {
        margin-top: 1.5rem;
        padding: 1rem;
        border-radius: var(--radius-lg);
        background: var(--color-primary-light);
      }

      .actions {
        justify-content: flex-end;
        margin-top: 1.5rem;
      }

      .spinner {
        width: 42px;
        height: 42px;
        border: 4px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (max-width: 720px) {
        .summary-grid {
          grid-template-columns: 1fr;
        }

        .item-row,
        .actions,
        .order-header {
          flex-direction: column;
        }
      }

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
  readonly summary = signal<any>(null);

  ngOnInit(): void {
    this.currencyService.loadCurrency();
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
  }

  print(): void {
    window.print();
  }

  sendToWhatsApp(data: any): void {
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
        (item: any) =>
          `- ${item.product_name} x${item.quantity}: ${fmt(item.total_price)}`,
      )
      .join('\n');
    const message = encodeURIComponent(
      `Hola, quiero compartir la orden ${data.order.order_number}\n\n${items}\n\nTotal: ${fmt(data.order.grand_total)}`,
    );
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      created: 'Creada',
      pending_payment: 'Pendiente de pago',
      processing: 'En proceso',
      finished: 'Finalizada',
      cancelled: 'Cancelada',
    };
    return labels[state] || state;
  }
}
