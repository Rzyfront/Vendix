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
import { forkJoin } from 'rxjs';
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
  formatChartPeriod,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

import { AnalyticsRefreshService, Refreshable } from '../../../shared/services/analytics-refresh.service';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { PaymentsReportService } from '../../../shared/services/payments-report.service';
import {
  PaymentsSummary,
  PaymentsTrendPoint,
  PaymentState,
  StorePaymentMethodOption,
} from '../../../shared/interfaces/payments-report.interface';
import {
  PAYMENTS_PINNED_PREFIX,
  PAYMENTS_PIN_FILTER_KEY,
  PAYMENT_STATE_LABELS,
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
import { comparisonLabelFor } from '../../utils/comparison-label.util';

/** Serie 1 del palette categórico validado (dataviz) — claro / oscuro. */
const SERIES_LIGHT = '#2a78d6';
const SERIES_DARK = '#3987e5';

interface StateRow {
  state: PaymentState;
  label: string;
  count: number;
  amount: number;
}

/**
 * "Resumen de Pagos" — vista 1 de la categoría Pagos
 * (PLAN-reporte-analitica-pagos-2026-09-28, paso 4). Signals puros + OnPush.
 *
 * Reglas (vendix-analytics-metrics): monto y % salen del mismo endpoint
 * (`/summary`); crecimiento `null` = sin base (no se pinta un 0 % falso);
 * la etiqueta de comparación se deriva del preset. Sin eje doble: recaudado y
 * cantidad van en dos gráficas (dataviz).
 */
@Component({
  selector: 'vendix-payments-overview',
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
  templateUrl: './payments-overview.component.html',
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
export class PaymentsOverviewComponent implements Refreshable {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly paymentsService = inject(PaymentsReportService);
  private readonly toast = inject(ToastService);
  private readonly authFacade = inject(AuthFacade);
  private readonly dateRangeSync = inject(DateRangeSyncService);
  private readonly analyticsRefresh = inject(AnalyticsRefreshService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly filters = signal<PaymentsFilterState>(
    defaultPaymentsFilterState({ withGranularity: true }),
  );
  readonly pinned = signal(false);
  readonly methods = signal<StorePaymentMethodOption[]>([]);

  readonly summary = signal<PaymentsSummary | null>(null);
  readonly trends = signal<PaymentsTrendPoint[]>([]);
  readonly loading = signal(false);
  readonly exporting = signal(false);

  private loadSeq = 0;

  /** Objeto ESTABLE (un literal en el template ensucia el input en cada ciclo). */
  readonly headerPin: HeaderPinConfig = { key: PAYMENTS_PIN_FILTER_KEY, label: 'Fijar' };

  readonly filterConfigs = computed(() =>
    buildPaymentsFilterConfigs(this.methods(), { withGranularity: true }),
  );

  readonly filterValues = computed<FilterValues>(() => ({
    ...stateToFilterValues(this.filters()),
    [PAYMENTS_PIN_FILTER_KEY]: this.pinned() ? 'true' : null,
  }));

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { action: 'export-xlsx', label: 'Exportar XLSX', icon: 'download', disabled: this.exporting() },
  ]);

  // ── Derivados de presentación ────────────────────────────────────────────

  readonly growthText = computed(() => {
    const s = this.summary();
    if (!s) return '';
    if (s.collected_growth === null) return 'Sin base de comparación';
    const g = s.collected_growth;
    const sign = g > 0 ? '+' : '';
    return `${sign}${g.toFixed(1)} % vs ${comparisonLabelFor(this.filters().date_range.preset)}`;
  });

  readonly growthBg = computed(() => this.growthTone('bg-emerald-100', 'bg-red-100', 'bg-purple-100'));
  readonly growthColor = computed(() =>
    this.growthTone('text-emerald-600', 'text-red-600', 'text-purple-600'),
  );

  private growthTone(up: string, down: string, neutral: string): string {
    const g = this.summary()?.collected_growth;
    if (g === null || g === undefined || g === 0) return neutral;
    return g > 0 ? up : down;
  }

  readonly stateRows = computed<StateRow[]>(() =>
    (this.summary()?.by_state ?? []).map((r) => ({
      state: r.state,
      label: PAYMENT_STATE_LABELS[r.state] ?? r.state,
      count: r.count,
      amount: r.amount,
    })),
  );

  readonly stateColumns: TableColumn[] = [
    { key: 'label', label: 'Estado', sortable: false, priority: 1 },
    {
      key: 'count',
      label: '# Pagos',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => String(Number(v) || 0),
    },
    {
      key: 'amount',
      label: 'Monto',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
  ];

  readonly stateCardConfig: ItemListCardConfig = {
    titleKey: 'label',
    subtitleKey: 'count',
    subtitleTransform: (item: StateRow) => `${item.count} pagos`,
    detailKeys: [
      {
        key: 'amount',
        label: 'Monto',
        icon: 'wallet',
        transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
      },
    ],
  };

  readonly amountChartOptions = signal<EChartsOption>({});
  readonly countChartOptions = signal<EChartsOption>({});

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
    const state = this.filters();
    const query = stateToQuery(state, 1, 20);
    const granularity = state.granularity ?? 'day';
    const seq = ++this.loadSeq;

    this.loading.set(true);
    forkJoin({
      summary: this.paymentsService.getSummary(query),
      trends: this.paymentsService.getTrends(query),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ summary, trends }) => {
          if (seq !== this.loadSeq) return; // respuesta vieja: se descarta
          this.summary.set(summary);
          this.trends.set(trends);
          this.updateCharts(trends, granularity);
          this.loading.set(false);
        },
        error: () => {
          if (seq !== this.loadSeq) return;
          this.loading.set(false);
          this.toast.error('No se pudo cargar el resumen de pagos.');
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
          ...defaultPaymentsFilterState({ withGranularity: true }),
          ...saved,
        });
        this.pinned.set(true);
        return;
      }
    }
    const fromUrl = queryParamsToState(qp);
    this.filters.set({ ...fromUrl, granularity: fromUrl.granularity ?? 'day' });
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
    const next = defaultPaymentsFilterState({ withGranularity: true });
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

  // ── Gráficas ─────────────────────────────────────────────────────────────

  private themeColors(): { text: string; grid: string; series: string } {
    if (typeof document === 'undefined') {
      return { text: '#6b7280', grid: '#e5e7eb', series: SERIES_LIGHT };
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
      series: dark ? SERIES_DARK : SERIES_LIGHT,
    };
  }

  private updateCharts(points: PaymentsTrendPoint[], granularity: string): void {
    const { text, grid, series } = this.themeColors();
    const labels = points.map((p) => formatChartPeriod(p.period, granularity));

    const base = {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: labels,
        axisLine: { lineStyle: { color: grid } },
        axisLabel: { color: text, hideOverlap: true },
      },
    };

    this.amountChartOptions.set({
      ...base,
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.axisValueLabel}<br/>Recaudado: <b>${this.currencyService.format(Number(p.value) || 0)}</b>`;
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: text, formatter: (v: number) => this.currencyService.formatChartAxis(v) },
        splitLine: { lineStyle: { color: grid, opacity: 0.5 } },
      },
      series: [
        {
          name: 'Recaudado',
          type: 'bar',
          data: points.map((p) => p.collected_amount),
          barMaxWidth: 28,
          itemStyle: { color: series, borderRadius: [4, 4, 0, 0] },
        },
      ],
    });

    this.countChartOptions.set({
      ...base,
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.axisValueLabel}<br/>Pagos: <b>${p.value}</b>`;
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: grid, opacity: 0.5 } },
      },
      series: [
        {
          name: 'Pagos',
          type: 'line',
          data: points.map((p) => p.payments_count),
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: series },
          itemStyle: { color: series, borderColor: 'var(--color-surface)', borderWidth: 2 },
        },
      ],
    });
  }
}
