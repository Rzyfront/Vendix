import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/index';
import {
  LodgingRestriction,
  restrictionLabels,
  Season,
  seasonRange,
  winningSeason,
} from '../../interfaces/rate-plan.interface';

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
  /** H2.3 — short labels of the night's restrictions ("Mín. 3", "CTA"…). */
  labels: string[];
  /** Full description for the tooltip. */
  title: string;
}

const pad = (value: number) => `${value}`.padStart(2, '0');

/** First day of today's month, `YYYY-MM-01`. */
function currentMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
}

/**
 * Hospitality Suite (H2.2) — rates calendar: one month, each night colored by
 * the season that prices it (highest priority when seasons overlap), with a
 * legend of the active seasons. H2.3: each night shows its restrictions and a
 * click opens them for editing.
 */
@Component({
  selector: 'app-rates-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonComponent, IconComponent, SelectorComponent],
  template: `
    <div class="space-y-3">
      <!-- U10 — arrows move one month, "Hoy" comes back and the selector jumps. -->
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div class="flex items-center gap-1">
          <app-button
            variant="outline"
            size="sm"
            customClasses="!h-11 !w-11 !px-0"
            ariaLabel="Mes anterior"
            (clicked)="shift(-1)"
            data-testid="rates-calendar-prev"
          >
            <app-icon slot="icon" name="chevron-left" [size]="18" />
          </app-button>
          <app-button
            variant="outline"
            size="sm"
            customClasses="!h-11"
            (clicked)="goToday()"
          >
            Hoy
          </app-button>
          <app-button
            variant="outline"
            size="sm"
            customClasses="!h-11 !w-11 !px-0"
            ariaLabel="Mes siguiente"
            (clicked)="shift(1)"
            data-testid="rates-calendar-next"
          >
            <app-icon slot="icon" name="chevron-right" [size]="18" />
          </app-button>
        </div>
        <app-selector
          class="w-44"
          size="sm"
          [options]="monthOptions()"
          [ngModel]="month()"
          (ngModelChange)="goTo($event)"
          id="rates-calendar-month"
          label="Mes"
          data-testid="rates-calendar-month"
        />
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
          <button
            type="button"
            class="flex min-h-12 flex-col rounded-md border border-border p-1 text-left hover:ring-2 hover:ring-primary/40"
            [style.background-color]="day.season ? day.season.color + '33' : null"
            [style.border-color]="day.season ? day.season.color : null"
            [attr.title]="day.title"
            [attr.data-season]="day.season?.name ?? null"
            [attr.data-date]="day.date"
            data-testid="rates-calendar-day"
            (click)="daySelected.emit(day.date)"
          >
            <span class="text-xs font-semibold text-text-primary">{{ day.day }}</span>
            @if (day.season) {
              <span class="truncate text-[10px] text-text-secondary">{{ day.season.name }}</span>
            }
            @for (label of day.labels; track label) {
              <span
                class="mt-0.5 truncate rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700"
                data-testid="rates-calendar-restriction"
              >
                {{ label }}
              </span>
            }
          </button>
        }
      </div>

      <p class="text-xs text-text-secondary">
        Toca una noche para fijar sus restricciones. Mín./Máx.: estancia para llegar esa noche ·
        CTA: cerrado a la llegada · CTD: cerrado a la salida · Stop: venta detenida.
      </p>

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
export class RatesCalendarComponent implements OnInit {
  readonly seasons = input<Season[]>([]);
  /** H2.3 — restrictions of the shown month and the names of the room types. */
  readonly restrictions = input<LodgingRestriction[]>([]);
  readonly unitTypeNames = input<ReadonlyMap<number, string>>(new Map());

  /** A night was clicked (`YYYY-MM-DD`). */
  readonly daySelected = output<string>();
  /** The shown month changed: its first and last night. */
  readonly monthChanged = output<{ from: string; to: string }>();

  readonly weekdayNames = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  /** First day of the shown month, `YYYY-MM-01`. */
  readonly month = signal(currentMonth());

  readonly activeSeasons = computed(() => this.seasons().filter((s) => s.is_active));

  /** "Octubre 2026" for a year back and two ahead of the shown month. */
  readonly monthOptions = computed<SelectorOption[]>(() => {
    const [year, month] = this.month().split('-').map(Number);
    return Array.from({ length: 37 }, (_, i) => {
      const date = new Date(Date.UTC(year, month - 1 + i - 12, 1));
      return {
        value: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`,
        label: `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      };
    });
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
    const names = this.unitTypeNames();
    return Array.from({ length: count }, (_, i) => {
      const date = `${year}-${pad(month)}-${pad(i + 1)}`;
      const season = winningSeason(date, seasons);
      // Every-type rows read "Mín. 3"; a type row reads "Suite: Stop".
      const labels = this.restrictions()
        .filter((r) => r.date === date)
        .flatMap((r) => {
          const prefix = r.unit_type_id == null ? '' : `${names.get(r.unit_type_id) ?? 'Tipo'}: `;
          return restrictionLabels(r).map((label) => prefix + label);
        });
      const title = [season ? season.name : 'Precio normal', ...labels].join(' · ');
      return { date, day: i + 1, season, labels, title };
    });
  });

  ngOnInit(): void {
    this.emitMonth();
  }

  range(season: Season): string {
    return seasonRange(season);
  }

  shift(delta: number): void {
    const [year, month] = this.month().split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + delta, 1));
    this.goTo(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-01`);
  }

  goToday(): void {
    this.goTo(currentMonth());
  }

  /** Shows the month of `value` (`YYYY-MM-01`); the same month is a no-op. */
  goTo(value: string | number | null): void {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-01$/.test(value) || value === this.month()) {
      return;
    }
    this.month.set(value);
    this.emitMonth();
  }

  private emitMonth(): void {
    const [year, month] = this.month().split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    this.monthChanged.emit({ from: this.month(), to: `${year}-${pad(month)}-${pad(last)}` });
  }
}
