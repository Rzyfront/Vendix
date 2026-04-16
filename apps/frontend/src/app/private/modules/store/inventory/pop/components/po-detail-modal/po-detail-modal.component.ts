import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ScrollableTabsComponent, ScrollableTab } from '../../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { PurchaseOrdersService } from '../../../services';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../../../../shared/components/dialog/dialog.service';
import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderReception,
  PurchaseOrderAttachment,
  PurchaseOrderPayment,
} from '../../../interfaces';
import { PoReceiveModalComponent } from '../po-receive-modal/po-receive-modal.component';
import { PoPaymentModalComponent } from '../po-payment-modal/po-payment-modal.component';
import { PoTimelineComponent } from '../po-timeline/po-timeline.component';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'app-po-detail-modal',
  standalone: true,
  imports: [
    DatePipe,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    ScrollableTabsComponent,
    PoReceiveModalComponent,
    PoPaymentModalComponent,
    PoTimelineComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      [title]="modalTitle()"
      size="xl"
    >
      <!-- Header: status badges -->
      <div slot="header">
        <div class="flex items-center gap-2 mt-1">
          <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide"
            [class]="orderStatusClass()">
            {{ orderStatusLabel() }}
          </span>
          @if (order()?.payment_status && order()!.payment_status !== 'unpaid') {
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide"
              [class]="paymentStatusClass()">
              {{ paymentStatusLabel() }}
            </span>
          }
        </div>
      </div>

      <!-- Tab navigation -->
      <div class="mb-4 -mx-1">
        <app-scrollable-tabs
          [tabs]="tabs"
          [activeTab]="activeTab()"
          (tabChange)="onTabChange($event)"
          size="sm"
        ></app-scrollable-tabs>
      </div>

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Detalle                            -->
      <!-- ═══════════════════════════════════════ -->
      @if (activeTab() === 'detail') {
        <div class="space-y-5">
          <!-- Summary cards row -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="p-3 rounded-lg bg-muted/20 border border-border/50">
              <p class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Proveedor</p>
              <p class="text-sm font-semibold text-text-primary mt-1 truncate">
                {{ order()?.supplier?.name || order()?.suppliers?.name || '—' }}
              </p>
            </div>
            <div class="p-3 rounded-lg bg-muted/20 border border-border/50">
              <p class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Bodega</p>
              <p class="text-sm font-semibold text-text-primary mt-1 truncate">
                {{ order()?.location?.name || '—' }}
              </p>
            </div>
            <div class="p-3 rounded-lg bg-muted/20 border border-border/50">
              <p class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Fecha</p>
              <p class="text-sm font-semibold text-text-primary mt-1">
                {{ order()?.order_date | date:'dd MMM yyyy' }}
              </p>
            </div>
            <div class="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p class="text-[10px] text-text-muted uppercase tracking-wider font-medium">Total</p>
              <p class="text-sm font-bold text-primary mt-1">
                {{ formatCurrency(order()?.total_amount || 0) }}
              </p>
            </div>
          </div>

          <!-- Items table -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-xs text-text-muted uppercase tracking-wider font-semibold">
                Productos ({{ orderItems().length }})
              </h4>
              @if (receptionProgress() < 100 && receptionProgress() > 0) {
                <span class="text-xs text-text-muted">
                  {{ receptionProgress() }}% recibido
                </span>
              }
            </div>
            <div class="overflow-x-auto border border-border rounded-lg">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-muted/30 text-left text-[11px] text-text-secondary uppercase tracking-wider">
                    <th class="py-2.5 px-3">Producto</th>
                    <th class="py-2.5 px-3 text-right w-16">Cant.</th>
                    <th class="py-2.5 px-3 text-right w-20 hidden sm:table-cell">Recibido</th>
                    <th class="py-2.5 px-3 text-right w-24">Costo</th>
                    <th class="py-2.5 px-3 text-right w-24">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of orderItems(); track item.id) {
                    <tr class="border-t border-border/50 hover:bg-muted/10 transition-colors">
                      <td class="py-2.5 px-3">
                        <span class="font-medium text-text-primary">{{ getItemProductName(item) }}</span>
                        @if (item.product_variants?.sku) {
                          <span class="text-[11px] text-text-muted block mt-0.5">SKU: {{ item.product_variants!.sku }}</span>
                        }
                        <!-- Reception progress bar per item (mobile-visible) -->
                        @if (getItemReceived(item) > 0) {
                          <div class="sm:hidden mt-1.5 flex items-center gap-2">
                            <div class="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                              <div class="h-full rounded-full transition-all duration-300"
                                [class]="getItemReceived(item) >= getItemOrdered(item) ? 'bg-success' : 'bg-primary'"
                                [style.width.%]="getItemProgress(item)">
                              </div>
                            </div>
                            <span class="text-[10px] text-text-muted whitespace-nowrap">
                              {{ getItemReceived(item) }}/{{ getItemOrdered(item) }}
                            </span>
                          </div>
                        }
                      </td>
                      <td class="py-2.5 px-3 text-right text-text-secondary tabular-nums">
                        {{ getItemOrdered(item) }}
                      </td>
                      <td class="py-2.5 px-3 text-right hidden sm:table-cell">
                        <div class="flex items-center justify-end gap-2">
                          @if (getItemReceived(item) >= getItemOrdered(item) && getItemOrdered(item) > 0) {
                            <app-icon name="check-circle" [size]="13" class="text-success"></app-icon>
                          }
                          <span class="tabular-nums" [class]="getItemReceived(item) >= getItemOrdered(item) ? 'text-success font-medium' : 'text-text-secondary'">
                            {{ getItemReceived(item) }}
                          </span>
                        </div>
                      </td>
                      <td class="py-2.5 px-3 text-right text-text-secondary tabular-nums">
                        {{ formatCurrency(item.unit_price || item.unit_cost || 0) }}
                      </td>
                      <td class="py-2.5 px-3 text-right font-medium text-text-primary tabular-nums">
                        {{ formatCurrency(getItemOrdered(item) * (item.unit_price || item.unit_cost || 0)) }}
                      </td>
                    </tr>
                  }
                </tbody>
                <tfoot>
                  @if (order()?.shipping_cost) {
                    <tr class="border-t border-border/50">
                      <td [attr.colspan]="4" class="py-2 px-3 text-right text-xs text-text-muted">Envio</td>
                      <td class="py-2 px-3 text-right text-sm text-text-secondary tabular-nums">
                        {{ formatCurrency(order()!.shipping_cost || 0) }}
                      </td>
                    </tr>
                  }
                  <tr class="border-t-2 border-border">
                    <td [attr.colspan]="4" class="py-3 px-3 text-right font-semibold text-text-primary">Total</td>
                    <td class="py-3 px-3 text-right font-bold text-primary text-base tabular-nums">
                      {{ formatCurrency(order()?.total_amount || 0) }}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <!-- Notes + extra info -->
          @if (order()?.notes || order()?.expected_date || order()?.payment_due_date) {
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              @if (order()?.expected_date) {
                <div class="flex items-center gap-2 p-2.5 rounded-lg bg-muted/10 border border-border/30">
                  <app-icon name="calendar" [size]="14" class="text-text-muted flex-shrink-0"></app-icon>
                  <div>
                    <span class="text-[10px] text-text-muted uppercase">Entrega esperada</span>
                    <p class="text-sm text-text-primary">{{ order()!.expected_date | date:'dd MMM yyyy' }}</p>
                  </div>
                </div>
              }
              @if (order()?.payment_due_date) {
                <div class="flex items-center gap-2 p-2.5 rounded-lg bg-muted/10 border border-border/30">
                  <app-icon name="clock" [size]="14" class="text-text-muted flex-shrink-0"></app-icon>
                  <div>
                    <span class="text-[10px] text-text-muted uppercase">Vencimiento pago</span>
                    <p class="text-sm text-text-primary">{{ order()!.payment_due_date | date:'dd MMM yyyy' }}</p>
                  </div>
                </div>
              }
              @if (order()?.notes) {
                <div class="sm:col-span-2 p-2.5 rounded-lg bg-muted/10 border border-border/30">
                  <span class="text-[10px] text-text-muted uppercase font-medium">Notas</span>
                  <p class="text-sm text-text-secondary mt-0.5">{{ order()!.notes }}</p>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Recepciones                        -->
      <!-- ═══════════════════════════════════════ -->
      @if (activeTab() === 'receptions') {
        <div class="space-y-4">
          <!-- Header with action -->
          <div class="flex justify-between items-center">
            <h4 class="text-sm font-semibold text-text-primary">
              Recepciones
              @if (receptions().length > 0) {
                <span class="text-text-muted font-normal ml-1">({{ receptions().length }})</span>
              }
            </h4>
            @if (canReceive()) {
              <app-button variant="primary" size="sm" (clicked)="showReceiveModal.set(true)">
                <app-icon name="package-check" [size]="14" slot="icon"></app-icon>
                Recibir Mercancia
              </app-button>
            }
          </div>

          <!-- Global reception progress -->
          @if (receptionProgress() > 0 && receptionProgress() < 100) {
            <div class="p-3 rounded-lg border border-border/50 bg-muted/10">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs text-text-muted">Progreso general</span>
                <span class="text-xs font-semibold text-text-primary">{{ receptionProgress() }}%</span>
              </div>
              <div class="h-2 bg-border rounded-full overflow-hidden">
                <div class="h-full bg-primary rounded-full transition-all duration-500"
                  [style.width.%]="receptionProgress()">
                </div>
              </div>
            </div>
          }
          @if (receptionProgress() === 100) {
            <div class="p-3 rounded-lg border border-success/30 bg-success/5 flex items-center gap-2">
              <app-icon name="check-circle" [size]="16" class="text-success flex-shrink-0"></app-icon>
              <span class="text-sm text-success font-medium">Toda la mercancia ha sido recibida</span>
            </div>
          }

          <!-- Content -->
          @if (loadingReceptions() && !receptionsLoaded()) {
            <div class="flex items-center justify-center py-12">
              <div class="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
            </div>
          } @else if (receptions().length === 0) {
            <div class="flex flex-col items-center py-10 text-center">
              <div class="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                <app-icon name="package" [size]="24" class="text-text-muted"></app-icon>
              </div>
              <p class="text-sm font-medium text-text-secondary">Sin recepciones registradas</p>
              <p class="text-xs text-text-muted mt-1 max-w-[240px]">
                Las recepciones se registran al recibir mercancia del proveedor
              </p>
            </div>
          } @else {
            <div class="space-y-3">
              @for (reception of receptions(); track reception.id) {
                <div class="border border-border rounded-lg p-3 hover:border-border/80 transition-colors">
                  <div class="flex justify-between items-start">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0">
                        <app-icon name="package-check" [size]="13" class="text-success"></app-icon>
                      </div>
                      <div>
                        <span class="text-sm font-medium text-text-primary">Recepcion #{{ reception.id }}</span>
                        <span class="text-[11px] text-text-muted block">
                          {{ reception.received_at | date:'dd MMM yyyy, HH:mm' }}
                        </span>
                      </div>
                    </div>
                    @if (reception.received_by) {
                      <span class="text-[11px] text-text-muted bg-muted/20 px-2 py-0.5 rounded-full">
                        {{ reception.received_by.first_name || reception.received_by.user_name }}
                      </span>
                    }
                  </div>
                  @if (reception.notes) {
                    <p class="text-xs text-text-secondary mt-2 ml-9">{{ reception.notes }}</p>
                  }
                  <div class="flex flex-wrap gap-1.5 mt-2.5 ml-9">
                    @for (rItem of reception.items; track rItem.id) {
                      <span class="inline-flex items-center gap-1 px-2 py-1 bg-success/8 text-success text-[11px] font-medium rounded-md border border-success/15">
                        <app-icon name="check" [size]="10"></app-icon>
                        {{ getReceptionItemName(rItem) }} × {{ rItem.quantity_received }}
                      </span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Pagos                              -->
      <!-- ═══════════════════════════════════════ -->
      @if (activeTab() === 'payments') {
        <div class="space-y-4">
          <!-- Header with action -->
          <div class="flex justify-between items-center">
            <h4 class="text-sm font-semibold text-text-primary">Pagos</h4>
            @if (order()?.payment_status !== 'paid' && order()?.status !== 'cancelled') {
              <app-button variant="primary" size="sm" (clicked)="showPaymentModal.set(true)">
                <app-icon name="dollar-sign" [size]="14" slot="icon"></app-icon>
                Registrar Pago
              </app-button>
            }
          </div>

          <!-- Payment progress bar -->
          <div class="p-4 rounded-lg border border-border/50 bg-muted/10">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs text-text-muted">Progreso de pago</span>
              <span class="text-xs font-semibold text-text-primary">{{ paymentProgress() }}%</span>
            </div>
            <div class="h-2.5 bg-border rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500"
                [class]="paymentProgress() >= 100 ? 'bg-success' : 'bg-primary'"
                [style.width.%]="Math.min(paymentProgress(), 100)">
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3 mt-3">
              <div class="text-center">
                <p class="text-[10px] text-text-muted uppercase tracking-wider">Total</p>
                <p class="text-sm font-bold text-text-primary mt-0.5 tabular-nums">{{ formatCurrency(order()?.total_amount || 0) }}</p>
              </div>
              <div class="text-center">
                <p class="text-[10px] text-text-muted uppercase tracking-wider">Pagado</p>
                <p class="text-sm font-bold mt-0.5 tabular-nums" [class]="totalPaid() > 0 ? 'text-success' : 'text-text-secondary'">
                  {{ formatCurrency(totalPaid()) }}
                </p>
              </div>
              <div class="text-center">
                <p class="text-[10px] text-text-muted uppercase tracking-wider">Pendiente</p>
                <p class="text-sm font-bold mt-0.5 tabular-nums" [class]="remainingBalance() > 0 ? 'text-destructive' : 'text-text-secondary'">
                  {{ formatCurrency(remainingBalance()) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Payment list -->
          @if (loadingPayments() && !paymentsLoaded()) {
            <div class="flex items-center justify-center py-12">
              <div class="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
            </div>
          } @else if (payments().length === 0) {
            <div class="flex flex-col items-center py-10 text-center">
              <div class="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center mb-3">
                <app-icon name="wallet" [size]="24" class="text-text-muted"></app-icon>
              </div>
              <p class="text-sm font-medium text-text-secondary">Sin pagos registrados</p>
              <p class="text-xs text-text-muted mt-1 max-w-[240px]">
                Registra pagos para llevar control del saldo con el proveedor
              </p>
            </div>
          } @else {
            <div class="space-y-2">
              @for (payment of payments(); track payment.id) {
                <div class="border border-border rounded-lg p-3 flex items-start gap-3 hover:border-border/80 transition-colors">
                  <div class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <app-icon name="dollar-sign" [size]="14" class="text-primary"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-2 flex-wrap">
                      <span class="text-sm font-semibold text-text-primary tabular-nums">
                        {{ formatCurrency(payment.amount) }}
                      </span>
                      <span class="text-[11px] text-text-muted">
                        {{ payment.payment_date | date:'dd MMM yyyy' }}
                      </span>
                    </div>
                    <div class="text-xs text-text-secondary mt-0.5">
                      {{ getPaymentMethodLabel(payment.payment_method) }}
                      @if (payment.reference) {
                        <span class="text-text-muted"> · Ref: {{ payment.reference }}</span>
                      }
                    </div>
                    @if (payment.notes) {
                      <p class="text-xs text-text-muted mt-1 italic">{{ payment.notes }}</p>
                    }
                  </div>
                  @if (payment.created_by) {
                    <span class="text-[10px] text-text-muted bg-muted/20 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                      {{ payment.created_by.first_name || payment.created_by.user_name }}
                    </span>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Adjuntos                           -->
      <!-- ═══════════════════════════════════════ -->
      @if (activeTab() === 'attachments') {
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <h4 class="text-sm font-semibold text-text-primary">
              Adjuntos
              @if (attachments().length > 0) {
                <span class="text-text-muted font-normal ml-1">({{ attachments().length }})</span>
              }
            </h4>
          </div>

          <!-- Upload dropzone -->
          <button
            type="button"
            class="w-full border-2 border-dashed border-border rounded-lg p-5 text-center
                   hover:border-primary/50 hover:bg-primary/3 active:scale-[0.99]
                   transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30
                   min-h-[44px]"
            (click)="fileInput.click()"
            (dragover)="onDragOver($event)"
            (drop)="onDrop($event)"
          >
            <app-icon name="upload-cloud" [size]="24" class="text-text-muted mx-auto mb-1.5"></app-icon>
            <p class="text-sm text-text-secondary">Arrastra archivos o haz clic para seleccionar</p>
            <p class="text-[11px] text-text-muted mt-0.5">PDF, imagenes, documentos</p>
          </button>
          <input
            #fileInput
            type="file"
            class="hidden"
            (change)="onFileSelected($event)"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
          >

          @if (uploading()) {
            <div class="flex items-center gap-2 text-sm text-text-secondary p-3 bg-primary/5 rounded-lg border border-primary/20">
              <div class="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
              Subiendo archivo...
            </div>
          }

          @if (loadingAttachments() && !attachmentsLoaded()) {
            <div class="flex items-center justify-center py-12">
              <div class="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent"></div>
            </div>
          } @else if (attachments().length === 0 && !uploading()) {
            <div class="flex flex-col items-center py-8 text-center">
              <p class="text-sm text-text-muted">Aun no hay archivos adjuntos</p>
            </div>
          } @else {
            <div class="space-y-2">
              @for (attachment of attachments(); track attachment.id) {
                <div class="border border-border rounded-lg p-3 flex items-center gap-3 hover:border-border/80 transition-colors">
                  <div class="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <app-icon [name]="getFileIcon(attachment.file_type)" [size]="16" class="text-primary"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-text-primary truncate">{{ attachment.file_name }}</p>
                    <p class="text-[11px] text-text-muted">
                      {{ formatFileSize(attachment.file_size) }} · {{ attachment.created_at | date:'dd MMM yyyy' }}
                    </p>
                    @if (attachment.supplier_invoice_number) {
                      <p class="text-[11px] text-primary font-medium mt-0.5">
                        Factura #{{ attachment.supplier_invoice_number }}
                        @if (attachment.supplier_invoice_amount) {
                          · {{ formatCurrency(+attachment.supplier_invoice_amount) }}
                        }
                      </p>
                    }
                  </div>
                  <div class="flex items-center gap-0.5 flex-shrink-0">
                    @if (attachment.download_url) {
                      <a
                        [href]="attachment.download_url"
                        target="_blank"
                        rel="noopener"
                        class="p-2.5 rounded-lg text-text-secondary hover:text-primary hover:bg-primary/10
                               transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        aria-label="Descargar archivo"
                      >
                        <app-icon name="file-down" [size]="16"></app-icon>
                      </a>
                    }
                    <button
                      type="button"
                      class="p-2.5 rounded-lg text-text-secondary hover:text-destructive hover:bg-destructive/10
                             transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                      (click)="removeAttachment(attachment.id)"
                      aria-label="Eliminar archivo"
                    >
                      <app-icon name="trash-2" [size]="16"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ═══════════════════════════════════════ -->
      <!-- TAB: Historial                          -->
      <!-- ═══════════════════════════════════════ -->
      @if (activeTab() === 'timeline') {
        <app-po-timeline [orderId]="order()?.id || null"></app-po-timeline>
      }

      <!-- Footer with contextual actions -->
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="onOpenChange(false)">
          Cerrar
        </app-button>
        @if (canReceive() && activeTab() === 'detail') {
          <app-button variant="primary" (clicked)="showReceiveModal.set(true)">
            <app-icon name="package-check" [size]="14" slot="icon"></app-icon>
            Recibir
          </app-button>
        }
        @if (order()?.payment_status !== 'paid' && order()?.status !== 'cancelled' && activeTab() === 'detail') {
          <app-button variant="outline" (clicked)="showPaymentModal.set(true)">
            <app-icon name="dollar-sign" [size]="14" slot="icon"></app-icon>
            Pagar
          </app-button>
        }
      </div>
    </app-modal>

    <!-- Sub-modals -->
    <app-po-receive-modal
      [isOpen]="showReceiveModal()"
      [order]="order()"
      (close)="showReceiveModal.set(false)"
      (received)="onReceptionCompleted()"
    ></app-po-receive-modal>

    <app-po-payment-modal
      [isOpen]="showPaymentModal()"
      [orderId]="order()?.id || null"
      [totalAmount]="order()?.total_amount || 0"
      [paidAmount]="totalPaid()"
      (close)="showPaymentModal.set(false)"
      (paymentRegistered)="onPaymentRegistered()"
    ></app-po-payment-modal>
  `,
  styles: [`:host { display: block; }`],
})
export class PoDetailModalComponent {
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly order = input<PurchaseOrder | null>(null);

  readonly close = output<void>();
  readonly orderUpdated = output<void>();

  readonly activeTab = signal<string>('detail');
  readonly showReceiveModal = signal(false);
  readonly showPaymentModal = signal(false);

  // Data signals
  readonly receptions = signal<PurchaseOrderReception[]>([]);
  readonly payments = signal<PurchaseOrderPayment[]>([]);
  readonly attachments = signal<PurchaseOrderAttachment[]>([]);

  // Loaded flags — prevent infinite spinner when API returns empty
  readonly receptionsLoaded = signal(false);
  readonly paymentsLoaded = signal(false);
  readonly attachmentsLoaded = signal(false);

  // Loading states
  readonly loadingReceptions = signal(false);
  readonly loadingPayments = signal(false);
  readonly loadingAttachments = signal(false);
  readonly uploading = signal(false);

  // Expose Math for template
  readonly Math = Math;

  readonly tabs: ScrollableTab[] = [
    { id: 'detail', label: 'Detalle', icon: 'file-text' },
    { id: 'receptions', label: 'Recepciones', icon: 'package-check' },
    { id: 'payments', label: 'Pagos', icon: 'dollar-sign' },
    { id: 'attachments', label: 'Adjuntos', icon: 'paperclip' },
    { id: 'timeline', label: 'Historial', icon: 'clock' },
  ];

  readonly modalTitle = computed(() => {
    const po = this.order();
    return po ? `Orden ${po.order_number || '#' + po.id}` : 'Detalle de Orden';
  });

  readonly orderItems = computed(() => {
    const po = this.order();
    return (po?.purchase_order_items || po?.items || []) as PurchaseOrderItem[];
  });

  readonly totalPaid = computed(() =>
    this.payments().reduce((sum, p) => sum + Number(p.amount || 0), 0)
  );

  readonly remainingBalance = computed(() =>
    Math.max(0, Number(this.order()?.total_amount || 0) - this.totalPaid())
  );

  readonly paymentProgress = computed(() => {
    const total = Number(this.order()?.total_amount || 0);
    if (total <= 0) return 0;
    return Math.round((this.totalPaid() / total) * 100);
  });

  readonly receptionProgress = computed(() => {
    const items = this.orderItems();
    if (items.length === 0) return 0;
    const totalOrdered = items.reduce((s, i) => s + this.getItemOrdered(i), 0);
    const totalReceived = items.reduce((s, i) => s + this.getItemReceived(i), 0);
    if (totalOrdered <= 0) return 0;
    return Math.round((totalReceived / totalOrdered) * 100);
  });

  readonly canReceive = computed(() => {
    const status = this.order()?.status;
    return status === 'approved' || status === 'partial' || status === 'ordered';
  });

  constructor() {
    // Load tab data lazily
    effect(() => {
      const tab = this.activeTab();
      const po = this.order();
      if (!po) return;

      if (tab === 'receptions' && !this.receptionsLoaded()) {
        this.loadReceptions(po.id);
      }
      if (tab === 'payments' && !this.paymentsLoaded()) {
        this.loadPayments(po.id);
      }
      if (tab === 'attachments' && !this.attachmentsLoaded()) {
        this.loadAttachments(po.id);
      }
    });
  }

  onTabChange(tab: string): void {
    this.activeTab.set(tab);
  }

  onOpenChange(value: boolean): void {
    if (!value) {
      this.close.emit();
      // Reset loaded flags so data refreshes next open
      this.receptionsLoaded.set(false);
      this.paymentsLoaded.set(false);
      this.attachmentsLoaded.set(false);
      this.receptions.set([]);
      this.payments.set([]);
      this.attachments.set([]);
      this.activeTab.set('detail');
    }
  }

  // ============================================================
  // Status helpers
  // ============================================================

  orderStatusClass(): string {
    const status = this.order()?.status;
    const map: Record<string, string> = {
      draft: 'bg-muted/40 text-text-secondary',
      submitted: 'bg-blue-100 text-blue-700',
      approved: 'bg-blue-100 text-blue-700',
      ordered: 'bg-blue-100 text-blue-700',
      partial: 'bg-amber-100 text-amber-700',
      received: 'bg-green-100 text-green-700',
      cancelled: 'bg-red-100 text-red-700',
    };
    return map[status || 'draft'] || 'bg-muted/40 text-text-secondary';
  }

  orderStatusLabel(): string {
    const status = this.order()?.status;
    const map: Record<string, string> = {
      draft: 'Borrador',
      submitted: 'Enviada',
      approved: 'Aprobada',
      ordered: 'Ordenada',
      partial: 'Parcial',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    return map[status || 'draft'] || status || 'Borrador';
  }

  paymentStatusClass(): string {
    const status = this.order()?.payment_status;
    const map: Record<string, string> = {
      unpaid: 'bg-red-100 text-red-700',
      partial: 'bg-amber-100 text-amber-700',
      paid: 'bg-green-100 text-green-700',
    };
    return map[status || 'unpaid'] || 'bg-muted/40 text-text-secondary';
  }

  paymentStatusLabel(): string {
    const status = this.order()?.payment_status;
    const map: Record<string, string> = {
      unpaid: 'Sin pagar',
      partial: 'Pago parcial',
      paid: 'Pagado',
    };
    return map[status || 'unpaid'] || '';
  }

  // ============================================================
  // Data loading (with loaded flags to prevent infinite spinners)
  // ============================================================

  private loadReceptions(orderId: number): void {
    this.loadingReceptions.set(true);
    this.purchaseOrdersService.getPurchaseOrderReceptions(orderId).subscribe({
      next: (res: any) => {
        this.receptions.set(res.data || res || []);
        this.loadingReceptions.set(false);
        this.receptionsLoaded.set(true);
      },
      error: () => {
        this.loadingReceptions.set(false);
        this.receptionsLoaded.set(true);
      },
    });
  }

  private loadPayments(orderId: number): void {
    this.loadingPayments.set(true);
    this.purchaseOrdersService.getPurchaseOrderPayments(orderId).subscribe({
      next: (res: any) => {
        this.payments.set(res.data || res || []);
        this.loadingPayments.set(false);
        this.paymentsLoaded.set(true);
      },
      error: () => {
        this.loadingPayments.set(false);
        this.paymentsLoaded.set(true);
      },
    });
  }

  private loadAttachments(orderId: number): void {
    this.loadingAttachments.set(true);
    this.purchaseOrdersService.getPurchaseOrderAttachments(orderId).subscribe({
      next: (res: any) => {
        this.attachments.set(res.data || res || []);
        this.loadingAttachments.set(false);
        this.attachmentsLoaded.set(true);
      },
      error: () => {
        this.loadingAttachments.set(false);
        this.attachmentsLoaded.set(true);
      },
    });
  }

  // ============================================================
  // Actions
  // ============================================================

  onReceptionCompleted(): void {
    this.showReceiveModal.set(false);
    const po = this.order();
    if (po) {
      this.receptionsLoaded.set(false);
      this.receptions.set([]);
      this.loadReceptions(po.id);
    }
    this.orderUpdated.emit();
  }

  onPaymentRegistered(): void {
    this.showPaymentModal.set(false);
    const po = this.order();
    if (po) {
      this.paymentsLoaded.set(false);
      this.payments.set([]);
      this.loadPayments(po.id);
    }
    this.orderUpdated.emit();
  }

  // ============================================================
  // Attachments
  // ============================================================

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) {
      this.uploadFile(files[0]);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.uploadFile(input.files[0]);
      input.value = '';
    }
  }

  private uploadFile(file: File): void {
    const po = this.order();
    if (!po) return;

    this.uploading.set(true);
    this.purchaseOrdersService.uploadPurchaseOrderAttachment(po.id, file).subscribe({
      next: (res: any) => {
        this.uploading.set(false);
        this.toastService.success('Archivo subido');
        const newAttachment = res.data || res;
        this.attachments.update(list => [...list, newAttachment]);
      },
      error: (err: string) => {
        this.uploading.set(false);
        this.toastService.error(err || 'Error al subir archivo');
      },
    });
  }

  async removeAttachment(attachmentId: number): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar adjunto',
      message: 'Esta accion no se puede deshacer.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const po = this.order();
    if (!po) return;

    this.purchaseOrdersService.removePurchaseOrderAttachment(po.id, attachmentId).subscribe({
      next: () => {
        this.attachments.update(list => list.filter(a => a.id !== attachmentId));
        this.toastService.success('Adjunto eliminado');
      },
      error: (err: string) => {
        this.toastService.error(err || 'Error al eliminar');
      },
    });
  }

  // ============================================================
  // Item helpers
  // ============================================================

  getItemProductName(item: PurchaseOrderItem): string {
    return item.products?.name || item.product?.name || 'Producto';
  }

  getItemOrdered(item: PurchaseOrderItem): number {
    return item.quantity_ordered ?? (item as any).quantity ?? 0;
  }

  getItemReceived(item: PurchaseOrderItem): number {
    return item.quantity_received ?? 0;
  }

  getItemProgress(item: PurchaseOrderItem): number {
    const ordered = this.getItemOrdered(item);
    if (ordered <= 0) return 0;
    return Math.min(100, Math.round((this.getItemReceived(item) / ordered) * 100));
  }

  getReceptionItemName(rItem: any): string {
    return rItem.purchase_order_item?.products?.name
      || rItem.purchase_order_item?.product?.name
      || 'Producto';
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(Number(amount) || 0);
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getFileIcon(mimeType: string): string {
    if (mimeType?.includes('pdf')) return 'file-text';
    if (mimeType?.includes('image')) return 'image';
    if (mimeType?.includes('sheet') || mimeType?.includes('excel')) return 'table';
    return 'paperclip';
  }

  getPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      bank_transfer: 'Transferencia bancaria',
      check: 'Cheque',
      credit_card: 'Tarjeta de credito',
    };
    return labels[method] || method;
  }
}
