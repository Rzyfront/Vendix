import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  StickyHeaderBadgeColor,
  ToastService,
  DialogService,
} from '../../../../../../../shared/components/index';
import { extractApiError } from '../../../../../../../shared/utils/http-error.util';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import { PurchaseOrdersService } from '../../../../inventory/services/purchase-orders.service';
import { DispatchNotesService } from '../../../../dispatch-notes/services/dispatch-notes.service';
import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  PurchaseOrderReception,
  PurchaseOrderPayment,
  PurchaseOrderAttachment,
  ReceivePurchaseOrderItemDto,
} from '../../../../inventory/interfaces';
import { PurchaseOrderPrintService } from '../../services/purchase-order-print.service';
import { PoPaymentModalComponent } from '../../../../inventory/pop/components/po-payment-modal/po-payment-modal.component';
import { PoTimelineComponent } from '../../../../inventory/pop/components/po-timeline/po-timeline.component';
// QUI-431: reusable bulk serial-load modal in `collect` mode (no API call).
import { SerialBulkLoadModalComponent } from '../../../../serial-numbers/components/serial-bulk-load-modal/serial-bulk-load-modal.component';
import { BulkBackfillItem } from '../../../../serial-numbers/services/serial-numbers.service';

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Borrador',
  submitted: 'Enviada',
  approved: 'Aprobada',
  ordered: 'Ordenada',
  partial: 'Parcial',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_COLORS: Record<PurchaseOrderStatus, StickyHeaderBadgeColor> = {
  draft: 'gray',
  submitted: 'yellow',
  approved: 'blue',
  ordered: 'blue',
  partial: 'yellow',
  received: 'green',
  cancelled: 'red',
};

/** One receivable line, built when the PO loads (NOT lazily like the modal). */
interface ReceiveLine {
  id: number;
  product_name: string;
  sku: string;
  quantity_ordered: number;
  quantity_received: number;
  pending: number;
  receive_quantity: number;
  unit_price: number;
  // UoM hints (display only — the backend converts to min stock unit).
  stock_unit: string | null;
  purchase_unit: string | null;
  purchase_to_stock_factor: number | null;
  // QUI-431 serial capture metadata.
  requires_serial: boolean;
  product_id: number;
  product_variant_id: number | null;
}

/**
 * STORE_ADMIN — Vista dedicada full-page de una Orden de Compra.
 *
 * Reemplaza el flujo modal-en-modal (po-detail-modal + po-receive-modal). Gestiona
 * aprobar, recibir (parciales + seriales, con selector Directa | Por remisión),
 * registrar pagos, adjuntos e historial. La tabla de recepción se construye al
 * cargar la OC (no depende de `onOpenChange`, el bug del modal anterior).
 */
@Component({
  selector: 'app-store-purchase-order-detail',
  standalone: true,
  imports: [
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    SpinnerComponent,
    StickyHeaderComponent,
    PoPaymentModalComponent,
    PoTimelineComponent,
    SerialBulkLoadModalComponent,
  ],
  template: `
    <div class="w-full min-h-screen">
      <app-sticky-header
        [title]="headerTitle()"
        [subtitle]="headerSubtitle()"
        icon="shopping-bag"
        [showBackButton]="true"
        backRoute="/admin/orders/purchase-orders"
        [badgeText]="statusLabel()"
        [badgeColor]="badgeColor()"
        [actions]="headerActions()"
        (actionClicked)="onAction($event)"
      />

      <div class="max-w-[1400px] mx-auto px-2 md:px-4 py-3 md:py-4">
        @if (errorMessage(); as msg) {
          <app-alert-banner variant="danger" title="Error" customClasses="mb-3">
            {{ msg }}
          </app-alert-banner>
        }

        @if (loading()) {
          <div class="py-16">
            <app-spinner [center]="true" text="Cargando orden..." />
          </div>
        } @else if (po(); as p) {
          <div class="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 lg:gap-4">
            <!-- ============ MAIN COLUMN ============ -->
            <div class="flex flex-col gap-3">
              <!-- Supplier + location -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <app-card>
                  <div class="flex items-start gap-3">
                    <div class="shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                      <app-icon name="truck" [size]="20" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-xs text-text-secondary">Proveedor</p>
                      <p class="text-base font-semibold text-text-primary truncate">
                        {{ p.supplier?.name || p.suppliers?.name || '—' }}
                      </p>
                    </div>
                  </div>
                </app-card>
                <app-card>
                  <div class="flex items-start gap-3">
                    <div class="shrink-0 w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <app-icon name="map-pin" [size]="20" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="text-xs text-text-secondary">Recibir en</p>
                      <p class="text-base font-semibold text-text-primary truncate">
                        {{ p.location?.name || '—' }}
                      </p>
                    </div>
                  </div>
                </app-card>
              </div>

              <!-- Items -->
              <app-card [padding]="false">
                <div class="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between">
                  <h2 class="text-sm md:text-base font-semibold text-text-primary">
                    Productos ({{ orderItems().length }})
                  </h2>
                  @if (receptionProgress() > 0 && receptionProgress() < 100) {
                    <span class="text-xs text-text-secondary">{{ receptionProgress() }}% recibido</span>
                  }
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead class="bg-surface-secondary border-b border-border">
                      <tr class="text-left text-text-secondary">
                        <th class="px-4 py-2 font-medium">Producto</th>
                        <th class="px-4 py-2 font-medium text-right">Pedido</th>
                        <th class="px-4 py-2 font-medium text-right hidden sm:table-cell">Recibido</th>
                        <th class="px-4 py-2 font-medium text-right">Costo</th>
                        <th class="px-4 py-2 font-medium text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of orderItems(); track item.id) {
                        <tr class="border-b border-border/40">
                          <td class="px-4 py-3">
                            <p class="font-medium text-text-primary">{{ getItemName(item) }}</p>
                            @if (item.product_variants?.sku) {
                              <p class="text-xs text-text-tertiary">SKU: {{ item.product_variants!.sku }}</p>
                            }
                          </td>
                          <td class="px-4 py-3 text-right text-text-primary">{{ getOrdered(item) }}</td>
                          <td class="px-4 py-3 text-right hidden sm:table-cell"
                            [class.text-success]="getReceived(item) >= getOrdered(item) && getOrdered(item) > 0"
                            [class.text-text-secondary]="getReceived(item) < getOrdered(item)">
                            {{ getReceived(item) }}
                          </td>
                          <td class="px-4 py-3 text-right text-text-secondary">{{ money(item.unit_price || item.unit_cost) }}</td>
                          <td class="px-4 py-3 text-right font-semibold text-text-primary">
                            {{ money(getOrdered(item) * num(item.unit_price || item.unit_cost)) }}
                          </td>
                        </tr>
                      }
                    </tbody>
                    <tfoot>
                      <tr class="border-t-2 border-border">
                        <td [attr.colspan]="4" class="px-4 py-3 text-right font-semibold text-text-primary">Total</td>
                        <td class="px-4 py-3 text-right font-bold text-primary">{{ money(p.total_amount) }}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </app-card>

              <!-- ============ RECEPTION SECTION ============ -->
              @if (canReceive()) {
                <app-card id="reception-section" [padding]="false">
                  <div class="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between gap-2">
                    <h2 class="text-sm md:text-base font-semibold text-text-primary flex items-center gap-2">
                      <app-icon name="package-check" [size]="16" class="text-primary" />
                      Recibir mercancía
                    </h2>
                    <!-- Directa | Por remisión selector -->
                    <div class="inline-flex rounded-lg border border-border overflow-hidden text-xs">
                      <button type="button"
                        class="px-3 py-1.5 font-medium transition-colors"
                        [class]="receiveMode() === 'direct' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary'"
                        (click)="receiveMode.set('direct')">
                        Directa
                      </button>
                      <button type="button"
                        class="px-3 py-1.5 font-medium transition-colors border-l border-border"
                        [class]="receiveMode() === 'remision' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-secondary'"
                        (click)="receiveMode.set('remision')">
                        Por remisión
                      </button>
                    </div>
                  </div>

                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead class="bg-surface-secondary border-b border-border">
                        <tr class="text-left text-text-secondary text-xs uppercase tracking-wider">
                          <th class="px-4 py-2.5">Producto</th>
                          <th class="px-4 py-2.5 text-center hidden sm:table-cell">Pedido</th>
                          <th class="px-4 py-2.5 text-center hidden sm:table-cell">Recibido</th>
                          <th class="px-4 py-2.5 text-center">Pendiente</th>
                          <th class="px-4 py-2.5 text-center">Recibir</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (line of receiveLines(); track line.id) {
                          <tr class="border-b border-border/40">
                            <td class="px-4 py-2.5">
                              <div class="font-medium text-text-primary">{{ line.product_name }}</div>
                              <div class="text-xs text-text-secondary">{{ line.sku }}</div>
                            </td>
                            <td class="px-4 py-2.5 text-center hidden sm:table-cell text-text-secondary">{{ line.quantity_ordered }}</td>
                            <td class="px-4 py-2.5 text-center hidden sm:table-cell text-text-secondary">{{ line.quantity_received }}</td>
                            <td class="px-4 py-2.5 text-center">
                              <span class="font-medium"
                                [class.text-amber-500]="line.pending > 0"
                                [class.text-text-secondary]="line.pending === 0">{{ line.pending }}</span>
                            </td>
                            <td class="px-4 py-2.5 text-center">
                              @if (line.pending > 0) {
                                <div class="flex flex-col items-center gap-0.5">
                                  <input type="number" [min]="0" [max]="line.pending"
                                    class="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                                    [(ngModel)]="line.receive_quantity" />
                                  @if (line.purchase_to_stock_factor && line.purchase_to_stock_factor > 1) {
                                    <span class="text-[10px] text-gray-500">
                                      {{ line.purchase_unit }} × {{ line.purchase_to_stock_factor }}
                                      = {{ (line.receive_quantity || 0) * line.purchase_to_stock_factor }} {{ line.stock_unit }}
                                    </span>
                                  } @else if (line.purchase_unit) {
                                    <span class="text-[10px] text-gray-500">{{ line.purchase_unit }}</span>
                                  }
                                  @if (line.requires_serial && line.receive_quantity > 0) {
                                    <button type="button"
                                      class="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                                      (click)="openSerialCapture(line)">
                                      <app-icon name="barcode" [size]="12" />
                                      Capturar seriales
                                    </button>
                                    @if (serialCountFor(line.id) > 0) {
                                      <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted"
                                        [class.text-success]="serialCountFor(line.id) >= line.receive_quantity"
                                        [class.text-amber-600]="serialCountFor(line.id) < line.receive_quantity">
                                        {{ serialCountFor(line.id) }}/{{ line.receive_quantity }} seriales
                                      </span>
                                    } @else {
                                      <span class="text-[10px] text-amber-600">Se autogenerarán</span>
                                    }
                                  }
                                </div>
                              } @else {
                                <span class="text-xs text-success font-medium">Completo</span>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>

                  <div class="p-4 border-t border-border space-y-3">
                    <div>
                      <label class="text-sm font-medium text-text-secondary block mb-1.5">Notas de recepción</label>
                      <textarea rows="2"
                        class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Notas opcionales sobre esta recepción..."
                        [(ngModel)]="receptionNotes"></textarea>
                    </div>
                    @if (receiveMode() === 'remision') {
                      <p class="text-xs text-text-secondary flex items-center gap-1.5">
                        <app-icon name="file-text" [size]="13" class="text-primary" />
                        Se generará una remisión de compra (entrada) enlazada a esta orden y se confirmará automáticamente.
                      </p>
                    }
                    <div class="flex flex-col sm:flex-row gap-2 sm:justify-between">
                      <app-button variant="outline" size="sm" (clicked)="receiveAll()" [disabled]="receiveSaving() || !hasPending()">
                        <app-icon name="check-check" [size]="14" slot="icon" />
                        Recibir todo
                      </app-button>
                      <app-button variant="primary" (clicked)="confirmReception()" [disabled]="receiveSaving() || !hasItemsToReceive()" [loading]="receiveSaving()">
                        {{ receiveMode() === 'remision' ? 'Recibir por remisión' : 'Confirmar recepción' }}
                      </app-button>
                    </div>
                  </div>
                </app-card>
              }

              <!-- ============ RECEPTIONS HISTORY ============ -->
              @if (receptions().length > 0) {
                <app-card [padding]="false">
                  <div class="px-4 py-3 border-b border-border bg-surface-secondary">
                    <h2 class="text-sm md:text-base font-semibold text-text-primary">
                      Recepciones ({{ receptions().length }})
                    </h2>
                  </div>
                  <div class="p-3 space-y-3">
                    @for (reception of receptions(); track reception.id) {
                      <div class="border border-border rounded-lg p-3">
                        <div class="flex justify-between items-start">
                          <div class="flex items-center gap-2">
                            <div class="w-7 h-7 rounded-full bg-success/10 flex items-center justify-center shrink-0">
                              <app-icon name="package-check" [size]="13" class="text-success" />
                            </div>
                            <div>
                              <span class="text-sm font-medium text-text-primary">Recepción #{{ reception.id }}</span>
                              <span class="text-[11px] text-text-muted block">{{ dateTime(reception.received_at) }}</span>
                            </div>
                          </div>
                          @if (reception.received_by) {
                            <span class="text-[11px] text-text-muted bg-muted/20 px-2 py-0.5 rounded-full">{{ userName(reception.received_by) }}</span>
                          }
                        </div>
                        @if (reception.notes) {
                          <p class="text-xs text-text-secondary mt-2 ml-9">{{ reception.notes }}</p>
                        }
                        <div class="flex flex-wrap gap-1.5 mt-2.5 ml-9">
                          @for (rItem of reception.items; track rItem.id) {
                            <span class="inline-flex items-center gap-1 px-2 py-1 bg-success/8 text-success text-[11px] font-medium rounded-md border border-success/15">
                              <app-icon name="check-check" [size]="10" />
                              {{ receptionItemName(rItem) }} × {{ rItem.quantity_received }}
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </app-card>
              }

              <!-- ============ TIMELINE ============ -->
              <app-card [padding]="false">
                <div class="px-4 py-3 border-b border-border bg-surface-secondary">
                  <h2 class="text-sm md:text-base font-semibold text-text-primary flex items-center gap-2">
                    <app-icon name="clock" [size]="16" class="text-text-secondary" />
                    Historial
                  </h2>
                </div>
                <div class="p-4">
                  <app-po-timeline [orderId]="p.id" />
                </div>
              </app-card>
            </div>

            <!-- ============ SIDEBAR ============ -->
            <div class="flex flex-col gap-3">
              <!-- Financial summary -->
              <app-card>
                <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Resumen financiero</h2>
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between"><span class="text-text-secondary">Subtotal</span><span class="font-medium text-text-primary">{{ money(p.subtotal_amount) }}</span></div>
                  <div class="flex justify-between"><span class="text-text-secondary">Descuento</span><span class="font-medium text-text-primary">{{ money(p.discount_amount) }}</span></div>
                  <div class="flex justify-between"><span class="text-text-secondary">Impuestos</span><span class="font-medium text-text-primary">{{ money(p.tax_amount) }}</span></div>
                  <div class="flex justify-between"><span class="text-text-secondary">Envío</span><span class="font-medium text-text-primary">{{ money(p.shipping_cost) }}</span></div>
                  <div class="flex justify-between border-t border-border pt-2 mt-1"><span class="font-semibold text-text-primary">Total</span><span class="font-bold text-primary">{{ money(p.total_amount) }}</span></div>
                </div>
              </app-card>

              <!-- Payment progress -->
              <app-card>
                <div class="flex items-center justify-between mb-3">
                  <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider">Pagos</h2>
                  @if (canRegisterPayment()) {
                    <app-button variant="outline" size="sm" (clicked)="showPaymentModal.set(true)">
                      <app-icon name="dollar-sign" [size]="13" slot="icon" />
                      Registrar
                    </app-button>
                  }
                </div>
                <div class="h-2.5 bg-border rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all duration-500"
                    [class]="paymentProgress() >= 100 ? 'bg-success' : 'bg-primary'"
                    [style.width.%]="cappedProgress()"></div>
                </div>
                <div class="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div>
                    <p class="text-[10px] text-text-muted uppercase tracking-wider">Total</p>
                    <p class="text-sm font-bold text-text-primary mt-0.5">{{ money(p.total_amount) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] text-text-muted uppercase tracking-wider">Pagado</p>
                    <p class="text-sm font-bold mt-0.5" [class]="totalPaid() > 0 ? 'text-success' : 'text-text-secondary'">{{ money(totalPaid()) }}</p>
                  </div>
                  <div>
                    <p class="text-[10px] text-text-muted uppercase tracking-wider">Pendiente</p>
                    <p class="text-sm font-bold mt-0.5" [class]="remaining() > 0 ? 'text-destructive' : 'text-text-secondary'">{{ money(remaining()) }}</p>
                  </div>
                </div>
                @if (payments().length > 0) {
                  <div class="mt-3 pt-3 border-t border-border space-y-2">
                    @for (payment of payments(); track payment.id) {
                      <div class="flex items-start gap-2">
                        <div class="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <app-icon name="dollar-sign" [size]="12" class="text-primary" />
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="flex items-baseline gap-2 flex-wrap">
                            <span class="text-sm font-semibold text-text-primary">{{ money(payment.amount) }}</span>
                            <span class="text-[11px] text-text-muted">{{ dateOnly(payment.payment_date) }}</span>
                          </div>
                          <div class="text-xs text-text-secondary">
                            {{ paymentMethodLabel(payment.payment_method) }}
                            @if (payment.reference) { <span class="text-text-muted"> · Ref: {{ payment.reference }}</span> }
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                }
              </app-card>

              <!-- Attachments -->
              <app-card>
                <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Adjuntos</h2>
                <button type="button"
                  class="w-full border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  (click)="fileInput.click()">
                  <app-icon name="upload-cloud" [size]="22" class="text-text-muted mx-auto mb-1" />
                  <p class="text-xs text-text-secondary">Subir archivo</p>
                </button>
                <input #fileInput type="file" class="hidden" (change)="onFileSelected($event)"
                  accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx" />
                @if (uploading()) {
                  <div class="flex items-center gap-2 text-xs text-text-secondary mt-2">
                    <app-spinner size="sm" /> Subiendo...
                  </div>
                }
                @if (attachments().length > 0) {
                  <div class="mt-3 space-y-2">
                    @for (attachment of attachments(); track attachment.id) {
                      <div class="border border-border rounded-lg p-2.5 flex items-center gap-2">
                        <app-icon [name]="fileIcon(attachment.file_type)" [size]="15" class="text-primary shrink-0" />
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-medium text-text-primary truncate">{{ attachment.file_name }}</p>
                          <p class="text-[10px] text-text-muted">{{ fileSize(attachment.file_size) }}</p>
                        </div>
                        @if (attachment.download_url) {
                          <a [href]="attachment.download_url" target="_blank" rel="noopener"
                            class="p-1.5 rounded text-text-secondary hover:text-primary" aria-label="Descargar">
                            <app-icon name="file-down" [size]="15" />
                          </a>
                        }
                        <button type="button" class="p-1.5 rounded text-text-secondary hover:text-destructive"
                          (click)="removeAttachment(attachment.id)" aria-label="Eliminar">
                          <app-icon name="trash-2" [size]="15" />
                        </button>
                      </div>
                    }
                  </div>
                }
              </app-card>
            </div>
          </div>
        }
      </div>
    </div>

    <!-- Register payment modal (reused, zoneless-correct) -->
    <app-po-payment-modal
      [isOpen]="showPaymentModal()"
      [orderId]="po()?.id || null"
      [totalAmount]="num(po()?.total_amount)"
      [paidAmount]="totalPaid()"
      (close)="showPaymentModal.set(false)"
      (paymentRegistered)="onPaymentRegistered()"
    />

    <!-- QUI-431 serial capture modal (collect mode) -->
    <app-serial-bulk-load-modal
      [isOpen]="serialModalOpen()"
      mode="collect"
      [productId]="serialModalProductId()"
      [productVariantId]="serialModalVariantId()"
      [maxCount]="serialModalMaxCount()"
      (isOpenChange)="onSerialModalOpenChange($event)"
      (collected)="onSerialsCollected($event)"
    />
  `,
  styles: [`
    :host { display: block; }
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
  `],
})
export class StorePurchaseOrderDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(PurchaseOrdersService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly printService = inject(PurchaseOrderPrintService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly currency = inject(CurrencyFormatService);

  readonly loading = signal(true);
  readonly actionLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly po = signal<PurchaseOrder | null>(null);

  readonly receptions = signal<PurchaseOrderReception[]>([]);
  readonly payments = signal<PurchaseOrderPayment[]>([]);
  readonly attachments = signal<PurchaseOrderAttachment[]>([]);
  readonly uploading = signal(false);

  // Reception state
  readonly receiveLines = signal<ReceiveLine[]>([]);
  readonly receiveMode = signal<'direct' | 'remision'>('direct');
  readonly receiveSaving = signal(false);
  receptionNotes = '';

  // Payment modal
  readonly showPaymentModal = signal(false);

  // QUI-431 serial capture state
  readonly serialsByLine = signal<Map<number, string[]>>(new Map());
  readonly serialModalOpen = signal(false);
  readonly serialModalProductId = signal<number | null>(null);
  readonly serialModalVariantId = signal<number | null>(null);
  readonly serialModalMaxCount = signal<number | null>(null);
  private serialModalLineId: number | null = null;

  // ============ Computed status/header ============
  readonly statusLabel = computed(() => {
    const s = this.po()?.status;
    return s ? STATUS_LABELS[s] ?? s : '—';
  });

  readonly badgeColor = computed<StickyHeaderBadgeColor>(() => {
    const s = this.po()?.status;
    return s ? STATUS_BADGE_COLORS[s] ?? 'gray' : 'gray';
  });

  readonly headerTitle = computed(() => {
    const p = this.po();
    if (!p) return 'Orden de compra';
    return `OC ${p.order_number || '#' + p.id}`;
  });

  readonly headerSubtitle = computed(() => {
    const p = this.po();
    if (!p) return '';
    const name = p.supplier?.name || p.suppliers?.name;
    return name ? `Proveedor: ${name}` : '';
  });

  readonly orderItems = computed<PurchaseOrderItem[]>(() => {
    const p = this.po();
    return (p?.purchase_order_items || p?.items || []) as PurchaseOrderItem[];
  });

  readonly totalPaid = computed(() =>
    this.payments().reduce((sum, p) => sum + this.num(p.amount), 0),
  );

  readonly remaining = computed(() =>
    Math.max(0, this.num(this.po()?.total_amount) - this.totalPaid()),
  );

  readonly paymentProgress = computed(() => {
    const total = this.num(this.po()?.total_amount);
    if (total <= 0) return 0;
    return Math.round((this.totalPaid() / total) * 100);
  });

  readonly cappedProgress = computed(() => Math.min(this.paymentProgress(), 100));

  readonly receptionProgress = computed(() => {
    const items = this.orderItems();
    if (items.length === 0) return 0;
    const ordered = items.reduce((s, i) => s + this.getOrdered(i), 0);
    const received = items.reduce((s, i) => s + this.getReceived(i), 0);
    if (ordered <= 0) return 0;
    return Math.round((received / ordered) * 100);
  });

  readonly canApprove = computed(() => {
    const s = this.po()?.status;
    return s === 'draft' || s === 'submitted';
  });

  readonly canReceive = computed(() => {
    const s = this.po()?.status;
    return s === 'approved' || s === 'ordered' || s === 'partial';
  });

  readonly canCancel = computed(() => {
    const s = this.po()?.status;
    return !!s && ['draft', 'submitted', 'approved', 'ordered', 'partial'].includes(s);
  });

  readonly canRegisterPayment = computed(() => {
    const p = this.po();
    if (!p || p.status === 'cancelled') return false;
    return this.remaining() > 0;
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const acts: StickyHeaderActionButton[] = [];
    const loading = this.actionLoading();
    if (this.canApprove()) {
      acts.push({ id: 'approve', label: 'Aprobar', variant: 'primary', icon: 'check-circle', loading, disabled: loading, visible: true });
    }
    if (this.canReceive()) {
      acts.push({ id: 'receive', label: 'Recibir', variant: 'primary', icon: 'package-check', disabled: loading, visible: true });
    }
    if (this.canRegisterPayment()) {
      acts.push({ id: 'pay', label: 'Registrar pago', variant: 'outline', icon: 'dollar-sign', disabled: loading, visible: true });
    }
    if (this.canCancel()) {
      acts.push({ id: 'cancel', label: 'Cancelar', variant: 'outline-danger', icon: 'x-circle', loading, disabled: loading, visible: true });
    }
    acts.push({ id: 'print', label: 'Imprimir', variant: 'outline', icon: 'printer', disabled: loading, visible: true });
    return acts;
  });

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!id) {
      this.errorMessage.set('Identificador de orden inválido.');
      this.loading.set(false);
      return;
    }
    this.fetchAll(id);
  }

  // ============ Loading ============
  private fetchAll(id: number): void {
    this.loading.set(true);
    forkJoin({
      po: this.service.getPurchaseOrderById(id),
      receptions: this.service.getPurchaseOrderReceptions(id).pipe(catchError(() => of({ data: [] as PurchaseOrderReception[] } as any))),
      payments: this.service.getPurchaseOrderPayments(id).pipe(catchError(() => of({ data: [] as PurchaseOrderPayment[] } as any))),
      attachments: this.service.getPurchaseOrderAttachments(id).pipe(catchError(() => of({ data: [] as PurchaseOrderAttachment[] } as any))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const order = (res.po as any)?.data ?? (res.po as any) ?? null;
          this.po.set(order);
          this.receptions.set((res.receptions as any)?.data ?? []);
          this.payments.set((res.payments as any)?.data ?? []);
          this.attachments.set((res.attachments as any)?.data ?? []);
          this.buildReceiveLines(order);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(typeof err === 'string' ? err : 'No se pudo cargar la orden.');
          this.loading.set(false);
        },
      });
  }

  private reload(): void {
    const id = this.po()?.id;
    if (id) this.fetchAll(id);
  }

  private buildReceiveLines(po: PurchaseOrder | null): void {
    if (!po) {
      this.receiveLines.set([]);
      return;
    }
    const items = (po.purchase_order_items || po.items || []) as PurchaseOrderItem[];
    this.receiveLines.set(
      items.map((item) => {
        const ordered = item.quantity_ordered ?? item.quantity ?? 0;
        const received = item.quantity_received ?? 0;
        const pending = Math.max(0, ordered - received);
        const product = item.products || item.product;
        return {
          id: item.id!,
          product_name: product?.name || 'Producto',
          sku: item.product_variants?.sku || product?.sku || '-',
          quantity_ordered: ordered,
          quantity_received: received,
          pending,
          receive_quantity: 0,
          unit_price: this.num(item.unit_price ?? item.unit_cost),
          stock_unit: product?.stock_unit ?? null,
          purchase_unit: product?.purchase_unit ?? null,
          purchase_to_stock_factor: product?.purchase_to_stock_factor ?? null,
          requires_serial: !!product?.requires_serial_numbers,
          product_id: item.product_id ?? product?.id ?? 0,
          product_variant_id: item.product_variant_id ?? item.product_variants?.id ?? null,
        };
      }),
    );
    this.receptionNotes = '';
    this.serialsByLine.set(new Map());
  }

  // ============ Header actions ============
  onAction(id: string): void {
    switch (id) {
      case 'approve': void this.approve(); break;
      case 'receive': this.scrollToReception(); break;
      case 'pay': this.showPaymentModal.set(true); break;
      case 'cancel': void this.cancel(); break;
      case 'print': this.print(); break;
    }
  }

  private scrollToReception(): void {
    document.getElementById('reception-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private print(): void {
    const p = this.po();
    if (p) this.printService.printPurchaseOrder(p);
  }

  async approve(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Aprobar orden',
      message: '¿Confirmas la aprobación de esta orden de compra? Quedará lista para recepción.',
      confirmText: 'Aprobar',
      cancelText: 'Cancelar',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service.approvePurchaseOrder(p.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Orden aprobada'); this.actionLoading.set(false); this.reload(); },
      error: (err) => { this.actionLoading.set(false); this.toast.error(typeof err === 'string' ? err : 'No se pudo aprobar la orden.'); },
    });
  }

  async cancel(): Promise<void> {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Cancelar orden',
      message: `¿Confirmas la cancelación de la orden ${p.order_number || '#' + p.id}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar orden',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.service.cancelPurchaseOrder(p.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success('Orden cancelada'); this.actionLoading.set(false); this.reload(); },
      error: (err) => { this.actionLoading.set(false); this.toast.error(typeof err === 'string' ? err : 'No se pudo cancelar la orden.'); },
    });
  }

  // ============ Reception ============
  hasPending(): boolean {
    return this.receiveLines().some((l) => l.pending > 0);
  }

  hasItemsToReceive(): boolean {
    return this.receiveLines().some((l) => l.receive_quantity > 0);
  }

  receiveAll(): void {
    this.receiveLines.update((lines) => lines.map((l) => ({ ...l, receive_quantity: l.pending })));
  }

  confirmReception(): void {
    const po = this.po();
    if (!po) return;

    const lines = this.receiveLines().filter((l) => l.receive_quantity > 0);
    if (lines.length === 0) {
      this.toast.warning('Ingresa al menos una cantidad a recibir');
      return;
    }
    const invalid = this.receiveLines().find((l) => l.receive_quantity > l.pending);
    if (invalid) {
      this.toast.warning(`La cantidad a recibir de "${invalid.product_name}" excede el pendiente`);
      return;
    }

    if (this.receiveMode() === 'remision') {
      this.receiveViaDispatchNote(po, lines);
    } else {
      this.receiveDirect(po, lines);
    }
  }

  private receiveDirect(po: PurchaseOrder, lines: ReceiveLine[]): void {
    const serialsByLine = this.serialsByLine();
    const items: ReceivePurchaseOrderItemDto[] = lines.map((l) => {
      const qty = Math.min(l.receive_quantity, l.pending);
      const dto: ReceivePurchaseOrderItemDto = { id: l.id, quantity_received: qty };
      if (l.requires_serial) {
        const serials = serialsByLine.get(l.id);
        if (serials && serials.length > 0) dto.serial_numbers = serials.slice(0, qty);
      }
      return dto;
    });

    this.receiveSaving.set(true);
    const notes = this.receptionNotes.trim() || undefined;
    this.service.receivePurchaseOrder(po.id, items, notes).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.onReceptionSuccess(),
      error: (err) => { this.receiveSaving.set(false); this.toast.error(typeof err === 'string' ? err : 'Error al recibir mercancía'); },
    });
  }

  private receiveViaDispatchNote(po: PurchaseOrder, lines: ReceiveLine[]): void {
    const serialsByLine = this.serialsByLine();
    // Extended item DTO — the Fase A backend links each line back to its PO
    // line via `purchase_order_item_id`, so it can delegate to PO.receive.
    const items = lines.map((l) => ({
      product_id: l.product_id,
      product_variant_id: l.product_variant_id ?? undefined,
      location_id: po.location_id,
      ordered_quantity: l.quantity_ordered,
      dispatched_quantity: Math.min(l.receive_quantity, l.pending),
      unit_price: l.unit_price,
      purchase_order_item_id: l.id,
    }));

    // Inbound purchase_receipt destination is `to_location_id` — the only
    // location key whitelisted on CreatePurchaseReceiptDispatchDto. Sending
    // `dispatch_location_id` would be rejected by `forbidNonWhitelisted` (400).
    const dto = {
      direction: 'inbound',
      subtype: 'purchase_receipt',
      reason: 'normal_purchase',
      supplier_id: po.supplier_id,
      purchase_order_id: po.id,
      to_location_id: po.location_id,
      notes: this.receptionNotes.trim() || undefined,
      items,
    } as any;

    this.receiveSaving.set(true);
    this.dispatchNotesService.createPurchaseReceipt(dto).pipe(
      switchMap((dn) => {
        const confirmBody = this.buildConfirmSerialsBody(dn, lines, serialsByLine);
        return this.dispatchNotesService.confirm(dn.id, confirmBody).pipe(map(() => dn));
      }),
      switchMap((dn) => this.dispatchNotesService.receive(dn.id)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.onReceptionSuccess(),
      error: (err) => { this.receiveSaving.set(false); this.toast.error(typeof err === 'string' ? err : (extractApiError(err).message || 'Error al recibir por remisión')); },
    });
  }

  /**
   * Best-effort map captured serials → the created dispatch-note lines by
   * product (+variant). Only emitted when serials were captured; otherwise
   * the confirm body is `{}` and the backend confirms normally.
   */
  private buildConfirmSerialsBody(dn: any, lines: ReceiveLine[], serialsByLine: Map<number, string[]>): any {
    const dnItems: any[] = dn?.dispatch_note_items || [];
    if (dnItems.length === 0 || serialsByLine.size === 0) return {};
    const itemSerials: any[] = [];
    for (const line of lines) {
      const serials = serialsByLine.get(line.id);
      if (!serials || serials.length === 0) continue;
      const dnItem = dnItems.find(
        (di) => di.product_id === line.product_id &&
          (di.product_variant_id ?? null) === (line.product_variant_id ?? null),
      );
      if (dnItem) {
        itemSerials.push({ dispatch_note_item_id: dnItem.id, serial_numbers: serials.slice(0, Math.min(line.receive_quantity, line.pending)) });
      }
    }
    return itemSerials.length > 0 ? { item_serials: itemSerials } : {};
  }

  private onReceptionSuccess(): void {
    this.receiveSaving.set(false);
    this.toast.success('Mercancía recibida correctamente');
    this.dispatchNotesService.invalidateCache();
    this.reload();
  }

  // ============ Serial capture (QUI-431) ============
  serialCountFor(lineId: number): number {
    return this.serialsByLine().get(lineId)?.length ?? 0;
  }

  openSerialCapture(line: ReceiveLine): void {
    this.serialModalLineId = line.id;
    this.serialModalProductId.set(line.product_id || null);
    this.serialModalVariantId.set(line.product_variant_id);
    this.serialModalMaxCount.set(line.receive_quantity || null);
    this.serialModalOpen.set(true);
  }

  onSerialModalOpenChange(open: boolean): void {
    this.serialModalOpen.set(open);
    if (!open) this.serialModalLineId = null;
  }

  onSerialsCollected(items: BulkBackfillItem[]): void {
    const lineId = this.serialModalLineId;
    if (lineId == null) return;
    const serials = items.map((i) => i.serial_number);
    this.serialsByLine.update((map) => {
      const next = new Map(map);
      next.set(lineId, serials);
      return next;
    });
    this.serialModalOpen.set(false);
    this.serialModalLineId = null;
  }

  // ============ Payments ============
  onPaymentRegistered(): void {
    this.showPaymentModal.set(false);
    this.reload();
  }

  // ============ Attachments ============
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.uploadFile(input.files[0]);
      input.value = '';
    }
  }

  private uploadFile(file: File): void {
    const p = this.po();
    if (!p) return;
    this.uploading.set(true);
    this.service.uploadPurchaseOrderAttachment(p.id, file).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        this.uploading.set(false);
        this.toast.success('Archivo subido');
        this.attachments.update((list) => [...list, res?.data ?? res]);
      },
      error: (err) => { this.uploading.set(false); this.toast.error(typeof err === 'string' ? err : 'Error al subir archivo'); },
    });
  }

  async removeAttachment(attachmentId: number): Promise<void> {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({
      title: 'Eliminar adjunto',
      message: 'Esta acción no se puede deshacer.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.service.removePurchaseOrderAttachment(p.id, attachmentId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.attachments.update((list) => list.filter((a) => a.id !== attachmentId)); this.toast.success('Adjunto eliminado'); },
      error: (err) => this.toast.error(typeof err === 'string' ? err : 'Error al eliminar'),
    });
  }

  // ============ Item helpers ============
  getItemName(item: PurchaseOrderItem): string {
    return item.products?.name || item.product?.name || 'Producto';
  }
  getOrdered(item: PurchaseOrderItem): number {
    return item.quantity_ordered ?? item.quantity ?? 0;
  }
  getReceived(item: PurchaseOrderItem): number {
    return item.quantity_received ?? 0;
  }
  receptionItemName(rItem: any): string {
    return rItem?.purchase_order_item?.products?.name || rItem?.purchase_order_item?.product?.name || 'Producto';
  }

  // ============ Format helpers ============
  num(v: number | string | null | undefined): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }
  money(v: number | string | null | undefined): string {
    return this.currency.format(this.num(v));
  }
  dateOnly(v?: string | null): string {
    return v ? formatDateOnlyUTC(v) : '—';
  }
  dateTime(v?: string | null): string {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  fileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }
  fileIcon(mime: string): string {
    if (mime?.includes('pdf')) return 'file-text';
    if (mime?.includes('image')) return 'image';
    if (mime?.includes('sheet') || mime?.includes('excel')) return 'table';
    return 'paperclip';
  }
  paymentMethodLabel(method: string): string {
    const labels: Record<string, string> = { cash: 'Efectivo', bank_transfer: 'Transferencia bancaria', check: 'Cheque', credit_card: 'Tarjeta de crédito' };
    return labels[method] || method || 'Sin método';
  }
  userName(user: { first_name?: string | null; last_name?: string | null; username?: string | null; user_name?: string | null } | null | undefined): string {
    if (!user) return 'Sistema';
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.username || user.user_name || 'Sistema';
  }
}
