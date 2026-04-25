import {
  Component,
  input,
  output,
  inject,
  effect,
  signal,
  DestroyRef } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';


import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService } from '../../../../../shared/components';
import { PosPaymentService } from '../services/pos-payment.service';
import { PosTicketService } from '../services/pos-ticket.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { Store } from '@ngrx/store';
import { Actions, ofType } from '@ngrx/effects';
import * as InvoicingActions from '../../invoicing/state/actions/invoicing.actions';
import {
  selectDianConfigStatus,
  selectDianConfigsLoading,
  DianConfigGateStatus,
  DianGateReason,
} from '../../invoicing/state/selectors/invoicing.selectors';
import { InvoicingNotConfiguredComponent } from '../../invoicing/components/invoicing-not-configured/invoicing-not-configured.component';

@Component({
  selector: 'app-pos-order-confirmation',
  standalone: true,
  imports: [
    ButtonComponent,
    ModalComponent,
    IconComponent,
    InvoicingNotConfiguredComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [size]="'md'"
      [showCloseButton]="true"
      title="¡Venta Completada!"
      [subtitle]="'Orden #' + orderNumber + ' procesada exitosamente'"
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
              <span class="font-medium text-text-primary">{{ currentDate }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-secondary">Cajero:</span>
              <span class="font-medium text-text-primary">{{ cashierName }}</span>
            </div>
            @if (customerName) {
              <div class="flex justify-between">
                <span class="text-text-secondary">Cliente:</span>
                <span class="font-medium text-text-primary">{{ customerName }}</span>
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
              @for (item of orderItems; track item) {
                <div class="flex justify-between text-sm">
                  <div class="flex flex-col">
                    <span class="font-medium text-text-primary">{{ item.name }}</span>
                    <span class="text-xs text-text-secondary">
                      @if (item.is_weight_product) {
                        {{ item.weight }} {{ item.weight_unit }} x {{ formatCurrency(item.unitPrice) }}/{{ item.weight_unit }}
                      } @else {
                        {{ item.quantity }}x {{ formatCurrency(item.unitPrice) }}
                      }
                    </span>
                  </div>
                  <span class="font-bold text-text-primary">{{ formatCurrency(item.totalPrice) }}</span>
                </div>
              }
            </div>
          </div>
    
          <!-- Summary -->
          <div class="pt-4 border-t border-border space-y-2.5">
            <div class="flex justify-between text-sm text-text-secondary">
              <span>Subtotal:</span>
              <span>{{ formatCurrency(orderSubtotal) }}</span>
            </div>
            @if (hasDiscount()) {
              <div class="flex justify-between text-sm text-destructive font-medium">
                <span>Descuento:</span>
                <span>-{{ formatCurrency(orderDiscount) }}</span>
              </div>
            }
            <div class="flex justify-between text-sm text-text-secondary">
              <span>Impuesto:</span>
              <span>{{ formatCurrency(orderTax) }}</span>
            </div>
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
    
      <div slot="footer" class="flex flex-col gap-3 w-full">
        <!-- CTA Primario: full-width, prominente -->
        <app-button
          variant="primary"
          size="lg"
          [fullWidth]="true"
          (clicked)="startNewSale()"
          >
          <app-icon name="plus" [size]="20" slot="icon"></app-icon>
          Nueva compra
        </app-button>
    
        <!-- Acciones secundarias: ghost, compactos, en fila -->
        <div class="flex items-center justify-center gap-1 sm:gap-2">
          <app-button variant="ghost" size="sm" (clicked)="printReceipt()" [loading]="printing" title="Imprimir Ticket">
            <app-icon name="printer" [size]="16" slot="icon"></app-icon>
            <span class="hidden sm:inline">Imprimir</span>
          </app-button>
    
          <app-button variant="ghost" size="sm" (clicked)="emailReceipt()" [disabled]="!customerEmail" [loading]="emailing" title="Enviar por Email">
            <app-icon name="mail" [size]="16" slot="icon"></app-icon>
            <span class="hidden sm:inline">Email</span>
          </app-button>
    
          <app-button variant="ghost" size="sm" (clicked)="createInvoice()" [disabled]="!orderId || dianConfigsLoading()" [loading]="creatingInvoice" title="Crear Factura">
            <app-icon name="file-text" [size]="16" slot="icon"></app-icon>
            <span class="hidden sm:inline">Factura</span>
          </app-button>
    
          <!-- Separador visual entre categorías -->
          <div class="w-px h-5 bg-[var(--color-border)] mx-1"></div>
    
          <app-button variant="ghost" size="sm" (clicked)="goToOrderDetail()" [disabled]="!orderId" title="Ver detalle de la orden">
            <app-icon name="external-link" [size]="16" slot="icon"></app-icon>
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

      @media print {
        /* Hide everything by default */
        body * {
          visibility: hidden !important;
        }
        
        /* Show only the ticket */
        .receipt-container, .receipt-container * {
          visibility: visible !important;
          color: #000 !important;
          background: none !important;
          box-shadow: none !important;
          font-family: 'Courier New', Courier, monospace !important;
          text-shadow: none !important;
        }

        .receipt-container {
          position: fixed !important;
          left: 0 !important;
          top: 0 !important;
          width: 300px !important; /* Standard POS width approx */
          margin: 0 !important;
          padding: 10px !important;
          border: none !important;
        }

        /* Simplify layout for print */
        .receipt-container .border-t, 
        .receipt-container .border-b,
        .receipt-container .border-t-2 {
          border-color: #000 !important;
          border-style: dashed !important;
          border-width: 1px 0 0 0 !important;
        }

        .receipt-container [class*="text-primary"],
        .receipt-container [class*="text-text-secondary"] {
          color: #000 !important;
        }

        .receipt-container [class*="bg-muted"] {
          background: none !important;
          border-top: 1px dashed #000 !important;
        }
        
        .receipt-container .text-2xl,
        .receipt-container .text-lg {
          font-size: 14pt !important;
          font-weight: bold !important;
        }

        /* Hide icons for print */
        app-icon {
          display: none !important;
        }

        @page {
          margin: 0;
          size: auto;
        }
      }
    `,
  ] })
export class PosOrderConfirmationComponent {
  private destroyRef = inject(DestroyRef);
  readonly isOpen = input<boolean>(false);
  readonly orderData = input<any>(null);
  readonly closed = output<void>();
  readonly newSale = output<void>();
  readonly viewDetail = output<string>();

  printing = false;
  emailing = false;
  creatingInvoice = false;

  orderNumber = '';
  orderId: string | null = null;
  currentDate = '';
  cashierName = '';
  customerName = '';
  customerEmail = '';
  customerTaxId = '';
  orderItems: any[] = [];
  orderSubtotal = 0;
  orderDiscount = 0;
  orderTax = 0;
  orderTotal = 0;
  paymentInfo: any = null;
private authFacade = inject(AuthFacade);
  private toastService = inject(ToastService);
  private ticketService = inject(PosTicketService);
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);
  private actions$ = inject(Actions);

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

  constructor() {
    const user = this.authFacade.getCurrentUser();
    this.cashierName = user ? `${user.first_name} ${user.last_name}` : 'Cajero';
    this.currencyService.loadCurrency();
    this.store.dispatch(InvoicingActions.loadDianConfigs());
effect(() => {
      if (this.orderData()) {
        this.loadOrderData();
      }
    });
  }

  private loadOrderData(): void {
    const data = this.orderData();
    this.orderId = data?.id?.toString?.() || null;
    this.orderNumber = data.order_number || data.number || 'N/A';
    this.currentDate = data.created_at
      ? new Date(data.created_at).toLocaleString('es-AR')
      : new Date().toLocaleString('es-AR');

    // Show "Consumidor Final" if customer_name is empty or undefined (anonymous sale)
    this.customerName = data.customer_name || 'Consumidor Final';
    this.customerEmail = data.customer_email || '';
    this.customerTaxId = data.customer_tax_id || data.customer?.tax_id || data.customer?.document_number || '';

    this.orderItems = (data.items || []).map((item: any) => {
      const unitPrice = Number(item.unit_price || item.unitPrice || 0);
      const quantity = Number(item.quantity || 0);
      const totalPrice = Number(item.total_price || item.totalPrice || 0);
      const tax = Number(item.tax_amount || item.tax || 0) || (totalPrice - (unitPrice * quantity));
      const weight = Number(item.weight || 0);
      const weight_unit = item.weight_unit || 'kg';
      const is_weight_product = weight > 0;
      return {
        name: item.product_name || item.name || 'Producto',
        quantity,
        unitPrice,
        totalPrice,
        tax,
        weight,
        weight_unit,
        is_weight_product };
    });

    this.orderSubtotal = Number(data.subtotal || 0);
    this.orderDiscount = Number(data.discount_amount || data.discount || 0);
    this.orderTax = Number(data.tax_amount || data.tax || 0);
    this.orderTotal = Number(data.total_amount || data.total || 0);

    if (data.payment) {
      this.paymentInfo = {
        method: data.payment.payment_method || data.payment.method || 'Pago',
        amount: Number(data.payment.amount || this.orderTotal) };
    } else if (data.isCreditSale) {
      this.paymentInfo = {
        method: 'Venta a Crédito',
        amount: this.orderTotal };
    }
  }

  onModalClosed(): void {
    this.closed.emit();
  }

  printReceipt(): void {
    if (!this.orderData()) return;

    this.printing = true;

    // Create TicketData from orderData
    const ticketData: any = {
      id: this.orderNumber,
      date: new Date(this.orderData().created_at || new Date()),
      items: this.orderItems.map(item => ({
        id: item.id || item.name,
        name: item.name,
        sku: item.sku || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        discount: 0,
        tax: item.tax,
        weight: item.weight || undefined,
        weight_unit: item.weight_unit || undefined })),
      subtotal: this.orderSubtotal,
      tax: this.orderTax,
      discount: this.orderDiscount,
      total: this.orderTotal,
      paymentMethod: this.paymentInfo?.method || 'Pago',
      cashReceived: this.paymentInfo?.amount,
      change: 0,
      customer: this.customerName ? {
        name: this.customerName,
        email: this.customerEmail,
        phone: '',
        taxId: this.customerTaxId } : undefined,
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
      transactionId: this.orderNumber,
      invoiceDataToken: this.orderData()?.invoiceDataToken,
      invoiceDataQrUrl: this.orderData()?.invoiceDataQrUrl };

    this.ticketService.printTicket(ticketData, { printReceipt: true }).subscribe({
      next: (success: boolean) => {
        this.printing = false;
        if (success) {
          this.toastService.success('Ticket enviado a impresión');
        } else {
          this.toastService.error('Error al imprimir ticket');
        }
      },
      error: (error: any) => {
        this.printing = false;
        console.error('Error al imprimir ticket:', error);
        this.toastService.error('Error al imprimir ticket');
      } });
  }

  emailReceipt(): void {
    if (!this.customerEmail) {
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

  async createInvoice(): Promise<void> {
    if (!this.orderId) return;

    // Gate: block the dispatch if DIAN config isn't ready.
    // If configs are still loading, refuse to avoid a flashed "missing" modal.
    if (this.dianConfigsLoading()) return;
    const dian = this.dianStatus();
    if (!dian.configured) {
      this.notConfiguredReason.set(dian.reason ?? 'missing');
      this.isNotConfiguredModalOpen.set(true);
      return;
    }

    this.creatingInvoice = true;

    // Listen for the result before dispatching
    const actionPromise = firstValueFrom(
      this.actions$.pipe(
        ofType(InvoicingActions.createFromOrderSuccess, InvoicingActions.createFromOrderFailure),
        takeUntilDestroyed(this.destroyRef),
      ),
    );

    this.store.dispatch(InvoicingActions.createFromOrder({ orderId: Number(this.orderId) }));

    const action = await actionPromise;
    this.creatingInvoice = false;
    if (action.type === InvoicingActions.createFromOrderSuccess.type) {
      this.toastService.success('Factura creada exitosamente');
    } else {
      const errorAction = action as ReturnType<typeof InvoicingActions.createFromOrderFailure>;
      this.toastService.error(errorAction.error || 'Error al crear la factura');
    }
  }

  hasDiscount(): boolean {
    return this.orderDiscount > 0;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }
}
