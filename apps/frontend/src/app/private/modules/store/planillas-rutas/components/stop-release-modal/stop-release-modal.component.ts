import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  DispatchRouteStop,
  ReleaseStopDto,
} from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-stop-release-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Liberar Parada"
      size="md"
      (cancel)="close.emit()"
    >
      <div class="space-y-3">
        <p class="text-sm text-text-secondary">
          Vas a liberar
          <strong>{{ stop().dispatch_note?.dispatch_number }}</strong>
          ({{ stop().dispatch_note?.customer_name }}) para que pueda asignarse a
          otra planilla.
        </p>
        <div>
          <label class="block text-sm font-medium mb-1">Motivo</label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            rows="3"
            [(ngModel)]="reason"
            placeholder="Ej: Cliente no se encontraba en la dirección"
          ></textarea>
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
          [disabled]="!reason || reason.length < 3"
          class="flex-1 rounded-md bg-red-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Liberar
        </button>
      </div>
    </app-modal>
  `,
})
export class StopReleaseModalComponent {
  readonly stop = input.required<DispatchRouteStop>();
  readonly close = output<void>();
  readonly submitted = output<ReleaseStopDto>();

  reason = '';

  submit() {
    if (!this.reason || this.reason.length < 3) return;
    this.submitted.emit({ reason: this.reason });
  }
}
