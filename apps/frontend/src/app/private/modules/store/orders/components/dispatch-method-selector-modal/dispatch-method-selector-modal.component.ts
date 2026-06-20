import { Component, input, output } from '@angular/core';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/** Outcome of the dispatch-method chooser. */
export type DispatchMethod = 'with-note' | 'without-note';

/**
 * Single entry-point chooser for dispatching an order. Replaces the two
 * separate buttons ("Despachar Orden" without a remisión vs "Generar
 * Remisión") with one converging flow: the operator decides whether to
 * dispatch generating a remisión (document + optional route) or to simply
 * mark the order as shipped without any shipment document. Both paths end
 * with the order in the `shipped` state.
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
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-primary-600 flex-shrink-0">
            <app-icon name="file-text" [size]="20"></app-icon>
          </div>
          <div class="min-w-0">
            <div class="font-semibold">Con remisión</div>
            <div class="text-sm text-text-secondary">
              Genera una remisión (documento de despacho) y, opcionalmente,
              asígnala a una ruta. La orden se marca como enviada.
            </div>
          </div>
        </button>

        <!-- Sin remisión -->
        <button
          type="button"
          (click)="selected.emit('without-note')"
          class="w-full text-left rounded-xl border border-border bg-surface hover:border-primary-600 hover:bg-primary-50 transition-colors p-4 flex items-start gap-3"
        >
          <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-text-secondary flex-shrink-0">
            <app-icon name="truck" [size]="20"></app-icon>
          </div>
          <div class="min-w-0">
            <div class="font-semibold">Sin remisión</div>
            <div class="text-sm text-text-secondary">
              Marca la orden como enviada sin generar ningún documento de
              despacho.
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
