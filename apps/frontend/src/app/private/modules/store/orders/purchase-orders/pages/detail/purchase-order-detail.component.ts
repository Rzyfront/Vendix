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
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';

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
import { DatePipe } from '@angular/common';

import { PurchaseOrdersService } from '../../../../inventory/services/purchase-orders.service';
import { DispatchNotesService } from '../../../../dispatch-notes/services/dispatch-notes.service';
import {
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  PurchaseOrderReception,
  PurchaseOrderPayment,
  PurchaseOrderAttachment,
} from '../../../../inventory/interfaces';
import { PurchaseOrderPrintService } from '../../services/purchase-order-print.service';
import { PoPaymentModalComponent, PoPaymentModalOrder } from '../../../../inventory/pop/components/po-payment-modal/po-payment-modal.component';
import { PoTimelineComponent } from '../../../../inventory/pop/components/po-timeline/po-timeline.component';
// QUI-431: reusable bulk serial-load modal in `collect` mode (no API call).
import { SerialBulkLoadModalComponent } from '../../../../serial-numbers/components/serial-bulk-load-modal/serial-bulk-load-modal.component';
import { BulkBackfillItem } from '../../../../serial-numbers/services/serial-numbers.service';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';

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

/**
 * QUI-647 — fila del calendario de pagos acordado con el proveedor.
 * El payload del detalle (`findOne`) trae `payment_schedules` con estos
 * campos; `status` es un String VarChar(20) con valores documentados
 * `planned` (esperando CxP) y `materialized` (ya copiado a
 * `ap_payment_schedules`). Se mapean también 'paid'/'partial'/'overdue'/
 * 'canceled' defensivamente por si el motor de cobro los propaga.
 */
interface PoPaymentSchedule {
  id: number;
  scheduled_date: string;
  amount: number | string;
  status: string;
  materialized_at?: string | null;
}

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
 * aprobar, recibir (parciales + seriales; toda recepción genera una remisión de
 * entrada — dispatch_note inbound purchase_receipt), registrar pagos, adjuntos e
 * historial. La tabla de recepción se construye al cargar la OC (no depende de
 * `onOpenChange`, el bug del modal anterior).
 */
@Component({
  selector: 'app-store-purchase-order-detail',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
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
                <!--
                  CP-ID-VNDX-2026-08-18-PO-PROD — F2.S1: tarjeta de proveedor
                  con 8 campos del supplier (no solo el nombre). Backend ya
                  devuelve el supplier completo via include suppliers: true
                  en findOne; antes solo pintabamos name.
                -->
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
                      <!-- 8 fields: NIT, persona de contacto, email, teléfono,
                           móvil, dirección, banco, cuenta. -->
                      <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-secondary">
                        <div class="truncate">
                          <span class="font-medium">NIT:</span>
                          {{ p.supplier?.tax_id || p.suppliers?.tax_id || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Contacto:</span>
                          {{ p.supplier?.contact_person || p.suppliers?.contact_person || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Email:</span>
                          {{ p.supplier?.email || p.suppliers?.email || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Tel:</span>
                          {{ p.supplier?.phone || p.suppliers?.phone || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Móvil:</span>
                          {{ p.supplier?.mobile || p.suppliers?.mobile || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Dirección:</span>
                          {{ (p.supplier?.address?.address_line_1 || p.suppliers?.address?.address_line_1) || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Banco:</span>
                          {{ p.supplier?.bank_name || p.suppliers?.bank_name || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Cuenta:</span>
                          {{ p.supplier?.bank_account_number || p.suppliers?.bank_account_number || '—' }}
                        </div>
                      </div>
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
                      <!--
                        CP-ID-VNDX-2026-08-18-PO-PROD — Anotación 1+: el peso
                        visual del card "Recibir en" debe simetrizar con el
                        card del proveedor. Mostramos: código, tipo de bodega,
                        dirección, fecha de recepción esperada/recibida.
                      -->
                      <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-secondary">
                        <div class="truncate">
                          <span class="font-medium">Código:</span>
                          {{ p.location?.code || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Tipo:</span>
                          {{ p.location?.type || '—' }}
                        </div>
                        <div class="truncate col-span-2">
                          <span class="font-medium">Dirección:</span>
                          {{ getLocationAddress(p.location) || '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Esperada:</span>
                          {{ p.expected_date ? (p.expected_date | date: 'dd/MM/yyyy') : '—' }}
                        </div>
                        <div class="truncate">
                          <span class="font-medium">Recibida:</span>
                          {{ p.received_date ? (p.received_date | date: 'dd/MM/yyyy') : '—' }}
                        </div>
                      </div>
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
                  <div class="px-4 py-3 border-b border-border bg-surface-secondary flex items-center gap-2">
                    <h2 class="text-sm md:text-base font-semibold text-text-primary flex items-center gap-2">
                      <app-icon name="package-check" [size]="16" class="text-primary" />
                      Recibir mercancía
                    </h2>
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
                    @if (pendingReceiptId(); as pendingId) {
                      <p class="text-xs text-amber-600 flex items-start gap-1.5">
                        <app-icon name="alert-triangle" [size]="13" class="shrink-0 mt-0.5" />
                        <span>
                          Un intento anterior ya generó la remisión de entrada <strong>#{{ pendingId }}</strong> y falló al
                          {{ pendingReceiptStage() === 'receive' ? 'recibirla' : 'confirmarla' }}. El reintento continúa sobre
                          esa misma remisión (no se crea otra), por lo que usará las cantidades ya registradas en ella.
                        </span>
                      </p>
                    } @else {
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
                      <app-button variant="primary" (clicked)="confirmReception()" [disabled]="receiveSaving() || (!pendingReceiptId() && !hasItemsToReceive())" [loading]="receiveSaving()">
                        {{ pendingReceiptId() ? 'Reintentar remisión #' + pendingReceiptId() : 'Recibir por remisión' }}
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

              <!-- QUI-647 — Plan de pagos: calendario de cuotas + saldo pendiente -->
              <app-card>
                <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Plan de pagos</h2>
                @if (paymentSchedules().length === 0) {
                  <!-- Vacío: orden immediate (contado) o un plan sin cuotas explícitas -->
                  <div class="flex flex-col items-center py-6 text-center">
                    <div class="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center mb-2">
                      <app-icon name="calendar" [size]="20" />
                    </div>
                    <p class="text-sm font-medium text-text-secondary">{{ paymentPlanEmptyTitle() }}</p>
                    <p class="text-xs text-text-muted mt-1 max-w-[220px]">{{ paymentPlanEmptyHint() }}</p>
                  </div>
                } @else {
                  <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="text-left text-[11px] text-text-secondary uppercase tracking-wider border-b border-border">
                          <th class="py-2 w-8">#</th>
                          <th class="py-2">Fecha</th>
                          <th class="py-2 text-right w-24">Monto</th>
                          <th class="py-2 text-right w-24">Estado</th>
                          <th class="py-2 text-right w-16">Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (schedule of paymentSchedules(); track schedule.id; let i = $index) {
                          <tr class="border-b border-border/40">
                            <td class="py-2 text-text-muted">{{ i + 1 }}</td>
                            <td class="py-2 text-text-primary">{{ dateOnly(schedule.scheduled_date) }}</td>
                            <td class="py-2 text-right font-medium text-text-primary">{{ money(schedule.amount) }}</td>
                            <td class="py-2 text-right">
                              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
                                [class]="getPaymentScheduleStatusClass(schedule.status)">
                                {{ getPaymentScheduleStatusLabel(schedule.status) }}
                              </span>
                            </td>
                            <td class="py-2 text-right">
                              @if (schedule.status === 'planned') {
                                <button
                                  type="button"
                                  class="inline-flex items-center justify-center w-7 h-7 rounded-md text-primary hover:bg-primary/10 transition-colors"
                                  (click)="payInstallment(schedule)"
                                  [attr.aria-label]="'Pagar cuota ' + (i + 1)"
                                  [attr.title]="'Pagar esta cuota'"
                                  data-testid="po-pay-installment"
                                >
                                  <app-icon name="dollar-sign" [size]="14" />
                                </button>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                      <tfoot>
                        @if (downPayment() > 0) {
                          <tr class="border-b border-border/40">
                            <td [attr.colspan]="3" class="py-2 text-right text-xs text-text-muted">Abono inicial</td>
                            <td class="py-2 text-right text-sm text-text-secondary">{{ money(downPayment()) }}</td>
                          </tr>
                        }
                        <tr>
                          <td [attr.colspan]="3" class="py-2.5 text-right font-semibold text-text-primary">Saldo pendiente</td>
                          <td class="py-2.5 text-right font-bold" [class]="planPendingBalance() > 0 ? 'text-destructive' : 'text-success'">
                            {{ money(planPendingBalance()) }}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                }
              </app-card>

              <!-- Payment progress -->
              <app-card>
                <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Pagos</h2>
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

    <!-- QUI-647 — Modal unificado de pago (configura plan + registra pago) -->
    <app-po-payment-modal
      [isOpen]="showPaymentModal()"
      [order]="orderForPayment()"
      [view]="paymentModalView()"
      [presetAmount]="paymentModalPreset()?.amount ?? null"
      [presetDate]="paymentModalPreset()?.date ?? null"
      [presetScheduleId]="paymentModalPreset()?.paymentScheduleId ?? null"
      (close)="onPaymentModalClose()"
      (saved)="onPaymentSaved()"
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

  // Reception state — la recepción SIEMPRE genera una remisión de entrada
  // (dispatch_note inbound purchase_receipt). No hay recepción directa.
  readonly receiveLines = signal<ReceiveLine[]>([]);
  readonly receiveSaving = signal(false);
  receptionNotes = '';

  /**
   * Remisión de entrada YA creada por un intento que falló después del create
   * (en `confirm` o en `receive`). Sin esto, reintentar "Recibir por remisión"
   * creaba una SEGUNDA remisión para la misma mercancía y dejaba la primera
   * huérfana en `draft`/`confirmed`. Mientras esté seteada, el reintento
   * continúa sobre esa remisión desde la etapa que falló.
   */
  readonly pendingReceiptId = signal<number | null>(null);
  readonly pendingReceiptStage = signal<'confirm' | 'receive' | null>(null);
  /** Payload de la remisión creada (necesario para rearmar el body de seriales). */
  private readonly pendingReceiptNote = signal<any>(null);

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

  /**
   * Forma unificada que consume `app-po-payment-modal` (QUI-647 — single
   * `order` input). Combina `po()` con `totalPaid()` para entregar el
   * `paid_amount` que el modal necesita sin redefinir el tipo en el padre.
   */
  readonly orderForPayment = computed<PoPaymentModalOrder | null>(() => {
    const o = this.po();
    if (!o) return null;
    return {
      id: o.id,
      total_amount: o.total_amount ?? 0,
      paid_amount: this.totalPaid(),
      payment_plan: o.payment_plan ?? null,
      status: o.status ?? null,
    };
  });

  readonly remaining = computed(() =>
    Math.max(0, this.num(this.po()?.total_amount) - this.totalPaid()),
  );

  readonly paymentProgress = computed(() => {
    const total = this.num(this.po()?.total_amount);
    if (total <= 0) return 0;
    return Math.round((this.totalPaid() / total) * 100);
  });

  readonly cappedProgress = computed(() => Math.min(this.paymentProgress(), 100));

  // ============================================================
  // QUI-647 — Plan de pagos (calendario de cuotas de la OC)
  // Mismo patrón que po-detail-modal: el payload del `findOne` trae
  // `payment_schedules` (fechas, montos, estados) y el saldo pendiente se
  // deriva de los pagos reales (`payments()`), la misma fuente de `remaining()`.
  // ============================================================

  /** Cuotas del plan, ordenadas por fecha (el backend ya las ordena asc). */
  readonly paymentSchedules = computed<PoPaymentSchedule[]>(() => {
    const po = this.po() as (PurchaseOrder & { payment_schedules?: PoPaymentSchedule[] }) | null;
    return po?.payment_schedules ?? [];
  });

  /** Modo de pago acordado: immediate | partial | deferred | installments | null. */
  readonly paymentPlan = computed<string | null>(() => {
    const po = this.po() as (PurchaseOrder & { payment_plan?: string | null }) | null;
    return po?.payment_plan ?? null;
  });

  /** Abono inicial registrado al crear la orden (`down_payment_amount`). */
  readonly downPayment = computed<number>(() => {
    const po = this.po() as (PurchaseOrder & { down_payment_amount?: number | string | null }) | null;
    return Number(po?.down_payment_amount ?? 0) || 0;
  });

  /**
   * Saldo pendiente del plan = total de la orden − pagado real.
   * `remaining()` suma `payments()` (que incluye el abono inicial, source
   * 'po_advance'), así que contempla el anticipo — ídem po-detail-modal.
   */
  readonly planPendingBalance = computed(() => this.remaining());

  /** ¿Hay un plan de pagos que mostrar? `installments` con cuotas o un modo distinto de immediate/null. */
  readonly hasPaymentPlan = computed(() => {
    const plan = this.paymentPlan();
    if (plan && plan !== 'immediate') return true;
    return this.paymentSchedules().length > 0;
  });

  /** Título del vacío del plan según el modo de pago. */
  readonly paymentPlanEmptyTitle = computed(() => {
    const plan = this.paymentPlan();
    if (plan === 'immediate' || plan === null || !this.hasPaymentPlan()) {
      return 'Sin plan de pagos';
    }
    return 'Sin cuotas programadas';
  });

  /** Hint del vacío del plan según el modo de pago. */
  readonly paymentPlanEmptyHint = computed(() => {
    const plan = this.paymentPlan();
    if (plan === 'immediate' || plan === null || !this.hasPaymentPlan()) {
      return 'La orden se pagó al contado';
    }
    if (plan === 'partial') {
      return 'Se registró un abono inicial y el saldo se paga según las condiciones acordadas';
    }
    if (plan === 'deferred') {
      return 'El pago se realiza en la fecha de vencimiento indicada';
    }
    return 'El saldo se paga según las condiciones acordadas con el proveedor';
  });

  readonly receptionProgress = computed(() => {
    const items = this.orderItems();
    if (items.length === 0) return 0;
    const ordered = items.reduce((s, i) => s + this.getOrdered(i), 0);
    const received = items.reduce((s, i) => s + this.getReceived(i), 0);
    if (ordered <= 0) return 0;
    return Math.round((received / ordered) * 100);
  });

  // Espejo de `PurchaseOrdersService.VALID_TRANSITIONS`. El backend sigue siendo
  // la autoridad; esto solo evita ofrecer una acción que va a ser rechazada.
  //
  // Los estados reales son los cinco de `purchase_order_status_enum`:
  // draft | approved | partial | received | cancelled. Aquí se evaluaban además
  // `submitted` y `ordered`, que no existen en el enum y por tanto nunca se
  // cumplían — condiciones muertas que disfrazaban el gating real.
  readonly canApprove = computed(() => this.po()?.status === 'draft');

  readonly canReceive = computed(() => {
    const s = this.po()?.status;
    return s === 'approved' || s === 'partial';
  });

  // `partial` y `received` quedan fuera a propósito: con mercancía ya ingresada
  // la reversión es una devolución a proveedor, no una cancelación. El backend
  // responde PO_CANCEL_RECEIVED_001 y ofrecer el botón solo llevaba al error.
  readonly canCancel = computed(() => {
    const s = this.po()?.status;
    return s === 'draft' || s === 'approved';
  });

  readonly canRegisterPayment = computed(() => {
    const p = this.po();
    if (!p || p.status === 'cancelled') return false;
    return this.remaining() > 0;
  });

  /**
   * Vista inicial del modal unificado de pago.
   *  - 'pay'  → botón header "Pagar" o ícono "Pagar" de una cuota del plan.
   *  - 'plan' → botón header "Configurar pago".
   * Una vez abierto, el usuario puede alternar entre vistas con el toggle interno.
   */
  readonly paymentModalView = signal<'pay' | 'plan'>('pay');
  /**
   * Pre-relleno opcional desde el ícono "Pagar" de una cuota del plan.
   * `paymentScheduleId` se propaga al payload del POST /payments como
   * `payment_schedule_id` para que el backend marque esa fila de
   * `purchase_order_payment_schedules` como `paid` (QUI-647).
   */
  readonly paymentModalPreset = signal<{
    amount: number;
    date: string | null;
    paymentScheduleId: number | null;
  } | null>(null);

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
      // QUI-647 — un solo entry point en el header: "Pagar" (vista pago, OCR +
      // registro de pago inmediato). El modal dual tiene un toggle interno que
      // permite alternar a "Configurar plan" desde la misma vista, por lo que
      // el segundo botón del header era redundante.
      acts.push({ id: 'pay', label: 'Pagar', variant: 'primary', icon: 'dollar-sign', disabled: loading, visible: true });
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
          // `purchase_order_items.unit_cost` es Decimal(12,4) y guarda el neto
          // sin redondear (p. ej. 840.3361 con IVA 19% incluido). El destino
          // (`dispatch_note_items.unit_price`) es Decimal(12,2): se redondea
          // aquí para no enviar más decimales de los que la columna admite.
          unit_price: this.round2(item.unit_price ?? item.unit_cost),
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
    // Cada (re)carga de la OC abre un intento limpio: la remisión pendiente de
    // un intento anterior ya no aplica sobre estas líneas recalculadas.
    this.clearPendingReceipt();
  }

  private clearPendingReceipt(): void {
    this.pendingReceiptId.set(null);
    this.pendingReceiptStage.set(null);
    this.pendingReceiptNote.set(null);
  }

  // ============ Header actions ============
  onAction(id: string): void {
    switch (id) {
      case 'approve': void this.approve(); break;
      case 'receive': this.scrollToReception(); break;
      case 'pay':
        this.openPaymentModal('pay');
        break;
      case 'cancel': void this.cancel(); break;
      case 'print': this.print(); break;
    }
  }

  /**
   * Abre el modal unificado en la vista indicada, limpiando cualquier prefill
   * previo (los presets son por apertura, no por sesión).
   */
  private openPaymentModal(view: 'pay' | 'plan'): void {
    this.paymentModalView.set(view);
    this.paymentModalPreset.set(null);
    this.showPaymentModal.set(true);
  }

  /**
   * Ícono "Pagar" en cada fila de `paymentSchedules()` con `status='planned'`.
   * Abre el modal en vista `pay` con monto + fecha pre-llenados desde la cuota.
   * El usuario puede editar antes de submit.
   *
   * El backend devuelve `scheduled_date` como ISO datetime (`2026-08-18T00:00:00.000Z`)
   * pero el input[type=date] del modal exige `yyyy-MM-dd`. Cortamos a date-only
   * acá para que el modal no reciba un string que el input rechace en silencio
   * y termine mostrando el campo vacío.
   */
  payInstallment(schedule: PoPaymentSchedule): void {
    this.paymentModalView.set('pay');
    this.paymentModalPreset.set({
      amount: Number(schedule.amount),
      date: this.toDateOnly(schedule.scheduled_date),
      paymentScheduleId: schedule.id,
    });
    this.showPaymentModal.set(true);
  }

  /**
   * Normaliza cualquier ISO datetime / Date a `yyyy-MM-dd` (date-only).
   * Si ya es date-only (10 chars sin `T`), lo devuelve tal cual.
   */
  private toDateOnly(v?: string | null): string | null {
    if (!v) return null;
    if (typeof v !== 'string') return null;
    if (v.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return null;
  }

  /** Reset preset al cerrar el modal. */
  onPaymentModalClose(): void {
    this.showPaymentModal.set(false);
    this.paymentModalPreset.set(null);
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
      error: (err) => { this.actionLoading.set(false); this.toast.error(this._errorText(err, 'No se pudo aprobar la orden.')); },
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
      error: (err) => { this.actionLoading.set(false); this.toast.error(this._errorText(err, 'No se pudo cancelar la orden.')); },
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

    // Reintento sobre una remisión ya creada: las cantidades viven en ella, no
    // en la tabla. Validar contra `receive_quantity` bloquearía el reintento.
    if (this.pendingReceiptId()) {
      this.receiveViaDispatchNote(po, this.receiveLines().filter((l) => l.receive_quantity > 0));
      return;
    }

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

    // Toda recepción genera una remisión de entrada (inbound purchase_receipt).
    this.receiveViaDispatchNote(po, lines);
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

    // La cadena no tiene compensación: si `confirm` o `receive` fallan, la
    // remisión ya existe. En vez de dejarla huérfana y crear otra al reintentar,
    // memorizamos su id + la etapa que falló y reanudamos desde ahí.
    const pendingId = this.pendingReceiptId();
    const resumeStage = this.pendingReceiptStage();

    const note$: Observable<any> = pendingId
      ? of(this.pendingReceiptNote())
      : this.dispatchNotesService.createPurchaseReceipt(dto).pipe(
          tap((dn) => {
            this.pendingReceiptId.set(dn.id);
            this.pendingReceiptNote.set(dn);
          }),
        );

    note$.pipe(
      switchMap((dn) => {
        // `confirm` ya se aplicó en un intento previo → no repetirlo.
        if (resumeStage === 'receive') return of(dn);
        this.pendingReceiptStage.set('confirm');
        const confirmBody = this.buildConfirmSerialsBody(dn, lines, serialsByLine);
        return this.dispatchNotesService.confirm(dn.id, confirmBody).pipe(map(() => dn));
      }),
      switchMap((dn) => {
        this.pendingReceiptStage.set('receive');
        return this.dispatchNotesService.receive(dn.id);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: () => this.onReceptionSuccess(),
      error: (err) => {
        this.receiveSaving.set(false);
        const message = typeof err === 'string' ? err : (extractApiError(err).message || 'Error al recibir por remisión');
        const noteId = this.pendingReceiptId();
        this.toast.error(noteId ? `Remisión #${noteId}: ${message}` : message);
      },
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
    this.clearPendingReceipt();
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
  /**
   * QUI-647 — el modal unificado emite `saved` tanto si solo configuró el plan
   * de pago como si además registró un pago. En ambos casos hay que releer la
   * OC completa (estado, plan y pagos vienen del mismo `findOne`).
   */
  onPaymentSaved(): void {
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
      error: (err) => { this.uploading.set(false); this.toast.error(this._errorText(err, 'Error al subir archivo')); },
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
      error: (err) => this.toast.error(this._errorText(err, 'Error al eliminar')),
    });
  }

  /**
   * `PurchaseOrdersService` dejó de aplastar el error a string: ahora propaga
   * el `HttpErrorResponse` crudo, con `error_code` y status. El guard
   * `typeof err === 'string'` que había aquí pasó a ser siempre falso, así que
   * cada fallo mostraba el texto de reserva y el motivo real del backend
   * quedaba únicamente en consola. Se conserva la rama de string por si algún
   * consumidor legado todavía rechaza con uno.
   */
  private _errorText(err: unknown, fallback: string): string {
    if (typeof err === 'string' && err.trim()) return err;
    return extractApiErrorMessage(err) || fallback;
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
  /**
   * `num()` con redondeo a 2 decimales, para valores que viajan a una columna
   * `Decimal(x,2)`. Deliberadamente NO se redondea dentro de `num()`: ese helper
   * también alimenta aritmética de visualización (`cantidad × costo` en la tabla
   * de productos), donde el costo de origen es Decimal(12,4) y truncarlo antes
   * de multiplicar desviaría el subtotal mostrado respecto al del backend.
   */
  round2(v: number | string | null | undefined): number {
    return Math.round(this.num(v) * 100) / 100;
  }
  money(v: number | string | null | undefined): string {
    return this.currency.format(this.num(v));
  }
  dateOnly(v?: string | null): string {
    return v ? formatDateOnlyUTC(v) : '—';
  }
  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — Anotación 1+: dirección legible de la
   * bodega. Devuelve `address_line_1 + city + state` o null si no hay.
   */
  getLocationAddress(loc?: any): string | null {
    if (!loc?.address) return null;
    const a = loc.address;
    const parts = [a.address_line_1, a.city?.name || a.city, a.state?.name || a.state].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
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

  // ============================================================
  // QUI-647 — Plan de pagos: estado de cada cuota
  // ============================================================
  getPaymentScheduleStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      planned: 'Programada',
      materialized: 'En cobro',
      paid: 'Pagada',
      partial: 'Parcial',
      overdue: 'Vencida',
      canceled: 'Cancelada',
    };
    return labels[status] || (status || '—');
  }

  getPaymentScheduleStatusClass(status: string): string {
    const map: Record<string, string> = {
      planned: 'bg-blue-100 text-blue-700',
      materialized: 'bg-primary/10 text-primary',
      paid: 'bg-green-100 text-green-700',
      partial: 'bg-amber-100 text-amber-700',
      overdue: 'bg-red-100 text-red-700',
      canceled: 'bg-muted/40 text-text-secondary',
    };
    return map[status] || 'bg-muted/40 text-text-secondary';
  }
  userName(user: { first_name?: string | null; last_name?: string | null; username?: string | null; user_name?: string | null } | null | undefined): string {
    if (!user) return 'Sistema';
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return name || user.username || user.user_name || 'Sistema';
  }
}
