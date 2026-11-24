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

const MONTHS = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' });
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
        <div class="flex flex-col gap-2 px-2 py-2 md:px-4 md:border-b md:border-border">
          <!-- M4: una sola fila en escritorio (navegación · búsqueda y filtros · vista);
               en celular navegación y vista arriba, búsqueda debajo. -->
          <div class="flex flex-wrap items-center gap-2 md:flex-nowrap" data-testid="agenda-toolbar">
            <div class="order-1 flex min-w-0 items-center gap-1 md:shrink-0">
              <app-button class="shrink-0" variant="outline" size="sm" (clicked)="goToday()">Hoy</app-button>
              <app-button variant="ghost" size="sm" ariaLabel="Anterior" (clicked)="move(-1)">
                <app-icon slot="icon" name="chevron-left" [size]="16" />
              </app-button>
              <app-button variant="ghost" size="sm" ariaLabel="Siguiente" (clicked)="move(1)">
                <app-icon slot="icon" name="chevron-right" [size]="16" />
              </app-button>
              <span class="ml-1 min-w-0 truncate text-sm font-bold capitalize text-text-primary md:max-w-[14rem]" [attr.title]="rangeLabel()">{{ rangeLabel() }}</span>
            </div>
            <div class="order-3 flex w-full items-center gap-2 md:order-2 md:w-auto md:min-w-0 md:flex-1 md:justify-end">
              <app-inputsearch
                class="flex-1 md:max-w-xs"
                size="sm"
                placeholder="Buscar número, cliente o servicio..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                [filters]="filterConfigs()"
                [filterValues]="filterValues()"
                [actions]="dropdownActions()"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="clearFilters()"
                (actionClick)="onAction($event)"
              />
            </div>
            <app-input-buttons
              class="order-2 ml-auto shrink-0 md:order-3 md:ml-0"
              [options]="viewOptions()"
              [ngModel]="view()"
              (ngModelChange)="setView($event)"
              [hideLabelsOnMobile]="false"
              [equalWidth]="false"
              customWrapperClass="!w-auto !mt-0"
              customContainerClass="!h-9 !rounded-xl"
            />
          </div>
          @if (availability().length) {
            <p class="text-xs text-text-secondary" data-testid="availability-hint">
              Lo sombreado está fuera del horario del prestador (horario, bloqueos y excepciones de Equipo de servicio).
            </p>
          } @else if (hasBookings()) {
            <p class="text-xs text-text-secondary">
              Filtra por personal para ver el horario disponible de cada prestador.
            </p>
          }
          @if (truncated()) {
            <p class="text-xs text-warning">
              Hay más eventos de los que caben en este rango: usa la vista Semana o Día, o filtra.
            </p>
          }
        </div>

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
  readonly filterConfigs = computed<FilterConfig[]>(() =>
    buildSchedulingFilters(this.sources(), { withDateRange: false, withShow: false }),
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
    if (view === 'day') return fullDate(anchor);
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
    this.filterValues.set({ ...values });
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
