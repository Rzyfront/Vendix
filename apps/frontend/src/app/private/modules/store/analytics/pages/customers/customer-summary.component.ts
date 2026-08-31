import {Component, OnInit, OnDestroy, inject, signal, computed,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  CustomersSummary,
  CustomerTrend,
  TopCustomer } from '../../interfaces/customers-analytics.interface';

import * as CustomersActions from './state/customers-analytics.actions';
import * as CustomersSelectors from './state/customers-analytics.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../shared/utils/date.util';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { comparisonLabelFor } from '../../utils/comparison-label.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { truncateLabel, compactCountAxis } from '../../../../../../shared/utils/chart-labels.util';

@Component({
  selector: 'vendix-customer-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
  ],
  templateUrl: './customer-summary.component.html',
  styleUrls: ['./customer-summary.component.scss'] })
export class CustomerSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private readonly route = inject(ActivatedRoute);
// Observables from store
  summary$: Observable<CustomersSummary | null> = this.store.select(
    CustomersSelectors.selectSummary,
  );
  trends$: Observable<CustomerTrend[]> = this.store.select(
    CustomersSelectors.selectTrends,
  );
  topCustomers$: Observable<TopCustomer[]> = this.store.select(
    CustomersSelectors.selectTopCustomers,
  );
  loading$: Observable<boolean> = this.store.select(
    CustomersSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    CustomersSelectors.selectLoadingTrends,
  );
  exporting$: Observable<boolean> = this.store.select(
    CustomersSelectors.selectExporting,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    CustomersSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    CustomersSelectors.selectGranularity,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly exporting = toSignal(this.exporting$, { initialValue: false });

  // Chart options
  trendsChartOptions= signal<EChartsOption>({});
  topCustomersChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly customersViews: AnalyticsView[] = getViewsByCategory('customers');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
      this.store.dispatch(CustomersActions.setDateRange({ dateRange: urlRange }));
    }

    // Dispatch initial loads
    this.store.dispatch(CustomersActions.loadCustomersSummary());
    this.store.dispatch(CustomersActions.loadCustomersTrends());
    this.store.dispatch(CustomersActions.loadTopCustomers());

    // Subscribe to trends to build chart options
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateTrendsChart(trends, granularity);
      });

    // Subscribe to top customers to build chart options
    this.topCustomers$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((topCustomers) => {
        this.updateTopCustomersChart(topCustomers);
      });
  }

  ngOnDestroy(): void {

this.store.dispatch(CustomersActions.clearCustomersAnalyticsState());
  }

  exportReport(): void {
    this.store.dispatch(CustomersActions.exportCustomersReport());
  }

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range',
    },
  ];

  /**
   * Proyecta el `dateRange` signal a las 3 keys que consume el dropdown
   * (`start`, `end`, `preset`). Computed para que el panel refleje los
   * cambios de NgRx sin tener que reasignar manualmente.
   */
  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
    };
  });

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onFilterChange(values: FilterValues): void {
    const start = values['date_range_start'] as string;
    const end = values['date_range_end'] as string;
    const preset = values['date_range_preset'] as string;
    if (start && end) {
      const nextRange: DateRangeFilter = {
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      };
      this.dateRange.set(nextRange);
      this.store.dispatch(CustomersActions.setDateRange({ dateRange: nextRange }));
    }
  }

  onClearAllFilters(): void {
    const defaultRange: DateRangeFilter = {
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    };
    this.dateRange.set(defaultRange);
    this.store.dispatch(CustomersActions.setDateRange({ dateRange: defaultRange }));
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    // QUI-609: derive the comparison label from the active preset (was the
    // hardcoded "vs período anterior" — defect C9 in the ticket catalog).
    return `${sign}${growth.toFixed(1)}% vs ${comparisonLabelFor(this.dateRange().preset)}`;
  }

  private updateTrendsChart(
    trends: CustomerTrend[],
    granularity: string,
  ): void {

    const style = getComputedStyle(document.documentElement);
    const primaryColor = '#8b5cf6';
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );
    const newCustomers = trends.map((t) => t.new_customers);

    this.trendsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Nuevos Clientes: ${data.value}`;
        } },
      legend: {
        data: ['Nuevos Clientes'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary } },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Nuevos Clientes',
          type: 'line',
          smooth: true,
          data: newCustomers,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}4D` },
                { offset: 1, color: `${primaryColor}0D` },
              ] } },
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor } },
      ] });
  }

  private updateTopCustomersChart(topCustomers: TopCustomer[]): void {
    const style = getComputedStyle(document.documentElement);
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const primaryColor = '#3b82f6';

    if (!topCustomers.length) {
      this.topCustomersChartOptions.set({
        graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: 'Sin datos disponibles', fill: '#9ca3af', fontSize: 14 } }],
      });
      return;
    }

    const sorted = [...topCustomers].reverse();
    const names = sorted.map((c) => {
      const fullName = c.customer_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
      return fullName || c.email;
    });
    const values = sorted.map((c) => c.total_spent);

    this.topCustomersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const data = params[0];
          return `${data.name}<br/>Total: ${this.currencyService.format(data.value)}`;
        } },
      legend: {
        data: ['Top Clientes'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        top: '3%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 10, width: 100, overflow: 'truncate', formatter: (val: string) => truncateLabel(val, 14) } },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.formatChartAxis(value) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Top Clientes',
          type: 'bar',
          data: values.map((v, i) => ({
            value: v,
            itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] }
          })),
          barMaxWidth: 40 },
      ] });
  }

}
