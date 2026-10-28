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
  SpinnerComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import {
  LodgingPerformanceReport,
  LodgingPerformanceRow,
} from '../../interfaces/performance.interface';
import { LodgingReservationsService } from '../../services/lodging-reservations.service';

type Granularity = 'day' | 'month';

interface ReportRow {
  period_label: string;
  source_label: string;
  available_label: string;
  sold_label: string;
  occupancy_label: string;
  revenue_label: string;
  adr_label: string;
  revpar_label: string;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** The three formulas, shown in a tooltip next to each KPI. */
const FORMULAS = [
  { label: 'Ocupación', text: 'Ocupación = noches vendidas / noches disponibles' },
  { label: 'ADR', text: 'ADR = ingreso de alojamiento / noches vendidas' },
  { label: 'RevPAR', text: 'RevPAR = ingreso de alojamiento / noches disponibles' },
];

/** Local civil date `YYYY-MM-DD` of the browser (the store's desk). */
function civilDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `2026-11-05` → `5 nov`; `2026-11` → `nov 2026`. */
function periodLabel(period: string): string {
  const [year, month, day] = period.split('-').map(Number);
  return day ? `${day} ${MONTHS[month - 1]}` : `${MONTHS[month - 1]} ${year}`;
}

/** Default period: the current month up to today, by day. */
function defaultFilters(): FilterValues {
  const today = new Date();
  return {
    period_preset: 'thisMonth',
    from: civilDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: civilDate(today),
    granularity: 'day',
  };
}

/** Case- and accent-insensitive "contains". */
function matches(term: string, ...values: (string | null | undefined)[]): boolean {
  const normalize = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return !needle || values.some((v) => !!v && normalize(v).includes(needle));
}

/**
 * Hospitality Suite — "Indicadores" (H7.2). Occupancy, ADR and RevPAR by
 * business day (store timezone) and month: a chart for the trend and a table
 * with the figures. Days closed by the night audit use its frozen snapshot.
 *
 * Standard admin list module: four stats, one card with the sticky search
 * and the options dropdown (period date range + day/month grouping + refresh),
 * the trend chart and the responsive data view. Clearing the filters goes
 * back to the current month by day.
 */
@Component({
  selector: 'app-hospitality-performance-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SpinnerComponent,
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
          title="Ocupación"
          [value]="pct(totals()?.occupancy_pct)"
          smallText="Noches vendidas / disponibles"
          iconName="bed-double"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="ADR"
          [value]="money(totals()?.adr)"
          smallText="Ingreso / noches vendidas"
          iconName="dollar-sign"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="RevPAR"
          [value]="money(totals()?.revpar)"
          smallText="Ingreso / noches disponibles"
          iconName="trending-up"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="loading() && !report()"
        />
        <app-stats
          title="Ingreso alojamiento"
          [value]="money(totals()?.room_revenue)"
          [smallText]="periodText()"
          iconName="wallet"
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
              Detalle {{ granularity() === 'day' ? 'por día' : 'por mes' }}
              <span class="text-text-secondary font-normal">({{ rows().length }})</span>
            </h2>

            <div class="flex items-center gap-2 w-full md:w-auto">
              <app-inputsearch
                class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                size="sm"
                [placeholder]="granularity() === 'day' ? 'Buscar día (ej.: 5 nov)...' : 'Buscar mes (ej.: nov)...'"
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
            <div class="p-4 md:p-6">
              <app-spinner [center]="true" text="Cargando indicadores…" />
            </div>
          } @else if (series().length === 0) {
            <app-empty-state
              icon="chart-line"
              title="Sin datos en el periodo"
              description="Elige otro periodo en los filtros para ver la ocupación, el ADR y el RevPAR."
              [showActionButton]="false"
            />
          } @else {
            <div class="mb-4 rounded-lg border border-border p-2 md:p-4">
              <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="kpi-formulas">
                <span class="font-semibold text-text-primary">Tendencia</span>
                @for (f of formulas; track f.label) {
                  <span class="inline-flex items-center gap-1 text-text-secondary">
                    {{ f.label }}
                    <app-tooltip [content]="f.text" position="bottom" size="sm">
                      <app-icon name="info" [size]="14" class="text-text-secondary" />
                    </app-tooltip>
                  </span>
                }
              </div>
              <app-chart [options]="chartOptions()" size="large" data-testid="kpi-chart" />
              <p class="mt-2 text-xs text-text-secondary">
                Día de negocio en la zona horaria de la tienda; los días cerrados usan la auditoría nocturna.
              </p>
            </div>

            @if (rows().length === 0) {
              <app-empty-state
                icon="search"
                title="Sin resultados"
                description="Ningún periodo coincide con la búsqueda."
                actionButtonText="Limpiar búsqueda"
                [showActionButton]="true"
                (actionClick)="search.set('')"
              />
            } @else {
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns()"
                [cardConfig]="cardConfig"
                [striped]="true"
                [hoverable]="true"
                emptyMessage="No hay periodos con ese criterio"
                emptyIcon="search"
                data-testid="kpi-table"
              />
            }
          }
        </div>
      </app-card>
    </div>
  `,
})
export class HospitalityPerformancePageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly formulas = FORMULAS;

  readonly loading = signal(true);
  readonly report = signal<LodgingPerformanceReport | null>(null);
  readonly search = signal('');
  readonly filterValues = signal<FilterValues>(defaultFilters());

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'period',
      label: 'Periodo',
      type: 'date-range',
      startKey: 'from',
      endKey: 'to',
      presetKey: 'period_preset',
    },
    {
      key: 'granularity',
      label: 'Agrupar',
      type: 'select',
      defaultValue: 'day',
      options: [
        { value: 'day', label: 'Por día' },
        { value: 'month', label: 'Por mes' },
      ],
    },
  ];

  readonly dropdownActions: DropdownAction[] = [
    { label: 'Actualizar', icon: 'refresh-cw', action: 'refresh', variant: 'outline' },
  ];

  readonly granularity = computed<Granularity>(() =>
    this.filterValues()['granularity'] === 'month' ? 'month' : 'day',
  );

  readonly periodText = computed(() => {
    const { from, to } = this.filterValues();
    return typeof from === 'string' && typeof to === 'string'
      ? `${periodLabel(from)} → ${periodLabel(to)}`
      : '';
  });

  readonly totals = computed(() => this.report()?.totals ?? null);
  readonly series = computed<LodgingPerformanceRow[]>(() => {
    const report = this.report();
    if (!report) return [];
    return this.granularity() === 'day' ? report.days : report.months;
  });

  readonly rows = computed<ReportRow[]>(() =>
    this.series()
      .filter((row) => matches(this.search(), periodLabel(row.period)))
      .map((row) => ({
        period_label: periodLabel(row.period),
        source_label: 'closed' in row ? (row.closed ? 'Cerrado' : 'En vivo') : '',
        available_label: String(row.nights_available),
        sold_label: String(row.nights_sold),
        occupancy_label: this.pct(row.occupancy_pct),
        revenue_label: this.money(row.room_revenue),
        adr_label: this.money(row.adr),
        revpar_label: this.money(row.revpar),
      })),
  );

  readonly columns = computed<TableColumn[]>(() => [
    { key: 'period_label', label: this.granularity() === 'day' ? 'Día' : 'Mes' },
    ...(this.granularity() === 'day' ? [{ key: 'source_label', label: 'Cierre' }] : []),
    { key: 'available_label', label: 'Noches disponibles', align: 'right' as const },
    { key: 'sold_label', label: 'Noches vendidas', align: 'right' as const },
    { key: 'occupancy_label', label: 'Ocupación', align: 'right' as const },
    { key: 'revenue_label', label: 'Ingreso alojamiento', align: 'right' as const },
    { key: 'adr_label', label: 'ADR', align: 'right' as const },
    { key: 'revpar_label', label: 'RevPAR', align: 'right' as const },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'period_label',
    subtitleKey: 'source_label',
    detailKeys: [
      { key: 'sold_label', label: 'Vendidas' },
      { key: 'available_label', label: 'Disponibles' },
      { key: 'adr_label', label: 'ADR' },
      { key: 'revpar_label', label: 'RevPAR' },
    ],
    footerKey: 'occupancy_label',
    footerLabel: 'Ocupación',
  };

  readonly chartOptions = computed<EChartsOption>(() => {
    const series = this.series();
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const border = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const text = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const money = (value: number) => this.currency.formatChartAxis(value);
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Ocupación %', 'ADR', 'RevPAR'], bottom: 0, textStyle: { color: text } },
      grid: { left: '3%', right: '4%', bottom: '14%', containLabel: true },
      xAxis: {
        type: 'category',
        data: series.map((row) => periodLabel(row.period)),
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: text },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: { color: text, formatter: money },
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
          name: 'Ocupación %',
          type: 'bar',
          yAxisIndex: 1,
          itemStyle: { color: `${primary}55` },
          data: series.map((row) => row.occupancy_pct),
        },
        { name: 'ADR', type: 'line', smooth: true, data: series.map((row) => row.adr) },
        { name: 'RevPAR', type: 'line', smooth: true, data: series.map((row) => row.revpar) },
      ],
    };
  });

  ngOnInit(): void {
    this.load();
  }

  onSearch(term: string | null): void {
    this.search.set((term ?? '').trim());
  }

  /** A period without both ends goes back to the current month. */
  onFilterChange(values: FilterValues): void {
    const from = values['from'];
    const to = values['to'];
    const granularity = values['granularity'] === 'month' ? 'month' : 'day';
    const periodChanged =
      from !== this.filterValues()['from'] || to !== this.filterValues()['to'];
    this.filterValues.set(
      typeof from === 'string' && from && typeof to === 'string' && to
        ? { ...values, granularity }
        : { ...defaultFilters(), granularity: Object.keys(values).length ? granularity : 'day' },
    );
    if (periodChanged) this.load();
  }

  onActionClick(action: string): void {
    if (action === 'refresh') this.load();
  }

  load(): void {
    const { from, to } = this.filterValues();
    this.loading.set(true);
    this.reservationsService
      .performance(String(from), String(to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => {
          this.report.set(report);
          this.loading.set(false);
        },
        error: (message: unknown) => {
          this.loading.set(false);
          this.toastService.error(typeof message === 'string' ? message : 'No se pudieron cargar los indicadores');
        },
      });
  }

  /** A KPI without base (null) shows "—", never 0. */
  pct(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : `${value.toLocaleString('es-CO')} %`;
  }

  money(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : this.currency.format(value, 0);
  }
}
