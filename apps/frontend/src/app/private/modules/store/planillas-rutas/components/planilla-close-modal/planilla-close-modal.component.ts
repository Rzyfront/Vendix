import { Component, DestroyRef, computed, effect, OnInit, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  CloseDispatchRouteDto,
  DispatchRoute,
  RouteCloseOptions,
} from '../../interfaces/planilla.interface';
import { PlanillasRutasService } from '../../services/planillas-rutas.service';

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

        @if (optionsLoading()) {
          <p class="text-sm text-text-secondary">Cargando cajas abiertas...</p>
        } @else if (optionsError()) {
          <div class="p-3 rounded-md text-sm bg-red-50 text-red-800 border border-red-200">
            {{ optionsError() }}
          </div>
        } @else if (options(); as opts) {
          <div>
            <label for="close-cash-session" class="block text-sm font-medium mb-1">
              Caja donde se entrega el recaudo
              @if (opts.cash_required) { <span class="text-red-600">*</span> }
            </label>
            @if (opts.cash_required && opts.sessions.length === 0) {
              <div class="p-3 rounded-md text-sm bg-yellow-50 text-yellow-800 border border-yellow-200">
                No hay cajas abiertas. Abre una caja para poder entregar el recaudo.
              </div>
            } @else {
              <select
                id="close-cash-session"
                class="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                [value]="selectedSessionId() ?? ''"
                (change)="onSessionChange($any($event.target).value)"
              >
                @if (opts.cash_required) {
                  <option value="">Selecciona una caja</option>
                } @else {
                  <option value="">Sin caja</option>
                }
                @for (s of opts.sessions; track s.id) {
                  <option [value]="s.id">
                    {{ s.register_name }} · abierta por {{ s.opened_by.name }}
                  </option>
                }
              </select>
              <p class="mt-1 text-xs text-text-secondary">
                El usuario que tiene abierta esa caja queda como responsable del recaudo.
              </p>
            }
          </div>
        }

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
          {{ submitting() ? 'Cerrando...' : 'Cerrar Planilla' }}
        </button>
      </div>
    </app-modal>
  `,
})
export class PlanillaCloseModalComponent implements OnInit {
  readonly route = input.required<DispatchRoute>();
  readonly close = output<void>();
  readonly submitted = output<CloseDispatchRouteDto>();
  /** True while the parent is performing the close request (blocks double submit). */
  readonly submitting = input(false);

  private readonly service = inject(PlanillasRutasService);
  private readonly destroyRef = inject(DestroyRef);

  readonly options = signal<RouteCloseOptions | null>(null);
  readonly optionsLoading = signal(true);
  readonly optionsError = signal<string | null>(null);
  readonly selectedSessionId = signal<number | null>(null);

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

  ngOnInit() {
    this.service
      .getCloseOptions(this.route().id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (opts) => {
          this.options.set(opts);
          this.optionsLoading.set(false);
          // A single open session is preselected when the cash is mandatory.
          if (opts.cash_required && opts.sessions.length === 1) {
            this.selectedSessionId.set(opts.sessions[0].id);
          }
        },
        error: (e) => {
          this.optionsLoading.set(false);
          this.optionsError.set(
            parseApiError(e).userMessage || 'No se pudieron cargar las cajas abiertas.',
          );
        },
      });
  }

  onSessionChange(value: string) {
    this.selectedSessionId.set(value ? Number(value) : null);
  }

  recalcVariance() {
    // variance = declared - cash collected (assuming all collected is cash)
    this.variance.set(Number(this.declaredCash) - this.cashCollected());
  }

  canSubmit(): boolean {
    if (this.submitting() || this.optionsLoading() || this.optionsError()) return false;
    const opts = this.options();
    if (!opts) return false;
    if (opts.cash_required && this.selectedSessionId() === null) return false;
    return Number(this.declaredCash) >= 0;
  }

  submit() {
    if (!this.canSubmit()) return;
    const sessionId = this.selectedSessionId();
    this.submitted.emit({
      declared_cash: Number(this.declaredCash),
      notes: this.notes || undefined,
      ...(sessionId !== null ? { cash_register_session_id: sessionId } : {}),
    });
  }
}
