import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DispatchRouteStop, ReleaseStopDto } from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-stop-release-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center"
      (click)="close.emit()"
    >
      <div
        class="bg-background rounded-t-2xl md:rounded-2xl w-full md:max-w-md p-4 space-y-3"
        (click)="$event.stopPropagation()"
      >
        <h2 class="text-lg font-semibold">Liberar Parada</h2>
        <p class="text-sm text-muted-foreground">
          Vas a liberar <strong>{{ stop.dispatch_note?.dispatch_number }}</strong>
          ({{ stop.dispatch_note?.customer_name }}) para que pueda asignarse a otra planilla.
        </p>
        <div>
          <label class="block text-sm font-medium mb-1">Motivo</label>
          <textarea
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows="3"
            [(ngModel)]="reason"
            placeholder="Ej: Cliente no se encontraba en la dirección"
          ></textarea>
        </div>
        <div class="flex gap-2 pt-2">
          <button
            (click)="close.emit()"
            class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm"
          >Cancelar</button>
          <button
            (click)="submit()"
            [disabled]="!reason || reason.length < 3"
            class="flex-1 rounded-md bg-red-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >Liberar</button>
        </div>
      </div>
    </div>
  `,
})
export class StopReleaseModalComponent {
  @Input({ required: true }) stop!: DispatchRouteStop;
  @Output() close = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<ReleaseStopDto>();

  reason = '';

  submit() {
    if (!this.reason || this.reason.length < 3) return;
    this.submitted.emit({ reason: this.reason });
  }
}
