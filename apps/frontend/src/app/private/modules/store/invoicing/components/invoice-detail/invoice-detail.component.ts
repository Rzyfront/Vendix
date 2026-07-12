import { Component, inject, input, output } from '@angular/core';
import { NgClass, DatePipe } from '@angular/common';
import { Store } from '@ngrx/store';
import { Invoice, InvoiceItem } from '../../interfaces/invoice.interface';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoice-detail',
  standalone: true,
  imports: [
    NgClass,
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      [title]="invoice() ? 'Factura ' + invoice()!.invoice_number : 'Detalle de Factura'"
      size="lg"
      >
      @if (invoice()) {
        <div class="p-4">
          <!-- Status & Type Banner -->
          <div class="flex items-center justify-between mb-4 p-3 rounded-lg bg-[var(--color-surface-secondary)] border border-border">
            <div class="flex items-center gap-2">
              <span class="text-sm text-text-secondary">Tipo:</span>
              <span class="text-sm font-medium text-text-primary">{{ getTypeLabel(invoice()!.invoice_type) }}</span>
            </div>
            <span
              class="px-2.5 py-1 text-xs font-medium rounded-full"
              [ngClass]="getStatusClasses(invoice()!.status)"
              >
              {{ getStatusLabel(invoice()!.status) }}
            </span>
          </div>
          <!-- Customer Info -->
          <div class="mb-4 space-y-2">
            <h4 class="text-sm font-semibold text-text-primary">Datos del Cliente</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <span class="text-text-secondary">Nombre:</span>
                <span class="ml-1 text-text-primary">{{ invoice()!.customer_name || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">NIT/Cédula:</span>
                <span class="ml-1 text-text-primary">{{ invoice()!.customer_tax_id || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Correo Electrónico:</span>
                <span class="ml-1 text-text-primary">{{ invoice()!.customer_email || '-' }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Teléfono:</span>
                <span class="ml-1 text-text-primary">{{ invoice()!.customer_phone || '-' }}</span>
              </div>
            </div>
          </div>
          <!-- Dates -->
          <div class="mb-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span class="text-text-secondary">Fecha Emisión:</span>
              <span class="ml-1 text-text-primary">{{ invoice()!.issue_date | date:'dd/MM/yyyy':'UTC' }}</span>
            </div>
            <div>
              <span class="text-text-secondary">Fecha Vencimiento:</span>
              <span class="ml-1 text-text-primary">{{ invoice()!.due_date ? (invoice()!.due_date | date:'dd/MM/yyyy':'UTC') : '-' }}</span>
            </div>
          </div>
          <!-- Resolution -->
          @if (invoice()!.resolution) {
            <div class="mb-4 text-sm p-2 bg-[var(--color-info-light)] rounded-lg">
              <span class="text-[var(--color-info)] font-medium">Resolución:</span>
              <span class="ml-1 text-[var(--color-info)]">
                {{ invoice()!.resolution?.prefix }} {{ invoice()!.resolution?.resolution_number }}
                ({{ invoice()!.resolution?.range_from }} - {{ invoice()!.resolution?.range_to }})
              </span>
            </div>
          }
          <!-- Items Table -->
          <div class="mb-4">
            <h4 class="text-sm font-semibold text-text-primary mb-2">Productos / Servicios</h4>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-2 px-2 text-text-secondary font-medium">Producto</th>
                    <th class="text-center py-2 px-2 text-text-secondary font-medium">Cant.</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Precio</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Desc.</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">IVA</th>
                    <th class="text-right py-2 px-2 text-text-secondary font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of invoice()!.items; track item) {
                    <tr class="border-b border-border">
                      <td class="py-2 px-2 text-text-primary">
                        <span>{{ item.product_name || item.description }}</span>
                        @if (item.applied_price_tier_name) {
                          <span class="block text-xs text-text-secondary">Tarifa: {{ item.applied_price_tier_name }}</span>
                        }
                        @if (isPackageLine(item)) {
                          <span class="block text-xs text-text-secondary">
                            {{ item.quantity }} paq. = {{ item.stock_units_consumed }} u. (×{{ packagePerUnit(item) }})
                          </span>
                        }
                      </td>
                      <td class="py-2 px-2 text-center text-text-primary">{{ item.quantity }}</td>
                      <td class="py-2 px-2 text-right text-text-primary">{{ formatCurrency(item.unit_price) }}</td>
                      <td class="py-2 px-2 text-right text-text-secondary">{{ formatCurrency(item.discount_amount) }}</td>
                      <td class="py-2 px-2 text-right text-text-secondary">{{ formatCurrency(item.tax_amount) }}</td>
                      <td class="py-2 px-2 text-right font-medium text-text-primary">{{ formatCurrency(item.total_amount) }}</td>
                    </tr>
                  }
                  @if (!invoice()!.items || invoice()!.items?.length === 0) {
                    <tr>
                      <td colspan="6" class="py-4 text-center text-text-secondary">Sin productos</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <!-- Taxes Summary -->
          @if (invoice()?.taxes && invoice()?.taxes?.length) {
            <div class="mb-4">
              <h4 class="text-sm font-semibold text-text-primary mb-2">Impuestos</h4>
              <div class="space-y-1">
                @for (tax of invoice()!.taxes; track tax) {
                  <div class="flex justify-between text-sm">
                    <span class="text-text-secondary">{{ tax.tax_name }} ({{ tax.tax_rate }}%)</span>
                    <span class="text-text-primary">{{ formatCurrency(tax.tax_amount) }}</span>
                  </div>
                }
              </div>
            </div>
          }
          <!-- Totals -->
          <div class="border-t border-border pt-3 space-y-1">
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Subtotal</span>
              <span class="text-text-primary">{{ formatCurrency(invoice()!.subtotal_amount) }}</span>
            </div>
            @if (invoice()!.discount_amount > 0) {
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Descuentos</span>
                <span class="text-error">-{{ formatCurrency(invoice()!.discount_amount) }}</span>
              </div>
            }
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Impuestos</span>
              <span class="text-text-primary">{{ formatCurrency(invoice()!.tax_amount) }}</span>
            </div>
            @if (invoice()!.withholding_amount > 0) {
              <div class="flex justify-between text-sm">
                <span class="text-text-secondary">Retenciones</span>
                <span class="text-error">-{{ formatCurrency(invoice()!.withholding_amount) }}</span>
              </div>
            }
            <div class="flex justify-between text-base font-semibold pt-2 border-t border-border">
              <span class="text-text-primary">Total</span>
              <span class="text-primary">{{ formatCurrency(invoice()!.total_amount) }}</span>
            </div>
          </div>
          <!-- Notes -->
          @if (invoice()!.notes) {
            <div class="mt-4 p-3 bg-[var(--color-surface-secondary)] rounded-lg">
              <h4 class="text-sm font-semibold text-text-primary mb-1">Notas</h4>
              <p class="text-sm text-text-secondary">{{ invoice()!.notes }}</p>
            </div>
          }
          <!-- DIAN Status -->
          @if (invoice()!.send_status) {
            <div class="mt-4 p-3 bg-[var(--color-surface-secondary)] rounded-lg">
              <h4 class="text-sm font-semibold text-text-primary mb-1">Estado DIAN</h4>
              <p class="text-sm text-text-secondary">{{ invoice()!.send_status }}</p>
            </div>
          }
          <!-- DIAN Details (CUFE/QR/PDF) -->
          @if (invoice()!.cufe || invoice()!.qr_code || invoice()!.pdf_url) {
            <div class="mt-4 p-3 bg-success-light rounded-lg space-y-3">
              <h4 class="text-sm font-semibold text-success">Información DIAN</h4>
              @if (invoice()!.cufe) {
                <div class="flex items-center gap-2">
                  <span class="text-xs text-success font-medium">CUFE:</span>
                  <code class="text-xs text-success bg-success-light px-2 py-0.5 rounded break-all flex-1">{{ invoice()!.cufe }}</code>
                  <app-button variant="ghost" size="sm" (clicked)="copyCufe()">
                    <app-icon slot="icon" name="copy" [size]="12"></app-icon>
                  </app-button>
                </div>
              }
              @if (invoice()!.qr_code) {
                <div class="text-center">
                  <img [src]="invoice()!.qr_code" alt="QR Code DIAN" class="w-32 h-32 mx-auto border border-success rounded" />
                </div>
              }
              @if (invoice()!.pdf_url) {
                <div>
                  <app-button variant="outline" size="sm" (clicked)="downloadPdf()">
                    <app-icon slot="icon" name="download" [size]="14"></app-icon>
                    Descargar PDF
                  </app-button>
                </div>
              }
            </div>
          }
          <!-- Cross-module Links -->
          @if (invoice()!.order_id) {
            <div class="mt-4">
              <a class="text-sm text-primary hover:underline cursor-pointer" (click)="navigateToOrder()">
                <app-icon name="external-link" [size]="12"></app-icon>
                Ver Orden Asociada
              </a>
            </div>
          }
        </div>
      }
    
      <!-- Footer with actions -->
      <div slot="footer">
        <div class="flex items-center justify-between gap-3 p-3 bg-[var(--color-surface-secondary)] rounded-b-xl border-t border-border">
          <div class="flex items-center gap-2">
            @if (canValidate) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onValidate()">
                <app-icon slot="icon" name="check" [size]="14"></app-icon>
                Validar
              </app-button>
            }
            @if (canSend) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onSend()">
                <app-icon slot="icon" name="send" [size]="14"></app-icon>
                Enviar
              </app-button>
            }
            @if (canCreateCreditNote) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="creditNote.emit(invoice()!)">
                <app-icon slot="icon" name="file-minus" [size]="14"></app-icon>
                Nota Crédito
              </app-button>
            }
            @if (canAccept) {
              <app-button
                variant="primary"
                size="sm"
                (clicked)="onAccept()">
                <app-icon slot="icon" name="check-circle" [size]="14"></app-icon>
                Aceptar
              </app-button>
            }
            @if (canReject) {
              <app-button
                variant="outline-danger"
                size="sm"
                (clicked)="onReject()">
                <app-icon slot="icon" name="x-circle" [size]="14"></app-icon>
                Rechazar
              </app-button>
            }
            @if (canCancel) {
              <app-button
                variant="outline"
                size="sm"
                (clicked)="onCancel()">
                <app-icon slot="icon" name="slash" [size]="14"></app-icon>
                Cancelar
              </app-button>
            }
            @if (canVoid) {
              <app-button
                variant="outline-danger"
                size="sm"
                (clicked)="onVoid()">
                <app-icon slot="icon" name="trash-2" [size]="14"></app-icon>
                Anular
              </app-button>
            }
          </div>
    
          <app-button
            variant="outline"
            (clicked)="onClose()">
            Cerrar
          </app-button>
        </div>
      </div>
    </app-modal>
    `
})
export class InvoiceDetailComponent {
  readonly isOpen = input<boolean>(false);
  readonly invoice = input<Invoice | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly creditNote = output<Invoice>();

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  get canValidate(): boolean {
    return this.invoice()?.status === 'draft';
  }

  get canSend(): boolean {
    return this.invoice()?.status === 'validated';
  }

  get canCreateCreditNote(): boolean {
    return this.invoice()?.status === 'accepted' && this.invoice()?.invoice_type === 'sales_invoice';
  }

  get canAccept(): boolean {
    return this.invoice()?.status === 'sent';
  }

  get canReject(): boolean {
    return this.invoice()?.status === 'sent';
  }

  get canCancel(): boolean {
    return this.invoice()?.status === 'draft' || this.invoice()?.status === 'validated';
  }

  get canVoid(): boolean {
    return this.invoice()?.status === 'accepted' || this.invoice()?.status === 'rejected';
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0);
  }

  /** True when the line consumed packaging stock different from its quantity. */
  isPackageLine(item: InvoiceItem): boolean {
    return (
      typeof item.stock_units_consumed === 'number' &&
      item.stock_units_consumed > 0 &&
      item.stock_units_consumed !== item.quantity
    );
  }

  /** Units of stock consumed per sold unit (packaging factor), rounded to 2dp. */
  packagePerUnit(item: InvoiceItem): number {
    const consumed = item.stock_units_consumed ?? 0;
    const qty = item.quantity || 1;
    return Math.round((consumed / qty) * 100) / 100;
  }

  onValidate(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.validateInvoice({ id: inv.id }));
    }
  }

  onSend(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.sendInvoice({ id: inv.id }));
    }
  }

  onAccept(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.acceptInvoice({ id: inv.id }));
    }
  }

  onReject(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.rejectInvoice({ id: inv.id }));
    }
  }

  onCancel(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.cancelInvoice({ id: inv.id }));
    }
  }

  onVoid(): void {
    const inv = this.invoice();
    if (inv) {
      this.store.dispatch(InvoicingActions.voidInvoice({ id: inv.id }));
    }
  }

  copyCufe(): void {
    const cufe = this.invoice()?.cufe;
    if (cufe) {
      navigator.clipboard.writeText(cufe);
    }
  }

  downloadPdf(): void {
    const pdfUrl = this.invoice()?.pdf_url;
    if (pdfUrl) {
      window.open(pdfUrl, '_blank');
    }
  }

  navigateToOrder(): void {
    // Emit event for parent to handle navigation
    this.isOpenChange.emit(false);
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
      voided: 'Anulada',
    };
    return labels[status] || status;
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      sales_invoice: 'Factura de Venta',
      purchase_invoice: 'Factura de Compra',
      credit_note: 'Nota Crédito',
      debit_note: 'Nota Débito',
      export_invoice: 'Factura de Exportación',
    };
    return labels[type] || type;
  }

  getStatusClasses(status: string): Record<string, boolean> {
    const map: Record<string, string> = {
      draft: 'bg-[var(--color-surface-secondary)] text-text-secondary',
      validated: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      sent: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      accepted: 'bg-success-light text-success',
      rejected: 'bg-error-light text-error',
      cancelled: 'bg-warning-light text-warning',
      voided: 'bg-[var(--color-surface-secondary)] text-text-secondary',
    };
    const classes = (map[status] || 'bg-[var(--color-surface-secondary)] text-text-secondary').split(' ');
    return classes.reduce((acc, cls) => ({ ...acc, [cls]: true }), {} as Record<string, boolean>);
  }
}
