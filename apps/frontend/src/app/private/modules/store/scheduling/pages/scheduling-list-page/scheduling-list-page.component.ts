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
  CardComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import type { StickyHeaderActionButton } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ReportExportModalComponent } from '../../../reservations/components/report-export-modal/report-export-modal.component';
import { RESCHEDULABLE_STATUSES } from '../../../scheduled-orders/interfaces/scheduled-order.interface';
import { dayMonth, weekdayShort } from '../../../scheduled-orders/utils/ymd.util';
import { SchedulingRecordHostComponent } from '../../components/scheduling-record-host/scheduling-record-host.component';
import {
  SchedulingEvent,
  SchedulingQuery,
  SchedulingSources,
  SchedulingStatusGroup,
} from '../../interfaces/scheduling.interface';
import { SchedulingApiService } from '../../services/scheduling-api.service';
import { filterValuesToQuery } from '../../utils/scheduling-calendar.util';
import {
  PROVIDER_CONFIG_HEADER_ACTIONS,
  STATUS_GROUP_COLOR,
  buildSchedulingFilters,
  schedulingConfigActions,
} from '../../utils/scheduling-ui.util';

/**
 * Órdenes → Programación (agenda-unificada F1). Una tabla con las reservas de
 * servicio y los pedidos programados de la tienda, con filtros por tipo,
 * personal, estado y fecha, y paginación en servidor. La configuración de
 * reservas (proveedores, disponibilidad, cola…) queda en «Opciones».
 */
@Component({
  selector: 'app-scheduling-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    ReportExportModalComponent,
    SchedulingRecordHostComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Programación"
        subtitle="Reservas de servicio y pedidos programados en una sola lista"
        icon="calendar-clock"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onAction($event)"
      />

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div
          class="sticky top-[52px] z-10 bg-background px-2 py-1.5 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-sm font-bold text-text-primary md:text-lg md:font-semibold">
              Programación ({{ totalItems() }})
            </h2>
            <div class="flex w-full items-center gap-2 md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64"
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
          </div>
          @if (truncated()) {
            <p class="mt-2 text-xs text-warning">
              Hay demasiados pedidos en el rango: acota las fechas para verlos todos.
            </p>
          }
        </div>

        @if (!loading() && sourcesLoaded() && !hasSources()) {
          <app-empty-state
            icon="calendar-clock"
            title="No hay nada que programar"
            description="Tu tienda no tiene reservas de servicio ni pedidos programados activos, o tu usuario no tiene permiso para verlos."
            [showActionButton]="false"
          />
        } @else if (!loading() && rows().length === 0) {
          <app-empty-state
            icon="calendar-clock"
            [title]="hasFilters() ? 'Sin resultados' : 'Nada programado'"
            [description]="hasFilters() ? 'Prueba con otros filtros o fechas.' : 'Aquí verás las reservas y pedidos programados desde hoy.'"
            [showActionButton]="false"
            [showClearFilters]="hasFilters()"
            [showRefreshButton]="true"
            (clearFiltersClick)="clearFilters()"
            (refreshClick)="load()"
          />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="rows()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [actions]="actions"
              [loading]="loading()"
              emptyMessage="Nada programado"
              emptyIcon="calendar-clock"
              (rowClick)="open($event)"
            />
            <div class="mt-4 flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="totalItems()"
                [limit]="limit"
                (pageChange)="onPageChange($event)"
              />
            </div>
          </div>
        }
      </app-card>

      <app-scheduling-record-host (changed)="load()" />

      @defer (when exportOpen()) {
        <app-report-export-modal [(isOpen)]="exportOpen" />
      }
    </div>
  `,
})
export class SchedulingListPageComponent {
  private readonly api = inject(SchedulingApiService);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = viewChild.required(SchedulingRecordHostComponent);

  readonly limit = 20;
  readonly sources = signal<SchedulingSources | null>(null);
  readonly sourcesLoaded = signal(false);
  readonly rows = signal<SchedulingEvent[]>([]);
  readonly loading = signal(false);
  readonly page = signal(1);
  readonly totalItems = signal(0);
  readonly truncated = signal(false);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({});
  readonly exportOpen = signal(false);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.limit)));
  readonly hasSources = computed(() => (this.sources()?.types.length ?? 0) > 0);
  readonly hasBookings = computed(() => !!this.sources()?.types.some((t) => t.value === 'booking'));
  readonly hasScheduled = computed(
    () => !!this.sources()?.types.some((t) => t.value === 'scheduled_order'),
  );
  readonly hasFilters = computed(
    () =>
      !!this.search() ||
      Object.entries(this.filterValues()).some(([key, value]) =>
        key === 'show' ? false : Array.isArray(value) ? value.length > 0 : !!value,
      ),
  );

  readonly filterConfigs = computed<FilterConfig[]>(() =>
    buildSchedulingFilters(this.sources(), { withDateRange: true, withShow: true }),
  );

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ...schedulingConfigActions({
      bookings: this.hasBookings(),
      scheduled: this.hasScheduled(),
      service: this.auth.isServiceIndustry(),
    }),
  ]);

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    ...PROVIDER_CONFIG_HEADER_ACTIONS.map((a) => ({ ...a, visible: this.hasBookings() })),
    { id: 'agenda', label: 'Ver agenda', icon: 'calendar-days', variant: 'outline' },
    {
      id: 'create-booking',
      label: 'Nueva reserva',
      icon: 'plus',
      variant: 'primary',
      visible: this.hasBookings(),
    },
  ]);

  readonly columns: TableColumn[] = [
    {
      key: 'date',
      label: 'Fecha y hora',
      priority: 1,
      transform: (_v: string, ev?: SchedulingEvent) => (ev ? whenLabel(ev) : ''),
    },
    { key: 'type_label', label: 'Tipo', priority: 2 },
    {
      key: 'title',
      label: 'Detalle',
      priority: 1,
      transform: (_v: string, ev?: SchedulingEvent) =>
        ev ? `${ev.title} · ${ev.reference}` : '',
    },
    {
      key: 'customer',
      label: 'Cliente',
      priority: 2,
      transform: (v: SchedulingEvent['customer']) => v?.name ?? '—',
    },
    {
      key: 'staff',
      label: 'Personal',
      priority: 3,
      transform: (v: SchedulingEvent['staff']) => v?.name ?? '—',
    },
    {
      key: 'status_group',
      label: 'Estado',
      priority: 1,
      transform: (_v: SchedulingStatusGroup, ev?: SchedulingEvent) => ev?.status_label ?? '',
      badge: true,
      badgeConfig: { type: 'custom', colorMap: STATUS_GROUP_COLOR, size: 'sm' },
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    titleTransform: (ev: SchedulingEvent) => ev.title,
    subtitleTransform: (ev: SchedulingEvent) => whenLabel(ev),
    avatarFallbackIcon: 'calendar-clock',
    avatarShape: 'square',
    badgeKey: 'status_label',
    badgeConfig: {
      type: 'custom',
      colorFn: (_v: unknown, ev?: SchedulingEvent) =>
        ev ? STATUS_GROUP_COLOR[ev.status_group] : null,
      size: 'sm',
    },
    detailKeys: [
      { key: 'type_label', label: 'Tipo', icon: 'layers' },
      {
        key: 'customer',
        label: 'Cliente',
        icon: 'user',
        transform: (v: SchedulingEvent['customer']) => v?.name ?? '—',
      },
      {
        key: 'staff',
        label: 'Personal',
        icon: 'user-cog',
        transform: (v: SchedulingEvent['staff']) => v?.name ?? '—',
      },
      { key: 'reference', label: 'Número', icon: 'hash' },
    ],
  };

  readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (ev: SchedulingEvent) => this.open(ev),
    },
    {
      label: 'Reprogramar',
      icon: 'calendar-clock',
      variant: 'primary',
      show: (ev: SchedulingEvent) => this.canRescheduleOrder(ev),
      action: (ev: SchedulingEvent) => this.host().rescheduleScheduledOrder(ev),
    },
    {
      label: 'Ver orden',
      icon: 'receipt',
      variant: 'ghost',
      show: (ev: SchedulingEvent) => !!ev.order_id,
      action: (ev: SchedulingEvent) => void this.router.navigate(['/admin/orders', ev.order_id]),
    },
  ];

  constructor() {
    this.api
      .getSources()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sources) => {
          this.sources.set(sources);
          this.sourcesLoaded.set(true);
          this.load();
        },
        error: () => {
          this.sourcesLoaded.set(true);
          this.toast.error('No se pudo cargar la programación');
        },
      });
  }

  load(): void {
    const sources = this.sources();
    if (!sources?.types.length) {
      this.rows.set([]);
      this.totalItems.set(0);
      return;
    }
    this.loading.set(true);
    this.api
      .getEvents(this.query(sources))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.totalItems.set(res.meta?.total ?? res.data.length);
          this.truncated.set(!!res.meta?.truncated);
        },
        error: () => this.toast.error('No se pudo cargar la programación'),
      });
  }

  /** «Próximos» (desde hoy, cronológico) salvo que elijan fechas o «Todo». */
  private query(sources: SchedulingSources): SchedulingQuery {
    const base = filterValuesToQuery(this.filterValues());
    const showAll = this.filterValues()['show'] === 'all';
    const hasRange = !!(base.from || base.to);
    return {
      ...base,
      ...(!hasRange && !showAll && { from: sources.today }),
      order: showAll && !hasRange ? 'desc' : 'asc',
      search: this.search() || undefined,
      page: this.page(),
      limit: this.limit,
    };
  }

  onSearch(term: string): void {
    this.search.set(term ?? '');
    this.page.set(1);
    this.load();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.filterValues.set({});
    this.search.set('');
    this.page.set(1);
    this.load();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  open(ev: SchedulingEvent): void {
    this.host().open(ev);
  }

  canRescheduleOrder(ev: SchedulingEvent): boolean {
    return (
      ev.type === 'scheduled_order' &&
      this.auth.hasPermission('store:scheduled_orders:reschedule') &&
      (RESCHEDULABLE_STATUSES as string[]).includes(ev.status)
    );
  }

  onAction(action: string): void {
    if (action === 'refresh') return this.load();
    if (action === 'agenda') return void this.router.navigate(['/admin/orders/agenda']);
    if (action === 'create-booking') return this.host().createBooking();
    if (action === 'export-bookings') return this.exportOpen.set(true);
    if (action.startsWith('/')) void this.router.navigateByUrl(action);
  }
}

/** «lun 23 nov · 09:00–10:30» en la zona de la tienda (ya viene local). */
export function whenLabel(ev: SchedulingEvent): string {
  return `${weekdayShort(ev.date)} ${dayMonth(ev.date)} · ${ev.local_start}–${ev.local_end}`;
}
