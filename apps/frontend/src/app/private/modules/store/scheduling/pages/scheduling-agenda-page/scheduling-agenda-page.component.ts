import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputButtonsComponent,
  InputsearchComponent,
  OptionsDropdownComponent,
  SpinnerComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import type { InputButtonOption } from '../../../../../../shared/components';
import type { StickyHeaderActionButton } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { storeToday } from '../../../../../../shared/utils/date.util';
import { fullDate } from '../../../scheduled-orders/utils/ymd.util';
import { EventCalendarComponent } from '../../components/event-calendar/event-calendar.component';
import { SchedulingRecordHostComponent } from '../../components/scheduling-record-host/scheduling-record-host.component';
import {
  ProviderDayAvailability,
  SchedulingEvent,
  SchedulingSources,
} from '../../interfaces/scheduling.interface';
import { SchedulingApiService } from '../../services/scheduling-api.service';
import {
  AgendaView,
  filterValuesToQuery,
  rangeForView,
  shiftAnchor,
  weekDays,
} from '../../utils/scheduling-calendar.util';
import { ProductionSseService } from '../../../restaurant-ops/production/services/production-sse.service';
import { RescheduleRequestsCounterService } from '../../services/reschedule-requests-counter.service';
import {
  PROVIDER_CONFIG_HEADER_ACTIONS,
  rescheduleRequestsAction,
  buildSchedulingFilters,
  schedulingConfigActions,
} from '../../utils/scheduling-ui.util';
import type { DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ModuleShellActionsService } from '../../../../../../shared/components/module-tabs-shell/module-shell-actions.service';
import { agendaUrl } from '../../scheduling-tabs';

/** Key of the mobile view switch inside the filters dropdown (not a data filter). */
const VIEW_FILTER_KEY = 'vista';

const MONTHS = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const SHORT_DAY = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const DAY_MONTH = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', day: 'numeric', month: 'short' });

function utc(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Órdenes → Agenda (agenda-unificada F1). Un solo calendario (mes, semana,
 * día) con las reservas de servicio y los pedidos programados, con los mismos
 * filtros que Programación. Todo en la zona horaria de la tienda.
 */
@Component({
  selector: 'app-scheduling-agenda-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    ButtonComponent,
    IconComponent,
    InputButtonsComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    SpinnerComponent,
    EmptyStateComponent,
    EventCalendarComponent,
    SchedulingRecordHostComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      @if (!embedded()) {
        <app-sticky-header
          title="Agenda"
          subtitle="Reservas y pedidos programados en un solo calendario"
          icon="calendar-days"
          variant="glass"
          [actions]="headerActions()"
          (actionClicked)="onAction($event)"
        />
      }

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Encabezado de UNA sola altura (anotación de Rafael). Escritorio:
             navegación a la izquierda; búsqueda, filtros y vista a la derecha.
             Celular: la vista va dentro de Filtros y la búsqueda se abre con
             la lupa en la misma fila. -->
        <div
          class="flex min-h-14 items-center gap-2 px-2 py-2 md:border-b md:border-border md:px-4"
          data-testid="agenda-toolbar"
        >
          @if (!(isMobile() && mobileSearchOpen())) {
            <div class="flex min-w-0 flex-1 items-center gap-1 md:flex-none md:shrink-0">
              <app-button class="shrink-0" variant="outline" size="sm" (clicked)="goToday()">Hoy</app-button>
              <app-button class="shrink-0" variant="ghost" size="sm" ariaLabel="Anterior" (clicked)="move(-1)">
                <app-icon slot="icon" name="chevron-left" [size]="16" />
              </app-button>
              <app-button class="shrink-0" variant="ghost" size="sm" ariaLabel="Siguiente" (clicked)="move(1)">
                <app-icon slot="icon" name="chevron-right" [size]="16" />
              </app-button>
              <span class="ml-1 min-w-0 truncate text-sm font-bold capitalize text-text-primary md:max-w-[14rem]" [attr.title]="rangeLabel()">{{ rangeLabel() }}</span>
            </div>
          }
          <div class="flex shrink-0 items-center gap-2 md:min-w-0 md:flex-1 md:justify-end" [class.flex-1]="isMobile() && mobileSearchOpen()">
            @if (!isMobile() || mobileSearchOpen()) {
              <app-inputsearch
                class="min-w-0 flex-1 md:max-w-xs"
                size="sm"
                placeholder="Buscar número, cliente o servicio..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              @if (isMobile()) {
                <app-button variant="ghost" size="sm" ariaLabel="Cerrar búsqueda" (clicked)="mobileSearchOpen.set(false)">
                  <app-icon slot="icon" name="x" [size]="16" />
                </app-button>
              }
            } @else {
              <app-button
                [variant]="search() ? 'outline' : 'ghost'"
                size="sm"
                ariaLabel="Buscar"
                data-testid="agenda-search-toggle"
                (clicked)="mobileSearchOpen.set(true)"
              >
                <app-icon slot="icon" name="search" [size]="16" />
              </app-button>
            }
            <app-options-dropdown
              [filters]="filterConfigs()"
              [filterValues]="dropdownValues()"
              [actions]="dropdownActions()"
              [isLoading]="loading()"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="clearFilters()"
              (actionClick)="onAction($event)"
            />
            @if (!isMobile()) {
              <app-input-buttons
                class="shrink-0"
                [options]="viewOptions()"
                [ngModel]="view()"
                (ngModelChange)="setView($event)"
                [hideLabelsOnMobile]="false"
                [equalWidth]="false"
                customWrapperClass="!w-auto !mt-0"
                customContainerClass="!h-9 !rounded-xl"
              />
            }
          </div>
        </div>
        @if (availability().length || truncated()) {
          <div class="flex flex-col gap-1 px-2 pt-2 md:px-4">
            @if (availability().length) {
              <p class="text-xs text-text-secondary" data-testid="availability-hint">
                Lo sombreado está fuera del horario del prestador (horario, bloqueos y ausencias).
              </p>
            }
            @if (truncated()) {
              <p class="text-xs text-warning">
                Hay más eventos de los que caben en este rango: usa la vista Semana o Día, o filtra.
              </p>
            }
          </div>
        }

        @if (sourcesLoaded() && !hasSources()) {
          <app-empty-state
            icon="calendar-days"
            title="No hay nada que programar"
            description="Tu tienda no tiene reservas de servicio ni pedidos programados activos, o tu usuario no tiene permiso para verlos."
            [showActionButton]="false"
          />
        } @else {
          <div class="relative">
            @if (loading()) {
              <div class="absolute inset-0 z-10 flex items-start justify-center bg-background/40 pt-10">
                <app-spinner />
              </div>
            }
            <app-event-calendar
              [view]="effectiveView()"
              [anchor]="anchor()"
              [today]="today()"
              [events]="events()"
              [availability]="availability()"
              [timezone]="timezone()"
              [focusToken]="focusToken()"
              [slotClickable]="hasBookings()"
              (slotClick)="onSlotClick($event)"
              (eventClick)="host().open($event)"
              (dayClick)="openDay($event)"
            />
          </div>
        }
      </app-card>

      <app-scheduling-record-host (changed)="load()" />
    </div>
  `,
})
export class SchedulingAgendaPageComponent {
  private readonly api = inject(SchedulingApiService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly host = viewChild.required(SchedulingRecordHostComponent);
  private readonly shellActions = inject(ModuleShellActionsService);
  private readonly sse = inject(ProductionSseService);
  private readonly reschedules = inject(RescheduleRequestsCounterService);
  private loadSub: Subscription | null = null;

  /** Montada como pestaña Calendario de Agenda: sin cabecera propia. */
  readonly embedded = input(false);

  readonly sources = signal<SchedulingSources | null>(null);
  readonly sourcesLoaded = signal(false);
  readonly events = signal<SchedulingEvent[]>([]);
  readonly availability = signal<ProviderDayAvailability[]>([]);
  readonly loading = signal(false);
  readonly truncated = signal(false);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly today = signal(storeToday(this.settings.timezone()));
  /** Zona de la tienda para la línea de «ahora» (la de `sources` manda). */
  readonly timezone = computed(() => this.sources()?.timezone || this.settings.timezone());
  /** «Hoy» vuelve a enfocar la hora actual aunque la semana no cambie. */
  readonly focusToken = signal(0);
  readonly anchor = signal(this.today());
  readonly view = signal<AgendaView>('week');
  readonly isMobile = signal(false);

  /** En celular la semana no cabe: se muestra el día (como la agenda de pedidos). */
  readonly effectiveView = computed<AgendaView>(() =>
    this.isMobile() && this.view() === 'week' ? 'day' : this.view(),
  );
  readonly viewOptions = computed<InputButtonOption[]>(() => [
    { value: 'month', label: 'Mes', icon: 'calendar' },
    ...(this.isMobile() ? [] : [{ value: 'week', label: 'Semana', icon: 'calendar-days' }]),
    { value: 'day', label: 'Día', icon: 'list' },
  ]);
  readonly hasSources = computed(() => (this.sources()?.types.length ?? 0) > 0);
  readonly hasBookings = computed(() => !!this.sources()?.types.some((t) => t.value === 'booking'));
  /** Celular: la búsqueda se abre en la misma fila del encabezado. */
  readonly mobileSearchOpen = signal(false);
  /**
   * En celular el cambio de vista (Mes/Día) vive dentro de Filtros para que el
   * encabezado tenga una sola altura. No cuenta como filtro activo.
   */
  readonly filterConfigs = computed<FilterConfig[]>(() => {
    const filters = buildSchedulingFilters(this.sources(), { withDateRange: false, withShow: false });
    if (!this.isMobile()) return filters;
    const view: FilterConfig = {
      key: VIEW_FILTER_KEY,
      label: 'Vista',
      type: 'select',
      options: this.viewOptions().map((o) => ({ value: o.value, label: o.label })),
      defaultValue: this.effectiveView(),
      countsAsActive: false,
    };
    return [view, ...filters];
  });
  readonly dropdownValues = computed<FilterValues>(() =>
    this.isMobile() ? { ...this.filterValues(), [VIEW_FILTER_KEY]: this.effectiveView() } : this.filterValues(),
  );
  readonly hasScheduled = computed(
    () => !!this.sources()?.types.some((t) => t.value === 'scheduled_order'),
  );
  /** Configuración de prestadores y de cada módulo, igual que en Programación. */
  readonly dropdownActions = computed<DropdownAction[]>(() =>
    schedulingConfigActions({
      bookings: this.hasBookings(),
      scheduled: this.hasScheduled(),
      service: this.auth.isServiceIndustry(),
    }).filter((a) => a.action !== 'export-bookings'),
  );
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    ...PROVIDER_CONFIG_HEADER_ACTIONS.map((a) => ({ ...a, visible: this.hasBookings() })),
    rescheduleRequestsAction(this.reschedules.count(), this.hasBookings()),
    {
      id: 'list',
      label: 'Ver programación',
      icon: 'list',
      variant: 'outline',
      // En Agenda la tabla es otra pestaña.
      visible: !this.embedded(),
    },
    {
      id: 'create-booking',
      label: 'Nueva reserva',
      icon: 'plus',
      variant: 'primary',
      visible: this.hasBookings(),
    },
  ]);
  readonly rangeLabel = computed(() => {
    const anchor = this.anchor();
    const view = this.effectiveView();
    if (view === 'month') return MONTHS.format(utc(anchor));
    if (view === 'day') return this.isMobile() ? SHORT_DAY.format(utc(anchor)) : fullDate(anchor);
    const days = weekDays(anchor);
    return `${DAY_MONTH.format(utc(days[0]))} – ${DAY_MONTH.format(utc(days[6]))}`;
  });

  constructor() {
    effect(() => {
      if (!this.embedded()) return;
      this.shellActions.set(
        this.headerActions().map((action) => ({ ...action, run: () => this.onAction(action.id) })),
      );
    });
    this.destroyRef.onDestroy(() => {
      if (this.embedded()) this.shellActions.clear();
    });
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const media = window.matchMedia('(max-width: 767px)');
      this.isMobile.set(media.matches);
      const onChange = (e: MediaQueryListEvent) => {
        this.isMobile.set(e.matches);
        this.load();
      };
      media.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
    }
    this.api
      .getSources()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sources) => {
          this.sources.set(sources);
          this.today.set(sources.today);
          this.anchor.set(sources.today);
          this.sourcesLoaded.set(true);
          this.startLiveSources();
          this.load();
        },
        error: () => {
          this.sourcesLoaded.set(true);
          this.toast.error('No se pudo cargar la agenda');
        },
      });
  }

  /**
   * Recarga el rango visible cancelando la petición anterior (anterior /
   * siguiente rápido no deja que una respuesta vieja pise la nueva).
   * `silent`: recarga en segundo plano (tiempo real), sin spinner ni toast.
   */
  load(silent = false): void {
    this.loadSub?.unsubscribe();
    if (!this.hasSources()) {
      this.events.set([]);
      return;
    }
    const range = rangeForView(this.effectiveView(), this.anchor());
    // El rango lo pone la vista del calendario, no el filtro.
    const query = filterValuesToQuery(this.filterValues());
    const filters = {
      types: query.types,
      status_groups: query.status_groups,
      staff_ids: query.staff_ids,
    };
    if (!silent) this.loading.set(true);
    this.loadSub = this.api
      .getCalendar({ ...filters, search: this.search() || undefined, ...range })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.events.set(res.data);
          this.availability.set(res.availability ?? []);
          this.truncated.set(res.truncated);
        },
        error: () => {
          if (!silent) this.toast.error('No se pudo cargar la agenda');
        },
      });
  }

  /** Tiempo real de pedidos (SSE de producción) y conteo de reagendas. */
  private startLiveSources(): void {
    if (this.hasScheduled() && this.sse.canStream()) {
      this.sse.listen(this.destroyRef, () => this.load(true));
    }
    if (this.hasBookings()) this.reschedules.watch(this.destroyRef);
  }

  /**
   * Reservar tocando un hueco (Semana/Día), como el calendario viejo de
   * Reservas: abre la reserva rápida con día y hora prellenados. El modal
   * valida la disponibilidad del prestador y de la tienda.
   */
  onSlotClick(slot: { date: string; time: string }): void {
    if (!this.hasBookings()) return;
    if (slot.date < this.today()) {
      this.toast.warning('No puedes agendar en un día que ya pasó.');
      return;
    }
    this.host().createBookingAt(slot.date, slot.time);
  }

  setView(view: string): void {
    if (view !== 'month' && view !== 'week' && view !== 'day') return;
    this.view.set(view);
    this.load();
  }

  move(direction: 1 | -1): void {
    this.anchor.set(shiftAnchor(this.effectiveView(), this.anchor(), direction));
    this.load();
  }

  goToday(): void {
    this.anchor.set(this.today());
    this.focusToken.update((n) => n + 1);
    this.load();
  }

  openDay(day: string): void {
    this.anchor.set(day);
    this.view.set('day');
    this.load();
  }

  onSearch(term: string): void {
    this.search.set(term ?? '');
    this.load();
  }

  onFilterChange(values: FilterValues): void {
    const { [VIEW_FILTER_KEY]: view, ...filters } = values;
    if (typeof view === 'string' && view !== this.effectiveView()) this.view.set(view as AgendaView);
    this.filterValues.set({ ...filters });
    this.load();
  }

  clearFilters(): void {
    this.filterValues.set({});
    this.search.set('');
    this.load();
  }

  onAction(action: string): void {
    if (action === 'list') return void this.router.navigateByUrl(agendaUrl('programacion'));
    if (action === 'create-booking') return this.host().createBooking();
    if (action.startsWith('/')) void this.router.navigateByUrl(action);
  }
}
