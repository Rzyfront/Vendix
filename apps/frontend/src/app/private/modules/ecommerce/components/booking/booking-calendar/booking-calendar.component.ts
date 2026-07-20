import {
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent, SpinnerComponent } from '../../../../../../shared/components';

interface DayInfo {
  date: string;          // YYYY-MM-DD
  has_slots: boolean;
  slots_count: number;
}

interface CalendarCell {
  iso: string;
  dayNumber: number;
  dayShort: string;   // 1-char weekday (L M X J V S D), Mon=0
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  available: boolean;
  slots_count: number;
}

const SPANISH_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * BookingCalendarComponent
 *
 * Calendario mobile-first para que el cliente elija día en el flujo ecommerce.
 * Días disponibles en VERDE con check icon, días sin slots en ROJO con X icon.
 * Tap en día verde → emite `dateSelected`.
 *
 * Mobile-first: grid 7 cols siempre, celdas 44×44px mínimo, header sticky.
 * Patrón skill `vendix-ui-ux`: color + ícono (nunca solo color).
 */
@Component({
  selector: 'app-booking-calendar',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './booking-calendar.component.html',
  styleUrls: ['./booking-calendar.component.scss'],
})
export class BookingCalendarComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly productId = input.required<number>();
  readonly providerId = input<number | null>(null);

  readonly dateSelected = output<string>();

  readonly loading = signal(true);
  readonly monthCursor = signal<{ year: number; month: number }>(this.todayCursor());
  readonly dayMap = signal<Map<string, DayInfo>>(new Map());
  readonly selectedDate = signal<string | null>(null);

  readonly weekDays = SPANISH_DAYS;

  readonly monthLabel = computed(() => {
    const c = this.monthCursor();
    const name = this.monthName(c.month);
    const cap = name.charAt(0).toUpperCase() + name.slice(1);
    return `${cap} ${c.year}`;
  });

  readonly cells = computed<CalendarCell[]>(() => {
    const { year, month } = this.monthCursor();
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    // weekday index 0..6 with Monday=0
    const jsWeekday = firstDay.getUTCDay(); // 0=Sun..6=Sat
    const leadingBlanks = (jsWeekday + 6) % 7; // shift to Mon=0
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const map = this.dayMap();
    const today = this.todayIso();

    const cells: CalendarCell[] = [];
    for (let i = 0; i < leadingBlanks; i++) {
      cells.push({
        iso: '',
        dayNumber: 0,
        dayShort: '',
        inMonth: false,
        isToday: false,
        isPast: true,
        available: false,
        slots_count: 0,
      });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(year, month - 1, d));
      const iso = date.toISOString().split('T')[0];
      const info = map.get(iso);
      // jsWeekday 0=Sun..6=Sat → SPANISH_DAYS index 0=Mon..6=Sun
      const jsWeekday = date.getUTCDay();
      const dayShort = SPANISH_DAYS[(jsWeekday + 6) % 7];
      cells.push({
        iso,
        dayNumber: d,
        dayShort,
        inMonth: true,
        isToday: iso === today,
        isPast: iso < today,
        available: !!info?.has_slots && iso >= today,
        slots_count: info?.slots_count ?? 0,
      });
    }
    return cells;
  });

  ngOnInit(): void {
    this.fetchMonth();
  }

  selectCell(cell: CalendarCell): void {
    if (!cell.available) return;
    this.selectedDate.set(cell.iso);
    this.dateSelected.emit(cell.iso);
  }

  prevMonth(): void {
    const { year, month } = this.monthCursor();
    const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    // Don't go before current month
    const today = this.todayCursor();
    if (
      prev.year < today.year ||
      (prev.year === today.year && prev.month < today.month)
    ) {
      return;
    }
    this.monthCursor.set(prev);
    this.fetchMonth();
  }

  nextMonth(): void {
    const { year, month } = this.monthCursor();
    const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
    this.monthCursor.set(next);
    this.fetchMonth();
  }

  canGoPrev(): boolean {
    const { year, month } = this.monthCursor();
    const today = this.todayCursor();
    return year > today.year || (year === today.year && month > today.month);
  }

  private fetchMonth(): void {
    const { year, month } = this.monthCursor();
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const lastDay = new Date(Date.UTC(year, month, 0));
    const dateFrom = firstDay.toISOString().split('T')[0];
    const dateTo = lastDay.toISOString().split('T')[0];

    this.loading.set(true);
    let params = new HttpParams().set('date_from', dateFrom).set('date_to', dateTo);
    const pid = this.providerId();
    if (pid) params = params.set('provider_id', pid.toString());

    this.http
      .get<any>(`${environment.apiUrl}/ecommerce/reservations/availability-overview/${this.productId()}`, { params })
      .pipe(map((r) => r.data || r || []))
      .subscribe({
        next: (list: DayInfo[]) => {
          const map = new Map<string, DayInfo>();
          for (const d of list) map.set(d.date, d);
          this.dayMap.set(map);
          this.loading.set(false);
        },
        error: () => {
          this.dayMap.set(new Map());
          this.loading.set(false);
        },
      });
  }

  private todayIso(): string {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      .toISOString()
      .split('T')[0];
  }

  private todayCursor(): { year: number; month: number } {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  /** Used in template to render the month name from the cursor's numeric month. */
  monthName(month: number): string {
    return SPANISH_MONTHS[month - 1] ?? '';
  }
}
