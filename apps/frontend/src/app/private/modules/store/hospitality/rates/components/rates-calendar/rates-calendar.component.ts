import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { IconComponent } from '../../../../../../../shared/components/index';
import { Season, seasonRange, winningSeason } from '../../interfaces/rate-plan.interface';

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

interface CalendarDay {
  date: string;
  day: number;
  season: Season | null;
}

const pad = (value: number) => `${value}`.padStart(2, '0');

/**
 * Hospitality Suite (H2.2) — rates calendar: one month, each night colored by
 * the season that prices it (highest priority when seasons overlap), with a
 * legend of the active seasons. Later slices add per-day restrictions here.
 */
@Component({
  selector: 'app-rates-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <button
          type="button"
          class="rounded-lg p-2 hover:bg-gray-100"
          aria-label="Mes anterior"
          (click)="shift(-1)"
        >
          <app-icon name="chevron-left" [size]="18" />
        </button>
        <p class="text-sm font-semibold text-text-primary" data-testid="rates-calendar-month">
          {{ monthLabel() }}
        </p>
        <button
          type="button"
          class="rounded-lg p-2 hover:bg-gray-100"
          aria-label="Mes siguiente"
          (click)="shift(1)"
        >
          <app-icon name="chevron-right" [size]="18" />
        </button>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary">
        @for (name of weekdayNames; track name) {
          <span>{{ name }}</span>
        }
      </div>
      <div class="grid grid-cols-7 gap-1">
        @for (blank of leadingBlanks(); track $index) {
          <span></span>
        }
        @for (day of days(); track day.date) {
          <div
            class="flex min-h-12 flex-col rounded-md border border-border p-1 text-left"
            [style.background-color]="day.season ? day.season.color + '33' : null"
            [style.border-color]="day.season ? day.season.color : null"
            [attr.title]="day.season ? day.season.name : 'Precio normal'"
            [attr.data-season]="day.season?.name ?? null"
            data-testid="rates-calendar-day"
          >
            <span class="text-xs font-semibold text-text-primary">{{ day.day }}</span>
            @if (day.season) {
              <span class="truncate text-[10px] text-text-secondary">{{ day.season.name }}</span>
            }
          </div>
        }
      </div>

      <div class="flex flex-wrap gap-3 text-xs text-text-secondary">
        <span class="flex items-center gap-1">
          <span class="h-3 w-3 rounded-sm border border-border bg-white"></span>
          Precio normal
        </span>
        @for (season of activeSeasons(); track season.id) {
          <span class="flex items-center gap-1">
            <span class="h-3 w-3 rounded-sm" [style.background-color]="season.color"></span>
            {{ season.name }} · {{ range(season) }} · prioridad {{ season.priority }}
          </span>
        }
      </div>
    </div>
  `,
})
export class RatesCalendarComponent {
  readonly seasons = input<Season[]>([]);

  readonly weekdayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  /** First day of the shown month, `YYYY-MM-01`. */
  private readonly month = signal(
    (() => {
      const today = new Date();
      return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
    })(),
  );

  readonly activeSeasons = computed(() => this.seasons().filter((s) => s.is_active));

  readonly monthLabel = computed(() => {
    const [year, month] = this.month().split('-').map(Number);
    return `${MONTH_NAMES[month - 1]} ${year}`;
  });

  /** Empty cells before the 1st so weeks start on Monday. */
  readonly leadingBlanks = computed(() => {
    const sunday0 = new Date(`${this.month()}T00:00:00.000Z`).getUTCDay();
    return Array.from({ length: (sunday0 + 6) % 7 });
  });

  readonly days = computed<CalendarDay[]>(() => {
    const [year, month] = this.month().split('-').map(Number);
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const seasons = this.activeSeasons();
    return Array.from({ length: count }, (_, i) => {
      const date = `${year}-${pad(month)}-${pad(i + 1)}`;
      return { date, day: i + 1, season: winningSeason(date, seasons) };
    });
  });

  range(season: Season): string {
    return seasonRange(season);
  }

  shift(delta: number): void {
    const [year, month] = this.month().split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    this.month.set(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`);
  }
}
