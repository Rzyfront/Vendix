import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../../../../../../shared/components';
import { dayMonth, fullDate, weekdayShort } from '../../../scheduled-orders/utils/ymd.util';
import {
  ProviderDayAvailability,
  SchedulingEvent,
  SchedulingStatusGroup,
} from '../../interfaces/scheduling.interface';
import {
  AgendaView,
  availabilityByDay,
  eventsByDay,
  offHourBands,
  hourRangeFor,
  layoutDay,
  monthGrid,
  weekDays,
} from '../../utils/scheduling-calendar.util';

/** Tinte por grupo de estado (tokens, sin colores fijos). */
export const STATUS_GROUP_TONE: Record<SchedulingStatusGroup, string> = {
  pending: 'bg-warning/10 border-warning/25 text-warning',
  confirmed: 'bg-info/10 border-info/25 text-info',
  in_progress: 'bg-primary/10 border-primary/25 text-primary-on-tint',
  completed: 'bg-success/10 border-success/25 text-success',
  cancelled: 'bg-muted/10 border-border text-text-secondary line-through',
  no_show: 'bg-error/10 border-error/25 text-error',
};

export const TYPE_ICON: Record<SchedulingEvent['type'], string> = {
  booking: 'calendar-clock',
  scheduled_order: 'package',
};

/** Máximo de eventos por celda del mes antes de «+N más». */
const MONTH_CELL_LIMIT = 3;

/**
 * Calendario de la Agenda (mes / semana / día). Genérico sobre
 * `SchedulingEvent`: no sabe de reservas ni de pedidos; un clic emite el
 * evento y la pantalla abre el flujo propio de su módulo.
 */
@Component({
  selector: 'app-event-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  styles: [
    `
      :host {
        display: block;
      }
      .grid-7 {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
      }
      .time-grid {
        position: relative;
        height: calc(var(--hours) * 3rem);
      }
      .hour-line {
        position: absolute;
        left: 0;
        right: 0;
        border-top: 1px solid var(--color-border);
      }
      .off-hours {
        position: absolute;
        left: 0;
        right: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          135deg,
          color-mix(in srgb, var(--color-text-muted) 10%, transparent) 0 0.25rem,
          transparent 0.25rem 0.5rem
        );
      }
      .ev-block {
        position: absolute;
        overflow: hidden;
      }
    `,
  ],
  template: `
    @switch (view()) {
      @case ('month') {
        <div class="grid-7 border-b border-border text-center text-xs font-semibold text-text-secondary">
          @for (d of weekHeader(); track d) {
            <div class="py-2 capitalize">{{ d }}</div>
          }
        </div>
        @for (week of month(); track week[0]) {
          <div class="grid-7 border-b border-border">
            @for (day of week; track day) {
              <div
                class="min-h-16 border-r border-border p-1 last:border-r-0 md:min-h-28"
                [class.opacity-50]="!inMonth(day)"
              >
                <button
                  type="button"
                  class="mb-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                  [class]="day === today() ? 'bg-primary text-white' : 'text-text-primary hover:bg-primary/10'"
                  [attr.aria-label]="'Ver ' + longDate(day)"
                  (click)="dayClick.emit(day)"
                >
                  {{ dayNumber(day) }}
                </button>
                @if (availabilityLabel(day); as label) {
                  <span
                    class="mb-1 block truncate rounded-md bg-muted/10 px-1 text-xs text-text-secondary"
                    [attr.title]="label"
                    data-testid="day-unavailable"
                    >{{ label }}</span
                  >
                }
                @if (byDay().get(day); as list) {
                  <!-- Celular: solo el conteo; tocar el día abre la vista Día. -->
                  <button
                    type="button"
                    class="w-full rounded-md bg-primary/10 px-1 text-xs font-semibold text-primary-on-tint md:hidden"
                    (click)="dayClick.emit(day)"
                  >
                    {{ list.length }}
                  </button>
                  <div class="hidden flex-col gap-1 md:flex">
                    @for (ev of list.slice(0, cellLimit); track ev.id) {
                      <button
                        type="button"
                        class="flex w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 text-left text-xs font-semibold"
                        [class]="tone(ev)"
                        [attr.aria-label]="ariaFor(ev)"
                        (click)="eventClick.emit(ev)"
                      >
                        <app-icon [name]="icon(ev)" [size]="12" />
                        <span class="truncate">{{ ev.local_start }} {{ ev.title }}</span>
                      </button>
                    }
                    @if (list.length > cellLimit) {
                      <button
                        type="button"
                        class="text-left text-xs font-semibold text-text-secondary hover:text-primary"
                        (click)="dayClick.emit(day)"
                      >
                        +{{ list.length - cellLimit }} más
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      }

      @default {
        <!-- Semana y día: rejilla horaria en la zona de la tienda. -->
        <div class="flex border-b border-border">
          <div class="w-12 shrink-0"></div>
          <div class="grid flex-1" [style.grid-template-columns]="'repeat(' + days().length + ', minmax(0, 1fr))'">
            @for (day of days(); track day) {
              <button
                type="button"
                class="py-2 text-center text-xs font-semibold capitalize"
                [class]="day === today() ? 'text-primary' : 'text-text-secondary'"
                (click)="dayClick.emit(day)"
              >
                {{ weekday(day) }} {{ shortDate(day) }}
              </button>
            }
          </div>
        </div>
        <div class="flex" [style.--hours]="hours().length">
          <div class="relative w-12 shrink-0 time-grid">
            @for (h of hours(); track h; let i = $index) {
              <span
                class="absolute right-1 -translate-y-1/2 text-xs text-text-secondary"
                [style.top.%]="(i / hours().length) * 100"
              >
                {{ h }}
              </span>
            }
          </div>
          <div class="grid flex-1" [style.grid-template-columns]="'repeat(' + days().length + ', minmax(0, 1fr))'">
            @for (day of days(); track day) {
              <div class="time-grid border-l border-border">
                @for (h of hours(); track h; let i = $index) {
                  <div class="hour-line" [style.top.%]="(i / hours().length) * 100"></div>
                }
                <!-- Disponibilidad del prestador filtrado: fuera de horario,
                     bloqueos y excepciones quedan sombreados. -->
                @for (band of offBands().get(day) ?? []; track band.top) {
                  <div class="off-hours" data-testid="off-hours" [style.top.%]="band.top" [style.height.%]="band.height"></div>
                }
                @if (availabilityLabel(day); as label) {
                  <div
                    class="absolute inset-x-1 top-1 z-10 truncate rounded-md bg-muted/10 px-1.5 py-0.5 text-xs font-semibold text-text-secondary"
                    data-testid="day-unavailable"
                  >
                    {{ label }}
                  </div>
                }
                @for (p of placed().get(day) ?? []; track p.event.id) {
                  <button
                    type="button"
                    class="ev-block rounded-md border px-1.5 py-1 text-left text-xs"
                    [class]="tone(p.event)"
                    [style.top.%]="p.top"
                    [style.height.%]="p.height"
                    [style.left.%]="(p.lane / p.lanes) * 100"
                    [style.width]="'calc(' + 100 / p.lanes + '% - 2px)'"
                    [attr.aria-label]="ariaFor(p.event)"
                    (click)="eventClick.emit(p.event)"
                  >
                    <span class="flex items-center gap-1 font-semibold">
                      <app-icon [name]="icon(p.event)" [size]="12" />
                      <span class="truncate">{{ p.event.local_start }}–{{ p.event.local_end }}</span>
                    </span>
                    <span class="block truncate font-semibold">{{ p.event.title }}</span>
                    @if (p.event.customer || p.event.staff) {
                      <span class="block truncate opacity-80">
                        {{ p.event.customer?.name ?? '' }}{{ p.event.customer && p.event.staff ? ' · ' : '' }}{{ p.event.staff?.name ?? '' }}
                      </span>
                    }
                  </button>
                }
              </div>
            }
          </div>
        </div>
      }
    }
  `,
})
export class EventCalendarComponent {
  readonly view = input.required<AgendaView>();
  /** Fecha ancla (`YYYY-MM-DD`): mes, semana o día visibles. */
  readonly anchor = input.required<string>();
  readonly today = input<string>('');
  readonly events = input<readonly SchedulingEvent[]>([]);
  /** Disponibilidad de los prestadores filtrados (vacío = no se pinta). */
  readonly availability = input<readonly ProviderDayAvailability[]>([]);

  readonly eventClick = output<SchedulingEvent>();
  readonly dayClick = output<string>();

  readonly cellLimit = MONTH_CELL_LIMIT;

  readonly byDay = computed(() => eventsByDay(this.events()));
  readonly month = computed(() => monthGrid(this.anchor()));
  readonly weekHeader = computed(() => weekDays(this.anchor()).map((d) => weekdayShort(d)));
  readonly days = computed(() =>
    this.view() === 'day' ? [this.anchor()] : weekDays(this.anchor()),
  );
  private readonly visibleEvents = computed(() => {
    const days = new Set(this.days());
    return this.events().filter((ev) => days.has(ev.date));
  });
  readonly availabilityDays = computed(() => availabilityByDay(this.availability()));
  readonly range = computed(() => {
    const days = this.availabilityDays();
    const windows = this.days().flatMap((day) =>
      (days.get(day)?.windows ?? []).map((w) => ({
        start: `${String(Math.floor(w.start / 60)).padStart(2, '0')}:${String(w.start % 60).padStart(2, '0')}`,
        end: w.end >= 1440 ? '00:00' : `${String(Math.floor(w.end / 60)).padStart(2, '0')}:${String(w.end % 60).padStart(2, '0')}`,
      })),
    );
    return hourRangeFor(this.visibleEvents(), windows);
  });
  readonly offBands = computed(() => {
    const range = this.range();
    const days = this.availabilityDays();
    const map = new Map<string, ReturnType<typeof offHourBands>>();
    for (const day of this.days()) map.set(day, offHourBands(days.get(day), range));
    return map;
  });
  readonly hours = computed(() => {
    const { start, end } = this.range();
    const out: string[] = [];
    for (let m = start; m < end; m += 60) out.push(`${String(m / 60).padStart(2, '0')}:00`);
    return out;
  });
  readonly placed = computed(() => {
    const range = this.range();
    const byDay = this.byDay();
    const map = new Map<string, ReturnType<typeof layoutDay>>();
    for (const day of this.days()) map.set(day, layoutDay(byDay.get(day) ?? [], range));
    return map;
  });

  /** «No disponible: motivo» o «Sin horario» para el día del prestador. */
  availabilityLabel(day: string): string | null {
    const info = this.availabilityDays().get(day);
    if (!info) return null;
    if (info.blocked) {
      return info.reasons.length ? `No disponible: ${info.reasons.join(', ')}` : 'No disponible';
    }
    if (!info.windows.length) return 'Sin horario';
    return null;
  }

  inMonth(day: string): boolean {
    return day.slice(0, 7) === this.anchor().slice(0, 7);
  }

  dayNumber(day: string): number {
    return Number(day.slice(8, 10));
  }

  weekday(day: string): string {
    return weekdayShort(day);
  }

  shortDate(day: string): string {
    return dayMonth(day);
  }

  longDate(day: string): string {
    return fullDate(day);
  }

  tone(ev: SchedulingEvent): string {
    return STATUS_GROUP_TONE[ev.status_group];
  }

  icon(ev: SchedulingEvent): string {
    return TYPE_ICON[ev.type];
  }

  ariaFor(ev: SchedulingEvent): string {
    return `${ev.type_label} ${ev.title}, ${ev.local_start} a ${ev.local_end}, ${ev.status_label}`;
  }
}
