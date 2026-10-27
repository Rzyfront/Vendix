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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EChartsOption } from 'echarts';
import {
  ButtonComponent,
  CardComponent,
  ChartComponent,
  IconComponent,
  InputComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SpinnerComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
  TooltipComponent,
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

/**
 * Hospitality Suite — "Indicadores" (H7.2). Occupancy, ADR and RevPAR by
 * business day (store timezone) and month: a chart for the trend and a table
 * with the figures. Days closed by the night audit use its frozen snapshot.
 */
@Component({
  selector: 'app-hospitality-performance-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputComponent,
    ButtonComponent,
    IconComponent,
    ChartComponent,
    TooltipComponent,
    ResponsiveDataViewComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        title="Indicadores"
        subtitle="Ocupación, tarifa promedio (ADR) y RevPAR por día y mes"
        icon="chart-line"
        variant="glass"
      />

      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats title="Ocupación" [value]="pct(totals()?.occupancy_pct)" smallText="Noches vendidas / disponibles" iconName="bed-double" [loading]="loading()" />
        <app-stats title="ADR" [value]="money(totals()?.adr)" smallText="Ingreso / noches vendidas" iconName="dollar-sign" [loading]="loading()" />
        <app-stats title="RevPAR" [value]="money(totals()?.revpar)" smallText="Ingreso / noches disponibles" iconName="trending-up" [loading]="loading()" />
        <app-stats title="Ingreso alojamiento" [value]="money(totals()?.room_revenue)" iconName="wallet" [loading]="loading()" />
      </div>

      <div class="space-y-3 p-2 md:p-4">
        <app-card [responsive]="true">
          <div class="flex flex-wrap items-end gap-2">
            <app-input label="Desde" type="date" [formControl]="from" data-testid="kpi-from" />
            <app-input label="Hasta" type="date" [formControl]="to" data-testid="kpi-to" />
            <app-button variant="outline" size="sm" [loading]="loading()" (clicked)="load()" data-testid="kpi-search">
              <app-icon slot="icon" name="search" [size]="14" />
              Consultar
            </app-button>
            <div class="ml-auto flex gap-1">
              <app-button size="sm" [variant]="granularity() === 'day' ? 'primary' : 'outline'" (clicked)="granularity.set('day')" data-testid="kpi-by-day">
                Por día
              </app-button>
              <app-button size="sm" [variant]="granularity() === 'month' ? 'primary' : 'outline'" (clicked)="granularity.set('month')" data-testid="kpi-by-month">
                Por mes
              </app-button>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary" data-testid="kpi-formulas">
            @for (f of formulas; track f.label) {
              <span class="inline-flex items-center gap-1">
                {{ f.label }}
                <app-tooltip [content]="f.text" position="bottom" size="sm">
                  <app-icon name="info" [size]="14" class="text-text-secondary" />
                </app-tooltip>
              </span>
            }
            <span>· Día de negocio en la zona horaria de la tienda; los días cerrados usan la auditoría nocturna.</span>
          </div>
        </app-card>

        @if (loading() && !report()) {
          <div class="flex flex-col items-center gap-2 py-8">
            <app-spinner size="md" />
            <p class="text-sm text-text-secondary">Cargando indicadores…</p>
          </div>
        } @else if (report()) {
          <app-card [responsive]="true">
            <h3 class="mb-2 text-sm font-semibold">Tendencia</h3>
            <app-chart [options]="chartOptions()" size="large" data-testid="kpi-chart" />
          </app-card>

          <app-card [responsive]="true" [padding]="false" overflow="visible">
            <h3 class="px-2 pt-2 text-sm font-semibold md:px-6 md:pt-4">Detalle {{ granularity() === 'day' ? 'por día' : 'por mes' }}</h3>
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns()"
                [cardConfig]="cardConfig"
                [striped]="true"
                data-testid="kpi-table"
              />
            </div>
          </app-card>
        }
      </div>
    </div>
  `,
})
export class HospitalityPerformancePageComponent implements OnInit {
  private readonly reservationsService = inject(LodgingReservationsService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly formulas = FORMULAS;
  readonly from = new FormControl(civilDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), {
    nonNullable: true,
  });
  readonly to = new FormControl(civilDate(new Date()), { nonNullable: true });

  readonly loading = signal(true);
  readonly granularity = signal<Granularity>('day');
  readonly report = signal<LodgingPerformanceReport | null>(null);

  readonly totals = computed(() => this.report()?.totals ?? null);
  private readonly series = computed<LodgingPerformanceRow[]>(() => {
    const report = this.report();
    if (!report) return [];
    return this.granularity() === 'day' ? report.days : report.months;
  });

  readonly rows = computed<ReportRow[]>(() =>
    this.series().map((row) => ({
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

  load(): void {
    this.loading.set(true);
    this.reservationsService
      .performance(this.from.value, this.to.value)
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
