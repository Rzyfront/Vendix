import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import {
  ButtonComponent,
  EmptyStateComponent,
  IconComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../../shared/components';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import { providerDisplayName } from '../../../../../../../shared/utils/provider-display-name';
import { addDays, fullDate } from '../../../../scheduled-orders/utils/ymd.util';
import { Booking, BookingStatus, ServiceProvider } from '../../../interfaces/reservation.interface';
import { ReservationsService } from '../../../services/reservations.service';
import { bookingDaySpan } from '../booking-day-span.util';
import { bookingCustomerName } from '../booking-stack.util';
import {
  DEFAULT_CALENDAR_RANGE,
  expandRangeToSpans,
  parseClockToMinutes,
  snapRangeToStep,
} from '../calendar-range.util';

interface AgendaItem {
  booking: Booking;
  start: string;
  end: string;
  customer: string;
  service: string;
  statusLabel: string;
}

interface AgendaColumn {
  key: string;
  title: string;
  /** Items per hour row, keyed by the row's start hour. */
  byHour: Map<number, AgendaItem[]>;
  count: number;
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  arriving: 'Por llegar',
  attending: 'En atención',
  in_progress: 'En curso',
  completed: 'Atendida',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

const UNASSIGNED_KEY = 'unassigned';

/**
 * Day agenda of reservations with one column per professional (QUI-967).
 * Self-contained so it can be embedded in the store "Panel Principal": it only
 * fetches the visible day and sends the user to the reservations module to
 * manage a booking.
 */
@Component({
  selector: 'app-provider-day-agenda',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent, SpinnerComponent, EmptyStateComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <div class="flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:justify-between md:px-4">
        <h2 class="text-base font-semibold capitalize text-text-primary md:text-lg">
          {{ dateLabel() }}
        </h2>
        <div class="flex items-center gap-2">
          <app-button variant="outline" size="sm" ariaLabel="Día anterior" (clicked)="goToDay(-1)">
            <app-icon slot="icon" name="chevron-left" [size]="16"></app-icon>
          </app-button>
          <app-button variant="outline" size="sm" [disabled]="isToday()" (clicked)="goToToday()">
            Hoy
          </app-button>
          <app-button variant="outline" size="sm" ariaLabel="Día siguiente" (clicked)="goToDay(1)">
            <app-icon slot="icon" name="chevron-right" [size]="16"></app-icon>
          </app-button>
        </div>
      </div>

      @if (loading() && !loaded()) {
        <div class="flex justify-center p-8"><app-spinner /></div>
      } @else if (errorMessage(); as msg) {
        <app-empty-state
          icon="alert-circle"
          title="No se pudo cargar la agenda"
          [description]="msg"
          [showActionButton]="false"
          [showRefreshButton]="true"
          (refreshClick)="reload()"
        />
      } @else if (columns().length === 0) {
        <app-empty-state
          icon="calendar"
          title="Aún no hay profesionales"
          description="Cuando registres profesionales, verás aquí su agenda del día."
          [showActionButton]="false"
        />
      } @else {
        <div class="overflow-x-auto px-2 pb-4 md:px-4">
          <div
            class="grid min-w-max gap-px rounded-xl border border-border bg-border"
            [style.grid-template-columns]="gridTemplate()"
          >
            <div class="sticky left-0 z-10 bg-surface px-2 py-2 text-xs font-medium text-text-secondary">
              Hora
            </div>
            @for (col of columns(); track col.key) {
              <div class="bg-surface px-3 py-2 text-sm font-semibold text-text-primary">
                {{ col.title }}
                <span class="ml-1 text-xs font-normal text-text-secondary">({{ col.count }})</span>
              </div>
            }

            @for (hour of hours(); track hour) {
              <div class="sticky left-0 z-10 bg-surface px-2 py-2 text-xs text-text-secondary">
                {{ hourLabel(hour) }}
              </div>
              @for (col of columns(); track col.key) {
                <div class="flex min-h-[3.5rem] flex-col gap-1 bg-surface p-1">
                  @for (item of col.byHour.get(hour) ?? []; track item.booking.id) {
                    <button
                      type="button"
                      class="w-full rounded-lg border border-border bg-background px-2 py-1 text-left text-xs transition hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      (click)="openBooking(item.booking)"
                    >
                      <span class="block font-semibold text-text-primary">
                        {{ item.start }} – {{ item.end }}
                      </span>
                      <span class="block truncate text-text-primary">{{ item.customer }}</span>
                      <span class="block truncate text-text-secondary">{{ item.service }}</span>
                      <span class="block text-text-secondary">{{ item.statusLabel }}</span>
                    </button>
                  }
                </div>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ProviderDayAgendaComponent {
  private readonly reservations = inject(ReservationsService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Day shown (`YYYY-MM-DD`); `null` follows the store's current day. */
  private readonly selectedDate = signal<string | null>(null);
  readonly today = computed(() => storeToday(this.settings.timezone()));
  readonly date = computed(() => this.selectedDate() ?? this.today());
  readonly isToday = computed(() => this.date() === this.today());
  readonly dateLabel = computed(() => fullDate(this.date()));

  readonly providers = signal<ServiceProvider[]>([]);
  private readonly bookings = signal<Booking[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly errorMessage = signal<string | null>(null);

  private bookingsSub: Subscription | null = null;

  /** Bookings that still occupy the agenda (cancelled ones are left out). */
  private readonly activeBookings = computed(() =>
    this.bookings().filter((b) => b.status !== 'cancelled'),
  );

  readonly columns = computed<AgendaColumn[]>(() => {
    const day = this.date();
    const byKey = new Map<string, { title: string; items: AgendaItem[] }>();
    for (const p of [...this.providers()].filter((x) => x.is_active).sort((a, b) => a.sort_order - b.sort_order)) {
      byKey.set(String(p.id), { title: providerDisplayName(p) || `Profesional ${p.id}`, items: [] });
    }
    const unassigned: AgendaItem[] = [];
    for (const booking of this.activeBookings()) {
      const span = bookingDaySpan(booking, day);
      const item: AgendaItem = {
        booking,
        start: span.start,
        end: span.end,
        customer: bookingCustomerName(booking),
        service: booking.product?.name ?? 'Servicio',
        statusLabel: STATUS_LABEL[booking.status] ?? '',
      };
      if (booking.provider_id == null) {
        unassigned.push(item);
        continue;
      }
      const key = String(booking.provider_id);
      let col = byKey.get(key);
      if (!col) {
        // Provider no longer in the active list: keep its bookings visible.
        col = {
          title: providerDisplayName(booking.provider) || `Profesional ${key}`,
          items: [],
        };
        byKey.set(key, col);
      }
      col.items.push(item);
    }
    const result: AgendaColumn[] = [...byKey.entries()].map(([key, v]) => this.toColumn(key, v.title, v.items));
    if (unassigned.length > 0) result.push(this.toColumn(UNASSIGNED_KEY, 'Sin asignar', unassigned));
    return result;
  });

  /** Start hours of the time axis rows (grows to fit every booking). */
  readonly hours = computed<number[]>(() => {
    const spans = this.activeBookings().map((b) => bookingDaySpan(b, this.date()));
    const range = snapRangeToStep(expandRangeToSpans(DEFAULT_CALENDAR_RANGE, spans), 60);
    const out: number[] = [];
    for (let m = range.start; m < range.end; m += 60) out.push(m / 60);
    return out;
  });

  readonly gridTemplate = computed(
    () => `4rem repeat(${this.columns().length}, minmax(11rem, 1fr))`,
  );

  constructor() {
    this.reservations
      .getProviders()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => this.providers.set(list ?? []),
        error: () => this.toast.error('No se pudieron cargar los profesionales'),
      });
    // Only the visible day is requested; changing day cancels the previous call.
    effect(() => {
      const day = this.date();
      untracked(() => this.load(day));
    });
    this.destroyRef.onDestroy(() => this.bookingsSub?.unsubscribe());
  }

  reload(): void {
    this.load(this.date());
  }

  private load(day: string): void {
    this.bookingsSub?.unsubscribe();
    this.loading.set(true);
    this.errorMessage.set(null);
    this.bookingsSub = this.reservations.getCalendar(day, day).subscribe({
      next: (data) => {
        this.bookings.set(data?.[day] ?? []);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('Intenta de nuevo en unos segundos.');
        this.loading.set(false);
      },
    });
  }

  private toColumn(key: string, title: string, items: AgendaItem[]): AgendaColumn {
    const byHour = new Map<number, AgendaItem[]>();
    for (const item of items) {
      const minutes = parseClockToMinutes(item.start);
      if (minutes == null) continue;
      const hour = Math.floor(minutes / 60);
      const list = byHour.get(hour);
      if (list) list.push(item);
      else byHour.set(hour, [item]);
    }
    for (const list of byHour.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return { key, title, byHour, count: items.length };
  }

  hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
  }

  goToDay(delta: -1 | 1): void {
    this.selectedDate.set(addDays(this.date(), delta));
  }

  goToToday(): void {
    this.selectedDate.set(null);
  }

  openBooking(_booking: Booking): void {
    // Managing a booking lives in the reservations module.
    void this.router.navigate(['/admin/reservations']);
  }
}
