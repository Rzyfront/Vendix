import { Component, OnInit, OnDestroy, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

import {
  CustomerTrend } from '../../interfaces/customers-analytics.interface';

import * as AcquisitionActions from './state/customer-acquisition.actions';
import * as AcquisitionSelectors from './state/customer-acquisition.selectors';

import { EChartsOption } from 'echarts';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../shared/utils/date.util';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';

@Component({
  selector: 'vendix-customer-acquisition',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    ExportButtonComponent,
    DateRangeFilterComponent,
    AnalyticsCardComponent,
  ],
  templateUrl: './customer-acquisition.component.html',
  styleUrls: ['./customer-acquisition.component.scss'],
})
export class CustomerAcquisitionComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);

  newCustomers$: Observable<number> = this.store.select(
    AcquisitionSelectors.selectNewCustomers,
  );
  conversionRate$: Observable<number> = this.store.select(
    AcquisitionSelectors.selectConversionRate,
  );
  acquisitionCost$: Observable<number> = this.store.select(
    AcquisitionSelectors.selectAcquisitionCost,
  );
  bestChannel$: Observable<string> = this.store.select(
    AcquisitionSelectors.selectBestChannel,
  );
  trends$: Observable<CustomerTrend[]> = this.store.select(
    AcquisitionSelectors.selectTrends,
  );
  channels$: Observable<any[]> = this.store.select(
    AcquisitionSelectors.selectChannels,
  );
  loading$: Observable<boolean> = this.store.select(
    AcquisitionSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    AcquisitionSelectors.selectLoadingTrends,
  );
  loadingChannels$: Observable<boolean> = this.store.select(
    AcquisitionSelectors.selectLoadingChannels,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    AcquisitionSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    AcquisitionSelectors.selectGranularity,
  );

  readonly newCustomers = toSignal(this.newCustomers$, { initialValue: 0 });
  readonly conversionRate = toSignal(this.conversionRate$, { initialValue: 0 });
  readonly acquisitionCost = toSignal(this.acquisitionCost$, { initialValue: 0 });
  readonly bestChannel = toSignal(this.bestChannel$, { initialValue: 'Directo' });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });
  readonly loadingChannels = toSignal(this.loadingChannels$, { initialValue: false });

  trendsChartOptions= signal<EChartsOption>({});
  channelsChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});
  exporting = signal(false);

  readonly customersViews: AnalyticsView[] = getViewsByCategory('customers');

  ngOnInit(): void {
    this.store.dispatch(AcquisitionActions.loadAcquisitionSummary());
    this.store.dispatch(AcquisitionActions.loadAcquisitionTrends());
    this.store.dispatch(AcquisitionActions.loadAcquisitionChannels());

    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateTrendsChart(trends, granularity);
      });

    combineLatest([this.channels$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([channels]) => {
        this.updateChannelsChart(channels);
      });
  }

  ngOnDestroy(): void {
    this.store.dispatch(AcquisitionActions.clearCustomerAcquisitionState());
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(AcquisitionActions.setDateRange({ dateRange: range }));
  }

  exportReport(): void {
    this.store.dispatch(AcquisitionActions.loadAcquisitionSummary());
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
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0];
          const trend = trends[data.dataIndex];
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${data.name}</strong><br/>
              <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${primaryColor}"></span>
                <span>Nuevos Clientes:</span>
                <strong style="margin-left:auto">${data.value}</strong>
              </div>
              ${trend ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">Registrados: ${data.name}</div>` : ''}
            </div>
          `;
        } },
      legend: {
        data: ['Nuevos Clientes'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 } },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } } },
      series: [
        {
          name: 'Nuevos Clientes',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: newCustomers,
          itemStyle: { color: primaryColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: primaryColor + '40' },
                { offset: 1, color: primaryColor + '05' },
              ],
            },
          },
        },
      ] });
  }

  private updateChannelsChart(channels: any[]): void {
    const style = getComputedStyle(document.documentElement);
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    if (!channels.length) {
      this.channelsChartOptions.set({ series: [] });
      return;
    }

    const channelColors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

    const labels = channels.map((c) => c.display_name || c.channel);
    const values = channels.map((c) => c.new_customers);

    this.channelsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor,
        borderWidth: 1,
        textStyle: { color: textSecondary, fontSize: 12 },
        formatter: (params: any) => {
          const data = params[0];
          const channel = channels[data.dataIndex];
          return `
            <div style="padding:8px">
              <strong style="font-size:13px">${data.name}</strong>
              <div style="margin-top:8px">
                <div style="display:flex;justify-content:space-between;gap:16px">
                  <span>Nuevos Clientes:</span>
                  <strong>${data.value}</strong>
                </div>
                ${channel?.conversion_rate ? `
                <div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px">
                  <span>Tasa Conversión:</span>
                  <strong>${channel.conversion_rate}%</strong>
                </div>
                ` : ''}
                ${channel?.total_visitors !== undefined ? `
                <div style="display:flex;justify-content:space-between;gap:16px;margin-top:4px">
                  <span>Visitantes:</span>
                  <strong>${channel.total_visitors}</strong>
                </div>
                ` : ''}
              </div>
            </div>
          `;
        } },
      legend: {
        data: ['Canales'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
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
        axisLabel: {
          color: textSecondary,
          fontSize: 11,
          rotate: 0 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor, type: 'dashed' } } },
      series: [
        {
          name: 'Canales',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: values,
          itemStyle: {
            color: (params: any) => channelColors[params.dataIndex % channelColors.length],
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${channelColors[0]}40` },
                { offset: 1, color: `${channelColors[0]}05` },
              ],
            },
          },
        },
      ] });
  }
}
