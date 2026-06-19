import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CloseDispatchRouteDto, DispatchRoute } from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planilla-close-modal',
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
        <h2 class="text-lg font-semibold">Cerrar y Cuadrar Planilla</h2>

        <div class="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
          <div class="flex justify-between">
            <span>Total a recaudar:</span>
            <strong>{{ route.total_to_collect | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
          </div>
          <div class="flex justify-between">
            <span>Total recaudado:</span>
            <strong class="text-green-600">
              {{ route.total_collected | currency: 'COP' : 'symbol' : '1.0-0' }}
            </strong>
          </div>
          <div class="flex justify-between">
            <span>Total retenciones:</span>
            <strong>{{ route.total_withholdings | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
          </div>
          <div class="flex justify-between">
            <span>Total a crédito:</span>
            <strong class="text-yellow-600">
              {{ route.total_credit | currency: 'COP' : 'symbol' : '1.0-0' }}
            </strong>
          </div>
          <div class="flex justify-between">
            <span>Total cambios/devoluciones:</span>
            <strong>{{ route.total_changes | currency: 'COP' : 'symbol' : '1.0-0' }}</strong>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Efectivo declarado por el conductor</label>
          <input
            type="number"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-lg font-bold"
            [(ngModel)]="declaredCash"
            (input)="recalcVariance()"
            min="0"
          />
        </div>

        <div
          class="p-3 rounded-md text-sm font-semibold"
          [ngClass]="varianceClass()"
        >
          Diferencia de caja:
          {{ variance() | currency: 'COP' : 'symbol' : '1.0-0' }}
          @if (variance() === 0) { (CUADRA) }
          @else if (variance() > 0) { (SOBRA) }
          @else { (FALTA) }
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Notas (opcional)</label>
          <textarea
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows="2"
            [(ngModel)]="notes"
          ></textarea>
        </div>

        <div class="flex gap-2 pt-2">
          <button
            (click)="close.emit()"
            class="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm"
          >Cancelar</button>
          <button
            (click)="submit()"
            [disabled]="!canSubmit()"
            class="flex-1 rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >Cerrar Planilla</button>
        </div>
      </div>
    </div>
  `,
})
export class PlanillaCloseModalComponent {
  @Input({ required: true }) route!: DispatchRoute;
  @Output() close = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<CloseDispatchRouteDto>();

  declaredCash = 0;
  notes = '';

  variance = signal(0);

  readonly varianceClass = computed(() => {
    const v = this.variance();
    if (v === 0) return 'bg-green-50 text-green-800 border border-green-200';
    if (v > 0) return 'bg-blue-50 text-blue-800 border border-blue-200';
    return 'bg-red-50 text-red-800 border border-red-200';
  });

  recalcVariance() {
    // variance = declared - cash collected (assuming all collected is cash)
    const cashCollected = Number(this.route.total_collected) || 0;
    this.variance.set(Number(this.declaredCash) - cashCollected);
  }

  canSubmit(): boolean {
    return Number(this.declaredCash) >= 0;
  }

  submit() {
    this.submitted.emit({
      declared_cash: Number(this.declaredCash),
      notes: this.notes || undefined,
    });
  }
}
