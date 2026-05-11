import { Component, computed, effect, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../../shared/components/index';
import {
  CompleteOrgTransferItemRequest,
  normalizeOrgTransferStatus,
  OrgTransfer,
  OrgTransferStatus,
} from '../../../interfaces/org-transfer.interface';

const STATUS_LABELS: Record<
  Exclude<OrgTransferStatus, 'draft' | 'completed'>,
  string
> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  in_transit: 'En tránsito',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATUS_BADGE_CLASSES: Record<
  Exclude<OrgTransferStatus, 'draft' | 'completed'>,
  string
> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-amber-100 text-amber-700',
  received: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_ICONS: Record<
  Exclude<OrgTransferStatus, 'draft' | 'completed'>,
  string
> = {
  pending: 'file-text',
  approved: 'check',
  in_transit: 'truck',
  received: 'check-circle',
  cancelled: 'x-circle',
};

@Component({
  selector: 'app-org-transfer-detail-modal',
  standalone: true,
  imports: [DatePipe, FormsModule, ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle()"
      [subtitle]="statusLabel()"
      size="md"
      (closed)="onClose()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      @if (transfer(); as t) {
        <!-- Status badge -->
        <div class="mb-4">
          <span
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
            [class]="statusClasses()"
          >
            <app-icon
              [name]="statusIcon()"
              [size]="14"
              class="mr-1.5"
            />
            {{ statusLabel() }}
          </span>
        </div>

        <!-- Locations -->
        <div
          class="p-4 bg-surface-secondary rounded-xl border border-border mb-4"
        >
          <div class="flex items-center gap-4">
            <div class="flex-1 min-w-0">
              <p class="text-xs text-text-secondary mb-1">Origen</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-error" />
                <p class="text-sm font-semibold text-text-primary truncate">
                  {{ originLabel() }}
                </p>
              </div>
            </div>
            <app-icon
              name="arrow-right"
              [size]="20"
              class="text-text-secondary shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="text-xs text-text-secondary mb-1">Destino</p>
              <div class="flex items-center gap-2">
                <app-icon name="map-pin" [size]="16" class="text-success" />
                <p class="text-sm font-semibold text-text-primary truncate">
                  {{ destinationLabel() }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline -->
        <div
          class="p-4 bg-surface-secondary rounded-xl border border-border mb-4"
        >
          <h4 class="text-sm font-medium text-text-secondary mb-3">
            Cronología
          </h4>
          <div class="space-y-2">
            <div class="flex items-center gap-3 text-sm">
              <div class="w-2 h-2 rounded-full bg-primary"></div>
              <span class="text-text-secondary w-28">Creada</span>
              <span class="text-text-primary font-medium">
                {{ t.created_at | date: 'short' }}
              </span>
            </div>
            @if (t.approved_at) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                <span class="text-text-secondary w-28">Aprobada</span>
                <span class="text-text-primary font-medium">
                  {{ t.approved_at | date: 'short' }}
                </span>
              </div>
            }
            @if (t.dispatched_at) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-amber-500"></div>
                <span class="text-text-secondary w-28">Despachada</span>
                <span class="text-text-primary font-medium">
                  {{ t.dispatched_at | date: 'short' }}
                </span>
              </div>
            }
            @if (t.completed_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span class="text-text-secondary w-28">Recibida</span>
                <span class="text-text-primary font-medium">
                  {{ t.completed_date | date: 'short' }}
                </span>
              </div>
            }
            @if (t.cancelled_at) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-red-500"></div>
                <span class="text-text-secondary w-28">Cancelada</span>
                <span class="text-text-primary font-medium">
                  {{ t.cancelled_at | date: 'short' }}
                </span>
              </div>
            }
            @if (t.expected_date) {
              <div class="flex items-center gap-3 text-sm">
                <div class="w-2 h-2 rounded-full bg-amber-300"></div>
                <span class="text-text-secondary w-28">Esperada</span>
                <span class="text-text-primary font-medium">
                  {{ t.expected_date | date: 'shortDate' }}
                </span>
              </div>
            }
          </div>
        </div>

        @if (t.notes) {
          <div
            class="p-3 bg-surface-secondary rounded-xl border border-border mb-4"
          >
            <p class="text-xs text-text-secondary mb-1">Notas</p>
            <p class="text-sm text-text-primary whitespace-pre-line">
              {{ t.notes }}
            </p>
          </div>
        }
        @if (t.cancellation_reason) {
          <div
            class="p-3 bg-error/10 rounded-xl border border-error/20 mb-4"
          >
            <p class="text-xs text-error mb-1">Motivo de cancelación</p>
            <p class="text-sm text-text-primary">
              {{ t.cancellation_reason }}
            </p>
          </div>
        }

        <!-- Items table -->
        <div class="mb-4">
          <h4 class="text-sm font-medium text-text-secondary mb-3">
            Productos ({{ t.stock_transfer_items.length || 0 }})
          </h4>
          <div class="border border-border rounded-xl overflow-hidden">
            <div
              class="grid grid-cols-12 gap-2 p-3 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border"
            >
              <div class="col-span-5">Producto</div>
              <div class="col-span-2 text-right">Solicitado</div>
              <div class="col-span-3 text-right">Recibido</div>
              <div class="col-span-2 text-right">Estado</div>
            </div>
            @for (item of t.stock_transfer_items; track item.id) {
              <div
                class="grid grid-cols-12 gap-2 p-3 items-center border-b border-border last:border-b-0"
              >
                <div class="col-span-5">
                  <p class="text-sm font-medium text-text-primary">
                    {{ item.products?.name || 'Producto' }}
                  </p>
                  @if (item.product_variants?.name) {
                    <p class="text-xs text-text-secondary">
                      {{ item.product_variants?.name }}
                    </p>
                  }
                </div>
                <div
                  class="col-span-2 text-right text-sm font-medium text-text-primary"
                >
                  {{ item.quantity }}
                </div>
                <div class="col-span-3 text-right">
                  @if (isCompleting()) {
                    <input
                      type="number"
                      [min]="0"
                      [max]="getMaxReceivable(item)"
                      [value]="getReceivedDraft(item.id)"
                      (input)="updateReceivedDraft(item.id, $event)"
                      class="w-20 px-2 py-1 text-sm text-right border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  } @else {
                    <span class="text-sm text-text-primary">
                      {{ item.quantity_received }}
                    </span>
                  }
                </div>
                <div class="col-span-2 text-right">
                  @if (item.quantity_received >= item.quantity) {
                    <span class="text-xs text-success font-medium">
                      Completo
                    </span>
                  } @else if (item.quantity_received > 0) {
                    <span class="text-xs text-warning font-medium">
                      Parcial
                    </span>
                  } @else {
                    <span class="text-xs text-text-secondary">Pendiente</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        @if (confirmDispatch()) {
          <div
            class="p-3 mt-2 bg-warning/10 rounded-xl border border-warning/30 flex items-start gap-2"
          >
            <app-icon
              name="alert-triangle"
              [size]="18"
              class="text-warning mt-0.5 shrink-0"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">
                Confirma el despacho
              </p>
              <p class="text-xs text-text-secondary mt-0.5">
                El origen perderá stock al despachar la transferencia. Esta
                acción no se puede deshacer.
              </p>
            </div>
          </div>
        }

        @if (confirmReception()) {
          <div
            class="p-3 mt-2 bg-warning/10 rounded-xl border border-warning/30 flex items-start gap-2"
          >
            <app-icon
              name="alert-triangle"
              [size]="18"
              class="text-warning mt-0.5 shrink-0"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">
                Confirma la recepción
              </p>
              <p class="text-xs text-text-secondary mt-0.5">
                El destino sumará stock por las cantidades recibidas. La
                transferencia quedará "Recibida" si todos los items se reciben
                completos.
              </p>
            </div>
          </div>
        }
      }

      <div
        slot="footer"
        class="flex justify-between gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <div>
          @if (isCompleting()) {
            <app-button
              variant="outline"
              (clicked)="cancelCompleting()"
              customClasses="!rounded-xl"
            >
              Volver
            </app-button>
          }
        </div>
        <div class="flex flex-wrap gap-2 justify-end">
          <app-button
            variant="outline"
            (clicked)="onClose()"
            customClasses="!rounded-xl font-bold"
          >
            Cerrar
          </app-button>

          @if (canApproveCurrent()) {
            <app-button
              variant="primary"
              [loading]="isProcessing()"
              (clicked)="approveTransfer.emit(transfer()!)"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon name="check" [size]="14" class="mr-1.5" slot="icon" />
              Aprobar
            </app-button>
          }

          @if (canDispatchCurrent() && !confirmDispatch()) {
            <app-button
              variant="primary"
              (clicked)="confirmDispatch.set(true)"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon name="truck" [size]="14" class="mr-1.5" slot="icon" />
              Despachar
            </app-button>
          }
          @if (canDispatchCurrent() && confirmDispatch()) {
            <app-button
              variant="primary"
              [loading]="isProcessing()"
              (clicked)="dispatchTransfer.emit(transfer()!)"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              <app-icon
                name="alert-triangle"
                [size]="14"
                class="mr-1.5"
                slot="icon"
              />
              Sí, despachar (origen pierde stock)
            </app-button>
          }

          @if (canCompleteCurrent() && !isCompleting()) {
            <app-button
              variant="primary"
              (clicked)="startCompleting()"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon
                name="check-circle"
                [size]="14"
                class="mr-1.5"
                slot="icon"
              />
              Completar recepción
            </app-button>
          }
          @if (
            canCompleteCurrent() && isCompleting() && !confirmReception()
          ) {
            <app-button
              variant="primary"
              (clicked)="confirmReception.set(true)"
              [disabled]="!hasReceivedQuantities()"
              customClasses="!rounded-xl font-bold"
            >
              Continuar
            </app-button>
          }
          @if (canCompleteCurrent() && confirmReception()) {
            <app-button
              variant="primary"
              [loading]="isProcessing()"
              (clicked)="emitComplete()"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              <app-icon
                name="check-circle"
                [size]="14"
                class="mr-1.5"
                slot="icon"
              />
              Sí, recibir
            </app-button>
          }

          @if (canCancelCurrent() && !isCompleting()) {
            <app-button
              variant="outline"
              [loading]="isProcessing()"
              (clicked)="cancelTransfer.emit(transfer()!)"
              customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5"
            >
              <app-icon
                name="x-circle"
                [size]="14"
                class="mr-1.5"
                slot="icon"
              />
              Cancelar
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class OrgTransferDetailModalComponent {
  readonly isOpen = input(false);
  readonly transfer = input<OrgTransfer | null>(null);
  readonly isProcessing = input(false);
  readonly canApprove = input(false);
  readonly canDispatch = input(false);
  readonly canComplete = input(false);
  readonly canCancel = input(false);

  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  readonly approveTransfer = output<OrgTransfer>();
  readonly dispatchTransfer = output<OrgTransfer>();
  readonly cancelTransfer = output<OrgTransfer>();
  readonly completeTransfer = output<{
    transfer: OrgTransfer;
    items: CompleteOrgTransferItemRequest[];
  }>();

  readonly isCompleting = signal(false);
  readonly confirmReception = signal(false);
  readonly confirmDispatch = signal(false);
  readonly receivedDraft = signal<Map<number, number>>(new Map());

  readonly statusValue = computed<
    Exclude<OrgTransferStatus, 'draft' | 'completed'>
  >(() => normalizeOrgTransferStatus(this.transfer()?.status));

  readonly statusLabel = computed(() => STATUS_LABELS[this.statusValue()]);
  readonly statusClasses = computed(() => STATUS_BADGE_CLASSES[this.statusValue()]);
  readonly statusIcon = computed(() => STATUS_ICONS[this.statusValue()]);

  readonly modalTitle = computed(() => {
    const t = this.transfer();
    if (!t) return 'Detalle';
    return t.transfer_number || `Transferencia #${t.id}`;
  });

  readonly originLabel = computed(() =>
    this.locationLabel(this.transfer()?.from_location ?? null),
  );
  readonly destinationLabel = computed(() =>
    this.locationLabel(this.transfer()?.to_location ?? null),
  );

  readonly canApproveCurrent = computed(
    () => this.canApprove() && this.statusValue() === 'pending',
  );
  readonly canDispatchCurrent = computed(
    () => this.canDispatch() && this.statusValue() === 'approved',
  );
  readonly canCompleteCurrent = computed(
    () => this.canComplete() && this.statusValue() === 'in_transit',
  );
  readonly canCancelCurrent = computed(() => {
    if (!this.canCancel()) return false;
    const s = this.statusValue();
    return s !== 'received' && s !== 'cancelled';
  });

  constructor() {
    effect(() => {
      // Reset transient state on open / when transfer changes.
      if (this.isOpen()) {
        this.isCompleting.set(false);
        this.confirmReception.set(false);
        this.confirmDispatch.set(false);
        this.receivedDraft.set(new Map());
      }
    });
  }

  onClose(): void {
    this.isCompleting.set(false);
    this.confirmReception.set(false);
    this.confirmDispatch.set(false);
    this.closed.emit();
  }

  startCompleting(): void {
    const t = this.transfer();
    if (!t) return;
    const next = new Map<number, number>();
    for (const item of t.stock_transfer_items) {
      const remaining = item.quantity - (item.quantity_received ?? 0);
      next.set(item.id, Math.max(0, remaining));
    }
    this.receivedDraft.set(next);
    this.isCompleting.set(true);
    this.confirmReception.set(false);
  }

  cancelCompleting(): void {
    this.isCompleting.set(false);
    this.confirmReception.set(false);
  }

  getMaxReceivable(item: { id: number; quantity: number; quantity_received?: number | null }): number {
    return item.quantity - (item.quantity_received ?? 0);
  }

  getReceivedDraft(itemId: number): number {
    return this.receivedDraft().get(itemId) ?? 0;
  }

  updateReceivedDraft(itemId: number, event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    const cleaned = Math.max(0, Number.isFinite(value) ? value : 0);
    const next = new Map(this.receivedDraft());
    next.set(itemId, cleaned);
    this.receivedDraft.set(next);
  }

  hasReceivedQuantities(): boolean {
    let total = 0;
    this.receivedDraft().forEach((v) => {
      total += v;
    });
    return total > 0;
  }

  emitComplete(): void {
    const t = this.transfer();
    if (!t) return;
    const items: CompleteOrgTransferItemRequest[] = [];
    this.receivedDraft().forEach((quantity_received, stock_transfer_item_id) => {
      if (quantity_received > 0) {
        items.push({ stock_transfer_item_id, quantity_received });
      }
    });
    this.completeTransfer.emit({ transfer: t, items });
  }

  private locationLabel(loc: OrgTransfer['from_location'] | null): string {
    if (!loc) return '-';
    const isCentral = loc.store_id == null;
    const tag = isCentral ? '📦 Bodega Central' : '🏪 Tienda';
    return `${tag} · ${loc.name}`;
  }
}
