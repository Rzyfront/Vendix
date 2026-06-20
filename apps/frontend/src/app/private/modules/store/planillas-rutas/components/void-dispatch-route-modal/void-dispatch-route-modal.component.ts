import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  DispatchRoute,
  VoidDispatchRouteDto,
} from '../../interfaces/planilla.interface';

/**
 * Confirm-modal for voiding a dispatch route. Replaces the previous
 * `window.prompt()` flow in the detail page (which was inconsistent with
 * the rest of the app's modals and broke on mobile).
 *
 * Behaviour:
 * - Captures a `reason` (required, min 3 chars) and an optional `notes`.
 * - Emits a `VoidDispatchRouteDto` on submit. The parent detail page posts it
 *   to `POST /store/dispatch-routes/:id/void` which now auto-releases
 *   non-terminal stops (so the dispatch_notes can be reassigned).
 * - Cancels on backdrop click or footer cancel button.
 */
@Component({
  selector: 'app-void-dispatch-route-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Anular planilla de despacho"
      size="md"
      (cancel)="close.emit()"
    >
      <div class="space-y-3">
        <div class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Advertencia:</strong> anular la planilla es una acción irreversible.
          @if (route().status === 'draft') {
            <p class="mt-1">
              Como la planilla está en borrador, se anulará sin impacto contable.
              Las remisiones <strong>no asignadas</strong> podrán asignarse a otra planilla.
            </p>
          } @else {
            <p class="mt-1">
              Las paradas pendientes se marcan como <strong>released</strong>
              y sus remisiones vuelven a estar disponibles para asignar a otra planilla.
              Las paradas ya liquidadas <strong>no se revierten</strong> — el efectivo
              y los movimientos ya quedaron en el libro auxiliar.
            </p>
          }
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">
            Motivo <span class="text-red-500">*</span>
          </label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            rows="2"
            [(ngModel)]="reason"
            placeholder="Ej: Vehículo varado, conductor enfermo, ruta cancelada por el cliente"
            required
            minlength="3"
            maxlength="500"
          ></textarea>
          @if (reason.length > 0 && reason.length < 3) {
            <p class="text-xs text-red-600 mt-1">Mínimo 3 caracteres.</p>
          }
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">
            Notas adicionales (opcional)
          </label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            rows="2"
            [(ngModel)]="notes"
            placeholder="Detalle adicional, contexto para auditoría, etc."
            maxlength="1000"
          ></textarea>
        </div>

        <div class="text-xs text-text-secondary">
          Planilla: <strong>{{ route().route_number }}</strong>
          · Estado actual: <strong>{{ route().status }}</strong>
        </div>
      </div>

      <div slot="footer" class="flex gap-2">
        <button
          type="button"
          (click)="close.emit()"
          class="flex-1 rounded-md border border-border bg-surface px-4 py-2 text-sm"
        >
          Cancelar
        </button>
        <button
          type="button"
          (click)="submit()"
          [disabled]="!canSubmit() || submitting()"
          class="flex-1 rounded-md bg-red-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {{ submitting() ? 'Anulando...' : 'Anular planilla' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class VoidDispatchRouteModalComponent {
  readonly route = input.required<DispatchRoute>();
  readonly close = output<void>();
  readonly submitted = output<VoidDispatchRouteDto>();

  readonly submitting = signal(false);
  reason = '';
  notes = '';

  canSubmit(): boolean {
    return this.reason.length >= 3 && this.reason.length <= 500;
  }

  submit() {
    if (!this.canSubmit()) return;
    this.submitting.set(true);
    this.submitted.emit({
      reason: this.reason,
      notes: this.notes || undefined,
    });
  }
}
