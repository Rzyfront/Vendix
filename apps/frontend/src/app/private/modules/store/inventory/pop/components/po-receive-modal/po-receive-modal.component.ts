import {Component, inject, input, output, signal, computed, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService } from '../../../services';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { PurchaseOrder, PurchaseOrderItem, ReceivePurchaseOrderItemDto } from '../../../interfaces';
// QUI-431: reusable bulk serial-load modal in `collect` mode (no API call).
import { SerialBulkLoadModalComponent } from '../../../../serial-numbers/components/serial-bulk-load-modal/serial-bulk-load-modal.component';
import { BulkBackfillItem } from '../../../../serial-numbers/services/serial-numbers.service';

interface ReceiveLineItem {
  id: number;
  product_name: string;
  sku: string;
  quantity_ordered: number;
  quantity_received: number;
  pending: number;
  receive_quantity: number;
  // ===== UoM display (Fase UoM) =====
  // The receive_quantity is in the PURCHASE unit (the unit the operator
  // sees on the PO line, e.g. L, kg, saco). The minimum stock unit
  // (ml, g) and the factor are shown as informational hints only — the
  // backend is the single place that multiplies by the factor to record
  // stock in the minimum unit. See purchase-orders.service.ts ->
  // resolveUoMConversion.
  stock_unit?: string | null;
  purchase_unit?: string | null;
  purchase_to_stock_factor?: number | null;
  // ===== QUI-431: serial capture =====
  // requires_serial: product is serialized → operator may capture real
  // serial numbers for this line. The backend auto-generates placeholders
  // for any missing serials, so capture is optional (soft warning only).
  requires_serial: boolean;
  product_id: number;
  product_variant_id: number | null;
}

@Component({
  selector: 'app-po-receive-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent, SerialBulkLoadModalComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onOpenChange($event)"
      title="Recibir Mercancia"
      size="lg"
    >
      <!-- Items Table -->
      <div class="overflow-x-auto -mx-2">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border text-left text-xs text-text-secondary uppercase tracking-wider">
              <th class="py-2.5 px-3">Producto</th>
              <th class="py-2.5 px-3 text-center hidden sm:table-cell">Pedido</th>
              <th class="py-2.5 px-3 text-center hidden sm:table-cell">Recibido</th>
              <th class="py-2.5 px-3 text-center">Pendiente</th>
              <th class="py-2.5 px-3 text-center">Recibir</th>
            </tr>
          </thead>
          <tbody>
            @for (item of items(); track item.id) {
              <tr class="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td class="py-2.5 px-3">
                  <div class="font-medium text-text-primary text-sm">{{ item.product_name }}</div>
                  <div class="text-xs text-text-secondary">{{ item.sku }}</div>
                </td>
                <td class="py-2.5 px-3 text-center hidden sm:table-cell text-text-secondary">
                  {{ item.quantity_ordered }}
                </td>
                <td class="py-2.5 px-3 text-center hidden sm:table-cell text-text-secondary">
                  {{ item.quantity_received }}
                </td>
                <td class="py-2.5 px-3 text-center">
                  <span
                    class="font-medium"
                    [class.text-amber-500]="item.pending > 0"
                    [class.text-text-secondary]="item.pending === 0"
                  >{{ item.pending }}</span>
                </td>
                <td class="py-2.5 px-3 text-center">
                  @if (item.pending > 0) {
                    <div class="flex flex-col items-center gap-0.5">
                      <input
                        type="number"
                        [min]="0"
                        [max]="item.pending"
                        class="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        [(ngModel)]="item.receive_quantity"
                      >
                      <!-- UoM hint (Fase UoM) — display only. The backend is
                           the single place that converts to minimum stock
                           unit using purchase_to_stock_factor. -->
                      @if (item.purchase_to_stock_factor && item.purchase_to_stock_factor > 1) {
                        <span class="text-[10px] text-gray-500">
                          {{ item.purchase_unit }} × {{ item.purchase_to_stock_factor }}
                          = {{ (item.receive_quantity || 0) * (item.purchase_to_stock_factor || 0) }}
                          {{ item.stock_unit }}
                        </span>
                      } @else if (item.purchase_unit) {
                        <span class="text-[10px] text-gray-500">{{ item.purchase_unit }}</span>
                      }

                      <!-- QUI-431: serial capture (serialized products only).
                           Soft validation: capturing fewer serials than the
                           received quantity is allowed (backend fills the rest
                           with placeholders); we show a warning badge. -->
                      @if (item.requires_serial && item.receive_quantity > 0) {
                        <button
                          type="button"
                          class="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                          (click)="openSerialCapture(item)"
                        >
                          <app-icon name="barcode" [size]="12"></app-icon>
                          Capturar seriales
                        </button>
                        @if (serialCountFor(item.id) > 0) {
                          <span
                            class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted"
                            [class.text-success]="serialCountFor(item.id) >= item.receive_quantity"
                            [class.text-amber-600]="serialCountFor(item.id) < item.receive_quantity"
                          >
                            {{ serialCountFor(item.id) }}/{{ item.receive_quantity }} seriales
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

      <!-- Notes -->
      <div class="mt-4">
        <label class="text-sm font-medium text-text-secondary block mb-1.5">Notas de recepcion</label>
        <textarea
          class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          rows="2"
          placeholder="Notas opcionales sobre esta recepcion..."
          [(ngModel)]="notes"
        ></textarea>
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex flex-col sm:flex-row gap-2 sm:justify-between">
        <app-button
          variant="outline"
          size="sm"
          (clicked)="receiveAll()"
          [disabled]="saving() || !hasPendingItems()"
        >
          <app-icon name="check-check" [size]="14" slot="icon" ></app-icon>
          Recibir Todo
        </app-button>
        <div class="flex gap-2 justify-end">
          <app-button variant="outline" (clicked)="onOpenChange(false)">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="confirm()"
            [disabled]="saving() || !hasItemsToReceive()"
            [loading]="saving()"
          >
            Confirmar Recepcion
          </app-button>
        </div>
      </div>
    </app-modal>

    <!-- QUI-431: serial capture modal (collect mode — parses textarea/CSV and
         emits the parsed serials; no API call). Reused per line on demand. -->
    <app-serial-bulk-load-modal
      [isOpen]="serialModalOpen()"
      mode="collect"
      [productId]="serialModalProductId()"
      [productVariantId]="serialModalVariantId()"
      [maxCount]="serialModalMaxCount()"
      (isOpenChange)="onSerialModalOpenChange($event)"
      (collected)="onSerialsCollected($event)"
    ></app-serial-bulk-load-modal>
  `,
  styles: [`
    :host { display: block; }
    /* Chrome, Safari, Edge, Opera */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    /* Firefox */
    input[type=number] {
      -moz-appearance: textfield;
    }
  `],
})
export class PoReceiveModalComponent {
  private destroyRef = inject(DestroyRef);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly order = input<PurchaseOrder | null>(null);

  readonly close = output<void>();
  readonly received = output<void>();

  readonly items = signal<ReceiveLineItem[]>([]);
  readonly saving = signal(false);
  notes = '';

  // ===== QUI-431: serial capture state =====
  /** Captured serial numbers per PO line id (collect mode of the bulk modal). */
  readonly serialsByLine = signal<Map<number, string[]>>(new Map());
  /** Bulk-load modal visibility + context for the line currently capturing. */
  readonly serialModalOpen = signal(false);
  readonly serialModalProductId = signal<number | null>(null);
  readonly serialModalVariantId = signal<number | null>(null);
  readonly serialModalMaxCount = signal<number | null>(null);
  /** Line id currently bound to the open serial-capture modal. */
  private serialModalLineId: number | null = null;

  constructor() {
    // Use effect-like pattern via input changes
  }

  /** Count of serials captured for a given PO line (template helper). */
  serialCountFor(lineId: number): number {
    return this.serialsByLine().get(lineId)?.length ?? 0;
  }

  /** Open the reusable bulk-load modal in collect mode for one serialized line. */
  openSerialCapture(item: ReceiveLineItem): void {
    this.serialModalLineId = item.id;
    this.serialModalProductId.set(item.product_id || null);
    this.serialModalVariantId.set(item.product_variant_id);
    this.serialModalMaxCount.set(item.receive_quantity || null);
    this.serialModalOpen.set(true);
  }

  /** Bulk modal chrome open/close → keep our visibility signal in sync. */
  onSerialModalOpenChange(open: boolean): void {
    this.serialModalOpen.set(open);
    if (!open) {
      this.serialModalLineId = null;
    }
  }

  /** collect mode emits the parsed items; persist just the serial strings. */
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

  onOpenChange(value: boolean): void {
    if (value) {
      this.buildItems();
    } else {
      this.close.emit();
    }
  }

  buildItems(): void {
    const po = this.order();
    if (!po) return;

    const orderItems = po.purchase_order_items || po.items || [];
    this.items.set(
      orderItems.map((item: PurchaseOrderItem) => {
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
          // Display hints for the UoM section in the receive row.
          stock_unit: product?.stock_unit ?? null,
          purchase_unit: product?.purchase_unit ?? null,
          purchase_to_stock_factor: product?.purchase_to_stock_factor ?? null,
          // QUI-431: serial capture metadata.
          requires_serial: !!product?.requires_serial_numbers,
          product_id: item.product_id ?? product?.id ?? 0,
          product_variant_id: item.product_variant_id ?? item.product_variants?.id ?? null,
        };
      })
    );
    this.notes = '';
    // Reset any serials captured for a previous PO.
    this.serialsByLine.set(new Map());
  }

  hasPendingItems(): boolean {
    return this.items().some(i => i.pending > 0);
  }

  hasItemsToReceive(): boolean {
    return this.items().some(i => i.receive_quantity > 0);
  }

  receiveAll(): void {
    this.items.update(items =>
      items.map(item => ({
        ...item,
        receive_quantity: item.pending,
      }))
    );
  }

  confirm(): void {
    const serialsByLine = this.serialsByLine();
    const itemsToReceive: ReceivePurchaseOrderItemDto[] = this.items()
      .filter(i => i.receive_quantity > 0)
      .map(i => {
        const dto: ReceivePurchaseOrderItemDto = {
          id: i.id,
          quantity_received: Math.min(i.receive_quantity, i.pending),
        };
        // QUI-431: only attach serials for serialized lines that captured any.
        // Cap to quantity_received; backend auto-generates the remainder.
        if (i.requires_serial) {
          const serials = serialsByLine.get(i.id);
          if (serials && serials.length > 0) {
            dto.serial_numbers = serials.slice(0, dto.quantity_received);
          }
        }
        return dto;
      });

    if (itemsToReceive.length === 0) {
      this.toastService.warning('Ingresa al menos una cantidad a recibir');
      return;
    }

    // Validate quantities
    const invalidItem = this.items().find(i => i.receive_quantity > i.pending);
    if (invalidItem) {
      this.toastService.warning(`La cantidad a recibir de "${invalidItem.product_name}" excede el pendiente`);
      return;
    }

    const po = this.order();
    if (!po) return;

    this.saving.set(true);
    const notes = this.notes.trim() || undefined;

    this.purchaseOrdersService.receivePurchaseOrder(po.id, itemsToReceive, notes).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success('Mercancia recibida correctamente');
        this.received.emit();
        this.close.emit();
      },
      error: (err: string) => {
        this.saving.set(false);
        this.toastService.error(err || 'Error al recibir mercancia');
      },
    });
  }
}
