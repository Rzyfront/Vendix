import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  computed,
} from '@angular/core';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { DispatchNote, DispatchNoteItem } from '../../interfaces/dispatch-note.interface';

@Component({
  selector: 'app-invoice-modal',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    IconComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onClose()"
      title="Generar Factura"
      size="md"
      >
      <!-- Header icon -->
      <div slot="header" class="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100">
        <app-icon name="file-plus" [size]="20" class="text-blue-600"></app-icon>
      </div>
    
      <!-- Body -->
      <div class="space-y-5">
        <!-- Info Banner -->
        <div class="rounded-xl bg-blue-50 border border-blue-200 p-4 flex items-center gap-3">
          <app-icon name="info" [size]="20" class="text-blue-600 flex-shrink-0"></app-icon>
          <p class="text-[var(--fs-sm)] text-blue-800">
            Se generara una factura por el total de esta remision.
          </p>
        </div>
    
        <!-- Items Summary — Desktop Table -->
        <div class="hidden md:block">
          <div class="rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table class="w-full text-left">
              <thead>
                <tr class="bg-[var(--color-background)] border-b border-[var(--color-border)]">
                  <th class="px-4 py-2.5 text-[var(--fs-xs)] font-[var(--fw-medium)] text-[var(--color-text-secondary)] uppercase tracking-wider">Producto</th>
                  <th class="px-4 py-2.5 text-[var(--fs-xs)] font-[var(--fw-medium)] text-[var(--color-text-secondary)] uppercase tracking-wider text-right">Cantidad</th>
                  <th class="px-4 py-2.5 text-[var(--fs-xs)] font-[var(--fw-medium)] text-[var(--color-text-secondary)] uppercase tracking-wider text-right">Precio</th>
                  <th class="px-4 py-2.5 text-[var(--fs-xs)] font-[var(--fw-medium)] text-[var(--color-text-secondary)] uppercase tracking-wider text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (item of items(); track item; let last = $last) {
                  <tr
                    class="transition-colors duration-150"
                    [class.border-b]="!last"
                    [class.border-[var(--color-border)]]="!last"
                    >
                    <td class="px-4 py-3 text-[var(--fs-sm)] text-[var(--color-text-primary)]">
                      {{ getProductName(item) }}
                    </td>
                    <td class="px-4 py-3 text-[var(--fs-sm)] text-[var(--color-text-primary)] text-right">
                      {{ item.dispatched_quantity }}
                    </td>
                    <td class="px-4 py-3 text-[var(--fs-sm)] text-[var(--color-text-primary)] text-right">
                      {{ formatCurrency(item.unit_price) }}
                    </td>
                    <td class="px-4 py-3 text-[var(--fs-sm)] font-[var(--fw-medium)] text-[var(--color-text-primary)] text-right">
                      {{ formatCurrency(item.total_price) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
    
        <!-- Items Summary — Mobile Cards -->
        <div class="md:hidden space-y-3">
          @for (item of items(); track item) {
            <div
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 space-y-2"
              >
              <p class="text-[var(--fs-sm)] font-[var(--fw-medium)] text-[var(--color-text-primary)]">
                {{ getProductName(item) }}
              </p>
              <div class="flex items-center justify-between">
                <span class="text-[var(--fs-xs)] text-[var(--color-text-secondary)]">
                  {{ item.dispatched_quantity }} x {{ formatCurrency(item.unit_price) }}
                </span>
                <span class="text-[var(--fs-sm)] font-[var(--fw-medium)] text-[var(--color-text-primary)]">
                  {{ formatCurrency(item.total_price) }}
                </span>
              </div>
            </div>
          }
        </div>
    
        <!-- Totals -->
        <div class="rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Subtotal</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ formatCurrency(dispatchNote().subtotal_amount) }}
            </span>
          </div>
    
          @if (hasDiscount()) {
            <div
              class="flex items-center justify-between"
              >
              <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Descuento</span>
              <span class="text-[var(--fs-sm)] text-red-600">
                -{{ formatCurrency(dispatchNote().discount_amount) }}
              </span>
            </div>
          }
    
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">IVA</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ formatCurrency(dispatchNote().tax_amount) }}
            </span>
          </div>
    
          <div class="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
            <span class="text-[var(--fs-base)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">Total</span>
            <span class="text-[var(--fs-lg)] font-[var(--fw-bold)] text-[var(--color-text-primary)]">
              {{ formatCurrency(dispatchNote().grand_total) }}
            </span>
          </div>
        </div>
    
        <!-- Customer Info -->
        <div class="rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">Cliente</span>
            <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
              {{ dispatchNote().customer_name }}
            </span>
          </div>
          @if (dispatchNote().customer_tax_id) {
            <div class="flex items-center justify-between">
              <span class="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">NIT / CC</span>
              <span class="text-[var(--fs-sm)] text-[var(--color-text-primary)]">
                {{ dispatchNote().customer_tax_id }}
              </span>
            </div>
          }
        </div>
    
        <!-- Linked Sales Order -->
        @if (dispatchNote().sales_order_id) {
          <div
            class="flex items-center gap-2 text-[var(--fs-sm)] text-[var(--color-text-secondary)]"
            >
            <app-icon name="link" [size]="14" class="text-[var(--color-text-muted)]"></app-icon>
            <span>
              Orden de venta:
              <span class="font-[var(--fw-medium)] text-[var(--color-text-primary)]">
                #{{ dispatchNote().sales_order?.order_number || dispatchNote().sales_order_id }}
              </span>
            </span>
          </div>
        }
      </div>
    
      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            iconName="file-plus"
            (clicked)="onInvoice()"
            >
            Generar Factura
          </app-button>
        </div>
      </div>
    </app-modal>
    `,
})
export class InvoiceModalComponent {
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly dispatchNote = input.required<DispatchNote>();
  readonly invoiced = output<void>();

  readonly items = computed(() => this.dispatchNote().dispatch_note_items || []);

  hasDiscount(): boolean {
    return (Number(this.dispatchNote().discount_amount) || 0) > 0;
  }

  formatCurrency(value: any): string {
    return this.currencyService.format(Number(value) || 0);
  }

  getProductName(item: DispatchNoteItem): string {
    if (item.product_variant?.name) {
      return `${item.product?.name || 'Producto'} - ${item.product_variant.name}`;
    }
    return item.product?.name || 'Producto';
  }

  onInvoice(): void {
    this.invoiced.emit();
  }

  onClose(): void {
    this.isOpenChange.emit(false);
  }
}
