import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  ToastService,
} from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import {
  isClockTime,
  toMinutes,
  validateWeeklyBlocks,
  windowSpan,
} from '../../../../../../../shared/utils/schedule-window.util';
import { ServiceStationsService, StationRateWindow } from '../service-stations.service';

const DAY_MIN = 1440;

/** Weekday labels indexed like the backend (0 = domingo). */
export const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;

interface RateWindowRow {
  key: number;
  weekday: number;
  start_time: string;
  end_time: string;
  block_price: number | null;
}

/**
 * Price a block starting at `weekday` + `time` pays: the window where the block STARTS (S18),
 * including the previous day's overnight spill; no window = the base block price.
 */
export function priceAt(
  windows: ReadonlyArray<Pick<StationRateWindow, 'weekday' | 'start_time' | 'end_time' | 'block_price'>>,
  weekday: number,
  time: string,
  basePrice: number,
): { price: number; fromWindow: boolean } {
  if (!isClockTime(time)) return { price: basePrice, fromWindow: false };
  const minute = toMinutes(time);
  for (const w of windows) {
    const span = windowSpan(w);
    if (w.weekday === weekday && minute >= span.startMin && minute < span.endMin) {
      return { price: w.block_price, fromWindow: true };
    }
    // Overnight spill of the previous day lands on the early minutes of this one.
    if (w.weekday === (weekday + 6) % 7 && span.endMin > DAY_MIN && minute < span.endMin - DAY_MIN) {
      return { price: w.block_price, fromWindow: true };
    }
  }
  return { price: basePrice, fromWindow: false };
}

/** Editor of the station's rate windows (S18): weekday, start, end, price, plus a price preview. */
@Component({
  selector: 'app-station-rate-windows',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, InputComponent, SelectorComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="p-3 rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] space-y-3"
      aria-labelledby="station-rate-windows-title"
    >
      <div>
        <h4 id="station-rate-windows-title" class="text-xs font-bold text-[var(--color-text-primary)]">
          Tarifa por franja
        </h4>
        <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
          Cada bloque se cobra con la franja donde empieza. Sin franja, se cobra la tarifa base de
          {{ blockPrice() | currency }}. Una franja que termina antes de empezar pasa al día siguiente.
        </p>
      </div>

      @if (loading()) {
        <p class="text-xs text-[var(--color-text-secondary)]">Cargando franjas…</p>
      } @else {
        @if (rows().length === 0) {
          <p class="text-xs text-[var(--color-text-secondary)]">Sin franjas: todo el tiempo se cobra a la tarifa base.</p>
        }

        @for (row of rows(); track row.key) {
          <div
            class="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_1.4fr_auto] gap-2 items-end p-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
          >
            <app-selector
              class="col-span-2 sm:col-span-1"
              label="Día"
              [options]="weekdayOptions"
              [ngModel]="row.weekday"
              (ngModelChange)="updateRow(row.key, { weekday: +$event })"
            />
            <app-input
              label="Desde"
              type="time"
              [ngModel]="row.start_time"
              (ngModelChange)="updateRow(row.key, { start_time: $event })"
            />
            <app-input
              label="Hasta"
              type="time"
              [ngModel]="row.end_time"
              (ngModelChange)="updateRow(row.key, { end_time: $event })"
            />
            <app-input
              class="col-span-2 sm:col-span-1"
              label="Precio del bloque"
              [currency]="true"
              [ngModel]="row.block_price"
              (ngModelChange)="updateRow(row.key, { block_price: toPrice($event) })"
            />
            <app-button
              class="col-span-2 sm:col-span-1 justify-self-end"
              variant="ghost"
              size="sm"
              (clicked)="removeRow(row.key)"
            >
              <app-icon slot="icon" name="trash-2" [size]="14" />
              Quitar
            </app-button>
          </div>
        }

        @if (validationError(); as problem) {
          <p class="text-xs text-[var(--color-error,#dc2626)]" role="alert">{{ problem }}</p>
        }

        <div class="flex flex-wrap items-center justify-between gap-2">
          <app-button variant="outline" size="sm" (clicked)="addRow()">
            <app-icon slot="icon" name="plus" [size]="14" />
            Agregar franja
          </app-button>
          <app-button
            variant="primary"
            size="sm"
            [loading]="saving()"
            [disabled]="!!validationError() || !dirty()"
            (clicked)="save()"
          >
            Guardar franjas
          </app-button>
        </div>

        <div class="border-t border-[var(--color-border)] pt-3 space-y-2">
          <h5 class="text-xs font-bold text-[var(--color-text-primary)]">Vista previa</h5>
          <div class="grid grid-cols-2 gap-2">
            <app-selector
              label="Día"
              [options]="weekdayOptions"
              [ngModel]="previewWeekday()"
              (ngModelChange)="previewWeekday.set(+$event)"
            />
            <app-input label="Hora de inicio" type="time" [ngModel]="previewTime()" (ngModelChange)="previewTime.set($event)" />
          </div>
          @if (preview(); as result) {
            <p class="text-sm font-semibold text-[var(--color-text-primary)]" aria-live="polite">
              {{ result.label }} → {{ result.price | currency }}
              <span class="text-xs font-normal text-[var(--color-text-secondary)]">
                {{ result.fromWindow ? '(franja)' : '(tarifa base)' }}
              </span>
            </p>
          }
          @if (dirty()) {
            <p class="text-xs text-[var(--color-text-secondary)]">La vista previa usa las franjas sin guardar.</p>
          }
        </div>
      }
    </section>
  `,
})
export class StationRateWindowsComponent {
  private readonly api = inject(ServiceStationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly stationId = input.required<number>();
  /** Station base block price, charged where no window applies. */
  readonly blockPrice = input.required<number>();

  readonly weekdayOptions: SelectorOption[] = WEEKDAY_LABELS.map((label, value) => ({ value, label }));

  readonly rows = signal<RateWindowRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly previewWeekday = signal(6);
  readonly previewTime = signal('20:00');

  private nextKey = 1;
  /** Serialized saved state, to know whether there is anything to save. */
  private readonly saved = signal('[]');

  readonly dirty = computed(() => this.serialize(this.rows()) !== this.saved());

  readonly validationError = computed<string | null>(() => {
    const rows = this.rows();
    for (const row of rows) {
      if (!isClockTime(row.start_time) || !isClockTime(row.end_time)) return 'Cada franja necesita hora de inicio y de fin.';
      if (row.block_price == null || row.block_price < 0) return 'Cada franja necesita un precio.';
    }
    const problem = validateWeeklyBlocks(
      rows.map((r) => ({ day: r.weekday, start_time: r.start_time, end_time: r.end_time })),
    );
    if (problem?.reason === 'overlap') {
      return `Las franjas del ${WEEKDAY_LABELS[problem.day].toLowerCase()} se superponen.`;
    }
    return problem ? 'Cada franja necesita hora de inicio y de fin.' : null;
  });

  readonly preview = computed(() => {
    const weekday = this.previewWeekday();
    const time = this.previewTime();
    if (!isClockTime(time)) return null;
    const windows = this.rows()
      .filter((r) => r.block_price != null && isClockTime(r.start_time) && isClockTime(r.end_time))
      .map((r) => ({
        weekday: r.weekday,
        start_time: r.start_time,
        end_time: r.end_time,
        block_price: r.block_price as number,
      }));
    const result = priceAt(windows, weekday, time, this.blockPrice());
    return { ...result, label: `${WEEKDAY_LABELS[weekday]} ${time}` };
  });

  protected readonly toPrice = (value: unknown): number | null =>
    value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

  constructor() {
    effect(() => {
      const id = this.stationId();
      untracked(() => this.load(id));
    });
  }

  addRow(): void {
    this.rows.update((rows) => [
      ...rows,
      { key: this.nextKey++, weekday: 6, start_time: '18:00', end_time: '23:00', block_price: this.blockPrice() },
    ]);
  }

  removeRow(key: number): void {
    this.rows.update((rows) => rows.filter((r) => r.key !== key));
  }

  updateRow(key: number, change: Partial<RateWindowRow>): void {
    this.rows.update((rows) => rows.map((r) => (r.key === key ? { ...r, ...change } : r)));
  }

  save(): void {
    if (this.validationError() || this.saving()) return;
    const windows: StationRateWindow[] = this.rows().map((r) => ({
      weekday: r.weekday,
      start_time: r.start_time,
      end_time: r.end_time,
      block_price: r.block_price as number,
    }));
    this.saving.set(true);
    this.api
      .setRateWindows(this.stationId(), windows)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Franjas guardadas.');
          this.load(this.stationId());
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.toast.error(extractApiErrorMessage(error) || 'No fue posible guardar las franjas.');
        },
      });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.api
      .getRateWindows(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (windows) => {
          const rows = (windows ?? []).map<RateWindowRow>((w) => ({
            key: this.nextKey++,
            weekday: w.weekday,
            start_time: w.start_time,
            end_time: w.end_time,
            block_price: w.block_price,
          }));
          this.rows.set(rows);
          this.saved.set(this.serialize(rows));
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(error) || 'No fue posible cargar las franjas.');
        },
      });
  }

  private serialize(rows: RateWindowRow[]): string {
    return JSON.stringify(rows.map((r) => [r.weekday, r.start_time, r.end_time, r.block_price]));
  }
}
