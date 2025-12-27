import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

// Interfaces
import { PurchaseOrder, PurchaseOrderItem, ReceivePurchaseOrderItemDto } from '../../../inventory/interfaces';

@Component({
  selector: 'app-purchase-order-detail-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="'Orden ' + (order?.order_number || '')"
      size="lg"
      size="lg"
      (closed)="onClose()"
    >
      <div *ngIf="order" class="space-y-6">
        <!-- Header Info -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/10 rounded-lg">
          <div>
            <span class="text-xs text-text-secondary block">Proveedor</span>
            <span class="font-medium">{{ order.suppliers?.name || order.supplier?.name || '-' }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Fecha de Orden</span>
            <span class="font-medium">{{ formatDate(order.order_date) }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Fecha Esperada</span>
            <span class="font-medium">{{ formatDate(order.expected_date) }}</span>
          </div>
          <div>
            <span class="text-xs text-text-secondary block">Estado</span>
            <span [class]="getStatusClasses(order.status)">{{ getStatusLabel(order.status) }}</span>
          </div>
        </div>

        <!-- Items Table -->
        <div>
          <h4 class="text-sm font-semibold text-text-primary mb-3">Productos</h4>
          <div class="border border-border rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-muted/20">
                <tr>
                  <th class="px-4 py-2 text-left font-medium text-text-secondary">Producto</th>
                  <th class="px-4 py-2 text-center font-medium text-text-secondary">Ordenado</th>
                  <th class="px-4 py-2 text-center font-medium text-text-secondary">Recibido</th>
                  <th class="px-4 py-2 text-right font-medium text-text-secondary">Precio</th>
                  <th class="px-4 py-2 text-right font-medium text-text-secondary">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of (order.purchase_order_items || order.items); let i = index" class="border-t border-border">
                  <td class="px-4 py-3">{{ item.products?.name || item.product?.name || 'Producto #' + item.product_id }}</td>
                  <td class="px-4 py-3 text-center">{{ item.quantity_ordered || item.quantity }}</td>
                  <td class="px-4 py-3 text-center">{{ item.quantity_received || 0 }}</td>
                  <td class="px-4 py-3 text-right">{{ formatCurrency(item.unit_cost || item.unit_price) }}</td>
                  <td class="px-4 py-3 text-right">{{ formatCurrency((item.quantity_ordered || item.quantity) * (item.unit_cost || item.unit_price)) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Totals -->
        <div class="flex justify-end">
          <div class="w-64 space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-text-secondary">Subtotal:</span>
              <span>{{ formatCurrency(order.subtotal_amount || 0) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-text-secondary">Envío:</span>
              <span>{{ formatCurrency(order.shipping_cost || 0) }}</span>
            </div>
            <div class="flex justify-between font-semibold text-base border-t border-border pt-2">
              <span>Total:</span>
              <span class="text-primary">{{ formatCurrency(order.total_amount || 0) }}</span>
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div *ngIf="order.notes" class="p-3 bg-muted/10 rounded-lg">
          <span class="text-xs text-text-secondary block mb-1">Notas:</span>
          <p class="text-sm">{{ order.notes }}</p>
        </div>

      </div>

      <!-- Footer Actions -->
      <div slot="footer" class="flex justify-between gap-3 w-full">
        <div>
          <app-button
            *ngIf="canCancel"
            variant="danger"
            (clicked)="onCancelOrder()"
          >
            <app-icon name="x-circle" [size]="16" class="mr-2"></app-icon>
            Cancelar Orden
          </app-button>
        </div>
        <div class="flex gap-3">
          <app-button variant="secondary" (clicked)="onClose()">
            Cerrar
          </app-button>
          <app-button
            *ngIf="canEdit"
            variant="outline"
            (clicked)="onEditOrder()"
          >
            <app-icon name="edit" [size]="16" class="mr-2"></app-icon>
            Editar Orden
          </app-button>
          <app-button
            *ngIf="canReceive"
            variant="primary"
            (clicked)="startReceiving()"
          >
            <app-icon name="package" [size]="16" class="mr-2"></app-icon>
            Recibir Todo
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class PurchaseOrderDetailModalComponent {
  @Input() isOpen = false;
  @Input() order: PurchaseOrder | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() receive = new EventEmitter<{ order_id: number; items: ReceivePurchaseOrderItemDto[] }>();
  @Output() cancel = new EventEmitter<number>();
  @Output() edit = new EventEmitter<PurchaseOrder>();

  is_receiving_mode = false;
  receive_quantities: number[] = [];

  get canEdit(): boolean {
    return !!this.order && this.order.status === 'draft';
  }

  get canReceive(): boolean {
    // Added 'approved' status
    return !!this.order && ['approved', 'ordered', 'partial'].includes(this.order.status);
  }

  get canCancel(): boolean {
    return !!this.order && ['draft', 'submitted', 'approved', 'ordered'].includes(this.order.status);
  }

  startReceiving(): void {
    const items = this.order?.purchase_order_items || this.order?.items; // Support both
    if (items) {
      // One-click receive: assume receiving all remaining quantities
      const itemsToReceive: ReceivePurchaseOrderItemDto[] = items
        .map((item: any) => ({
          id: item.id!,
          quantity_received: (item.quantity_ordered || item.quantity) - (item.quantity_received || 0)
        }))
        .filter((item) => item.quantity_received > 0);

      if (itemsToReceive.length > 0) {
        // Emit immediately without entering edit mode
        this.receive.emit({ order_id: this.order!.id, items: itemsToReceive });
      }
    }
  }

  // Legacy method kept if needed or removed if unused
  confirmReceive(): void {
    // Logic moved to startReceiving for quick receive
  }

  onCancelOrder(): void {
    if (this.order) {
      this.cancel.emit(this.order.id);
    }
  }

  onEditOrder(): void {
    if (this.order) {
      this.edit.emit(this.order);
    }
  }

  onClose(): void {
    this.is_receiving_mode = false;
    this.receive_quantities = [];
    this.close.emit();
  }

  formatDate(date: string | undefined): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-CO');
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value || 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      submitted: 'Enviada',
      approved: 'Aprobada',
      ordered: 'Ordenada',
      partial: 'Parcial',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getStatusClasses(status: string): string {
    const base = 'px-2 py-0.5 text-xs font-medium rounded-full';
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      submitted: 'bg-blue-100 text-blue-700',
      approved: 'bg-green-100 text-green-700',
      ordered: 'bg-amber-100 text-amber-700',
      partial: 'bg-purple-100 text-purple-700',
      received: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-red-100 text-red-700',
    };
    return `${base} ${colors[status] || 'bg-gray-100 text-gray-700'}`;
  }
}
