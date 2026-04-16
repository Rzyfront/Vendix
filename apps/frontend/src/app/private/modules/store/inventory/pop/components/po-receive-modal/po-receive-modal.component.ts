import {
  Component,
  inject,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PurchaseOrdersService } from '../../../services';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { PurchaseOrder, PurchaseOrderItem } from '../../../interfaces';

interface ReceiveLineItem {
  id: number;
  product_name: string;
  sku: string;
  quantity_ordered: number;
  quantity_received: number;
  pending: number;
  receive_quantity: number;
}

@Component({
  selector: 'app-po-receive-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
                    <input
                      type="number"
                      [min]="0"
                      [max]="item.pending"
                      class="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      [(ngModel)]="item.receive_quantity"
                    >
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
          <app-icon name="check-check" [size]="14" slot="icon"></app-icon>
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
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly order = input<PurchaseOrder | null>(null);

  readonly close = output<void>();
  readonly received = output<void>();

  readonly items = signal<ReceiveLineItem[]>([]);
  readonly saving = signal(false);
  notes = '';

  constructor() {
    // Use effect-like pattern via input changes
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
        };
      })
    );
    this.notes = '';
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
    const itemsToReceive = this.items()
      .filter(i => i.receive_quantity > 0)
      .map(i => ({
        id: i.id,
        quantity_received: Math.min(i.receive_quantity, i.pending),
      }));

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

    this.purchaseOrdersService.receivePurchaseOrder(po.id, itemsToReceive, notes).subscribe({
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
