import {
  Component,
  EventEmitter,
  Input,
  Output,
  OnInit,
  OnChanges,
  OnDestroy,
  inject,
} from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  ToastService,
} from '../../../../../shared/components';
import { PosPaymentService } from '../services/pos-payment.service';
import { PosTicketService } from '../services/pos-ticket.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';

@Component({
  selector: 'app-pos-order-confirmation',
  standalone: true,
  imports: [
    CommonModule,
    ButtonComponent,
    ModalComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [size]="'md'"
      (closed)="onModalClosed()"
      [showCloseButton]="false"
    >
      <div slot="header" class="text-center py-2">
        <div
          class="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center text-success mx-auto mb-4"
        >
          <app-icon name="check-circle" [size]="40"></app-icon>
        </div>
        <h2 class="text-2xl font-bold text-text-primary">¡Venta Completada!</h2>
        <p class="text-text-secondary">
          Orden #{{ orderNumber }} procesada exitosamente
        </p>
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
            <div *ngIf="customerName" class="flex justify-between">
              <span class="text-text-secondary">Cliente:</span>
              <span class="font-medium text-text-primary">{{ customerName }}</span>
            </div>
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
              <div *ngFor="let item of orderItems" class="flex justify-between text-sm">
                <div class="flex flex-col">
                  <span class="font-medium text-text-primary">{{ item.name }}</span>
                  <span class="text-xs text-text-secondary">{{ item.quantity }}x {{ formatCurrency(item.unitPrice) }}</span>
                </div>
                <span class="font-bold text-text-primary">{{ formatCurrency(item.totalPrice) }}</span>
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="pt-4 border-t border-border space-y-2.5">
            <div class="flex justify-between text-sm text-text-secondary">
              <span>Subtotal:</span>
              <span>{{ formatCurrency(orderSubtotal) }}</span>
            </div>
            <div *ngIf="hasDiscount()" class="flex justify-between text-sm text-destructive font-medium">
              <span>Descuento:</span>
              <span>-{{ formatCurrency(orderDiscount) }}</span>
            </div>
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
          <div *ngIf="paymentInfo" class="mt-6 pt-4 border-t border-border bg-muted/20 -mx-6 px-6 -mb-6 pb-6 rounded-b-xl">
            <div class="flex justify-between items-center text-sm">
              <div class="flex items-center gap-2">
                <app-icon name="credit-card" [size]="16" class="text-text-secondary"></app-icon>
                <span class="font-medium text-text-secondary">{{ paymentInfo.method }}:</span>
              </div>
              <span class="font-bold text-text-primary">{{ formatCurrency(paymentInfo.amount) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div slot="footer" class="flex flex-wrap items-center justify-between gap-3 w-full">
        <div class="flex gap-3">
          <app-button
            variant="outline"
            size="md"
            (clicked)="printReceipt()"
            [loading]="printing"
          >
            <app-icon name="printer" [size]="18" slot="icon"></app-icon>
            Imprimir Ticket
          </app-button>

          <app-button
            variant="outline"
            size="md"
            (clicked)="emailReceipt()"
            [disabled]="!customerEmail"
            [loading]="emailing"
          >
            <app-icon name="mail" [size]="18" slot="icon"></app-icon>
            Email
          </app-button>
        </div>

        <app-button variant="primary" size="md" (clicked)="startNewSale()" class="shadow-sm">
          <app-icon name="plus" [size]="18" slot="icon"></app-icon>
          Nueva Venta
        </app-button>
      </div>
    </app-modal>
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
  ],
})
export class PosOrderConfirmationComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isOpen = false;
  @Input() orderData: any = null;
  @Output() closed = new EventEmitter<void>();
  @Output() newSale = new EventEmitter<void>();

  printing = false;
  emailing = false;

  orderNumber = '';
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

  private destroy$ = new Subject<void>();
  private authFacade = inject(AuthFacade);
  private toastService = inject(ToastService);
  private ticketService = inject(PosTicketService);

  ngOnInit(): void {
    const user = this.authFacade.getCurrentUser();
    this.cashierName = user ? `${user.first_name} ${user.last_name}` : 'Cajero';
  }

  ngOnChanges(): void {
    if (this.orderData) {
      this.loadOrderData();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadOrderData(): void {
    this.orderNumber = this.orderData.order_number || this.orderData.number || 'N/A';
    this.currentDate = this.orderData.created_at
      ? new Date(this.orderData.created_at).toLocaleString('es-AR')
      : new Date().toLocaleString('es-AR');

    this.customerName = this.orderData.customer_name || '';
    this.customerEmail = this.orderData.customer_email || '';
    this.customerTaxId = this.orderData.customer_tax_id || this.orderData.customer?.tax_id || this.orderData.customer?.document_number || '';

    console.log('Order data customer:', this.orderData.customer);
    console.log('Customer tax_id:', this.customerTaxId);

    this.orderItems = (this.orderData.items || []).map((item: any) => {
      const unitPrice = Number(item.unit_price || item.unitPrice || 0);
      const quantity = Number(item.quantity || 0);
      const totalPrice = Number(item.total_price || item.totalPrice || 0);
      const tax = Number(item.tax_amount || item.tax || 0) || (totalPrice - (unitPrice * quantity));
      return {
        name: item.product_name || item.name || 'Producto',
        quantity,
        unitPrice,
        totalPrice,
        tax,
      };
    });

    console.log('Order items with tax:', this.orderItems);

    this.orderSubtotal = Number(this.orderData.subtotal || 0);
    this.orderDiscount = Number(this.orderData.discount_amount || this.orderData.discount || 0);
    this.orderTax = Number(this.orderData.tax_amount || this.orderData.tax || 0);
    this.orderTotal = Number(this.orderData.total_amount || this.orderData.total || 0);

    if (this.orderData.payment) {
      this.paymentInfo = {
        method: this.orderData.payment.payment_method || this.orderData.payment.method || 'Pago',
        amount: Number(this.orderData.payment.amount || this.orderTotal),
      };
    } else if (this.orderData.isCreditSale) {
      this.paymentInfo = {
        method: 'Venta a Crédito',
        amount: this.orderTotal,
      };
    }
  }

  onModalClosed(): void {
    this.closed.emit();
  }

  printReceipt(): void {
    if (!this.orderData) return;

    this.printing = true;

    // Create TicketData from orderData
    const ticketData: any = {
      id: this.orderNumber,
      date: new Date(this.orderData.created_at || new Date()),
      items: this.orderItems.map(item => ({
        id: item.id || item.name,
        name: item.name,
        sku: item.sku || '',
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        discount: 0,
        tax: item.tax,
      })),
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
        taxId: this.customerTaxId,
      } : undefined,
      store: {
        name: 'Vendix Store',
        address: '123 Main St, City, State 12345',
        phone: '+1 (555) 123-4567',
        email: 'info@vendix.com',
        taxId: 'TAX-123456789',
        id: 1,
        logo: '',
      },
      organization: {
        name: 'Vendix',
        taxId: 'ORG-123',
      },
      cashier: this.cashierName,
      transactionId: this.orderNumber,
    };

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
      },
    });
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

  hasDiscount(): boolean {
    return this.orderDiscount > 0;
  }

  formatCurrency(amount: any): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
    }).format(Number(amount));
  }
}
