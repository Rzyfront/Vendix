import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** Una fila rechazada por `resolve-lines`. `row` es la posición en el carrito (1-based). */
export interface PopBulkRowError {
  row: number;
  label: string;
  message: string;
}

/**
 * Estado del panel de progreso de las fases largas de una compra grande:
 * resolver productos nuevos por lotes y recibir por job.
 */
export interface PopBulkProgressState {
  kind: 'resolve' | 'receive';
  /** `running` avanza; `blocked` espera una decisión del operador. */
  status: 'running' | 'blocked';
  /** Texto de la barra: «Resolviendo productos», «Recibiendo». */
  label: string;
  /** Unidad que se cuenta: «productos», «líneas». */
  unit: string;
  processed: number;
  total: number;
  message?: string;
  rowErrors?: PopBulkRowError[];
  canRetry?: boolean;
}

/**
 * Panel flotante y sobrio con el avance de una fase larga del POP. Un solo
 * acento (el primario del tema); el bloqueo usa el color destructivo.
 */
@Component({
  selector: 'app-pop-bulk-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as s) {
      <div
        class="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-[26rem] z-[10000] rounded-card border border-border bg-surface shadow-card p-4"
        role="status"
        aria-live="polite"
      >
        <div class="flex items-baseline justify-between gap-3">
          <span class="text-sm font-semibold text-[var(--color-text-primary)]">
            {{ s.label }} {{ s.processed }} de {{ s.total }} {{ s.unit }}
          </span>
          <span class="text-xs text-[var(--color-text-secondary)]">{{ percent() }}%</span>
        </div>

        <div
          class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-muted)]"
          role="progressbar"
          [attr.aria-valuenow]="percent()"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full bg-[var(--color-primary)] transition-all"
            [style.width.%]="percent()"
          ></div>
        </div>

        @if (s.message) {
          <p
            [class]="
              s.status === 'blocked'
                ? 'mt-3 text-sm text-[var(--color-destructive)]'
                : 'mt-3 text-sm text-[var(--color-text-secondary)]'
            "
          >
            {{ s.message }}
          </p>
        }

        @if (s.rowErrors?.length) {
          <ul
            class="mt-2 max-h-40 overflow-y-auto divide-y divide-[var(--color-border)] rounded border border-border text-xs"
          >
            @for (e of s.rowErrors; track e.row) {
              <li class="px-2 py-1.5 text-[var(--color-text-primary)]">
                <span class="font-medium">Fila {{ e.row }}</span>
                @if (e.label) {
                  <span class="text-[var(--color-text-secondary)]"> · {{ e.label }}</span>
                }
                <div class="text-[var(--color-destructive)]">{{ e.message }}</div>
              </li>
            }
          </ul>
        }

        @if (s.status === 'blocked') {
          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-md border border-border text-[var(--color-text-primary)]"
              (click)="dismiss.emit()"
            >
              Cerrar
            </button>
            @if (s.canRetry) {
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-md bg-[var(--color-primary)] text-[var(--color-text-on-primary)]"
                (click)="retry.emit()"
              >
                Reintentar
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class PopBulkProgressComponent {
  readonly state = input<PopBulkProgressState | null>(null);
  readonly retry = output<void>();
  readonly dismiss = output<void>();

  readonly percent = computed(() => {
    const s = this.state();
    if (!s || s.total <= 0) return 0;
    return Math.min(100, Math.round((s.processed / s.total) * 100));
  });
}
