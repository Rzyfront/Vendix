import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

import { StockTransfer, StockTransferItem, TransferStatus, CompleteTransferItem } from '../interfaces';

@Component({
  selector: 'app-transfer-detail-modal',
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
      [title]="transfer?.transfer_number || 'Detalle'"
      [subtitle]="getStatusLabel(transfer?.status)"
      size="md"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (transfer) {
        <!-- Status Badge -->
        <div class="mb-4">
          <span
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
            [class]="getStatusClasses(transfer.status)"
          >
            <app-icon [name]="getStatusIcon(transfer.status)" [size]="14" class="mr-1.5"></app-icon>
            {{ getStatusLabel(transfer.status) }}
          </span>
        </div>

        <!-- Locations -->
        <div class="p-4 bg-surface-secondary rounded-xl border border-border mb-4">
          <div class="flex items-center gap-4">
            <div class="flex-1">
              <p class="text-xs text-text-secondary mb-1">Origen</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-error"></app-icon>
                <p class="text-sm font-semibold text-text-primary">{{ transfer.from_location.name || '-' }}</p>
              </div>
            </div>
            <app-icon name="arrow-right" [size]="20" class="text-text-secondary"></app-icon>
            <div class="flex-1">
              <p class="text-xs text-text-secondary mb-1">Destino</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-success"></app-icon>
                <p class="text-sm font-semibold text-text-primary">{{ transfer.to_location.name || '-' }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline -->
        <div class="p-4 bg-surface-secondary rounded-xl border border-border mb-4">
          <h4 class="text-sm font-medium text-text-secondary mb-3">Cronología</h4>
          <div class="space-y-2">
            <div class="flex items-center gap-3 text-sm">
              <div class="w-2 h-2 rounded-full bg-primary"></div>
              <span class="text-text-secondary w-24">Creada</span>
              <span class="text-text-primary font-medium">
                {{ transfer.transfer_date | date:'dd/MM/yyyy HH:mm' }}
              </span>
            </div>
            @if (transfer.approved_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                <span class="text-text-secondary w-24">Aprobada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer.approved_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer.completed_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span class="text-text-secondary w-24">Completada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer.completed_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer.cancelled_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-gray-400"></div>
                <span class="text-text-secondary w-24">Cancelada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer.cancelled_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer.expected_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-amber-400"></div>
                <span class="text-text-secondary w-24">Esperada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer.expected_date | date:'dd/MM/yyyy' }}
                </span>
              </div>
            }
          </div>
        </div>

        @if (transfer.notes) {
          <div class="p-3 bg-surface-secondary rounded-xl border border-border mb-4">
            <p class="text-xs text-text-secondary mb-1">Notas</p>
            <p class="text-sm text-text-primary">{{ transfer.notes }}</p>
          </div>
        }

        <!-- Items Table -->
        <div class="mb-4">
          <h4 class="text-sm font-medium text-text-secondary mb-3">
            Productos ({{ transfer.stock_transfer_items.length || 0 }})
          </h4>
          <div class="border border-border rounded-xl overflow-hidden">
            <!-- Header -->
            <div class="grid grid-cols-12 gap-2 p-3 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border">
              <div class="col-span-5">Producto</div>
              <div class="col-span-2 text-right">Solicitado</div>
              <div class="col-span-3 text-right">
                {{ isCompleting ? 'Recibido' : 'Recibido' }}
              </div>
              <div class="col-span-2 text-right">Estado</div>
            </div>

            <!-- Items -->
            @for (item of transfer.stock_transfer_items; track item.id; let i = $index) {
              <div class="grid grid-cols-12 gap-2 p-3 items-center border-b border-border last:border-b-0"
                [class.bg-primary/5]="isCompleting">
                <div class="col-span-5">
                  <p class="text-sm font-medium text-text-primary">
                    {{ item.products.name || 'Producto' }}
                  </p>
                  @if (item.product_variants?.name) {
                    <p class="text-xs text-text-secondary">{{ item.product_variants?.name }}</p>
                  }
                </div>
                <div class="col-span-2 text-right text-sm font-medium text-text-primary">
                  {{ item.quantity }}
                </div>
                <div class="col-span-3 text-right">
                  @if (isCompleting) {
                    <input
                      type="number"
                      [min]="0"
                      [max]="item.quantity"
                      [value]="getReceivedQuantity(item.id)"
                      (input)="updateReceivedQuantity(item.id, $event)"
                      class="w-20 px-2 py-1 text-sm text-right border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  } @else {
                    <span class="text-sm text-text-primary">{{ item.quantity_received ?? '-' }}</span>
                  }
                </div>
                <div class="col-span-2 text-right">
                  @if (item.quantity_received !== undefined && item.quantity_received !== null) {
                    @if (item.quantity_received >= item.quantity) {
                      <span class="text-xs text-success font-medium">Completo</span>
                    } @else if (item.quantity_received > 0) {
                      <span class="text-xs text-warning font-medium">Parcial</span>
                    } @else {
                      <span class="text-xs text-text-secondary">Pendiente</span>
                    }
                  } @else {
                    <span class="text-xs text-text-secondary">-</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        @if (confirmingReception) {
          <div class="p-3 mt-4 bg-warning/10 rounded-xl border border-warning/30 flex items-start gap-2">
            <app-icon name="alert-triangle" [size]="18" class="text-warning mt-0.5 shrink-0"></app-icon>
            <div>
              <p class="text-sm font-medium text-text-primary">Estas seguro?</p>
              <p class="text-xs text-text-secondary mt-0.5">
                Esta accion aplicara los movimientos de inventario: se restara stock de la
                ubicacion de origen y se sumara en la ubicacion de destino. Esta accion no se puede deshacer.
              </p>
            </div>
          </div>
        }
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-between gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <div>
          @if (isCompleting) {
            <app-button variant="outline" (clicked)="isCompleting = false; confirmingReception = false" customClasses="!rounded-xl">
              Cancelar Recepción
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" (clicked)="onClose()" customClasses="!rounded-xl font-bold">
            Cerrar
          </app-button>

          @if (transfer?.status === 'draft') {
            <app-button variant="primary" (clicked)="approveTransfer.emit(transfer!)" customClasses="!rounded-xl font-bold">
              <app-icon name="check" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Aprobar
            </app-button>
          }

          @if (transfer?.status === 'in_transit' && !isCompleting) {
            <app-button variant="primary" (clicked)="startCompleting()" customClasses="!rounded-xl font-bold">
              <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Recibir
            </app-button>
          }

          @if (isCompleting && !confirmingReception) {
            <app-button
              variant="primary"
              (clicked)="confirmingReception = true"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Confirmar Recepcion
            </app-button>
          }

          @if (confirmingReception) {
            <app-button
              variant="primary"
              (clicked)="onComplete()"
              [loading]="isProcessing"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
            >
              <app-icon name="alert-triangle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Si, Aplicar Movimientos
            </app-button>
          }

          @if (transfer?.status === 'draft' || transfer?.status === 'in_transit') {
            @if (!isCompleting) {
              <app-button variant="outline" (clicked)="cancelTransfer.emit(transfer!)" customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5">
                <app-icon name="x-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
                Cancelar
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class TransferDetailModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() transfer: StockTransfer | null = null;
  @Input() isProcessing = false;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();
  @Output() approveTransfer = new EventEmitter<StockTransfer>();
  @Output() cancelTransfer = new EventEmitter<StockTransfer>();
  @Output() completeTransfer = new EventEmitter<CompleteTransferItem[]>();

  isCompleting = false;
  confirmingReception = false;
  receivedQuantities: Map<number, number> = new Map();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.isCompleting = false;
      this.confirmingReception = false;
      this.receivedQuantities.clear();
    }
  }

  startCompleting(): void {
    this.isCompleting = true;
    if (this.transfer?.stock_transfer_items) {
      for (const item of this.transfer.stock_transfer_items) {
        this.receivedQuantities.set(item.id, item.quantity);
      }
    }
  }

  getReceivedQuantity(itemId: number): number {
    return this.receivedQuantities.get(itemId) ?? 0;
  }

  updateReceivedQuantity(itemId: number, event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.receivedQuantities.set(itemId, Math.max(0, value));
  }

  onComplete(): void {
    const items: CompleteTransferItem[] = [];
    this.receivedQuantities.forEach((quantity_received, id) => {
      items.push({ id, quantity_received });
    });
    this.completeTransfer.emit(items);
  }

  onClose(): void {
    this.isCompleting = false;
    this.closed.emit();
  }

  getStatusLabel(status?: TransferStatus): string {
    if (!status) return '';
    const labels: Record<TransferStatus, string> = {
      draft: 'Borrador',
      in_transit: 'En Tránsito',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getStatusClasses(status: TransferStatus): string {
    const map: Record<TransferStatus, string> = {
      draft: 'bg-gray-100 text-gray-700',
      in_transit: 'bg-blue-100 text-blue-700',
      completed: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-gray-100 text-gray-500',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }

  getStatusIcon(status: TransferStatus): string {
    const map: Record<TransferStatus, string> = {
      draft: 'file-text',
      in_transit: 'truck',
      completed: 'check-circle',
      cancelled: 'x-circle',
    };
    return map[status] || 'info';
  }
}
