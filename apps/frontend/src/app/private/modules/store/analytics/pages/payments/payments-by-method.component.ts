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
import { ActivatedRoute } from '@angular/router';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../shared/components';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterValues,
  HeaderPinConfig,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

import { AnalyticsRefreshService, Refreshable } from '../../../shared/services/analytics-refresh.service';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { PaymentsReportService } from '../../../shared/services/payments-report.service';
import {
  PaymentsSummary,
  PaymentsSummaryByMethod,
  StorePaymentMethodOption,
} from '../../../shared/interfaces/payments-report.interface';
import {
  PAYMENTS_PINNED_PREFIX,
  PAYMENTS_PIN_FILTER_KEY,
  PaymentsFilterState,
  buildPaymentsFilterConfigs,
  defaultPaymentsFilterState,
  filterValuesToState,
  paymentsUrlHasNoFilters,
  queryParamsToState,
  stateToFilterValues,
  stateToQuery,
} from '../../../shared/utils/payments-filters.util';
import {
  buildPinnedFiltersKey,
  persistPinnedFilters,
  readPinnedFilters,
} from '../../../shared/utils/pinned-filters.util';

/**
 * Palette categórico validado (dataviz/palette.md), en orden fijo: el color
 * sigue a la entidad, no al ranking. Del 8.º en adelante se pliega en "Otros".
 */
const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHERS_COLOR = '#9ca3af';

export type MethodChartType = 'bar' | 'donut';

/**
 * "Por Método de Pago" — vista 2 de la categoría Pagos
 * (PLAN-reporte-analitica-pagos-2026-09-28, paso 4). Signals puros + OnPush.
 *
 * Reglas (vendix-analytics-metrics): monto y % salen del mismo endpoint
 * (`/summary`, `by_method`). `by_method.count` cuenta solo pagos recaudados y
 * `payment_method_id = null` es "Sin método". La gráfica (barras o dona) y la
 * tabla salen de la misma lista, con el mismo denominador.
 */
@Component({
  selector: 'vendix-payments-by-method',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    ChartComponent,
    CurrencyPipe,
    IconComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    OptionsDropdownComponent,
  ],
  templateUrl: './payments-by-method.component.html',
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
    `,
  ],
})
export class PaymentsByMethodComponent implements Refreshable {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly paymentsService = inject(PaymentsReportService);
  private readonly toast = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);
  private readonly dateRangeSync = inject(DateRangeSyncService);
  private readonly analyticsRefresh = inject(AnalyticsRefreshService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly filters = signal<PaymentsFilterState>(
    defaultPaymentsFilterState(),
  );
  readonly pinned = signal(false);
  readonly methods = signal<StorePaymentMethodOption[]>([]);

  readonly summary = signal<PaymentsSummary | null>(null);
  readonly chartType = signal<MethodChartType>('donut');
  readonly loading = signal(false);
  readonly exporting = signal(false);

  private loadSeq = 0;

  /** Objeto ESTABLE (un literal en el template ensucia el input en cada ciclo). */
  readonly headerPin: HeaderPinConfig = { key: PAYMENTS_PIN_FILTER_KEY, label: 'Fijar' };

  readonly filterConfigs = computed(() =>
    buildPaymentsFilterConfigs(this.methods(), { withGranularity: false }),
  );

  readonly filterValues = computed<FilterValues>(() => ({
    ...stateToFilterValues(this.filters()),
    [PAYMENTS_PIN_FILTER_KEY]: this.pinned() ? 'true' : null,
  }));

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { action: 'export-xlsx', label: 'Exportar XLSX', icon: 'download', disabled: this.exporting() },
  ]);

  // ── Derivados de presentación ────────────────────────────────────────────

  readonly rows = computed<PaymentsSummaryByMethod[]>(() => this.summary()?.by_method ?? []);

  readonly columns: TableColumn[] = [
    { key: 'display_name', label: 'Método', sortable: false, priority: 1 },
    {
      key: 'count',
      label: '# Pagos recaudados',
      sortable: false,
      align: 'right',
      priority: 2,
      transform: (v: unknown) => String(Number(v) || 0),
    },
    {
      key: 'collected_amount',
      label: 'Recaudado',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
    {
      key: 'percentage',
      label: '%',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => `${(Number(v) || 0).toFixed(1)} %`,
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    subtitleKey: 'percentage',
    subtitleTransform: (item: PaymentsSummaryByMethod) =>
      `${(Number(item.percentage) || 0).toFixed(1)} % del recaudo`,
    detailKeys: [
      {
        key: 'collected_amount',
        label: 'Recaudado',
        icon: 'wallet',
        transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
      },
      {
        key: 'count',
        label: '# Pagos recaudados',
        icon: 'receipt',
        transform: (v: unknown) => String(Number(v) || 0),
      },
    ],
  };

  readonly chartOptions = signal<EChartsOption>({});

  constructor() {
    this.currencyService.loadCurrency();
    this.initFilters();
    this.loadMethods();

    // Refresh global del shell (botón "Actualizar"): el shell no llama a
    // refresh() si el hijo es Refreshable, recarga este effect.
    effect(() => {
      const count = this.analyticsRefresh.refreshSignal();
      if (count > 0) untracked(() => this.refresh());
    });

    this.dateRangeSync.setDateRange(this.filters().date_range);
    this.refresh();
  }

  refresh(): void {
    const query = stateToQuery(this.filters(), 1, 20);
    const seq = ++this.loadSeq;

    this.loading.set(true);
    this.paymentsService
      .getSummary(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          if (seq !== this.loadSeq) return; // respuesta vieja: se descarta
          this.summary.set(summary);
          this.updateChart();
          this.loading.set(false);
        },
        error: () => {
          if (seq !== this.loadSeq) return;
          this.loading.set(false);
          this.toast.error('No se pudo cargar los pagos por método.');
        },
      });
  }

  // ── Filtros y pin ────────────────────────────────────────────────────────

  private pinKey(): string | null {
    return buildPinnedFiltersKey(
      PAYMENTS_PINNED_PREFIX + 'analytics_',
      this.authFacade.userStore()?.id,
    );
  }

  private initFilters(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (paymentsUrlHasNoFilters(qp)) {
      const saved = readPinnedFilters<PaymentsFilterState>(this.pinKey());
      if (saved?.date_range?.start_date && saved.date_range.end_date) {
        this.filters.set({
          ...defaultPaymentsFilterState(),
          ...saved,
        });
        this.pinned.set(true);
        return;
      }
    }
    this.filters.set(queryParamsToState(qp));
  }

  private loadMethods(): void {
    this.paymentsService
      .getStorePaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (m) => this.methods.set(m),
        error: () => this.methods.set([]),
      });
  }

  onFilterChange(values: FilterValues): void {
    const next = filterValuesToState(values, this.filters());
    const pinned = values[PAYMENTS_PIN_FILTER_KEY] === 'true';
    this.filters.set(next);
    this.pinned.set(pinned);
    persistPinnedFilters(this.pinKey(), pinned ? next : null);
    this.dateRangeSync.setDateRange(next.date_range);
    this.refresh();
  }

  onClearAllFilters(): void {
    const next = defaultPaymentsFilterState();
    this.filters.set(next);
    this.pinned.set(false);
    persistPinnedFilters(this.pinKey(), null);
    this.dateRangeSync.setDateRange(next.date_range);
    this.refresh();
  }

  onActionClick(action: string): void {
    if (action === 'export-xlsx') this.exportXlsx();
  }

  private exportXlsx(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.paymentsService
      .exportPayments(stateToQuery(this.filters(), 1, 20))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pagos_${toLocalDateString()}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
          this.toast.error('No se pudo exportar el reporte de pagos.');
        },
      });
  }

  // ── Gráfica ──────────────────────────────────────────────────────────────

  setChartType(type: MethodChartType): void {
    this.chartType.set(type);
    this.updateChart();
  }

  private themeColors(): { text: string; grid: string; palette: string[] } {
    if (typeof document === 'undefined') {
      return { text: '#6b7280', grid: '#e5e7eb', palette: CATEGORICAL_LIGHT };
    }
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const dark =
      root.getAttribute('data-theme') === 'dark' ||
      (root.getAttribute('data-theme') !== 'light' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    return {
      text: style.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
      grid: style.getPropertyValue('--color-border').trim() || '#e5e7eb',
      palette: dark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT,
    };
  }

  private updateChart(): void {
    const { text, grid, palette } = this.themeColors();
    const all = this.rows().filter((r) => r.collected_amount > 0);
    const cap = palette.length;

    // Se pliega en "Otros" del slot 8 en adelante (nunca se generan tonos nuevos).
    const head = all.slice(0, all.length > cap ? cap - 1 : cap);
    const tail = all.slice(head.length);
    const items = head.map((r, i) => ({
      name: r.display_name,
      value: r.collected_amount,
      color: palette[i],
    }));
    if (tail.length) {
      items.push({
        name: 'Otros',
        value: tail.reduce((acc, r) => acc + r.collected_amount, 0),
        color: OTHERS_COLOR,
      });
    }
    const total = items.reduce((acc, i) => acc + i.value, 0);
    const pct = (v: number): string => (total > 0 ? ((v / total) * 100).toFixed(1) : '0.0');

    if (this.chartType() === 'donut') {
      this.chartOptions.set({
        tooltip: {
          trigger: 'item',
          formatter: (p: any) =>
            `${p.name}<br/><b>${this.currencyService.format(Number(p.value) || 0)}</b> (${pct(Number(p.value) || 0)} %)`,
        },
        legend: { bottom: 0, textStyle: { color: text } },
        series: [
          {
            name: 'Recaudado',
            type: 'pie',
            radius: ['45%', '70%'],
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 4, borderColor: 'var(--color-surface)', borderWidth: 2 },
            label: { show: false },
            data: items.map((i) => ({ name: i.name, value: i.value, itemStyle: { color: i.color } })),
          },
        ],
      });
      return;
    }

    // Barras horizontales: una sola serie, el mayor arriba.
    const ordered = [...items].reverse();
    this.chartOptions.set({
      grid: { left: 8, right: 72, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}<br/><b>${this.currencyService.format(Number(p.value) || 0)}</b> (${pct(Number(p.value) || 0)} %)`;
        },
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: text, formatter: (v: number) => this.currencyService.formatChartAxis(v) },
        splitLine: { lineStyle: { color: grid, opacity: 0.5 } },
      },
      yAxis: {
        type: 'category',
        data: ordered.map((i) => i.name),
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { color: text, width: 110, overflow: 'truncate' },
      },
      series: [
        {
          name: 'Recaudado',
          type: 'bar',
          data: ordered.map((i) => i.value),
          barMaxWidth: 24,
          itemStyle: { color: palette[0], borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            color: text,
            formatter: (p: any) => `${pct(Number(p.value) || 0)} %`,
          },
        },
      ],
    });
  }
}
