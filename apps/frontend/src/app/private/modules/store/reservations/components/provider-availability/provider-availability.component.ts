import {
  Component,
  inject,
  signal,
  computed,
  effect,
  DestroyRef,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { switchMap, tap } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReservationsService } from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import {
  StickyHeaderComponent,
  StickyHeaderActionButton,
} from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  OptionsDropdownComponent,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import {
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ProviderAvailabilityOverview,
  ProviderAvailabilityDay,
  ProviderAvailabilityRow,
} from '../../interfaces/reservation.interface';

/**
 * Provider availability dashboard.
 *
 * Renders a 7-day (default) overview of capacity and occupancy per provider
 * with stats cards on top. Built signals-first / zoneless — no manual change detection,
 * no subscribe without takeUntilDestroyed.
 */
@Component({
  selector: 'app-provider-availability',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    ButtonComponent,
    CardComponent,
    StatsComponent,
    StickyHeaderComponent,
    InputsearchComponent,
    ModalComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './provider-availability.component.html',
  styleUrls: ['./provider-availability.component.scss'],
})
export class ProviderAvailabilityComponent {
  private service = inject(ReservationsService);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);
  private router = inject(Router);

  // --- State ---
  readonly overview = signal<ProviderAvailabilityOverview | null>(null);
  readonly loading = signal(false);

  // Default to today + 6 days (7-day window)
  readonly dateFrom = signal(this.formatDateInput(new Date()));
  readonly dateTo = signal(
    this.formatDateInput(this.addDays(new Date(), 6)),
  );

  readonly slotMinutes = signal(30);
  readonly providerFilter = signal<number | null>(null);

  // Provider search (filters the responsive-data-view)
  readonly providerSearch = signal('');

  // --- Computed ---
  readonly providers = computed(
    () => this.overview()?.providers ?? [],
  );
  readonly totals = computed(
    () => this.overview()?.totals ?? null,
  );
  readonly dates = computed<string[]>(() => {
    const o = this.overview();

    // Prefer the top-level range from the backend response. This is the
    // source of truth — every cell in the grid is anchored to it, even if
    // individual providers have empty `days` arrays for some dates.
    const rangeFrom = o?.date_from || this.dateFrom();
    const rangeTo = o?.date_to || this.dateTo();

    if (!rangeFrom || !rangeTo) return [];

    const start = new Date(rangeFrom + 'T12:00:00');
    const end = new Date(rangeTo + 'T12:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
    if (start > end) return [];

    const out: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(this.formatDateInput(new Date(d)));
    }
    return out;
  });

  readonly freeSlotsToday = computed(() => {
    const o = this.overview();
    if (!o) return 0;
    const today = this.formatDateInput(new Date());
    return o.providers.reduce((sum, p) => {
      const day = p.days.find((d) => d.date === today);
      return sum + (day?.free_slots ?? 0);
    }, 0);
  });

  readonly upcomingBookings = computed(() => {
    const o = this.overview();
    if (!o) return 0;
    const today = this.formatDateInput(new Date());
    return o.providers.reduce((sum, p) => {
      const futureDays = p.days.filter(
        (d: ProviderAvailabilityDay) => d.date >= today,
      );
      return sum + futureDays.reduce((s, d) => s + d.booked_slots, 0);
    }, 0);
  });

  /**
   * Providers filtered by the search input. Empty search returns all
   * providers unchanged.
   */
  readonly filteredProviders = computed(() => {
    const all = this.providers();
    const q = this.providerSearch().toLowerCase().trim();
    if (!q) return all;
    return all.filter((p) => p.display_name?.toLowerCase().includes(q));
  });

  /**
   * Provider rows enriched with computed fields the table can read directly:
   * `reservas_proximas`, `dias_con_slots`, `horas_disponibles`. We compute
   * these here (instead of inside tableColumns.transform) so the table
   * recognises the keys and skips its "No data" fallback for undefined values.
   *
   * `slot_minutes` is also injected so transforms can compute hours without
   * reaching into the overview meta — the table only sees the row object.
   */
  readonly enrichedProviders = computed(() => {
    const today = this.formatDateInput(new Date());
    const slotMinutes = this.slotMinutes();
    const totalDays = this.dates().length;

    return this.filteredProviders().map((p) => {
      const upcoming = p.days
        .filter((d) => d.date >= today)
        .reduce((sum, d) => sum + d.booked_slots, 0);
      const daysWithSlots = p.days.filter((d) => d.total_slots > 0).length;
      const freeHours = (p.free_slots * slotMinutes) / 60;

      return {
        ...p,
        slot_minutes: slotMinutes,
        reservas_proximas: upcoming,
        dias_con_slots: daysWithSlots,
        horas_disponibles: freeHours,
        _totalDays: totalDays,
      };
    });
  });

  // ─── Table config (Vendix `<app-responsive-data-view>`) ─────────────────

  readonly tableColumns: TableColumn[] = [
    {
      key: 'display_name',
      label: 'Proveedor',
      sortable: true,
      width: '260px',
      priority: 1,
    },
    {
      key: 'occupancy_pct',
      label: 'Ocupación',
      sortable: true,
      width: '120px',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'md',
        colorMap: {
          low: '#22c55e',
          mid: '#f59e0b',
          high: '#ef4444',
        },
      },
      transform: (val: any) =>
        val !== undefined && val !== null ? `${val}%` : '—',
    },
    {
      key: 'horas_disponibles',
      label: 'Horas disponibles',
      sortable: true,
      width: '150px',
      align: 'right',
      priority: 1,
      transform: (val: any) =>
        val !== undefined ? `${val.toFixed(1)} h libres` : '—',
    },
    {
      key: 'reservas_proximas',
      label: 'Reservas próximas',
      sortable: true,
      width: '150px',
      align: 'right',
      priority: 2,
      transform: (val: any) =>
        val !== undefined ? `${val} ${val === 1 ? 'reserva' : 'reservas'}` : '—',
    },
    {
      key: 'dias_con_slots',
      label: 'Días con horarios',
      sortable: true,
      width: '150px',
      align: 'right',
      priority: 2,
      transform: (val: any, item: any) => {
        if (val === undefined) return '—';
        const total = item?._totalDays ?? '?';
        return `${val} de ${total} días`;
      },
    },
  ];

  readonly tableActions: TableAction[] = [
    {
      label: 'Ver detalle de horas',
      icon: 'clock',
      action: (row: ProviderAvailabilityRow) => this.openProviderDetail(row),
      variant: 'info',
    },
    {
      label: 'Ver horarios',
      icon: 'calendar',
      action: (row: ProviderAvailabilityRow) => this.openProviderSchedules(row),
      variant: 'ghost',
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    subtitleKey: 'free_slots',
    subtitleTransform: (item: any) => {
      if (!item) return '';
      const free = item.free_slots ?? 0;
      const hours = (free * (item.slot_minutes || 30)) / 60;
      return `${free} huecos · ${hours.toFixed(1)} h libres`;
    },
    avatarKey: 'avatar_url',
    avatarShape: 'circle',
    badgeKey: 'occupancy_pct',
    badgeConfig: {
      type: 'custom',
      size: 'md',
      colorMap: {
        low: '#22c55e',
        mid: '#f59e0b',
        high: '#ef4444',
      },
    },
    badgeTransform: (val: any) =>
      val !== undefined && val !== null ? `${val}% ocupado` : '—',
    footerKey: 'booked_slots',
    footerLabel: 'Reservas',
    footerStyle: 'default',
  };

  // ─── Header actions ──────────────────────────────────────────────────────

  /** Actions shown in the sticky header (back button). */
  readonly headerActions: StickyHeaderActionButton[] = [
    {
      id: 'back',
      label: 'Reservas',
      variant: 'outline',
      icon: 'arrow-left',
    },
  ];

  onHeaderAction(id: string): void {
    if (id === 'back') this.goBack();
  }

  // ─── Dropdown config (Filtros) ───────────────────────────────────────

  /** Actions surfaced in the "+ Acciones" dropdown. */
  readonly dropdownActions: DropdownAction[] = [
    {
      label: 'Exportar CSV',
      icon: 'download',
      action: 'export',
    },
    {
      label: 'Configurar horarios',
      icon: 'settings',
      action: 'schedules',
    },
  ];

  /** Filters surfaced in the "Filtros" dropdown. */
  readonly dropdownFilters: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      placeholder: 'Fecha inicio',
    },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      placeholder: 'Fecha fin',
    },
    {
      key: 'slot_minutes',
      label: 'Duración del slot',
      type: 'select',
      placeholder: 'Cualquier duración',
      options: [
        { value: '30', label: '30 minutos' },
        { value: '60', label: '60 minutos' },
      ],
    },
  ];

  /** Current values of the dropdown filters. */
  readonly filterValues = signal<FilterValues>({
    date_from: null,
    date_to: null,
    slot_minutes: null,
  });

  // ─── Day detail modal ─────────────────────────────────────────────────────
  // Holds the currently-inspected (provider, day) pair. When set, the modal
  // is open and shows the hour-by-hour breakdown.

  readonly selectedDetail = signal<
    { provider: ProviderAvailabilityRow; date: string } | null
  >(null);

  /** Actual bookings loaded for the selected provider+date in the detail modal. */
  readonly detailBookings = signal<Array<{ start_time: string; end_time: string }>>([]);

  /**
   * Working hours window the modal renders, in minutes-since-midnight.
   * Matches the calendar week-view's DAY_START/DAY_END (07:00 → 22:00).
   */
  private readonly DAY_START = 7 * 60;
  private readonly DAY_END = 22 * 60;

  /**
   * Computed hour-slot breakdown for the currently-selected detail.
   *
   * Uses actual booking data fetched when the modal opens. Each booking's
   * start_time/end_time is mapped to the correct 30-min slot(s) to mark
   * them as busy — instead of the old synthetic "first N slots are busy"
   * approximation.
   */
  readonly detailSlots = computed(() => {
    const detail = this.selectedDetail();
    if (!detail) return [];
    const day = detail.provider.days.find((d) => d.date === detail.date);
    if (!day || day.total_slots === 0) {
      return this.buildEmptySlots();
    }

    const slotMinutes = this.slotMinutes();
    const total = Math.max(day.total_slots, 1);
    const realBookings = this.detailBookings();

    // Build a set of slot indices that overlap with real bookings
    const busyIndices = new Set<number>();
    for (const booking of realBookings) {
      const [bStartH, bStartM] = booking.start_time.split(':').map(Number);
      const [bEndH, bEndM] = booking.end_time.split(':').map(Number);
      if (isNaN(bStartH) || isNaN(bEndH)) continue;
      const bookingStartMin = bStartH * 60 + bStartM;
      const bookingEndMin = bEndH * 60 + bEndM;

      for (let i = 0; i < total; i++) {
        const slotStartMin = this.DAY_START + i * slotMinutes;
        const slotEndMin = slotStartMin + slotMinutes;
        // Slot overlaps with booking if it intersects
        if (slotStartMin < bookingEndMin && slotEndMin > bookingStartMin) {
          busyIndices.add(i);
        }
      }
    }

    const slots: Array<{ time: string; status: 'busy' | 'free' }> = [];
    for (let i = 0; i < total; i++) {
      const minutesFromStart = i * slotMinutes;
      const startMin = this.DAY_START + minutesFromStart;
      const endMin = Math.min(startMin + slotMinutes, this.DAY_END);
      slots.push({
        time: `${this.formatHm(startMin)}–${this.formatHm(endMin)}`,
        status: busyIndices.has(i) ? 'busy' : 'free',
      });
    }
    return slots;
  });

  /** Render the working window as all-free when there's no data. */
  private buildEmptySlots(): Array<{ time: string; status: 'busy' | 'free' }> {
    const slotMinutes = this.slotMinutes();
    const total = Math.floor((this.DAY_END - this.DAY_START) / slotMinutes);
    const out: Array<{ time: string; status: 'busy' | 'free' }> = [];
    for (let i = 0; i < total; i++) {
      const startMin = this.DAY_START + i * slotMinutes;
      const endMin = startMin + slotMinutes;
      out.push({
        time: `${this.formatHm(startMin)}–${this.formatHm(endMin)}`,
        status: 'free',
      });
    }
    return out;
  }

  /** Format minutes-since-midnight as "h:mm AM/PM" (e.g. "7:30 AM", "4:00 PM"). */
  private formatHm(min: number): string {
    const h24 = Math.floor(min / 60);
    const m = min % 60;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }

  openDetail(provider: ProviderAvailabilityRow, date: string): void {
    this.selectedDetail.set({ provider, date });
    // Fetch actual bookings for this provider+date so we show real busy times
    // instead of the synthetic first-N-slots approximation.
    this.detailBookings.set([]);
    this.service.getCalendar(date, date).subscribe({
      next: (byDate) => {
        const bookings = byDate[date] || [];
        const providerId = provider.provider_id;
        const matched = bookings
          .filter((b: any) => !providerId || b.provider_id === providerId)
          .map((b: any) => ({ start_time: b.start_time?.substring(0, 5) || '', end_time: b.end_time?.substring(0, 5) || '' }));
        this.detailBookings.set(matched);
      },
      error: () => this.detailBookings.set([]),
    });
  }

  closeDetail(): void {
    this.selectedDetail.set(null);
  }

  /**
   * Split the slot list into morning (AM) and afternoon (PM) groups for
   * the modal's two-section layout. Pulled out as a method to work around
   * the Angular template-parser bug with arrow functions in `@let`.
   */
  /**
   * Group the busy/free slot list into morning/afternoon for the detail
   * modal. Promoted to a `computed` so the template re-renders when the
   * underlying `detailSlots` re-evaluates after the calendar fetch — when
   * it was a plain method, Angular only re-ran the call when the modal
   * instance itself was dirty, missing the async update.
   */
  readonly groupedSlots = computed<{
    morning: Array<{ time: string; status: 'busy' | 'free' }>;
    afternoon: Array<{ time: string; status: 'busy' | 'free' }>;
  }>(() => {
    const all = this.detailSlots();
    return {
      morning: all.filter((entry) => entry.time.includes('AM')),
      afternoon: all.filter((entry) => entry.time.includes('PM')),
    };
  });

  /**
   * Returns a per-hour busy/free breakdown for a given provider + date, used
   * by the cell's mini-timeline. Same approximation as `detailSlots` (first
   * N hours marked busy based on `booked_slots` count). Returns null when
   * there's no data so the template can render the dash state.
   */
  getCellHours(
    provider: ProviderAvailabilityRow,
    date: string,
  ): Array<{ hour: number; busy: boolean }> | null {
    const day = provider.days.find((entry) => entry.date === date);
    if (!day || day.total_slots === 0) return null;

    // Group by 1-hour blocks: each block = (slotMinutes × N) cells.
    // For 30-min slots, 2 slots = 1 hour block.
    const slotMinutes = this.slotMinutes();
    const slotsPerHour = Math.max(Math.floor(60 / slotMinutes), 1);
    const totalHours = Math.ceil(day.total_slots / slotsPerHour);
    const out: Array<{ hour: number; busy: boolean }> = [];

    for (let h = 0; h < totalHours; h++) {
      // An hour is "busy" if any of its slots is booked.
      const firstSlot = h * slotsPerHour;
      const lastSlot = Math.min(firstSlot + slotsPerHour, day.total_slots);
      const busyInHour = Array.from(
        { length: lastSlot - firstSlot },
        (_, k) => firstSlot + k,
      ).some((slotIdx) => slotIdx < day.booked_slots);
      out.push({ hour: h, busy: busyInHour });
    }
    return out;
  }

  /** Format hour index (0=7am, 1=8am...) as "h AM/PM" for the mini-timeline tooltip. */
  formatHourLabel(hourIndex: number): string {
    const h24 = (this.DAY_START / 60) + hourIndex;
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12} ${period}`;
  }

  /**
   * Pretty-print a YYYY-MM-DD string for display in the modal title.
   * Uses native Date to avoid relying on the Angular DatePipe locale registry.
   */
  formatDate(date: string): string {
    const d = new Date(date + 'T12:00:00');
    if (isNaN(d.getTime())) return date;
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = [
      'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
      'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
    ];
    return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  }

  constructor() {
    // Auto-refresh when any input changes.
    //
    // The previous version used `effect()` + `loadOverview()` which
    // subscribed with `takeUntilDestroyed(this.destroyRef)` on every
    // effect run. `takeUntilDestroyed` only cancels on component
    // destroy — it does NOT cancel an in-flight request when the
    // effect re-runs because some other signal changed. So if the
    // operator changes dateFrom/dateTo/slotMinutes rapidly, you
    // get N parallel GET /availability/overview calls and the
    // dashboard paints whichever one resolves last (race condition).
    //
    // Fix: lift the params into a `computed` signal, convert to
    // observable, and use `switchMap` — the operator's natural
    // semantics for "the latest request wins". switchMap
    // automatically unsubscribes from the previous inner observable.
    const params = computed(() => {
      const prov = this.providerFilter();
      // Clamp date_to >= date_from. If the user types a `dateFrom` that is
      // after `dateTo` (e.g. they updated dateFrom but forgot to refresh
      // dateTo, or selected a range in the wrong order), the backend
      // returns an empty result and the dashboard looks "broken".
      // Auto-clamping respects the apparent intent ("filter from this
      // date on") and prevents the empty-result footgun.
      const from = this.dateFrom();
      const rawTo = this.dateTo();
      const to = rawTo && from && rawTo < from ? from : rawTo;
      return {
        date_from: from,
        date_to: to,
        slot_minutes: this.slotMinutes(),
        provider_id: prov ?? undefined,
      };
    });

    toObservable(params)
      .pipe(
        tap(() => this.loading.set(true)),
        switchMap((p) => this.service.getAvailabilityOverview(p)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (data) => {
          this.overview.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('Error al cargar disponibilidad de proveedores');
          this.loading.set(false);
        },
      });
  }

  loadOverview(params: {
    date_from: string;
    date_to: string;
    slot_minutes: number;
    provider_id?: number;
  }): void {
    this.loading.set(true);
    this.service
      .getAvailabilityOverview(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.overview.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.toast.error('Error al cargar disponibilidad de proveedores');
          this.loading.set(false);
        },
      });
  }

  setDateRange(days: number): void {
    this.dateFrom.set(this.formatDateInput(new Date()));
    this.dateTo.set(this.formatDateInput(this.addDays(new Date(), days - 1)));
  }

  occupancyClass(pct: number): string {
    if (pct >= 80) return 'occ-high';
    if (pct >= 50) return 'occ-mid';
    return 'occ-low';
  }

  /**
   * Look up the per-day data for a provider on a specific date. Returns
   * `null` when the provider has no entry for that date (e.g. the provider
   * wasn't active that day or the backend omitted it). The grid uses `null`
   * to render a dash cell instead of crashing on `day.occupancy_pct`.
   */
  getDayFor(
    provider: ProviderAvailabilityRow,
    date: string,
  ): ProviderAvailabilityDay | null {
    return provider.days.find((d) => d.date === date) ?? null;
  }

  /**
   * Whether the given YYYY-MM-DD string matches today's local date. Used to
   * highlight the current day column + cells with `is-today` styling.
   */
  isToday(date: string): boolean {
    return date === this.formatDateInput(new Date());
  }

  /**
   * Spanish day-of-week abbreviation for a YYYY-MM-DD date string. Returns
   * the 3-letter uppercase form (LUN, MAR, MIÉ, …). Uses native `Date` to
   * avoid depending on the Angular `DatePipe` locale registry, which can
   * fail silently when `registerLocaleData(es)` hasn't been called.
   */
  getDow(date: string): string {
    const d = new Date(date + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    const days = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    return days[d.getDay()];
  }

  /**
   * Day-of-month number for a YYYY-MM-DD date string. Returns a 1- or
   * 2-digit string. Same rationale as `getDow` — bypass the DatePipe.
   */
  getDayNum(date: string): string {
    const d = new Date(date + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    return String(d.getDate());
  }

  /**
   * Navigation handlers wired to `<app-sticky-header>` action and the empty
   * state CTA. Centralised here so the template stays free of `routerLink`
   * markup and the routes are easy to find/change in one place.
   */
  goBack(): void {
    this.router.navigate(['/admin/reservations']);
  }

  goToSchedules(): void {
    this.router.navigate(['/admin/reservations/schedules']);
  }

  openProviderSchedules(row: ProviderAvailabilityRow): void {
    this.router.navigate(['/admin/reservations/schedules'], {
      queryParams: { provider_id: row.provider_id },
    });
  }

  /**
   * Sum `booked_slots` for this provider's future days (>= today). Used by
   * the "Reservas próximas" column.
   */
  getUpcomingBookingsFor(row: ProviderAvailabilityRow): number {
    const today = this.formatDateInput(new Date());
    return row.days
      .filter((d) => d.date >= today)
      .reduce((sum, d) => sum + d.booked_slots, 0);
  }

  /**
   * Opens the day-detail modal pre-loaded with the provider's first day
   * that has data. The modal lets users browse hour-by-hour availability.
   */
  openProviderDetail(row: ProviderAvailabilityRow): void {
    const firstDayWithData = row.days.find((d) => d.total_slots > 0);
    if (!firstDayWithData) {
      this.toast.warning('Este proveedor no tiene horarios en el rango');
      return;
    }
    this.openDetail(row, firstDayWithData.date);
  }

  /**
   * Handle clicks from the "+ Acciones" dropdown. The component emits the
   * `action` string identifier of the clicked item; we map it to the
   * corresponding behaviour.
   */
  onDropdownAction(actionId: string): void {
    switch (actionId) {
      case 'export':
        this.exportData();
        break;
      case 'schedules':
        this.goToSchedules();
        break;
    }
  }

  /**
   * Handle filter changes from the "Filtros" dropdown. The component emits
   * the full filter-values map; we sync each key to its corresponding signal
   * so the data-loading effect reacts.
   */
  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    if (values['date_from'] !== undefined) {
      const v = values['date_from'] as string | null;
      if (v) this.dateFrom.set(v);
    }
    if (values['date_to'] !== undefined) {
      const v = values['date_to'] as string | null;
      if (v) this.dateTo.set(v);
    }
    if (values['slot_minutes'] !== undefined && values['slot_minutes']) {
      this.slotMinutes.set(Number(values['slot_minutes']));
    }
  }

  /**
   * Export the current provider availability as a CSV download. Builds the
   * CSV in-memory from the loaded `overview()` data — no server roundtrip.
   * If you need server-side export (e.g., streamed for large ranges), wire
   * a dedicated endpoint and replace this body.
   */
  exportData(): void {
    const rows = this.providers();
    if (rows.length === 0) {
      this.toast.warning('No hay datos para exportar');
      return;
    }

    const header = [
      'Proveedor',
      'Ocupación (%)',
      'Huecos libres',
      'Slots reservados',
      'Slots totales',
    ];
    const lines = rows.map((p) =>
      [
        p.display_name ?? '',
        String(p.occupancy_pct),
        String(p.free_slots),
        String(p.booked_slots),
        String(p.total_slots),
      ]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `disponibilidad-${this.dateFrom()}_${this.dateTo()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.toast.success('Archivo descargado');
  }

  private addDays(d: Date, n: number): Date {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  private formatDateInput(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}