import {
  Component,
  computed,
  inject,
  input,
  output,
  effect,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { activeStoreId } from '../../../../../../core/utils/store-scoped-cache';

import { StockTransfer, StockTransferItem, TransferStatus, CompleteTransferItem } from '../interfaces';
import {
  TransferFlowPanelComponent,
  type TransferCloseWithLossRequest,
  type TransferDispatchRequest,
} from '../advanced/transfer-flow-panel.component';
import {
  TransferFlowNote,
  TransferFlowView,
  isAdvancedTransfer,
  isNeverDispatched,
  receiptStoreBlock,
} from '../advanced/transfer-advanced';

@Component({
  selector: 'app-transfer-detail-modal',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    TransferFlowPanelComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="transfer()?.transfer_number || 'Detalle'"
      [subtitle]="statusLabel()"
      size="lg"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (transfer()) {
        <!-- Status Badge -->
        <div class="mb-4">
          <span
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
            [class]="getStatusClasses(transfer()!.status)"
          >
            <app-icon [name]="getStatusIcon(transfer()!.status)" [size]="14" class="mr-1.5"></app-icon>
            {{ statusLabel() }}
          </span>
          @if (transfer()!.no_support_alert) {
            <span
              class="ml-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700"
              data-testid="detail-alert-badge"
            >
              <app-icon name="alert-triangle" [size]="14" class="mr-1.5"></app-icon>
              Con alerta
            </span>
          }
        </div>

        <!-- Locations -->
        <div class="p-4 bg-surface-secondary rounded-xl border border-border mb-4">
          <div class="flex items-center gap-4">
            <div class="flex-1">
              <p class="text-xs text-text-secondary mb-1">Origen</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-error"></app-icon>
                <p class="text-sm font-semibold text-text-primary">{{ transfer()!.from_location.name || '-' }}</p>
              </div>
            </div>
            <app-icon name="arrow-right" [size]="20" class="text-text-secondary"></app-icon>
            <div class="flex-1">
              <p class="text-xs text-text-secondary mb-1">Destino</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-success"></app-icon>
                <p class="text-sm font-semibold text-text-primary">{{ destinationName() }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Orden avanzada: remisiones, transporte, despacho y pérdida (P3) -->
        <app-transfer-flow-panel
          [transfer]="flowView()"
          surface="store"
          [currentStoreId]="currentStoreId()"
          [isProcessing]="isProcessing()"
          (dispatch)="dispatchTransfer.emit($event)"
          (closeWithLoss)="closeWithLoss.emit($event)"
          (openNote)="openNote.emit($event)"
        ></app-transfer-flow-panel>

        <!-- Timeline -->
        <div class="p-4 bg-surface-secondary rounded-xl border border-border mb-4">
          <h4 class="text-sm font-medium text-text-secondary mb-3">Cronología</h4>
          <div class="space-y-2">
            <div class="flex items-center gap-3 text-sm">
              <div class="w-2 h-2 rounded-full bg-primary"></div>
              <span class="text-text-secondary w-24">Creada</span>
              <span class="text-text-primary font-medium">
                {{ transfer()!.transfer_date | date:'dd/MM/yyyy HH:mm' }}
              </span>
            </div>
            @if (transfer()!.approved_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                <span class="text-text-secondary w-24">Aprobada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer()!.approved_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer()!.completed_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span class="text-text-secondary w-24">Completada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer()!.completed_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer()!.cancelled_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-gray-400"></div>
                <span class="text-text-secondary w-24">Cancelada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer()!.cancelled_date | date:'dd/MM/yyyy HH:mm' }}
                </span>
              </div>
            }
            @if (transfer()!.expected_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-amber-400"></div>
                <span class="text-text-secondary w-24">Esperada</span>
                <span class="text-text-primary font-medium">
                  {{ transfer()!.expected_date | date:'dd/MM/yyyy' }}
                </span>
              </div>
            }
          </div>
        </div>

        @if (transfer()!.notes) {
          <div class="p-3 bg-surface-secondary rounded-xl border border-border mb-4">
            <p class="text-xs text-text-secondary mb-1">Notas</p>
            <p class="text-sm text-text-primary">{{ transfer()!.notes }}</p>
          </div>
        }

        <!-- Items Table -->
        <div class="mb-4">
          <h4 class="text-sm font-medium text-text-secondary mb-3">
            Productos ({{ transfer()!.stock_transfer_items.length || 0 }})
          </h4>
          <div class="border border-border rounded-xl overflow-hidden">
            <!-- Header -->
            <div class="grid grid-cols-12 gap-2 p-3 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border">
              <div class="col-span-4">Producto</div>
              <div class="col-span-2 text-right">Pedido</div>
              <div class="col-span-2 text-right">Enviado</div>
              <div class="col-span-2 text-right">
                {{ isCompleting ? 'Llegó ahora' : 'Recibido' }}
              </div>
              <div class="col-span-2 text-right">Estado</div>
            </div>

            <!-- Items -->
            @for (item of transfer()!.stock_transfer_items; track item.id; let i = $index) {
              <div class="grid grid-cols-12 gap-2 p-3 items-center border-b border-border last:border-b-0"
                [class.bg-primary/5]="isCompleting">
                <div class="col-span-4 min-w-0">
                  <p class="text-sm font-medium text-text-primary">
                    {{ item.products.name || 'Producto' }}
                  </p>
                  @if (item.product_variants?.name) {
                    <p class="text-xs text-text-secondary">{{ item.product_variants?.name }}</p>
                  }
                  @if (item.inventory_batches?.batch_number) {
                    <p class="text-xs text-text-secondary">Lote {{ item.inventory_batches?.batch_number }}</p>
                  }
                </div>
                <div class="col-span-2 text-right text-sm font-medium text-text-primary">
                  {{ item.quantity }}
                </div>
                <div class="col-span-2 text-right text-sm text-text-primary">
                  {{ item.quantity_dispatched ?? (transfer()!.dispatched_at ? item.quantity : '-') }}
                </div>
                <div class="col-span-2 text-right">
                  @if (isCompleting) {
                    <input
                      type="number"
                      [min]="0"
                      [max]="pendingQuantity(item)"
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
                    @if (pendingQuantity(item) === 0 && (item.quantity_lost ?? 0) > 0) {
                      <span class="text-xs text-error font-medium">Pérdida {{ item.quantity_lost }}</span>
                    } @else if (pendingQuantity(item) === 0 && item.quantity_received > 0) {
                      <span class="text-xs text-success font-medium">Completo</span>
                    } @else if (item.quantity_received > 0) {
                      <span class="text-xs text-warning font-medium">Faltan {{ pendingQuantity(item) }}</span>
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
              <p class="text-sm font-medium text-text-primary">¿Estás seguro?</p>
              <p class="text-xs text-text-secondary mt-0.5">{{ receptionWarning() }}</p>
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

          @if (canApprove()) {
            <app-button variant="primary" (clicked)="approveTransfer.emit(transfer()!)" customClasses="!rounded-xl font-bold">
              <app-icon name="check" [size]="14" class="mr-1.5" slot="icon" ></app-icon>
              Aprobar
            </app-button>
          }

          @if (canReceive() && !isCompleting) {
            <app-button variant="primary" (clicked)="startCompleting()" customClasses="!rounded-xl font-bold">
              <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon" ></app-icon>
              Recibir
            </app-button>
          }

          @if (isCompleting && !confirmingReception) {
            <app-button
              variant="primary"
              (clicked)="confirmingReception = true"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon" ></app-icon>
              Confirmar Recepcion
            </app-button>
          }

          @if (confirmingReception) {
            <app-button
              variant="primary"
              (clicked)="onComplete()"
              [loading]="isProcessing()"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
            >
              <app-icon name="alert-triangle" [size]="14" class="mr-1.5" slot="icon" ></app-icon>
              Si, Aplicar Movimientos
            </app-button>
          }

          @if (canCancel()) {
            @if (!isCompleting) {
              <app-button variant="outline" (clicked)="cancelTransfer.emit(transfer()!)" customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5">
                <app-icon name="x-circle" [size]="14" class="mr-1.5" slot="icon" ></app-icon>
                Cancelar
              </app-button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class TransferDetailModalComponent {
  readonly isOpen = input(false);
  readonly transfer = input<StockTransfer | null>(null);
  readonly isProcessing = input(false);

  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly approveTransfer = output<StockTransfer>();
  readonly cancelTransfer = output<StockTransfer>();
  readonly completeTransfer = output<CompleteTransferItem[]>();
  readonly dispatchTransfer = output<TransferDispatchRequest>();
  readonly closeWithLoss = output<TransferCloseWithLossRequest>();
  readonly openNote = output<TransferFlowNote>();

  private toastService = inject(ToastService);
  private authFacade = inject(AuthFacade);

  /** Tienda activa: decide si la recepción puede seguir desde aquí (R3-2). */
  readonly currentStoreId = computed(() => activeStoreId(this.authFacade));

  readonly flowView = computed(
    () => this.transfer() as unknown as TransferFlowView | null,
  );

  /** En tienda, aprobar deja `in_transit`; si aún no salió, se dice así. */
  readonly statusLabel = computed(() => {
    const transfer = this.transfer();
    if (!transfer) return '';
    const view = transfer as unknown as TransferFlowView;
    if (
      transfer.status === 'in_transit' &&
      isAdvancedTransfer(view) &&
      isNeverDispatched(view)
    ) {
      return 'Aprobada, por despachar';
    }
    return this.getStatusLabel(transfer.status);
  });

  readonly receptionWarning = computed(() => {
    const transfer = this.transfer();
    if (transfer?.dispatched_at) {
      return 'Se sumará al destino lo que registres como recibido. Si falta algo, la transferencia queda recibida en parte y podrás registrar lo que llegue después.';
    }
    return 'Esta acción aplicará los movimientos de inventario: se restará stock de la bodega de origen y se sumará en la de destino. No se puede deshacer.';
  });

  /**
   * El backend crea las transferencias en `pending`; el botón sólo miraba
   * `draft`, así que en una transferencia nueva no aparecía "Aprobar" y el
   * flujo quedaba sin salida. Se aceptan los dos porque `draft` es el valor
   * legado que todavía tienen las filas viejas.
   */
  readonly canApprove = computed(() => {
    const status = this.transfer()?.status;
    return status === 'pending' || status === 'draft';
  });

  /** Cancelable mientras el stock no se haya acreditado en destino. */
  readonly canCancel = computed(() => {
    const status = this.transfer()?.status;
    return (
      status === 'pending' ||
      status === 'draft' ||
      status === 'approved' ||
      status === 'in_transit' ||
      status === 'partially_received'
    );
  });

  /**
   * D4 — se puede recibir mientras haya saldo en camino, también por partes.
   * Una salida a destino externo no se recibe (se cierra al despachar) y una
   * transferencia con modo de movimiento debe despacharse antes: el backend
   * rechaza ambas, así que el botón no se muestra.
   */
  readonly canReceive = computed(() => {
    const transfer = this.transfer();
    if (!transfer) return false;
    const status = transfer.status;
    if (status !== 'in_transit' && status !== 'partially_received') {
      return false;
    }
    if (transfer.is_external_destination) return false;
    const neverDispatched =
      !transfer.dispatched_at &&
      (transfer.stock_transfer_items ?? []).every(
        (item) => item.quantity_dispatched == null,
      );
    if (transfer.movement_mode && neverDispatched) return false;
    // R3-2 — las entregas siguen en la tienda de la primera remisión de
    // entrada: el panel lo explica y aquí no se ofrece el botón.
    return (
      receiptStoreBlock(
        transfer as unknown as TransferFlowView,
        'store',
        this.currentStoreId(),
      ) == null
    );
  });

  /** D8 — una salida a destino externo no tiene bodega de destino. */
  readonly destinationName = computed(() => {
    const transfer = this.transfer();
    if (!transfer) return '-';
    if (transfer.to_location?.name) return transfer.to_location.name;
    if (transfer.is_external_destination) {
      return `Destino externo: ${transfer.external_destination_name || '-'}`;
    }
    return '-';
  });

  isCompleting = false;
  confirmingReception = false;
  receivedQuantities: Map<number, number> = new Map();

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.isCompleting = false;
        this.confirmingReception = false;
        this.receivedQuantities.clear();
      }
    });
  }

  startCompleting(): void {
    this.isCompleting = true;
    if (this.transfer()?.stock_transfer_items) {
      for (const item of this.transfer()!.stock_transfer_items) {
        this.receivedQuantities.set(item.id, this.pendingQuantity(item));
      }
    }
  }

  /** Saldo por recibir: lo que salió menos lo recibido y lo perdido. */
  pendingQuantity(item: StockTransferItem): number {
    const dispatched = item.quantity_dispatched ?? item.quantity;
    return Math.max(
      0,
      dispatched - (item.quantity_received ?? 0) - (item.quantity_lost ?? 0),
    );
  }

  getReceivedQuantity(itemId: number): number {
    return this.receivedQuantities.get(itemId) ?? 0;
  }

  updateReceivedQuantity(itemId: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = +raw;
    const min = 0;
    const clamped = Math.max(min, value);
    // Feedback visible cuando el usuario teclea un valor por debajo del mínimo
    // (ignoramos el campo vacío mientras edita para no spamear toasts).
    if (raw !== '' && Number.isFinite(value) && value < min) {
      this.toastService.info(
        'La cantidad recibida no puede ser negativa.',
        'Cantidad ajustada',
      );
    }
    this.receivedQuantities.set(itemId, clamped);
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
      pending: 'Pendiente',
      draft: 'Borrador',
      approved: 'Aprobada',
      in_transit: 'En Tránsito',
      received: 'Recibida',
      completed: 'Completada',
      cancelled: 'Cancelada',
      partially_received: 'Parcialmente recibida',
      closed_with_loss: 'Cerrada con pérdida',
    };
    return labels[status] || status;
  }

  getStatusClasses(status: TransferStatus): string {
    const map: Record<TransferStatus, string> = {
      pending: 'bg-gray-100 text-gray-700',
      draft: 'bg-gray-100 text-gray-700',
      approved: 'bg-violet-100 text-violet-700',
      in_transit: 'bg-blue-100 text-blue-700',
      received: 'bg-emerald-100 text-emerald-700',
      completed: 'bg-emerald-100 text-emerald-700',
      cancelled: 'bg-gray-100 text-gray-500',
      partially_received: 'bg-amber-100 text-amber-700',
      closed_with_loss: 'bg-red-100 text-red-700',
    };
    return map[status] || 'bg-gray-100 text-gray-700';
  }

  getStatusIcon(status: TransferStatus): string {
    const map: Record<TransferStatus, string> = {
      pending: 'file-text',
      draft: 'file-text',
      approved: 'check',
      in_transit: 'truck',
      received: 'check-circle',
      completed: 'check-circle',
      cancelled: 'x-circle',
      partially_received: 'truck',
      closed_with_loss: 'alert-triangle',
    };
    return map[status] || 'info';
  }
}
