import {Component, OnInit, OnDestroy, inject,
  DestroyRef, signal, computed} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable, combineLatest } from 'rxjs';
import { toSignal , takeUntilDestroyed} from '@angular/core/rxjs-interop';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import {
  CurrencyPipe,
  CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import {
  OverviewSummary,
  OverviewTrend } from '../../../interfaces/overview-analytics.interface';
import {
  AnalyticsCardComponent
} from '../../../components/analytics-card/analytics-card.component';
import {
  AnalyticsCategoryChipsComponent
} from '../../../components/analytics-category-chips/analytics-category-chips.component';
import {
  ExportButtonComponent
} from '../../../components/export-button/export-button.component';
import {
  DateRangeFilterComponent
} from '../../../components/date-range-filter/date-range-filter.component';
import {
  ANALYTICS_CATEGORIES,
  ANALYTICS_VIEWS,
  AnalyticsCategoryId,
  AnalyticsView,
} from '../../../config/analytics-registry';

import * as OverviewActions from '../state/overview-summary.actions';
import * as OverviewSelectors from '../state/overview-summary.selectors';

import { EChartsOption } from 'echarts';
import { formatChartPeriod, getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-overview-summary',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
    AnalyticsCategoryChipsComponent,
    ExportButtonComponent,
    DateRangeFilterComponent,
  ],
  templateUrl: './overview-summary.component.html',
  styleUrls: ['./overview-summary.component.scss'] })
export class OverviewSummaryComponent implements OnInit, OnDestroy {
  private destroyRef = inject(DestroyRef);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
// Observables from store
  summary$: Observable<OverviewSummary | null> = this.store.select(
    OverviewSelectors.selectSummary,
  );
  trends$: Observable<OverviewTrend[]> = this.store.select(
    OverviewSelectors.selectTrends,
  );
  loading$: Observable<boolean> = this.store.select(
    OverviewSelectors.selectLoading,
  );
  loadingTrends$: Observable<boolean> = this.store.select(
    OverviewSelectors.selectLoadingTrends,
  );
  dateRange$: Observable<DateRangeFilter> = this.store.select(
    OverviewSelectors.selectDateRange,
  );
  granularity$: Observable<string> = this.store.select(
    OverviewSelectors.selectGranularity,
  );

  readonly summary = toSignal(this.summary$, { initialValue: null });
  readonly loading = toSignal(this.loading$, { initialValue: false });
  readonly loadingTrends = toSignal(this.loadingTrends$, { initialValue: false });

  // Analytics Catalog signals
  readonly selectedCategory = signal<AnalyticsCategoryId | null>(null);
  readonly searchTerm = signal<string>('');

  readonly categories = ANALYTICS_CATEGORIES;

  private readonly categoryById = computed(() =>
    new Map(ANALYTICS_CATEGORIES.map((c) => [c.id, c])),
  );

  readonly filteredViews = computed(() => {
    const category = this.selectedCategory();
    const search = this.searchTerm().toLowerCase().trim();

    let views = ANALYTICS_VIEWS.filter((v) => v.category !== 'overview');

    if (category) {
      views = views.filter((v) => v.category === category);
    }

    if (search) {
      views = views.filter(
        (v) =>
          v.title.toLowerCase().includes(search) ||
          v.description.toLowerCase().includes(search),
      );
    }

    return views;
  });

  readonly viewsByCategory = computed(() => {
    const views = this.filteredViews();
    const grouped = new Map<AnalyticsCategoryId, AnalyticsView[]>();

    for (const view of views) {
      if (!grouped.has(view.category)) {
        grouped.set(view.category, []);
      }
      grouped.get(view.category)!.push(view);
    }

    return grouped;
  });

// Chart options
  gaugeChartOptions= signal<EChartsOption>({});
  comparativeChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  // Cached summary for template helpers
  private currentSummary: OverviewSummary | null = null;

  ngOnInit(): void {
    this.currencyService.loadCurrency();

    // Dispatch initial loads
    this.store.dispatch(OverviewActions.loadOverviewSummary());
    this.store.dispatch(OverviewActions.loadOverviewTrends());

    // Cache summary for template helpers
    this.summary$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((summary) => {
      this.currentSummary = summary;
      if (summary) {
        this.updateGaugeChart(summary.breakeven_ratio);
      }
    });

    // Subscribe to trends to build comparative chart
    combineLatest([this.trends$, this.granularity$])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([trends, granularity]) => {
        this.updateComparativeChart(trends, granularity);
      });
  }

  ngOnDestroy(): void {

this.store.dispatch(OverviewActions.clearOverviewSummaryState());
  }

  onCategoryChange(categoryId: AnalyticsCategoryId | null): void {
    this.selectedCategory.set(categoryId);
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.store.dispatch(OverviewActions.setDateRange({ dateRange: range }));
  }

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
  }

  exportReport(): void {
  }

  getCategoryLabel = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.label ?? categoryId;
  };

  getCategoryIcon = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.icon ?? 'folder';
  };

  getCategoryColor = (categoryId: AnalyticsCategoryId): string => {
    return this.categoryById().get(categoryId)?.color ?? 'var(--color-primary)';
  };

  // Template helpers
  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs periodo anterior`;
  }

  formatBreakevenRatio(ratio?: number): string {
    if (ratio === undefined || ratio === null) return '0%';
    return `${ratio.toFixed(1)}%`;
  }

  getBreakevenLabel(ratio?: number): string {
    if (!ratio) return 'Sin datos';
    if (ratio < 70) return 'Margen saludable';
    if (ratio < 90) return 'Margen ajustado';
    return 'Margen critico';
  }

  getBreakevenBgColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'bg-green-100';
    if (ratio < 90) return 'bg-yellow-100';
    return 'bg-red-100';
  }

  getBreakevenTextColor(ratio?: number): string {
    if (!ratio || ratio < 70) return 'text-green-600';
    if (ratio < 90) return 'text-yellow-600';
    return 'text-red-600';
  }

  getBreakevenStatusText(ratio?: number): string {
    if (!ratio)
      return 'Registra ingresos y gastos para ver el estado de tu negocio.';
    if (ratio < 70) {
      return `Tu negocio opera con un margen saludable. Solo el ${ratio.toFixed(1)}% de tus ingresos se destina a cubrir gastos.`;
    }
    if (ratio < 90) {
      return `Tus gastos representan el ${ratio.toFixed(1)}% de tus ingresos. Considera optimizar costos para mejorar el margen.`;
    }
    return `Atención: tus gastos representan el ${ratio.toFixed(1)}% de tus ingresos. Revisa tu estructura de costos.`;
  }

  // Chart builders
  private updateGaugeChart(ratio: number): void {
    this.gaugeChartOptions.set({
      series: [
        {
          type: 'gauge',
          center: ['50%', '65%'],
          radius: '90%',
          startAngle: 180,
          endAngle: 0,
          min: 0,
          max: 150,
          splitNumber: 3,
          pointer: {
            show: true,
            length: '60%',
            width: 6,
            itemStyle: {
              color: 'auto' } },
          axisLine: {
            lineStyle: {
              width: 20,
              color: [
                [0.467, '#22c55e'], // 0-70%: green
                [0.6, '#eab308'], // 70-90%: yellow
                [1, '#ef4444'], // 90-150%: red
              ] } },
          axisTick: { show: false },
          splitLine: {
            length: 12,
            lineStyle: { width: 2, color: '#999' } },
          axisLabel: {
            distance: 25,
            fontSize: 11,
            formatter: (value: number) => `${value}%` },
          detail: {
            valueAnimation: true,
            formatter: (value: number) => `${value.toFixed(1)}%`,
            fontSize: 20,
            fontWeight: 'bold',
            offsetCenter: [0, '20%'],
            color: ratio < 70 ? '#22c55e' : ratio < 90 ? '#eab308' : '#ef4444' },
          data: [{ value: Math.min(ratio, 150) }] },
      ] });
  }

  private updateComparativeChart(
    trends: OverviewTrend[],
    granularity: string,
  ): void {

    const style = getComputedStyle(document.documentElement);
    const borderColor =
      style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary =
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const labels = trends.map((t) =>
      formatChartPeriod(t.period, granularity),
    );

    this.comparativeChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            html += `${p.marker} ${p.seriesName}: ${this.currencyService.format(p.value)}<br/>`;
          }
          return html;
        } },
      legend: {
        data: ['Ventas', 'Gastos', 'Impuestos', 'Rend. Bruto', 'Rend. Neto'],
        bottom: 30,
        textStyle: { color: textSecondary } },
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
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (value: number) => this.currencyService.format(Math.round(value), 0) },
        splitLine: { lineStyle: { color: borderColor } } },
      series: [
        {
          name: 'Ventas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.sales),

          itemStyle: { color: '#22c55e' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#22c55e4D' },
                { offset: 1, color: '#22c55e0D' },
              ] } } },
        {
          name: 'Gastos',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.expenses),

          itemStyle: { color: '#ef4444' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#ef44444D' },
                { offset: 1, color: '#ef44440D' },
              ] } } },
        {
          name: 'Impuestos',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.taxes),

          itemStyle: { color: '#f59e0b' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b4D' },
                { offset: 1, color: '#f59e0b0D' },
              ] } } },
        {
          name: 'Rend. Bruto',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.gross_profit),

          itemStyle: { color: '#3b82f6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f64D' },
                { offset: 1, color: '#3b82f60D' },
              ] } } },
        {
          name: 'Rend. Neto',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.net_profit),

          itemStyle: { color: '#8b5cf6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#8b5cf64D' },
                { offset: 1, color: '#8b5cf60D' },
              ] } } },
      ] });
  }

}
