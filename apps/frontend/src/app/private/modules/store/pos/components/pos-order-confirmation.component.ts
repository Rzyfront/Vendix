import {
  Component,
  input,
  output,
  inject,
  effect,
  computed,
  signal,
  untracked,
  viewChild,
  DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';


import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService } from '../../../../../shared/components';
import { PosPaymentService } from '../services/pos-payment.service';
import { PosTicketService } from '../services/pos-ticket.service';
import { RepartosService } from '../../../store-delivery/services/repartos.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { Store } from '@ngrx/store';
import * as InvoicingActions from '../../invoicing/state/actions/invoicing.actions';
import {
  selectDianConfigStatus,
  selectDianConfigsLoading,
  DianConfigGateStatus,
  DianGateReason,
} from '../../invoicing/state/selectors/invoicing.selectors';
import { InvoicingNotConfiguredComponent } from '../../invoicing/components/invoicing-not-configured/invoicing-not-configured.component';
import { PosFiscalStatusComponent } from './pos-fiscal-status.component';
import { PosFiscalStatus } from '../services/pos-fiscal.service';
import { DispatchTicketPrintService } from '../../dispatch-ticket/services/dispatch-ticket-print.service';
import {
  shouldAutoPrintDispatchTicket,
  type ShouldAutoPrintDispatchTicketContext,
} from '../../../../../shared/services/print/dispatch-ticket-autoprint';
import { DispatchTicketData } from '../../dispatch-ticket/models/dispatch-ticket-data.model';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';

@Component({
  selector: 'app-pos-order-confirmation',
  standalone: true,
  imports: [
    ButtonComponent,
    ModalComponent,
    IconComponent,
    InvoicingNotConfiguredComponent,
    PosFiscalStatusComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [size]="'md'"
      [showCloseButton]="true"
      [title]="derivedModalTitle()"
      [subtitle]="derivedModalSubtitle()"
      (closed)="onModalClosed()"
      >
      <div slot="header"
        class="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center text-success flex-shrink-0">
        <app-icon name="check-circle" [size]="24"></app-icon>
      </div>
    
      <!-- Ticket Visual Representation -->
      <div class="max-w-md mx-auto print:max-w-none">
        <div
          class="bg-surface border border-dashed border-border rounded-xl p-6 shadow-sm relative overflow-hidden receipt-container"
          >
          <!-- Decorative edges -->
          <div class="absolute top-0 left-0 right-0 h-1 bg-primary/20"></div>
    
          <div class="text-center border-b border-border pb-6 mb-6">
            <h3 class="text-xl font-bold text-text-primary tracking-tight">
              Vendix POS
            </h3>
            <p class="text-sm text-text-secondary font-medium">
              Sistema de Punto de Venta
            </p>
          </div>
    
          <div class="space-y-3 mb-6 text-sm">
            <div class="flex justify-between">
              <span class="text-text-secondary">Fecha:</span>
              <span class="font-medium text-text-primary">{{ derivedCurrentDate() }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-secondary">Cajero:</span>
              <span class="font-medium text-text-primary">{{ cashierName }}</span>
            </div>
            @if (derivedCustomerName()) {
              <div class="flex justify-between">
                <span class="text-text-secondary">Cliente:</span>
                <span class="font-medium text-text-primary">{{ derivedCustomerName() }}</span>
              </div>
            }
          </div>
    
          <!-- Items Table -->
          <div class="space-y-4 mb-6">
            <div
              class="flex justify-between text-xs font-bold text-text-secondary uppercase tracking-wider pb-2 border-b border-border"
              >
              <span>Producto</span>
              <span>Total</span>
            </div>
            <div class="space-y-3">
              @for (item of derivedOrderItems(); track item) {
                <div class="flex justify-between text-sm">
                  <div class="flex flex-col">
                    <span class="font-medium text-text-primary">{{ item.name }}</span>
	                    <span class="text-xs text-text-secondary">
	                      @if (item.is_weight_product) {
	                        {{ item.weight }} {{ item.weight_unit }} x {{ formatCurrency(item.unitPrice) }}/{{ item.weight_unit }}
	                      } @else if (item.saleUnitCode && item.saleQuantity != null) {
	                        <!-- QUI-648: la misma escala que capturó el cajero. -->
	                        {{ item.saleQuantity }} {{ item.saleUnitCode }} x {{ formatCurrency(item.unitPrice) }}/{{ item.saleUnitCode }}
	                      } @else {
	                        {{ item.quantity }}x {{ formatCurrency(item.unitPrice) }}
	                      }
	                    </span>
	                    @if (item.appliedPriceTierName) {
	                      <span class="mt-1 inline-flex w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
	                        Tarifa: {{ item.appliedPriceTierName }}
	                      </span>
	                    }
	                    @if (item.isPackageUnit && item.unitsPerPackage > 1) {
	                      <span class="mt-1 inline-flex w-fit rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
	                        {{ item.quantity }} {{ item.quantity === 1 ? 'paquete' : 'paquetes' }}
	                        = {{ item.quantity * item.unitsPerPackage }} unid (Caja ×{{ item.unitsPerPackage }})
	                      </span>
	                    }
	                  </div>
                  <span class="font-bold text-text-primary">{{ formatCurrency(item.totalPrice) }}</span>
                </div>
              }
            </div>
          </div>
    
          <!-- Summary -->
          <div class="pt-4 border-t border-border space-y-2.5">
            @if (showSubtotal) {
              <div class="flex justify-between text-sm text-text-secondary">
                <span>Subtotal:</span>
                <span>{{ formatCurrency(orderSubtotal) }}</span>
              </div>
            }
            @for (promo of derivedAppliedPromotions(); track promo.promotion_id || promo.id || promo.name) {
              <div class="flex justify-between text-xs text-success">
                <span class="truncate">
                  <app-icon name="tag" [size]="12" class="inline mr-1"></app-icon>
                  {{ promo.name }}
                  @if (promo.code) {
                    <span class="opacity-70">({{ promo.code }})</span>
                  }
                </span>
                <span class="font-medium whitespace-nowrap">-{{ formatCurrency(promo.discount_amount) }}</span>
              </div>
            }
            @for (cp of derivedAppliedCoupons(); track cp.coupon_id || cp.id || cp.code) {
              <div class="flex justify-between text-xs text-success">
                <span class="truncate">
                  <app-icon name="ticket" [size]="12" class="inline mr-1"></app-icon>
                  Cupón <strong>{{ cp.code }}</strong>
                </span>
                <span class="font-medium whitespace-nowrap">-{{ formatCurrency(cp.discount_applied) }}</span>
              </div>
            }
            @if (hasDiscount()) {
              <div class="flex justify-between text-sm text-destructive font-medium">
                <span>Descuento total:</span>
                <span>-{{ formatCurrency(orderDiscount) }}</span>
              </div>
            }
            @if (printsVatBreakdown()) {
              <div class="flex justify-between text-sm text-text-secondary">
                <span>Impuesto:</span>
                <span>{{ formatCurrency(orderTax) }}</span>
              </div>
            }
            <div
              class="flex justify-between items-center pt-3 mt-2 border-t-2 border-double border-border"
              >
              <span class="text-lg font-bold text-text-primary">Total:</span>
              <span class="text-2xl font-extrabold text-primary">{{ formatCurrency(orderTotal) }}</span>
            </div>
          </div>
    
          <!-- Payment Info -->
          @if (paymentInfo) {
            <div class="mt-6 pt-4 border-t border-border bg-muted/20 -mx-6 px-6 -mb-6 pb-6 rounded-b-xl">
              <div class="flex justify-between items-center text-sm">
                <div class="flex items-center gap-2">
                  <app-icon name="credit-card" [size]="16" class="text-text-secondary"></app-icon>
                  <span class="font-medium text-text-secondary">{{ paymentInfo.method }}:</span>
                </div>
                <span class="font-bold text-text-primary">{{ formatCurrency(paymentInfo.amount) }}</span>
              </div>
            </div>
          }
        </div>
      </div>

      <!-- Estado fiscal de la venta. Va FUERA del recibo (print:hidden) porque
           es información de operación, no parte del documento que se entrega, y
           porque el ticket ya declara por su cuenta si es copia informativa.
           Nunca abre nada: informa mientras el cajero sigue trabajando. -->
      <div class="max-w-md mx-auto mt-4 print:hidden">
        <!-- SIN ACENTOS GRAVES ACÁ: este comentario vive DENTRO del literal
             del template, y un acento grave lo CIERRA. La paridad del resto
             del archivo se descuadra y el compilador reporta una cascada
             (NG1002 sobre el decorador, TS1005, "Cannot find name 'styles'",
             aridad falsa en otros archivos) en sitios que no tienen nada mal.

             El isOpen() del binding de abajo no es decoración: el contenido
             proyectado en un modal se instancia aunque el modal esté cerrado,
             así que sin él el indicador seguiría sondeando en segundo plano
             después de que el cajero pasó a la siguiente venta. -->
        <app-pos-fiscal-status
          [orderId]="isOpen() && orderId ? +orderId : null"
          (statusChanged)="onFiscalStatus($event)"
        ></app-pos-fiscal-status>
      </div>

      <div slot="footer" class="flex flex-col gap-3 w-full">
        <!-- CTA Primario: full-width, prominente -->
        <app-button
          variant="primary"
          size="lg"
          [fullWidth]="true"
          (clicked)="startNewSale()"
          >
          <app-icon name="plus" [size]="20" slot="icon" ></app-icon>
          Nueva compra
        </app-button>
    
        <!-- Acciones secundarias: ghost, compactos, en fila -->
        <div class="flex items-center justify-center gap-1 sm:gap-2">
          @if (derivedIsPaid()) {
            <app-button variant="ghost" size="sm" (clicked)="printReceipt()" [loading]="printing" title="Imprimir Ticket">
              <app-icon name="printer" [size]="16" slot="icon" ></app-icon>
              <span class="hidden sm:inline">Imprimir</span>
            </app-button>
          }
    
          <app-button variant="ghost" size="sm" (clicked)="emailReceipt()" [disabled]="!derivedCustomerEmail()" [loading]="emailing" title="Enviar por Email">
            <app-icon name="mail" [size]="16" slot="icon" ></app-icon>
            <span class="hidden sm:inline">Email</span>
          </app-button>
    
          <!-- Emite el documento de verdad (no sólo crea el borrador). Se apaga
               cuando la DIAN ya lo aceptó: reemitir un documento aceptado no es
               un reintento, es un hecho económico distinto. -->
          <app-button variant="ghost" size="sm" (clicked)="createInvoice()" [disabled]="!orderId || dianConfigsLoading() || alreadyIssued()" [loading]="creatingInvoice()" [title]="invoiceButtonTitle()">
            <app-icon name="file-text" [size]="16" slot="icon" ></app-icon>
            <span class="hidden sm:inline">Factura</span>
          </app-button>
    
          <!-- Separador visual entre categorías -->
          <div class="w-px h-5 bg-[var(--color-border)] mx-1"></div>
    
          @if (orderData()?.isShippingSale && orderId) {
            <app-button variant="ghost" size="sm" (clicked)="dispatchOrder()" [loading]="dispatching()" title="Enviar la orden a despacho">
              <app-icon name="send" [size]="16" slot="icon" ></app-icon>
              <span class="hidden sm:inline">Despachar</span>
            </app-button>
          }

          <app-button variant="ghost" size="sm" (clicked)="goToOrderDetail()" [disabled]="!orderId" title="Ver detalle de la orden">
            <app-icon name="external-link" [size]="16" slot="icon" ></app-icon>
            <span class="hidden sm:inline">Ver detalle</span>
          </app-button>
        </div>
      </div>
    </app-modal>

    @defer (when isNotConfiguredModalOpen()) {
      <app-invoicing-not-configured
        [(isOpen)]="isNotConfiguredModalOpen"
        [reason]="notConfiguredReason()"
      ></app-invoicing-not-configured>
    }

    <!-- Aquí NO hay modal de requisitos fiscales, y es deliberado.
         Ver la nota "SIN MODAL DE REQUISITOS FISCALES" en la clase. -->
    `,
  styles: [
    `
      :host {
        display: block;
      }

      .receipt-container {
        /* Pseudo-paper texture */
        background-image: radial-gradient(var(--color-border) 0.5px, transparent 0.5px);
        background-size: 20px 20px;
        background-color: var(--color-surface);
      }
    `,
  ] })
/**
 * SIN MODAL DE REQUISITOS FISCALES — Y ES DELIBERADO.
 *
 * Aquí vivía un `<app-save-requirements-modal>` enlazado con `[(isOpen)]` al
 * SINGLETON de raíz `FiscalRequirementsService`. Ningún camino del POS lo abría
 * a propósito: lo abría `invoicing.effects.ts` (`report()` →
 * `fiscalReq.presentFiscalError(error)`) ante CUALQUIER 4xx fiscal de CUALQUIER
 * efecto de facturación, viniera o no de esta pantalla.
 *
 * Y esta pantalla se monta con el POS —no está diferida; sólo su `app-modal`
 * interno se abre con `isOpen()`—, así que ese modal quedaba armado durante
 * toda la sesión de caja. Un fallo fiscal de fondo le tapaba la pantalla al
 * cajero con la venta YA COBRADA: exactamente lo que el carril del POS no puede
 * hacer.
 *
 * En el POS el estado fiscal lo cuenta el indicador NO MODAL
 * `app-pos-fiscal-status`, que ya imprime el problema y su corrección sin
 * interrumpir la caja. El modal de requisitos sigue montado donde corresponde
 * —`fiscal-operations.component.ts` y las pantallas de facturación—, que es el
 * carril donde bloquear ANTES de gastar numeración es el comportamiento
 * correcto.
 */
export class PosOrderConfirmationComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly orderData = input<any>(null);
  readonly closed = output<void>();
  readonly newSale = output<void>();
  readonly viewDetail = output<string>();

  printing = false;
  emailing = false;
  /**
   * Loading del botón «Factura». Es señal —y no un campo plano como sus dos
   * vecinos— porque ahora lo apaga la respuesta del indicador fiscal, que llega
   * por un `output()` y no por el `await` que lo encendía.
   */
  readonly creatingInvoice = signal(false);
  /** Loading del botón "Despachar" (envío al pool de reparto). */
  readonly dispatching = signal(false);

  // CP-POS-MODAL-SCOPE-001 / Phase F.8 v3 — derived `computed()` signals from
  // `orderData()` instead of an `effect()` side-effect that writes to plain
  // signal fields. Two failed prior fixes:
  //   - setTimeout(0): still tripped NG0100 because the effect ran during
  //     CD and the deferred write reached the next cycle's stale check.
  //   - signal<any>('') with set() in the effect: same problem — the signal
  //     value at first render was '' and then became the populated value,
  //     and Angular's expression-change guard fired before the new value
  //     could be picked up.
  // `computed()` re-evaluates inside the SAME CD cycle as the template read,
  // so Angular always sees the latest `orderData()` value when it
  // re-checks the binding. No stale value, no NG0100. The plain field
  // mirrors stay as a single-shot convenience for legacy callers.
  readonly derivedOrderNumber = computed(() => {
    const d = this.orderData();
    return d?.order_number || d?.number || 'N/A';
  });
  // CP-POS-MODAL-SCOPE-001 / Phase F.12 — distinguish draft vs sale in
  // the confirmation modal copy so the cashier doesn't read a draft save
  // as a fiscal sale. Draft = state in ['draft', 'created'] with no
  // payment row; anything else with a payment row is a sale.
  readonly derivedIsShippingSale = computed(
    () => !!this.orderData()?.isShippingSale,
  );
  readonly derivedIsPaid = computed(() => {
    const d = this.orderData();
    if (!d) return false;
    // Explicit draft flag from POS draft-saved flow (onCreateOrderConfirmed)
    if (d.isCreateOrder === true) return false;

    const state = (d.state || d.status || '').toString().toLowerCase();
    const isTerminalPaidState =
      state === 'finished' || state === 'processing' || state === 'completed';
    const hasPaymentStatus =
      d.payment_status === 'succeeded' || d.payment_status === 'paid';
    const hasPaymentObject =
      !!d.payment && typeof d.payment === 'object';
    const hasPaymentsArray =
      Array.isArray(d.payments) && d.payments.length > 0;
    const isCredit = !!d.isCreditSale;
    const isShipping =
      !!d.isShippingSale || this.derivedIsShippingSale();

    return (
      isTerminalPaidState ||
      hasPaymentStatus ||
      hasPaymentObject ||
      hasPaymentsArray ||
      isCredit ||
      isShipping
    );
  });
  readonly derivedModalTitle = computed(() => {
    if (this.derivedIsShippingSale()) return '¡Pedido con Envío!';
    return this.derivedIsPaid()
      ? '¡Venta Completada!'
      : '¡Orden Guardada!';
  });
  readonly derivedModalSubtitle = computed(() => {
    if (this.derivedIsShippingSale()) {
      return `Pedido #${this.derivedOrderNumber()} registrado con envío a domicilio. Listo para despacho.`;
    }
    return (
      (this.derivedIsPaid() ? 'Orden #' : 'Borrador #') +
      this.derivedOrderNumber() +
      (this.derivedIsPaid()
        ? ' procesada exitosamente'
        : ' guardado. Puedes volver a modificarla antes de cobrar.')
    );
  });
  readonly derivedCurrentDate = computed(() => {
    const d = this.orderData();
    if (!d) return new Date().toLocaleString('es-AR');
    return d.created_at
      ? new Date(d.created_at).toLocaleString('es-AR')
      : new Date().toLocaleString('es-AR');
  });
  readonly derivedCustomerName = computed(() => {
    const d = this.orderData();
    if (!d) return 'Consumidor Final';
    if (d.customer_name) return d.customer_name;
    if (d.customer?.first_name) {
      return `${d.customer.first_name} ${d.customer.last_name || ''}`.trim();
    }
    if (d.customer?.name) return d.customer.name;
    if (d.customer?.business_name) return d.customer.business_name;
    // ADR-9: `customer_alias` es etiqueta de venta rápida (cliente no formal,
    // sin documento fiscal). Coexiste con `customer_id = null` por CHECK en
    // DB, así que las ramas de arriba no se dispararon. Va ANTES del
    // fallback «Consumidor Final» para que el tiquete de despacho diga
    // el nombre con el que el cliente reclama en el mostrador.
    if (d.customer_alias) return d.customer_alias;
    return 'Consumidor Final';
  });
  readonly derivedCustomerEmail = computed(() => this.orderData()?.customer_email || this.orderData()?.customer?.email || '');
  readonly derivedCustomerTaxId = computed(() => {
    const d = this.orderData();
    return d?.customer_tax_id || d?.customer?.tax_id || d?.customer?.document_number || '';
  });
  readonly derivedOrderItems = computed(() => {
    const d = this.orderData();
    const items = d?.items || d?.order_items || [];
    return items.map((item: any) => {
      const unitPrice = Number(item.unit_price || item.unitPrice || 0);
      const quantity = Number(item.quantity || 0);
      const totalPrice = Number(item.total_price || item.totalPrice || 0);
      const tax = Number(item.tax_amount || item.tax || 0) || (totalPrice - (unitPrice * quantity));
      const weight = Number(item.weight || 0);
      const weight_unit = item.weight_unit || 'kg';
      const is_weight_product = weight > 0;
      const stockUnitsConsumed = Number(item.stock_units_consumed || 0);
      const unitsPerPackage =
        item.units_per_package != null
          ? Number(item.units_per_package)
          : stockUnitsConsumed > 0 && quantity > 0 && stockUnitsConsumed !== quantity
            ? stockUnitsConsumed / quantity
            : null;
      const saleUnitCode = item.sale_unit_code || item.saleUnitCode || null;
      const rawSaleQuantity = item.sale_quantity ?? item.saleQuantity ?? null;
      const saleQuantity =
        rawSaleQuantity != null && Number.isFinite(Number(rawSaleQuantity))
          ? Number(rawSaleQuantity)
          : null;
      return {
        id: item.id || item.product_id,
        product_id: item.product_id,
        name: item.product_name || item.name,
        sku: item.product_sku || item.sku || '',
        quantity,
        unitPrice,
        totalPrice,
        tax,
        weight,
        weight_unit,
        is_weight_product,
        appliedPriceTierName: item.applied_price_tier_name || item.appliedPriceTierName,
        isPackageUnit: !!item.is_package_unit || !!unitsPerPackage,
        unitsPerPackage,
        isTakeaway: !!item.is_takeaway,
        serials: (() => {
          const raw = item.serial_numbers_snapshot ?? item.serials ?? item.serial_numbers ?? null;
          if (Array.isArray(raw)) return raw.map((s: any) => String(s).trim()).filter((s: string) => s.length > 0);
          if (typeof raw === 'string' && raw.trim().length > 0) return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
          return undefined;
        })() };
    });
  });
  readonly derivedOrderTotal = computed(() => {
    const d = this.orderData();
    return Number(d?.grand_total ?? d?.total_amount ?? d?.total ?? 0);
  });
  readonly derivedOrderSubtotal = computed(() => {
    const d = this.orderData();
    return Number(d?.subtotal ?? d?.subtotal_amount ?? 0);
  });
  readonly derivedOrderTax = computed(() => {
    const d = this.orderData();
    return Number(d?.tax_amount ?? d?.tax ?? 0);
  });
  readonly derivedOrderDiscount = computed(() => {
    const d = this.orderData();
    return Number(d?.discount_amount ?? d?.discount ?? 0);
  });
  readonly derivedInvoiceDataToken = computed(() => this.orderData()?.invoiceDataToken ?? this.orderData()?.invoice_data_token);
  readonly derivedInvoiceDataQrUrl = computed(() => {
    const d = this.orderData();
    const token = d?.invoiceDataToken ?? d?.invoice_data_token;
    // CP-POS-MODAL-SCOPE-001 / Phase F.8 v3 — storeDomainHostname was
    // a property that the legacy `loadOrderData` assigned; we removed
    // that path. Fall back to `window.location.hostname` so the QR URL
    // still works even if the store-specific hostname signal isn't wired
    // through this input anymore.
    const hostname =
      (this as any).storeDomainHostname ?? window.location.hostname;
    return token && hostname
      ? `${window.location.protocol}//${hostname}/factura/${token}`
      : undefined;
  });
  readonly derivedElectronicInvoice = computed(() => this.electronicInvoice() ?? undefined);
  readonly derivedAppliedPromotions = computed(() => {
    const d = this.orderData();
    return d?.applied_promotions || d?.appliedPromotions || this.appliedPromotions || [];
  });
  readonly derivedAppliedCoupons = computed(() => {
    const d = this.orderData();
    return d?.applied_coupons || d?.appliedCoupons || this.appliedCoupons || [];
  });

  orderId: string | null = null;
  cashierName = '';
  orderSubtotal = 0;
  orderDiscount = 0;
  orderTax = 0;
  orderTotal = 0;
  // Persisted discount snapshots — populated only when the POS payment
  // response includes them; never recalculated client-side.
  appliedPromotions: Array<{
    id?: number;
    promotion_id?: number;
    name: string;
    code?: string | null;
    discount_amount: number;
  }> = [];
  appliedCoupons: Array<{
    id?: number;
    coupon_id?: number;
    code: string;
    name?: string | null;
    discount_applied: number;
  }> = [];
  paymentInfo: any = null;
private authFacade = inject(AuthFacade);
  private toastService = inject(ToastService);
  private ticketService = inject(PosTicketService);
  private repartosService = inject(RepartosService);
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);
  // CP-DTLP Phase E.1/E.2 — disparador POS del tiquete de despacho.
  private readonly dispatchTicketPrint = inject(DispatchTicketPrintService);
  // CP-DTLP Phase E.1/E.2 — guard del disparador.
  private readonly settingsFacade = inject(StoreSettingsFacade);

  /**
   * Mismo predicado que el papel (`PosTicketService.shouldShowTaxes`): la
   * pantalla que el cajero muestra al cliente al cobrar no puede afirmar un IVA
   * que el tiquete no imprime. Requiere el área fiscal `invoicing` activa y que
   * el comercio no sea no responsable de IVA.
   */
  readonly printsVatBreakdown = this.authFacade.printsVatBreakdown;

  // ── CP-DTLP Phase E.1/E.2 — disparador POS del tiquete de despacho ─────
  //
  // Defaults copiados del `GeneralSettingsStore` (route-scoped, no inyectable
  // desde acá). Default true/false para que tiendas nuevas puedan imprimirlo
  // manual sin tocar settings, y auto-with-POS opt-in por admin.

  /** Habilita el tiquete de despacho globalmente. Default true (ADR-7). */
  readonly printDispatchTicketEnabled = computed<boolean>(
    () => this.settingsFacade.receipts()?.print_dispatch_ticket_enabled ?? true,
  );

  /** Auto-imprime el tiquete junto con POS/factura cuando hay envío. Default false. */
  readonly printDispatchTicketAutoWithPos = computed<boolean>(
    () => this.settingsFacade.receipts()?.print_dispatch_ticket_auto_with_pos ?? false,
  );

  /**
   * Decisión del usuario 2026-08-31: opt-in por admin para que el tiquete
   * de despacho funcione como tiquete de reclamo en ventas de mostrador
   * (`direct_delivery`) y para llevar (`pickup`). Enmienda al ADR-6;
   * default false. Pasado al predicado compartido en
   * `shouldAutoPrintDispatchTicket`.
   */
  readonly printDispatchTicketOnCounter = computed<boolean>(
    () => this.settingsFacade.receipts()?.print_dispatch_ticket_on_counter ?? false,
  );

  /**
   * Espejo de `showSubtotal` en `PosTicketService`: sin desglose de IVA un
   * subtotal que no suma al total deja la diferencia huérfana en pantalla.
   * Getter y no `computed` porque `orderTax` es una propiedad plana, no un
   * signal — un `computed` sobre ella no sería reactivo.
   */
  get showSubtotal(): boolean {
    return this.printsVatBreakdown() || !(this.orderTax > 0);
  }

  // DIAN config gate (pre-invoice)
  readonly dianStatus = toSignal(this.store.select(selectDianConfigStatus), {
    initialValue: {
      configured: false,
      reason: null,
      default: null,
    } as DianConfigGateStatus,
  });
  readonly dianConfigsLoading = toSignal(
    this.store.select(selectDianConfigsLoading),
    { initialValue: false },
  );
  readonly isNotConfiguredModalOpen = signal(false);
  readonly notConfiguredReason = signal<DianGateReason>('missing');

  /**
   * El indicador fiscal es el dueño del estado del documento: consulta, repite
   * la consulta mientras sigue en camino y pinta el desenlace. El botón
   * «Factura» del pie sólo le delega la emisión, para que no existan dos
   * fuentes de verdad sobre la misma venta.
   */
  private readonly fiscalIndicator = viewChild(PosFiscalStatusComponent);

  /** Último estado fiscal leído, para el pie y para el ticket. */
  readonly fiscalStatus = signal<PosFiscalStatus | null>(null);

  /** Sólo se avisa por toast la emisión que el cajero pidió a mano. */
  private awaitingManualEmit = false;

  /**
   * La compuerta DIAN se carga PEREZOSAMENTE y una sola vez por montaje.
   *
   * Antes se despachaba `loadDianConfigs()` en el constructor. Este componente
   * se monta con el POS —no está diferido; sólo su modal interno se abre con
   * `isOpen()`—, así que la petición salía en CADA entrada a la caja, incluso
   * en tiendas sin facturación electrónica y con el cajón todavía cerrado. Un
   * cajero sin `invoicing:read` recibía un 403 al abrir el POS: ruido en una
   * pantalla donde el error fiscal no le pertenece.
   *
   * Ahora sale cuando la información se necesita —al cerrarse una venta— y sólo
   * si el usuario puede leerla. Si no puede, `dianStatus()` queda en su valor
   * inicial `configured: false`, que es exactamente el desenlace correcto: el
   * botón «Factura» abre el modal de configuración en lugar de intentar emitir.
   */
  private dianConfigsRequested = false;

  private ensureDianConfigsLoaded(): void {
    if (this.dianConfigsRequested) return;
    if (!this.authFacade.hasPermission('invoicing:read')) return;
    this.dianConfigsRequested = true;
    this.store.dispatch(InvoicingActions.loadDianConfigs());
  }

  constructor() {
    const user = this.authFacade.getCurrentUser();
    this.cashierName = user ? `${user.first_name} ${user.last_name}` : 'Cajero';
    this.currencyService.loadCurrency();
    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.ensureDianConfigsLoaded());
      }
    });
    effect(() => {
      const isOpen = this.isOpen();
      const data = this.orderData();
      if (isOpen && data) {
        // CP-POS-MODAL-SCOPE-001 / Phase F.8 — defer the order-data load out
        // of the current change-detection cycle. `loadOrderData()` writes
        // `orderNumber`, `currentDate`, `customerName`, `electronicInvoice`,
        // `fiscalStatus`, `creatingInvoice`, etc. while Angular is still
        // checking THIS template, and we get NG0100
        // ExpressionChangedAfterItHasBeenCheckedError on every order
        // confirmation. `setTimeout(0)` schedules the load on the next
        // macrotask — AFTER Angular's CD has fully settled and a fresh CD
        // cycle will pick up all the new field/signal values cleanly. Using
        // `queueMicrotask` was not enough: the next CD cycle still saw the
        // half-updated state and tripped the guard. Zoneless-safe: signal
        // writes inside the timeout are still tracked by the change graph.
        untracked(() => {
          this.resetStaleInvoiceState(data);
          this.maybeAutoPrint();
        });
      }
    });
  }

  /**
   * Honours `pos.auto_print_receipt`, which until now was stored and editable
   * but never read at runtime, so the toggle did nothing.
   *
   * Guarded per order id: the effect re-runs on any signal it reads, and a
   * second run would send the same ticket to the printer again.
   */
  private autoPrintedOrderId: string | null = null;

  /**
   * La FE ya auto-impresa para la orden (tras `issued`). Guard por orden:
   * el sondeo fiscal re-emite estados y cada `issued` no debe reimprimir.
   */
  private autoPrintedFeOrderId: string | null = null;

  /** Electronic invoice issued for this sale, once one exists. */
  readonly electronicInvoice = signal<{
    number: string;
    cufe?: string;
  } | null>(null);

  /**
   * Resets invoice/fiscal status signals when the order id changes between
   * renders of the modal. Pulled out of the previous side-effect-only
   * effect so the actual template reads happen via `computed()`. This is
   * called from inside `untracked()` so its signal writes do NOT
   * participate in the CD graph and can't trip NG0100.
   */
  private resetStaleInvoiceState(data: any): void {
    const previousOrderId = this.orderId;
    this.orderId = data?.id?.toString?.() || null;
    if (this.orderId !== previousOrderId) {
      this.electronicInvoice.set(null);
      this.fiscalStatus.set(null);
      this.awaitingManualEmit = false;
      this.creatingInvoice.set(false);
      this.autoPrintedFeOrderId = null;
    }
    // Mirrors still useful for the print path (see `printReceipt`).
    this.orderTotal = Number(data?.grand_total ?? data?.total_amount ?? data?.total ?? 0);
    this.orderSubtotal = Number(data?.subtotal ?? data?.subtotal_amount ?? 0);
    this.orderDiscount = Number(data?.discount_amount ?? data?.discount ?? 0);
    this.orderTax = Number(data?.tax_amount ?? data?.tax ?? 0);
    this.appliedPromotions = data?.applied_promotions || data?.appliedPromotions || [];
    this.appliedCoupons = data?.applied_coupons || data?.appliedCoupons || [];
    if (data.payment) {
      this.paymentInfo = {
        method: data.payment.payment_method || data.payment.method || 'Pago',
        amount: Number(data.payment.amount || this.orderTotal) };
    } else if (data.isCreditSale) {
      this.paymentInfo = {
        method: 'Venta a Crédito',
        amount: this.orderTotal };
    } else if (data.isAnonymousSale) {
      this.paymentInfo = {
        method: 'Pago Anónimo',
        amount: this.orderTotal };
    } else {
      this.paymentInfo = null;
    }
  }

  private maybeAutoPrint(): void {
    if (!this.isOpen()) return;
    // CP-POS-MODAL-SCOPE-001 / Phase F.15 — only PAID orders emit a
    // POS receipt. Drafts (`Guardar`) MUST NOT trigger the printer:
    // the cashier can save a draft and continue editing without
    // printing anything. The previous behaviour fired for any order
    // opened in the confirmation modal, including fresh drafts, which
    // produced an unwanted receipt every time the cashier clicked
    // `Guardar`.
    if (!this.derivedIsPaid()) return;
    if (!this.ticketService.shouldAutoPrint()) return;
    if (!this.orderId || this.autoPrintedOrderId === this.orderId) return;

    this.autoPrintedOrderId = this.orderId;
    this.printReceipt();
    // CP-DTLP Phase E.1 — encadenar tiquete de despacho con trigger
    // `'automatic'` junto al POS auto. La guard (incluye
    // `print_dispatch_ticket_auto_with_pos` + envío + `direct_delivery`)
    // vive en `printDispatchTicketIfNeeded`. `printReceipt` ya encadena
    // su propio `'explicit'`, pero lo salta cuando `autoPrintedOrderId`
    // coincide con `orderId` para no imprimir el despacho dos veces.
    void this.printDispatchTicketIfNeeded('automatic');
  }


  onModalClosed(): void {
    this.closed.emit();
  }

  printReceipt(): void {
    if (!this.orderData()) return;

    this.printing = true;

    // Create TicketData from orderData
    const docId = Number(this.orderId || this.orderData()?.id);
    const ticketData: any = {
      orderId: !isNaN(docId) && docId > 0 ? docId : undefined,
      id: String(this.orderId || this.orderData()?.id || this.derivedOrderNumber() || 'N/A'),
      date: new Date(this.orderData().created_at || new Date()),
      items: this.derivedOrderItems().map((item: any) => ({
        id: item.id || item.name,
        name: item.name,
        sku: item.sku || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        discount: 0,
	        tax: item.tax,
	        weight: item.weight || undefined,
	        weight_unit: item.weight_unit || undefined,
	        appliedPriceTierName: item.appliedPriceTierName,
	        isPackageUnit: item.isPackageUnit,
	        unitsPerPackage: item.unitsPerPackage,
	        // QUI-648 — el tiquete imprime "3 m", no "3000".
	        saleUnitCode: item.saleUnitCode,
	        saleQuantity: item.saleQuantity,
	        // QUI-653 — se propaga en este camino también: si solo lo llevara el
	        // mapeo desde la orden persistida, el tiquete que se imprime justo tras
	        // cobrar saldría sin la marca y el de una reimpresión sí, con la misma
	        // venta imprimiéndose distinto según el momento.
	        isTakeaway: item.isTakeaway,
	        serials: item.serials })),
      subtotal: this.derivedOrderSubtotal() || this.orderSubtotal,
      tax: this.derivedOrderTax() || this.orderTax,
      discount: this.derivedOrderDiscount() || this.orderDiscount,
      total: this.derivedOrderTotal() || this.orderTotal,
      paymentMethod: this.paymentInfo?.method || 'Pago',
      cashReceived: this.paymentInfo?.amount || (this.derivedOrderTotal() || this.orderTotal),
      change: Number(this.orderData()?.change || 0),
      customer: this.derivedCustomerName() ? {
        name: this.derivedCustomerName(),
        email: this.derivedCustomerEmail(),
        phone: '',
        taxId: this.derivedCustomerTaxId() } : undefined,
      store: {
        name: 'Vendix Store',
        address: '123 Main St, City, State 12345',
        phone: '+1 (555) 123-4567',
        email: 'info@vendix.com',
        taxId: 'TAX-123456789',
        id: 1,
        logo: '' },
      organization: {
        name: 'Vendix',
        taxId: 'ORG-123' },
      cashier: this.cashierName,
      transactionId: this.derivedOrderNumber(),
      invoiceDataToken: this.derivedInvoiceDataToken(),
      invoiceDataQrUrl: this.derivedInvoiceDataQrUrl(),
      electronicInvoice: this.electronicInvoice() ?? undefined };

    this.ticketService.printTicket(ticketData, { printReceipt: true }).subscribe({
      next: (success: boolean) => {
        this.printing = false;
        if (success) {
          this.toastService.success('Ticket enviado a impresión');
        } else {
          this.toastService.error('Error al imprimir ticket');
        }
        // CP-DTLP Phase E.2 — encadenar tiquete de despacho manual con
        // `'explicit'`. Se salta cuando `maybeAutoPrint` nos invocó
        // (autoPrintedOrderId ya seteado): en ese caso E.1 encadena el
        // `'automatic'` por su lado y no queremos imprimir dos veces.
        if (this.autoPrintedOrderId !== this.orderId) {
          void this.printDispatchTicketIfNeeded('explicit');
        }
      },
      error: (error: any) => {
        this.printing = false;
        console.error('Error al imprimir ticket:', error);
        this.toastService.error('Error al imprimir ticket');
        // Misma lógica en el path de error — no perdemos el intento.
        if (this.autoPrintedOrderId !== this.orderId) {
          void this.printDispatchTicketIfNeeded('explicit');
        }
      } });
  }

  emailReceipt(): void {
    if (!this.derivedCustomerEmail()) {
      this.toastService.warning('No hay email de cliente disponible');
      return;
    }

    this.emailing = true;

    setTimeout(() => {
      this.emailing = false;
      this.toastService.success('Ticket enviado por email correctamente');
    }, 2000);
  }

  startNewSale(): void {
    this.newSale.emit();
  }

  goToOrderDetail(): void {
    if (!this.orderId) return;
    this.viewDetail.emit(this.orderId);
  }

  /**
   * "Despachar" (solo ventas con envío): publica la orden al pool de reparto
   * (`POST /store/dispatch-notes/orders/:orderId/send-to-dispatch`, idempotente)
   * para que un repartidor la tome. En éxito arranca una nueva venta
   * (`startNewSale()`), replicando el reinicio total de "Nueva compra".
   */
  dispatchOrder(): void {
    if (!this.orderId || this.dispatching()) return;
    this.dispatching.set(true);
    this.repartosService
      .publishToPool(Number(this.orderId))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.dispatching.set(false);
          // Idempotente: si ya estaba publicada se dice así, no "enviada".
          if (res?.already_pooled) {
            this.toastService.info(
              'La orden ya estaba en el pool de despacho, esperando repartidor',
            );
          } else {
            this.toastService.success('Orden enviada a despacho');
          }
          this.startNewSale();
        },
        error: (err: any) => {
          this.dispatching.set(false);
          this.toastService.error(
            err?.message || 'No se pudo enviar la orden a despacho',
          );
        },
      });
  }

  /**
   * Emite el documento electrónico de esta venta BAJO DEMANDA.
   *
   * ## Qué hacía antes y por qué estaba mal
   *
   * Despachaba `InvoicingActions.createFromOrder`, que crea un borrador y
   * **nunca lo transmite**. El cajero pulsaba «Factura», recibía «Factura creada
   * exitosamente» y se iba con la certeza de haber emitido un documento que en
   * realidad seguía en `draft`, con su consecutivo reservado y sin CUFE. El
   * mensaje era verdadero y la conclusión falsa, que es la peor combinación.
   *
   * Ahora delega en el indicador fiscal, que llama a
   * `POST /store/invoicing/pos/orders/:id/emit` — el mismo motor y la misma
   * puerta de validación que el carril fiscal. El indicador es el dueño del
   * estado; este botón sólo lo empuja, para que no existan dos fuentes de verdad
   * sobre la misma venta.
   *
   * El único modal de este flujo lo abre esta función y sólo cuando el cajero
   * pulsa: la compuerta de configuración DIAN, que trae su CTA para terminar la
   * habilitación. El resultado de la emisión NUNCA abre nada.
   */
  createInvoice(): void {
    if (!this.orderId || this.creatingInvoice()) return;

    // Con las configuraciones todavía cargando se rechaza en silencio, para no
    // pintar un modal de «falta configurar» que se desmiente medio segundo
    // después.
    if (this.dianConfigsLoading()) return;
    const dian = this.dianStatus();
    if (!dian.configured) {
      this.notConfiguredReason.set(dian.reason ?? 'missing');
      this.isNotConfiguredModalOpen.set(true);
      return;
    }

    const indicator = this.fiscalIndicator();
    if (!indicator) return;

    // `emitNow()` devuelve `false` si ya hay una consulta en vuelo. Sin este
    // aviso, el botón se quedaría cargando para siempre esperando una respuesta
    // que nadie pidió.
    this.awaitingManualEmit = true;
    this.creatingInvoice.set(true);
    if (!indicator.emitNow()) {
      this.awaitingManualEmit = false;
      this.creatingInvoice.set(false);
    }
  }

  /**
   * Cada lectura del estado fiscal que hace el indicador (la automática, cada
   * sondeo, y la que provoca el botón «Factura»).
   *
   * Hace dos cosas y ninguna interrumpe al cajero:
   *
   * 1. **Sella el ticket.** Si ya hay número de factura, se recuerda para que un
   *    tiquete impreso después se identifique como copia informativa de un
   *    documento que existe, en vez de declararse no validado ante la DIAN.
   *    Antes esto sólo ocurría si el cajero pulsaba «Factura» a mano; con la
   *    emisión automática, el documento salía y el ticket seguía mintiendo.
   * 2. **Avisa por toast SÓLO la emisión que el cajero pidió.** Los sondeos
   *    automáticos no notifican nada: el indicador ya está en pantalla diciendo
   *    exactamente lo mismo, y un toast por sondeo sería ruido cada cinco
   *    segundos.
   */
  onFiscalStatus(status: PosFiscalStatus): void {
    this.fiscalStatus.set(status);

    if (status.invoice_number) {
      this.electronicInvoice.set({
        number: status.invoice_number,
        cufe: status.cufe ?? undefined,
      });
    }

    if (!this.awaitingManualEmit) return;
    this.awaitingManualEmit = false;
    this.creatingInvoice.set(false);

    switch (status.state) {
      case 'issued':
        this.toastService.success(
          status.invoice_number
            ? `Factura ${status.invoice_number} aceptada por la DIAN`
            : 'Factura aceptada por la DIAN',
        );
        // Con auto-print activo y ticket ya auto-impreso, la FE sale sola:
        // el gate ahora resuelve a la factura emitida. Guard por orden para
        // no reimprimir en cada re-sondeo. Imprimir nunca emite (la emisión
        // ya ocurrió arriba, a mano), así que no se consume consecutivo extra.
        if (
          this.orderId &&
          this.autoPrintedOrderId === this.orderId &&
          this.autoPrintedFeOrderId !== this.orderId &&
          this.ticketService.shouldAutoPrint()
        ) {
          this.autoPrintedFeOrderId = this.orderId;
          this.printReceipt();
        }
        break;
      case 'contingency':
        this.toastService.warning(status.message);
        break;
      case 'failed':
        // El detalle accionable —qué falta y dónde se corrige— ya está impreso
        // bajo el ticket, en el indicador. El toast sólo avisa que hay algo que
        // mirar.
        this.toastService.error(status.message);
        break;
      case 'not_applicable':
        this.toastService.info(status.message);
        break;
      default:
        this.toastService.info(
          'El documento electrónico va en camino. La venta ya está registrada.',
        );
    }
  }

  /** La DIAN ya aceptó el documento de esta venta. */
  readonly alreadyIssued = computed(
    () => this.fiscalStatus()?.state === 'issued',
  );

  readonly invoiceButtonTitle = computed(() =>
    this.alreadyIssued()
      ? 'Esta venta ya tiene factura electrónica aceptada'
      : 'Emitir la factura electrónica de esta venta',
  );

  hasDiscount(): boolean {
    return (this.derivedOrderDiscount() || this.orderDiscount) > 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  // ── CP-DTLP Phase E.1/E.2 — Helpers del disparador POS del tiquete de despacho ─
  //
  // `isDirectDeliveryOrder` y `hasShippingOrder` se consolidaron en el
  // predicado compartido `shouldAutoPrintDispatchTicket`
  // (`shared/services/print/dispatch-ticket-autoprint.ts`). El contexto
  // que arma `printDispatchTicketIfNeeded` pasa `deliveryType`,
  // `isShippingSale` y `counterEnabled`; el predicado decide.

  /**
   * Construye el `DispatchTicketData` desde el `orderData` actual. La dirección
   * puede venir incompleta desde el POS (el endpoint del POS puede no devolver
   * `addresses_orders_shipping_address_idToaddresses`); cuando falta, el
   * tiquete se imprime con campos vacíos — no bloqueamos la venta por eso.
   */
  private buildDispatchTicketData(order: any): DispatchTicketData {
    const items = (order?.items || order?.order_items || []).map(
      (item: any) => ({
        sku:
          item.sku ||
          item.product_sku ||
          item.variant_sku ||
          item.products?.sku ||
          item.product_variants?.sku ||
          '',
        productName: item.product_name || item.name || 'Producto',
        orderedQty: Number(item.quantity || 0),
        dispatchedQty: Number(item.quantity || 0),
      }),
    );

    const address =
      order?.addresses_orders_shipping_address_idToaddresses ||
      order?.shipping_address_snapshot ||
      null;
    const user = this.authFacade.getCurrentUser();
    const storeName = user?.store?.name || 'Vendix';

    return {
      orderId: order?.id,
      orderNumber: this.derivedOrderNumber(),
      dateFormatted: this.derivedCurrentDate(),
      storeName,
      customer: {
        name: this.derivedCustomerName(),
        addressLine1: address?.address_line1 || '',
        addressLine2: address?.address_line2,
        city: address?.city,
      },
      items,
    };
  }

  /**
   * Encadena el tiquete de despacho si la guard pasa. Disparador único del
   * POS: lo invocan `maybeAutoPrint()` (E.1, trigger `'automatic'`) y
   * `printReceipt()` (E.2, trigger `'explicit'`), más los hooks de
   * `pos.component.ts`.
   *
   * Con `trigger === 'automatic'`, exige además `print_dispatch_ticket_auto_with_pos`
   * (opt-in por admin). Con `trigger === 'explicit'`, sólo exige el switch
   * global. `direct_delivery` se salta siempre. Sin envío no hay a quién
   * despachar.
   */
  private async printDispatchTicketIfNeeded(
    trigger: 'automatic' | 'explicit',
  ): Promise<void> {
    const order = this.orderData();
    if (!order) return;
    // Construye el contexto UNA vez y delega la cadena de guards al predicado
    // compartido con el detalle de orden. Mismo flag, misma lógica,
    // misma fuente (settings.receipts).
    const context: ShouldAutoPrintDispatchTicketContext = {
      printDispatchTicketEnabled: this.printDispatchTicketEnabled(),
      printDispatchTicketAuto:
        trigger === 'automatic' ? this.printDispatchTicketAutoWithPos() : undefined,
      // Decisión del usuario 2026-08-31: tiquete de reclamo en mostrador
      // y para llevar. Mismo flag, mismo origen que el detalle de orden.
      counterEnabled: this.printDispatchTicketOnCounter(),
      deliveryType: order.delivery_type,
      isShippingSale: order.isShippingSale,
    };
    if (!shouldAutoPrintDispatchTicket(trigger, context)) return;

    try {
      await this.dispatchTicketPrint.printDispatchTicket(
        this.buildDispatchTicketData(order),
        trigger,
      );
    } catch (err) {
      console.error('[CP-DTLP] Error al imprimir tiquete de despacho:', err);
    }
  }
}
