import { Component, computed, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  CloseDispatchRouteDto,
  DispatchRoute,
} from '../../interfaces/planilla.interface';

@Component({
  selector: 'app-planilla-close-modal',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, ModalComponent, InputComponent],
  template: `
    <app-modal
      [isOpen]="true"
      title="Cerrar y Cuadrar Planilla"
      size="md"
      (cancel)="close.emit()"
    >
      <div class="space-y-3">
        <div class="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
          <div class="flex justify-between">
            <span>Total a recaudar:</span>
            <strong>{{ +route().total_to_collect | currency }}</strong>
          </div>
          <div class="flex justify-between">
            <span>Total recaudado:</span>
            <strong class="text-green-600">
              {{ +route().total_collected | currency }}
            </strong>
          </div>
          <div class="flex justify-between">
            <span>Total retenciones:</span>
            <strong>{{ +route().total_withholdings | currency }}</strong>
          </div>
          <div class="flex justify-between">
            <span>Total a crédito:</span>
            <strong class="text-yellow-600">
              {{ +route().total_credit | currency }}
            </strong>
          </div>
          <div class="flex justify-between">
            <span>Total cambios/devoluciones:</span>
            <strong>{{ +route().total_changes | currency }}</strong>
          </div>
        </div>

        <app-input
          label="Efectivo declarado por el conductor"
          [currency]="true"
          [(ngModel)]="declaredCash"
          (inputChange)="recalcVariance()"
        ></app-input>

        <div class="p-3 rounded-md text-sm font-semibold" [class]="varianceClass()">
          Diferencia de caja:
          {{ variance() | currency }}
          @if (variance() === 0) {
            (CUADRA)
          } @else if (variance() > 0) {
            (SOBRA)
          } @else {
            (FALTA)
          }
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Notas (opcional)</label>
          <textarea
            class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            rows="2"
            [(ngModel)]="notes"
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
          [disabled]="!canSubmit()"
          class="flex-1 rounded-md bg-green-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Cerrar Planilla
        </button>
      </div>
    </app-modal>
  `,
})
export class PlanillaCloseModalComponent {
  readonly route = input.required<DispatchRoute>();
  readonly close = output<void>();
  readonly submitted = output<CloseDispatchRouteDto>();

  declaredCash = 0;
  notes = '';

  readonly variance = signal(0);
  /** Cash actually collected so far (from the route's persisted totals). */
  readonly cashCollected = computed(
    () => Number(this.route()?.total_collected ?? 0) || 0,
  );

  readonly varianceClass = computed(() => {
    const v = this.variance();
    if (v === 0) return 'bg-green-50 text-green-800 border border-green-200';
    if (v > 0) return 'bg-blue-50 text-blue-800 border border-blue-200';
    return 'bg-red-50 text-red-800 border border-red-200';
  });

  constructor() {
    // Recompute the variance every time the route() input changes AND once
    // on init. Without this the operator would see `0 - total_collected`
    // (a giant FALTA) until they touched the input.
    effect(() => {
      this.route();
      this.recalcVariance();
    });
  }

  recalcVariance() {
    // variance = declared - cash collected (assuming all collected is cash)
    this.variance.set(Number(this.declaredCash) - this.cashCollected());
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
