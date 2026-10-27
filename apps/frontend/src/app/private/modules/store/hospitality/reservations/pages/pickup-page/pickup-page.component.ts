import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { EChartsOption } from 'echarts';
import {
  CardComponent,
  ChartComponent,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  IconComponent,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ToastService,
  TooltipComponent,
} from '../../../../../../../shared/components/index';
import { LodgingPickupReport } from '../../interfaces/pickup.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

interface PickupTableRow {
  date_label: string;
  weekday_label: string;
  rooms_label: string;
  on_books_label: string;
  pickup_7_label: string;
  pickup_30_label: string;
  occupancy_label: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Default horizon of the forecast, in stay dates from today. */
const DEFAULT_DAYS = '90';

const FORMULAS = [
  { label: 'Pickup', text: 'Pickup = noches de esa fecha reservadas en los últimos 7 o 30 días' },
  { label: 'Ocupación proyectada', text: 'Ocupación proyectada = noches reservadas / habitaciones activas' },
];

/** `2026-11-05` → `5 nov 2026`. */
function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** `2026-11-05` → `jueves` (civil date, no timezone shift). */
function weekdayLabel(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/**
 * Hospitality Suite — "Pickup y pronóstico" (H7.3). For each future stay
 * date: the nights already on the books, how many were booked in the last 7
 * and 30 days, and the projected occupancy, so the manager decides whether to
 * raise or lower the rate.
 *
 * Standard admin list module: four stats, one card with the sticky search and
 * the options dropdown (horizon + refresh), the trend chart and the
 * responsive data view.
 */
@Component({
  selector: 'app-hospitality-pickup-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    StatsComponent,
    CardComponent,
    IconComponent,
    ChartComponent,
    TooltipComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full md:space-y-4">
      <!-- Stats: sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Ocupación proyectada"
          [value]="pct(totals()?.projected_occupancy_pct)"
          [smallText]="horizonText()"
          iconName="bed-double"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Noches reservadas"
          [value]="count(totals()?.on_books)"
          smallText="Reservas confirmadas y en casa"
          iconName="calendar-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Pickup 7 días"
          [value]="count(totals()?.pickup_7)"
          smallText="Reservadas en los últimos 7 días"
          iconName="trending-up"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Pickup 30 días"
          [value]="count(totals()?.pickup_30)"
          smallText="Reservadas en los últimos 30 días"
          iconName="calendar-plus"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="loading() && !report()"
        />
      </div>

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <!-- Sticky search header -->
        <div
          class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                 md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
        >
          <div
            class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4"
          >
            <h2
              class="text-[13px] font-bold text-gray-600 tracking-wide
                     md:text-lg md:font-semibold md:text-text-primary"
            >
              Pickup por fecha de estadía
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                placeholder="Buscar fecha (ej.: 5 nov, viernes)..."
                [debounceTime]="300"
                [ngModel]="search()"
                (ngModelChange)="onSearch($event)"
              />
              <app-options-dropdown
                class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                [filters]="filterConfigs"
                [filterValues]="filterValues()"
                [actions]="dropdownActions"
                [isLoading]="loading()"
                (filterChange)="onFilterChange($event)"
                (clearAllFilters)="onFilterChange({})"
                (actionClick)="onActionClick($event)"
              />
            </div>
          </div>
        </div>

        <div class="px-2 pb-2 pt-3 md:p-4">
          @if (loading() && !report()) {
            <div class="p-4 md:p-6 text-center">
              <div
                class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-text-secondary">Cargando pronóstico...</p>
            </div>
          } @else if (!report()) {
            <app-empty-state
              icon="calendar-clock"
              title="Sin pronóstico"
              description="No se pudo cargar el pickup. Usa Actualizar para reintentar."
              [showActionButton]="false"
            />
          } @else {
            <div class="mb-4 rounded-lg border border-border p-2 md:p-4">
              <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="pickup-formulas">
                <span class="font-semibold text-text-primary">Próximos días</span>
                @for (f of formulas; track f.label) {
                  <span class="inline-flex items-center gap-1 text-text-secondary">
                    {{ f.label }}
                    <app-tooltip [content]="f.text" position="bottom" size="sm">
                      <app-icon name="info" [size]="14" class="text-text-secondary" />
                    </app-tooltip>
                  </span>
                }
              </div>
              <app-chart [options]="chartOptions()" size="large" data-testid="pickup-chart" />
              <p class="mt-2 text-xs text-text-secondary">
                Fechas de estadía desde hoy en la zona horaria de la tienda; no incluye reservas web sin pagar.
              </p>
            </div>

            @if (rows().length === 0) {
              <app-empty-state
                icon="search"
                title="Sin resultados"
                description="Ninguna fecha coincide con la búsqueda."
                actionButtonText="Limpiar búsqueda"
                [showActionButton]="true"
                (actionClick)="search.set('')"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay fechas con ese criterio"
                emptyIcon="search"
                data-testid="pickup-table"
              />
            }
          }
        </div>
      </app-card>
    </div>
  `,
})
export class HospitalityPickupPageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly formulas = FORMULAS;

  readonly loading = signal(true);
  readonly report = signal<LodgingPickupReport | null>(null);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>({ days: DEFAULT_DAYS });

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'days',
      label: 'Horizonte',
      type: 'select',
      defaultValue: DEFAULT_DAYS,
      options: [
        { value: '30', label: 'Próximos 30 días' },
        { value: '60', label: 'Próximos 60 días' },
        { value: '90', label: 'Próximos 90 días' },
        { value: '180', label: 'Próximos 180 días' },
        { value: '365', label: 'Próximos 365 días' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  readonly totals = computed(() => this.report()?.totals ?? null);

  readonly horizonText = computed(() => {
    const report = this.report();
    return report ? `${dateLabel(report.from)} → ${dateLabel(report.to)}` : '';
  });

  readonly rows = computed<PickupTableRow[]>(() =>
    (this.report()?.days ?? [])
      .map((day) => ({
        date_label: dateLabel(day.stay_date),
        weekday_label: weekdayLabel(day.stay_date),
        rooms_label: String(day.rooms),
        on_books_label: String(day.on_books),
        pickup_7_label: String(day.pickup_7),
        pickup_30_label: String(day.pickup_30),
        occupancy_label: this.pct(day.projected_occupancy_pct),
      }))
      .filter((row) => matches(this.search(), row.date_label, row.weekday_label)),
  );

  readonly columns: TableColumn[] = [
    { key: 'date_label', label: 'Fecha de estadía' },
    { key: 'weekday_label', label: 'Día' },
    { key: 'rooms_label', label: 'Habitaciones', align: 'right' },
    { key: 'on_books_label', label: 'Noches reservadas', align: 'right' },
    { key: 'pickup_7_label', label: 'Pickup 7 días', align: 'right' },
    { key: 'pickup_30_label', label: 'Pickup 30 días', align: 'right' },
    { key: 'occupancy_label', label: 'Ocupación proyectada', align: 'right' },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'date_label',
    subtitleKey: 'weekday_label',
    detailKeys: [
      { key: 'on_books_label', label: 'Reservadas' },
      { key: 'pickup_7_label', label: 'Pickup 7 d' },
      { key: 'pickup_30_label', label: 'Pickup 30 d' },
      { key: 'rooms_label', label: 'Habitaciones' },
    ],
    footerKey: 'occupancy_label',
    footerLabel: 'Ocupación proyectada',
  };

  readonly chartOptions = computed<EChartsOption>(() => {
    const days = this.report()?.days ?? [];
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const border = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const text = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['Ocupación proyectada %', 'Pickup 7 días', 'Pickup 30 días'],
        bottom: 0,
        textStyle: { color: text },
      },
      grid: { left: '3%', right: '4%', bottom: '14%', containLabel: true },
      xAxis: {
        type: 'category',
        data: days.map((day) => dateLabel(day.stay_date).slice(0, -5)),
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: text },
      },
      yAxis: [
        {
          type: 'value',
          minInterval: 1,
          axisLabel: { color: text },
          splitLine: { lineStyle: { color: border } },
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: { color: text, formatter: '{value} %' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Ocupación proyectada %',
          type: 'bar',
          yAxisIndex: 1,
          itemStyle: { color: `${primary}55` },
          data: days.map((day) => day.projected_occupancy_pct),
        },
        { name: 'Pickup 7 días', type: 'line', data: days.map((day) => day.pickup_7) },
        { name: 'Pickup 30 días', type: 'line', data: days.map((day) => day.pickup_30) },
      ],
    };
  });

  ngOnInit(): void {
    this.load();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** Clearing the filters goes back to the next 90 days. */
  onFilterChange(values: FilterValues): void {
    const days = typeof values['days'] === 'string' && values['days'] ? values['days'] : DEFAULT_DAYS;
    const changed = days !== this.filterValues()['days'];
    this.filterValues.set({ days });
    if (changed) this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
  }

  load(): void {
    this.loading.set(true);
    this.reservationsService
      .pickup(Number(this.filterValues()['days']))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudo cargar el pronóstico');
        },
      });
  }

  /** Projected occupancy without rooms (null) shows "—", never 0. */
  pct(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.toLocaleString('es-CO')} %`;
  }

  count(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : value.toLocaleString('es-CO');
  }
}
