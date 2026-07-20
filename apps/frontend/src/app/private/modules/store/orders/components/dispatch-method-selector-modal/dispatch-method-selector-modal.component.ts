import { Component, input, output } from '@angular/core';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * Outcome of the dispatch-method chooser.
 * - `with-note`: genera una remisión controlada (documento + ruta opcional).
 * - `direct`: entrega completa: crea una remisión, la marca como entregada y
 *   finaliza la orden.
 * - `to-dispatch`: publica la orden al pool de repartidores (Vendix Repartos).
 */
export type DispatchMethod = 'with-note' | 'direct' | 'to-dispatch';

/**
 * Single entry-point chooser for dispatching an order. Replaces the two
 * separate buttons ("Despachar Orden" without a remisión vs "Generar
 * Remisión") with one converging flow, plus a third path that publishes the
 * order to the carrier pool (Vendix Repartos). The operator decides whether to
 * dispatch generating a remisión (document + optional route), to simply mark
 * the order as shipped without any shipment document, or to send it to the
 * dispatch pool so a repartidor claims it.
 *
 * Zoneless-clean: signal input + signal outputs only, no legacy CD APIs.
 */
@Component({
  selector: 'app-dispatch-method-selector-modal',
  standalone: true,
  imports: [ModalComponent, IconComponent],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Despachar orden"
      subtitle="Elige cómo quieres despachar esta orden"
      size="md"
      (cancel)="closed.emit()"
      (closed)="closed.emit()"
    >
      <div class="space-y-3">
        <!-- Con remisión -->
        <button
          type="button"
          (click)="selected.emit('with-note')"
          class="w-full text-left rounded-xl border border-border bg-surface hover:border-primary-600 hover:bg-primary-50 transition-colors p-4 flex items-start gap-3"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-[0.625rem] flex-shrink-0"
            style="color: var(--color-primary); background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1); border: 1px solid rgba(var(--color-primary-rgb, 126, 215, 165), 0.18);"
          >
            <app-icon name="file-text" [size]="20"></app-icon>
          </div>
          <div class="min-w-0">
            <div class="font-semibold">Crear remisión con ruta de despacho</div>
            <div class="text-sm text-text-secondary">
              Genera una remisión (documento de despacho) y, opcionalmente,
              asígnala a una ruta. La orden se marca como enviada.
            </div>
          </div>
        </button>

        <!-- Envío directo -->
        <button
          type="button"
          (click)="selected.emit('direct')"
          class="w-full text-left rounded-xl border border-border bg-surface hover:border-primary-600 hover:bg-primary-50 transition-colors p-4 flex items-start gap-3"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-[0.625rem] bg-slate-100 border border-slate-200 text-slate-600 flex-shrink-0"
          >
            <app-icon name="truck" [size]="20"></app-icon>
          </div>
          <div class="min-w-0">
            <div class="font-semibold">Envío directo</div>
            <div class="text-sm text-text-secondary">
              Crea una remisión, la marca como entregada y finaliza la orden.
            </div>
          </div>
        </button>

        <!-- Enviar a despacho (pool de repartidores) -->
        <button
          type="button"
          (click)="selected.emit('to-dispatch')"
          class="w-full text-left rounded-xl border border-border bg-surface hover:border-primary-600 hover:bg-primary-50 transition-colors p-4 flex items-start gap-3"
        >
          <div
            class="flex h-10 w-10 items-center justify-center rounded-[0.625rem] flex-shrink-0"
            style="color: var(--color-primary); background: rgba(var(--color-primary-rgb, 126, 215, 165), 0.1); border: 1px solid rgba(var(--color-primary-rgb, 126, 215, 165), 0.18);"
          >
            <app-icon name="send" [size]="20"></app-icon>
          </div>
          <div class="min-w-0">
            <div class="font-semibold">Enviar a despacho</div>
            <div class="text-sm text-text-secondary">
              Publica la orden al pool de reparto para que un repartidor la tome
              y la agregue a su ruta.
            </div>
          </div>
        </button>
      </div>

      <div slot="footer" class="flex justify-end">
        <button
          type="button"
          (click)="closed.emit()"
          class="rounded-md border border-border bg-surface px-4 py-2 text-sm"
        >
          Cancelar
        </button>
      </div>
    </app-modal>
  `,
})
export class DispatchMethodSelectorModalComponent {
  /** Controls modal visibility from the parent. */
  readonly isOpen = input<boolean>(false);

  /** Emitted with the chosen dispatch method. */
  readonly selected = output<DispatchMethod>();
  /** Emitted when the operator dismisses the chooser. */
  readonly closed = output<void>();
}
