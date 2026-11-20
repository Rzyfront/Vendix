import {
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
} from '../../../../../../shared/components/index';
import {
  TransferFlowNote,
  TransferFlowView,
  buildDispatchBody,
  canCloseWithLoss,
  canDispatch,
  deliveryDeadlinePassed,
  hasExitAlert,
  isAdvancedTransfer,
  receiptStoreBlock,
  supportDocumentLabel,
  totalPending,
  transportSummary,
} from './transfer-advanced';

export interface TransferDispatchRequest {
  items: Array<{ id: number; quantity_dispatched: number; batch_id?: number }>;
  notes?: string;
}

export interface TransferCloseWithLossRequest {
  reason: string;
  notes?: string;
}

/**
 * Bloque del detalle de una transferencia avanzada (P3), compartido por los
 * modales de tienda y de organización: datos de la orden (modo, destino
 * externo, transporte, remisiones), alerta de salida sin soporte (D8),
 * despacho con conteo de salida (D3), aviso de la tienda donde se siguen
 * registrando las entregas (R3-2) y cierre del pendiente como pérdida, que solo
 * aparece cuando venció la fecha límite (D4).
 *
 * La recepción (enviado vs recibido) sigue en la tabla de cada modal.
 */
@Component({
  selector: 'app-transfer-flow-panel',
  standalone: true,
  imports: [DatePipe, FormsModule, ButtonComponent, IconComponent],
  template: `
    @if (transfer(); as t) {
      @if (alert()) {
        <div
          class="mb-3 flex items-start gap-2 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
          data-testid="flow-exit-alert"
        >
          <app-icon name="alert-triangle" [size]="16" class="shrink-0 mt-0.5" />
          <span>
            <strong>Salida de inventario sin documento ni motivo.</strong>
            Esta salida a un destino externo no tiene documento soporte ni
            motivo registrado.
          </span>
        </div>
      }

      @if (advanced()) {
        <div
          class="mb-4 p-3 bg-surface-secondary rounded-xl border border-border space-y-1.5 text-sm"
        >
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <span class="text-text-secondary">Manejo:</span>
            <span
              class="font-medium text-text-primary"
              data-testid="flow-mode"
              >{{ modeLabel() }}</span
            >
          </div>
          @if (t.is_external_destination) {
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-text-secondary">Destino externo:</span>
              <span class="text-text-primary">
                {{ t.external_destination_name || '-' }}
                @if (t.external_destination_tax_id) {
                  · NIT {{ t.external_destination_tax_id }}
                }
                @if (t.external_destination_address) {
                  · {{ t.external_destination_address }}
                }
              </span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-text-secondary">Soporte:</span>
              <span class="text-text-primary">
                {{ supportLabel() || 'Sin documento' }}
                @if (t.support_document_id) {
                  #{{ t.support_document_id }}
                }
                @if (t.exit_reason) {
                  · Motivo: {{ t.exit_reason }}
                }
              </span>
            </div>
          }
          @if (transport()) {
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-text-secondary">Transporte:</span>
              <span class="text-text-primary">{{ transport() }}</span>
            </div>
          }
          @if (shippingCost() > 0) {
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-text-secondary">Costo de transporte:</span>
              <span class="text-text-primary">{{ shippingCost() }}</span>
            </div>
          }
          @if (t.dispatch_note || t.receipt_note) {
            <div class="flex flex-wrap items-center gap-2 pt-1">
              @if (t.dispatch_note; as note) {
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15"
                  data-testid="flow-dispatch-note"
                  (click)="openNote.emit(note)"
                >
                  <app-icon name="file-text" [size]="13" />
                  Remisión de salida {{ note.dispatch_number }}
                </button>
              }
              @if (t.receipt_note; as note) {
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15"
                  data-testid="flow-receipt-note"
                  (click)="openNote.emit(note)"
                >
                  <app-icon name="file-text" [size]="13" />
                  Remisión de entrada {{ note.dispatch_number }}
                </button>
              }
            </div>
          }
          @if (t.loss_reason) {
            <div class="flex flex-wrap gap-x-4 gap-y-1">
              <span class="text-text-secondary">Motivo de la pérdida:</span>
              <span class="text-text-primary">{{ t.loss_reason }}</span>
            </div>
          }
        </div>
      }

      @if (receiptBlockStore(); as storeName) {
        <div
          class="mb-4 flex items-start gap-2 rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-sm text-text-primary"
          data-testid="flow-receipt-store-block"
        >
          <app-icon name="info" [size]="16" class="text-info shrink-0 mt-0.5" />
          <span>
            Las entregas de esta transferencia se están registrando en
            <strong>{{ storeName }}</strong
            >, donde se recibió la primera. Para seguir recibiendo, cambia a esa
            tienda (o regístralo desde la organización).
          </span>
        </div>
      }

      <!-- Despacho con conteo de salida -->
      @if (dispatchOpen()) {
        <div
          class="mb-4 p-3 rounded-xl border border-primary/30 bg-primary/5"
          data-testid="flow-dispatch-form"
        >
          <h4 class="text-sm font-semibold text-text-primary mb-1">
            Conteo de salida
          </h4>
          <p class="text-xs text-text-secondary mb-3">{{ dispatchHint() }}</p>
          <div
            class="border border-border rounded-lg overflow-hidden bg-surface"
          >
            @for (item of t.stock_transfer_items; track item.id) {
              <div
                class="grid grid-cols-12 gap-2 items-center px-3 py-2 border-b border-border last:border-b-0"
              >
                <div class="col-span-6 min-w-0">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ item.products?.name || 'Producto' }}
                    @if (item.product_variants?.name) {
                      <span class="text-text-secondary"
                        >· {{ item.product_variants?.name }}</span
                      >
                    }
                  </p>
                  <p class="text-xs text-text-secondary truncate">
                    Lote:
                    {{
                      item.inventory_batches?.batch_number ||
                        'el más antiguo disponible'
                    }}
                  </p>
                </div>
                <div class="col-span-3 text-right text-xs text-text-secondary">
                  Pedido {{ item.quantity }}
                </div>
                <div class="col-span-3 text-right">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    [max]="item.quantity"
                    class="w-20 px-2 py-1 text-sm text-right border border-border rounded-lg bg-surface focus:border-primary outline-none"
                    [attr.data-testid]="'flow-dispatch-qty-' + item.id"
                    [value]="dispatchQty()[item.id] ?? item.quantity"
                    (input)="setDispatchQty(item.id, $any($event.target).value)"
                  />
                </div>
              </div>
            }
          </div>
          <textarea
            rows="2"
            class="w-full mt-3 px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:border-primary outline-none"
            placeholder="Notas del despacho (opcional)"
            [ngModel]="dispatchNotes()"
            (ngModelChange)="dispatchNotes.set($event)"
          ></textarea>
          @if (dispatchError()) {
            <p
              class="text-xs text-error mt-2"
              data-testid="flow-dispatch-error"
            >
              {{ dispatchError() }}
            </p>
          }
          <div class="flex justify-end gap-2 mt-3">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="dispatchOpen.set(false)"
              >Volver</app-button
            >
            <app-button
              variant="primary"
              size="sm"
              [loading]="isProcessing()"
              data-testid="flow-dispatch-confirm"
              (clicked)="confirmDispatch()"
            >
              Confirmar despacho
            </app-button>
          </div>
        </div>
      } @else if (showDispatch()) {
        <div class="mb-4 flex justify-end">
          <app-button
            variant="primary"
            size="sm"
            data-testid="flow-dispatch-open"
            (clicked)="openDispatch()"
          >
            <app-icon slot="icon" name="truck" [size]="14" />
            Despachar
          </app-button>
        </div>
      }

      <!-- Cierre del pendiente como pérdida (D4) -->
      @if (lossOpen()) {
        <div
          class="mb-4 p-3 rounded-xl border border-error/30 bg-error/5"
          data-testid="flow-loss-form"
        >
          <h4 class="text-sm font-semibold text-text-primary mb-1">
            Cerrar pendiente como pérdida
          </h4>
          <p class="text-xs text-text-secondary mb-2">
            Se darán de baja {{ pending() }} unidad(es) que no llegaron y la
            transferencia quedará cerrada. Esta acción no se puede deshacer.
          </p>
          <textarea
            rows="2"
            maxlength="500"
            class="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:border-primary outline-none"
            placeholder="Motivo de la pérdida (obligatorio)"
            data-testid="flow-loss-reason"
            [ngModel]="lossReason()"
            (ngModelChange)="lossReason.set($event)"
          ></textarea>
          @if (lossError()) {
            <p class="text-xs text-error mt-1">{{ lossError() }}</p>
          }
          <div class="flex justify-end gap-2 mt-3">
            <app-button
              variant="outline"
              size="sm"
              (clicked)="lossOpen.set(false)"
              >Volver</app-button
            >
            <app-button
              variant="danger"
              size="sm"
              [loading]="isProcessing()"
              data-testid="flow-loss-confirm"
              (clicked)="confirmLoss()"
            >
              Cerrar como pérdida
            </app-button>
          </div>
        </div>
      } @else if (showCloseWithLoss()) {
        <div class="mb-4 flex justify-end">
          <app-button
            variant="outline"
            size="sm"
            customClasses="!text-error !border-error hover:!bg-error/5"
            data-testid="flow-loss-open"
            (clicked)="lossOpen.set(true)"
          >
            <app-icon slot="icon" name="alert-triangle" [size]="14" />
            Cerrar pendiente como pérdida
          </app-button>
        </div>
      } @else if (lossHintDate()) {
        <p
          class="mb-4 text-xs text-text-secondary"
          data-testid="flow-loss-hint"
        >
          Si lo pendiente no llega, podrás cerrarlo como pérdida después del
          {{ lossHintDate() | date: 'dd/MM/yyyy' : 'UTC' }}.
        </p>
      }
    }
  `,
})
export class TransferFlowPanelComponent {
  readonly transfer = input<TransferFlowView | null>(null);
  readonly surface = input<'store' | 'organization'>('store');
  readonly currentStoreId = input<number | null>(null);
  readonly isProcessing = input(false);
  /** Permisos de la superficie (organización los separa por acción). */
  readonly allowDispatch = input(true);
  readonly allowCloseWithLoss = input(true);
  /** Reloj inyectable para los specs. */
  readonly now = input<Date | null>(null);

  readonly dispatch = output<TransferDispatchRequest>();
  readonly closeWithLoss = output<TransferCloseWithLossRequest>();
  readonly openNote = output<TransferFlowNote>();

  readonly dispatchOpen = signal(false);
  readonly dispatchQty = signal<Record<number, number>>({});
  readonly dispatchNotes = signal('');
  readonly dispatchError = signal<string | null>(null);

  readonly lossOpen = signal(false);
  readonly lossReason = signal('');
  readonly lossError = signal<string | null>(null);

  private readonly clock = computed(() => this.now() ?? new Date());

  readonly advanced = computed(() => isAdvancedTransfer(this.transfer()));
  readonly alert = computed(() => hasExitAlert(this.transfer()));
  readonly showDispatch = computed(
    () => this.allowDispatch() && canDispatch(this.transfer()),
  );
  readonly showCloseWithLoss = computed(
    () =>
      this.allowCloseWithLoss() &&
      canCloseWithLoss(this.transfer(), this.clock()),
  );
  readonly pending = computed(() => {
    const t = this.transfer();
    return t ? totalPending(t) : 0;
  });
  readonly receiptBlockStore = computed(() =>
    receiptStoreBlock(this.transfer(), this.surface(), this.currentStoreId()),
  );
  readonly transport = computed(() => {
    const t = this.transfer();
    return t ? transportSummary(t) : null;
  });
  readonly shippingCost = computed(
    () => Number(this.transfer()?.shipping_cost ?? 0) || 0,
  );
  readonly supportLabel = computed(() =>
    supportDocumentLabel(this.transfer()?.support_document_type),
  );
  readonly modeLabel = computed(() => {
    const t = this.transfer();
    if (t?.movement_mode === 'mass_only') return 'Solo movimiento masivo';
    if (t?.movement_mode === 'with_dispatch_notes')
      return 'Con remisiones de salida y entrada';
    return 'Sin remisiones';
  });
  readonly dispatchHint = computed(() => {
    const t = this.transfer();
    if (t?.is_external_destination) {
      return 'Cuenta lo que sale. Se registrará la salida con su remisión y la transferencia quedará cerrada.';
    }
    if (t?.movement_mode === 'mass_only') {
      return 'Cuenta lo que sale. Al confirmar, el inventario sale del origen y entra al destino.';
    }
    return 'Cuenta lo que sale. Al confirmar, el inventario sale del origen y se emite la remisión de salida; el destino lo suma al recibir.';
  });
  /**
   * Pista de cuándo podrá cerrarse como pérdida: en camino, con pendiente y
   * fecha límite todavía vigente.
   */
  readonly lossHintDate = computed(() => {
    const t = this.transfer();
    if (!t?.expected_date || t.is_external_destination) return null;
    if (t.status !== 'in_transit' && t.status !== 'partially_received')
      return null;
    if (this.pending() <= 0) return null;
    if (deliveryDeadlinePassed(t.expected_date, this.clock())) return null;
    return t.expected_date;
  });

  constructor() {
    // Otra transferencia (o la misma recargada tras una acción): formularios
    // cerrados y conteos limpios.
    effect(() => {
      this.transfer();
      untracked(() => this.reset());
    });
  }

  openDispatch(): void {
    const t = this.transfer();
    if (!t) return;
    const qty: Record<number, number> = {};
    for (const item of t.stock_transfer_items) qty[item.id] = item.quantity;
    this.dispatchQty.set(qty);
    this.dispatchError.set(null);
    this.dispatchOpen.set(true);
  }

  setDispatchQty(id: number, raw: string): void {
    const value = raw === '' ? 0 : Number(raw);
    this.dispatchQty.update((q) => ({ ...q, [id]: value }));
  }

  confirmDispatch(): void {
    const t = this.transfer();
    if (!t) return;
    const qty = this.dispatchQty();
    const { body, error } = buildDispatchBody(
      t,
      t.stock_transfer_items.map((item) => ({
        id: item.id,
        quantity_dispatched: qty[item.id] ?? item.quantity,
        batch_id: item.batch_id ?? null,
      })),
      this.dispatchNotes(),
    );
    this.dispatchError.set(error);
    if (body) this.dispatch.emit(body);
  }

  confirmLoss(): void {
    const reason = this.lossReason().trim();
    if (reason.length < 3) {
      this.lossError.set(
        'Escribe el motivo de la pérdida (al menos 3 letras).',
      );
      return;
    }
    this.lossError.set(null);
    this.closeWithLoss.emit({ reason });
  }

  private reset(): void {
    this.dispatchOpen.set(false);
    this.dispatchQty.set({});
    this.dispatchNotes.set('');
    this.dispatchError.set(null);
    this.lossOpen.set(false);
    this.lossReason.set('');
    this.lossError.set(null);
  }
}
