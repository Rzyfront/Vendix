import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
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
import { buildSchedulingFilters } from '../../utils/scheduling-ui.util';

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
      <app-sticky-header
        title="Agenda"
        subtitle="Reservas y pedidos programados en un solo calendario"
        icon="calendar-days"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onAction($event)"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="flex flex-col gap-2 px-2 py-2 md:px-4 md:py-3 md:border-b md:border-border">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-1">
              <app-button variant="outline" size="sm" (clicked)="goToday()">Hoy</app-button>
              <app-button variant="ghost" size="sm" ariaLabel="Anterior" (clicked)="move(-1)">
                <app-icon slot="icon" name="chevron-left" [size]="16" />
              </app-button>
              <app-button variant="ghost" size="sm" ariaLabel="Siguiente" (clicked)="move(1)">
                <app-icon slot="icon" name="chevron-right" [size]="16" />
              </app-button>
              <span class="ml-1 text-sm font-bold capitalize text-text-primary">{{ rangeLabel() }}</span>
            </div>
            <app-input-buttons
              [options]="viewOptions()"
              [ngModel]="view()"
              (ngModelChange)="setView($event)"
              [hideLabelsOnMobile]="false"
              [equalWidth]="false"
              customWrapperClass="!w-auto !mt-0"
              customContainerClass="!h-9 !rounded-xl"
            />
          </div>
          <div class="flex w-full items-center gap-2">
            <app-inputsearch
              class="flex-1 md:max-w-xs"
              size="sm"
              placeholder="Buscar número, cliente o servicio..."
              [debounceTime]="300"
              [ngModel]="search()"
              (ngModelChange)="onSearch($event)"
            />
            <app-options-dropdown
              triggerLabel="Filtros"
              [filters]="filterConfigs()"
              [filterValues]="filterValues()"
              [isLoading]="loading()"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="clearFilters()"
            />
          </div>
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
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  readonly host = viewChild.required(SchedulingRecordHostComponent);

  readonly sources = signal<SchedulingSources | null>(null);
  readonly sourcesLoaded = signal(false);
  readonly events = signal<SchedulingEvent[]>([]);
  readonly loading = signal(false);
  readonly truncated = signal(false);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly today = signal(storeToday(this.settings.timezone()));
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
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    { id: 'list', label: 'Ver programación', icon: 'list', variant: 'outline' },
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
          this.load();
        },
        error: () => {
          this.sourcesLoaded.set(true);
          this.toast.error('No se pudo cargar la agenda');
        },
      });
  }

  load(): void {
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
    this.loading.set(true);
    this.api
      .getCalendar({ ...filters, search: this.search() || undefined, ...range })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.events.set(res.data);
          this.truncated.set(res.truncated);
        },
        error: () => this.toast.error('No se pudo cargar la agenda'),
      });
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
    if (action === 'list') void this.router.navigate(['/admin/orders/scheduling']);
    if (action === 'create-booking') this.host().createBooking();
  }
}
