import {Component, OnInit, OnDestroy, inject, signal,
  DestroyRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

import { DateRangeFilter } from '../../interfaces/analytics.interface';
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

@Component({
  selector: 'vendix-customer-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    ExportButtonComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './customer-summary.component.html',
  styleUrls: ['./customer-summary.component.scss'] })
export class CustomerSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
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

  // Options dropdown config
  filterConfigs: FilterConfig[] = [
    {
      key: 'date_from',
      label: 'Desde',
      type: 'date',
      defaultValue: getDefaultStartDate() },
    {
      key: 'date_to',
      label: 'Hasta',
      type: 'date',
      defaultValue: getDefaultEndDate() },
    {
      key: 'granularity',
      label: 'Granularidad',
      type: 'select',
      options: [
        { value: 'hour', label: 'Por Hora' },
        { value: 'day', label: 'Por Día' },
        { value: 'week', label: 'Por Semana' },
        { value: 'month', label: 'Por Mes' },
        { value: 'year', label: 'Por Año' },
      ],
      placeholder: 'Seleccionar',
      defaultValue: 'day' },
  ];

  filterValues: FilterValues = {};

  readonly customersViews: AnalyticsView[] = getViewsByCategory('customers');

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(CustomersActions.loadCustomersSummary());
    this.store.dispatch(CustomersActions.loadCustomersTrends());
    this.store.dispatch(CustomersActions.loadTopCustomers());

    // Sync store state → filterValues for the options dropdown
    combineLatest([this.dateRange$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([dateRange, granularity]) => {
        this.filterValues = {
          date_from: dateRange.start_date || null,
          date_to: dateRange.end_date || null,
          granularity: granularity || 'day' };
      });

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

  onFilterChange(values: FilterValues): void {
    const dateFrom = values['date_from'] as string;
    const dateTo = values['date_to'] as string;
    const granularity = values['granularity'] as string;

    const currentRange = this.filterValues;
    if (
      dateFrom !== currentRange['date_from'] ||
      dateTo !== currentRange['date_to']
    ) {
      this.store.dispatch(
        CustomersActions.setDateRange({
          dateRange: {
            start_date: dateFrom || '',
            end_date: dateTo || '',
            preset: 'custom' } }),
      );
    }

    if (granularity !== currentRange['granularity']) {
      this.store.dispatch(
        CustomersActions.setGranularity({ granularity: granularity || 'day' }),
      );
    }
  }

  onClearAllFilters(): void {
    this.store.dispatch(
      CustomersActions.setDateRange({
        dateRange: {
          start_date: getDefaultStartDate(),
          end_date: getDefaultEndDate(),
          preset: 'thisMonth' } }),
    );
    this.store.dispatch(
      CustomersActions.setGranularity({ granularity: 'day' }),
    );
  }

  exportReport(): void {
    this.store.dispatch(CustomersActions.exportCustomersReport());
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs período anterior`;
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
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary } },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
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
      this.topCustomersChartOptions.set({ series: [] });
      return;
    }

    const sorted = [...topCustomers].reverse();
    const names = sorted.map((c) => {
      // Prefer customer_name from backend, fallback to first+last or email
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
      grid: {
        left: '3%',
        right: '6%',
        bottom: '3%',
        containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.format(Math.round(value), 0) },
        splitLine: { lineStyle: { color: borderColor } } },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: {
          color: textSecondary,
          width: 120,
          overflow: 'truncate' } },
      series: [
        {
          name: 'Total Gastado',
          type: 'bar',
          data: values,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: `${primaryColor}99` },
                { offset: 1, color: primaryColor },
              ] },
            borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 32 },
      ] });
  }

}
