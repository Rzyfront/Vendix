import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ToggleComponent,
} from '../../../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import {
  BookingSeriesInput,
  BookingSeriesPreviewRow,
  BookingSeriesResult,
  ReservationsService,
} from '../../../services/reservations.service';

const MAX_OCCURRENCES = 26;
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Booking fields every occurrence shares (the series adds only the recurrence). */
export type SeriesBase = Omit<BookingSeriesInput, 'frequency' | 'interval_count' | 'occurrences' | 'skip_conflicts'>;

/** "14-nov" from a YYYY-MM-DD date (no timezone math). */
export function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${day}-${MONTHS[month - 1] ?? ''}`;
}

/** "Se crearon 6 reservas · 2 fechas chocan: 14-nov, 21-nov". */
export function seriesSummary(result: BookingSeriesResult): string {
  const created = result.created.length;
  const head = `Se ${created === 1 ? 'creó 1 reserva' : `crearon ${created} reservas`}`;
  if (result.conflicts.length === 0) return head;
  const dates = result.conflicts.map((c) => shortDate(c.date)).join(', ');
  const n = result.conflicts.length;
  return `${head} · ${n === 1 ? '1 fecha choca' : `${n} fechas chocan`}: ${dates}`;
}

function toBoundedInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** "Repetir" option of the reservation modal (S19): frequency, every N, occurrences, date preview. */
@Component({
  selector: 'app-booking-series-form',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent, ToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="series-form" aria-labelledby="series-form-title">
      <div class="series-head">
        <div>
          <h4 id="series-form-title" class="series-title">
            <app-icon name="repeat" [size]="14" />
            Repetir esta reserva
          </h4>
          <p class="series-hint">Crea las próximas fechas de una vez. Cada una se cancela por separado.</p>
        </div>
        <app-toggle [checked]="repeating()" ariaLabel="Repetir la reserva" (changed)="onToggle($event)" />
      </div>

      @if (repeating()) {
        <div class="series-grid">
          <app-selector
            label="Frecuencia"
            [options]="frequencyOptions"
            [ngModel]="frequency()"
            (ngModelChange)="frequency.set($event); resetPreview()"
          />
          <app-input
            [label]="frequency() === 'weekly' ? 'Cada (semanas)' : 'Cada (días)'"
            type="number"
            min="1"
            max="52"
            [ngModel]="intervalCount()"
            (ngModelChange)="intervalCount.set(toInt($event, 1, 52, 1)); resetPreview()"
          />
          <app-input
            label="Repeticiones (1-26)"
            type="number"
            min="1"
            max="26"
            [ngModel]="occurrences()"
            (ngModelChange)="occurrences.set(toInt($event, 1, 26, 1)); resetPreview()"
          />
        </div>

        <div class="series-actions">
          <app-button variant="outline" size="sm" [loading]="previewing()" [disabled]="busy()" (clicked)="loadPreview()">
            <app-icon slot="icon" name="calendar" [size]="14" />
            Ver fechas
          </app-button>
          <app-button variant="primary" size="sm" [loading]="creating()" [disabled]="busy()" (clicked)="create()">
            <app-icon slot="icon" name="check" [size]="16" />
            Crear serie
          </app-button>
        </div>

        @if (errorMessage(); as message) {
          <p class="series-error" role="alert">{{ message }}</p>
        }

        @if (preview(); as rows) {
          <ul class="series-list" aria-label="Fechas de la serie">
            @for (row of rows; track row.index) {
              <li class="series-row" [class.is-conflict]="row.status === 'conflict'">
                <span class="series-date">{{ label(row.date) }}</span>
                @if (row.status === 'ok') {
                  <span class="series-state">Libre</span>
                } @else {
                  <span class="series-state">Choca{{ row.message ? ': ' + row.message : '' }}</span>
                }
              </li>
            }
          </ul>
          @if (conflictCount() > 0) {
            <p class="series-hint">Las fechas libres se crean y las que chocan se omiten.</p>
          }
        }

        @if (result(); as done) {
          <p class="series-result" aria-live="polite">{{ summary(done) }}</p>
        }
      }
    </section>
  `,
  styles: [
    `
      .series-form { margin-top: 1rem; padding: 0.75rem; border-radius: 0.75rem; background: var(--color-background); border: 1px solid var(--color-border); display: flex; flex-direction: column; gap: 0.75rem; }
      .series-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
      .series-title { display: flex; align-items: center; gap: 0.375rem; margin: 0; font-size: 0.75rem; font-weight: 700; color: var(--color-text-primary); }
      .series-hint { margin: 0.125rem 0 0; font-size: 0.75rem; color: var(--color-text-secondary); }
      .series-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
      .series-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
      .series-error { margin: 0; font-size: 0.75rem; color: var(--color-error, #dc2626); }
      .series-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; max-height: 14rem; overflow-y: auto; }
      .series-row { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.375rem 0.625rem; border-radius: 0.5rem; background: var(--color-surface); border: 1px solid var(--color-border); font-size: 0.75rem; color: var(--color-text-primary); }
      .series-row.is-conflict { border-color: var(--color-error, #dc2626); }
      .series-state { color: var(--color-text-secondary); text-align: right; }
      .series-row.is-conflict .series-state { color: var(--color-error, #dc2626); }
      .series-result { margin: 0; font-size: 0.8125rem; font-weight: 600; color: var(--color-text-primary); }
      @media (min-width: 640px) { .series-grid { grid-template-columns: repeat(3, 1fr); } }
    `,
  ],
})
export class SeriesFormComponent {
  private readonly reservations = inject(ReservationsService);
  private readonly destroyRef = inject(DestroyRef);

  /** Booking fields shared by every occurrence; null while the booking is incomplete. */
  readonly base = input.required<SeriesBase | null>();
  /** Two-way: true while the series is the way this booking gets created (hides the single-booking button). */
  readonly repeating = model(false);
  readonly created = output<BookingSeriesResult>();

  readonly frequencyOptions: SelectorOption[] = [
    { value: 'daily', label: 'Diaria' },
    { value: 'weekly', label: 'Semanal' },
  ];

  readonly frequency = signal<'daily' | 'weekly'>('weekly');
  readonly intervalCount = signal(1);
  readonly occurrences = signal(4);
  readonly preview = signal<BookingSeriesPreviewRow[] | null>(null);
  readonly result = signal<BookingSeriesResult | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly previewing = signal(false);
  readonly creating = signal(false);

  readonly busy = computed(() => this.previewing() || this.creating() || !this.base());
  readonly conflictCount = computed(() => (this.preview() ?? []).filter((r) => r.status === 'conflict').length);

  protected readonly summary = seriesSummary;
  protected readonly label = shortDate;
  protected readonly toInt = toBoundedInt;

  onToggle(checked: boolean): void {
    this.repeating.set(checked);
    this.resetPreview();
    this.result.set(null);
  }

  resetPreview(): void {
    this.preview.set(null);
    this.errorMessage.set(null);
  }

  loadPreview(): void {
    const body = this.body();
    if (!body) return;
    this.previewing.set(true);
    this.errorMessage.set(null);
    this.reservations
      .previewBookingSeries(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.preview.set(rows);
          this.previewing.set(false);
        },
        error: (error: unknown) => {
          this.previewing.set(false);
          this.errorMessage.set(extractApiErrorMessage(error) || 'No fue posible calcular las fechas.');
        },
      });
  }

  create(): void {
    const body = this.body();
    if (!body) return;
    this.creating.set(true);
    this.errorMessage.set(null);
    this.reservations
      .createBookingSeries(body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.creating.set(false);
          this.result.set(result);
          this.created.emit(result);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          // Includes the 400 for stations with a booking prepay or a required deposit.
          this.errorMessage.set(extractApiErrorMessage(error) || 'No fue posible crear la serie.');
        },
      });
  }

  private body(): BookingSeriesInput | null {
    const base = this.base();
    if (!base) return null;
    return {
      ...base,
      frequency: this.frequency(),
      interval_count: this.intervalCount(),
      occurrences: Math.min(this.occurrences(), MAX_OCCURRENCES),
    };
  }
}
