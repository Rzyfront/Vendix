import { Component, DestroyRef, OnInit, inject, computed, signal  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Subscription, defaultIfEmpty, take } from 'rxjs';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReviewsSummary, RatingTrendPoint, AnalyticsService } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { compactCountAxis, truncateLabel } from '../../../../../../shared/utils/chart-labels.util';
import { comparisonLabelFor } from '../../utils/comparison-label.util';

import {
  OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
@Component({
  selector: 'vendix-review-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    AnalyticsCardComponent,

    OptionsDropdownComponent,],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
      :host ::ng-deep .results-header { padding: 0.75rem 1rem; }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Stats Cards -->
      @if (loading()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else if (summaryError()) {
        <div role="alert" class="p-4 rounded-xl border border-border bg-surface text-[var(--color-text-secondary)]">
          No se pudo cargar el resumen de reseñas. Intenta nuevamente desde los filtros.
        </div>
      } @else if (summary()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Calificación promedio"
            [value]="summary()?.average_rating ?? 0"
            [smallText]="averageRatingGrowthText()"
            iconName="star"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Reseñas del período"
            [value]="summary()?.total_reviews || 0"
            [smallText]="totalReviewsGrowthText()"
            iconName="message-square"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Por moderar"
            [value]="summary()?.pending_reviews || 0"
            smallText="Pendientes de aprobación"
            iconName="clock"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>

          <app-stats
            title="Compras verificadas"
            [value]="verifiedPurchaseRateText()"
            [smallText]="verifiedPurchaseSmallText()"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>
      }

          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
      <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2 min-w-0">
          <app-icon name="star" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
          <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Analíticas de Reseñas</span>
        </div>
        <div class="flex items-end gap-2 flex-wrap shrink-0">
        <app-options-dropdown
                    class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                    [filters]="filterConfigs"
                    [filterValues]="filterValues()"
                    [actions]="dropdownActions()"
                    [showActions]="true"
                    triggerLabel="Acciones"
                    triggerIcon="plus"
                    [debounceMs]="350"
                    [isLoading]="exporting()"
                    (filterChange)="onFilterChange($event)"
                    (clearAllFilters)="onClearAllFilters()"
                    (actionClick)="onActionsDropdownClick($event)"
                  ></app-options-dropdown>
        </div>
      </div>
      <div class="p-4 space-y-6">


      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
        <!-- Charts Row -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Rating Distribution Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución de Ratings</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Solo aprobadas · conteo y % del total</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (summaryError()) {
              <p class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Resumen no disponible.</p>
            } @else if (summary()) {
              <app-chart [options]="ratingDistributionChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>

        <!-- Reviews Status Chart -->
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="results-header flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado de Reseñas</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Aprobadas, pendientes y rechazadas</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (summaryError()) {
              <p class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Resumen no disponible.</p>
            } @else if (summary()) {
              <app-chart [options]="reviewsStatusChartOptions()" size="large" [showLegend]="true"></app-chart>
            }
          </div>
        </app-card>
      </div>

      <!-- Rating Trend Chart -->
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="results-header flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Tendencia de Calificación Promedio</span>
          <span class="text-xs text-[var(--color-text-secondary)]">Solo aprobadas · por período local de la tienda</span>
        </div>
        <div class="p-4">
          @if (trendLoading()) {
            <div class="h-64 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else if (trendError()) {
            <p role="alert" class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
              No se pudo cargar la tendencia de calificaciones. Intenta nuevamente desde los filtros.
            </p>
          } @else {
            <app-chart [options]="ratingTrendChartOptions()" size="large" [showLegend]="true"></app-chart>
          }
        </div>
      </app-card>

      <p class="text-xs text-[var(--color-text-secondary)] leading-relaxed">
        El promedio considera solo reseñas aprobadas (las visibles en la tienda). Pendientes y rechazadas se listan aparte. El % vs. período anterior y la compra verificada comparten ese mismo denominador.
      </p>
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Reseñas</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of reviewsViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
          </div>
    </app-card>
</div>

`,
})
export class ReviewSummaryComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);

  private dataRequests = new Subscription();
  private requestVersion = 0;

  loading = signal(true);
  trendLoading = signal(true);
  summaryError = signal(false);
  trendError = signal(false);
  exporting = signal(false);
  summary = signal<ReviewsSummary | null>(null);
  ratingTrend = signal<RatingTrendPoint[]>([]);

  ratingDistributionChartOptions= signal<EChartsOption>({});
  reviewsStatusChartOptions= signal<EChartsOption>({});
  ratingTrendChartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly reviewsViews: AnalyticsView[] = getViewsByCategory('reviews');

  /** QUI-629: la tendencia respeta el rango elegido sin selector extra. */
  readonly trendGranularity = computed<'day' | 'week' | 'month' | 'year'>(
    () => {
      const range = this.dateRange();
      const start = new Date(range.start_date).getTime();
      const end = new Date(range.end_date).getTime();
      if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) {
        return 'day';
      }
      const days = (end - start) / 86_400_000;
      if (days <= 45) return 'day';
      if (days <= 180) return 'week';
      if (days <= 800) return 'month';
      return 'year';
    },
  );

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.loadData();
  }

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.requestVersion++;
      this.dataRequests.unsubscribe();
    });
  }

  loadData(): void {
    if (this.destroyRef.destroyed) return;
    const version = ++this.requestVersion;
    this.dataRequests.unsubscribe();
    this.dataRequests = new Subscription();
    const dateRange = { ...this.dateRange() };

    this.loading.set(true);
    this.trendLoading.set(true);
    this.summaryError.set(false);
    this.trendError.set(false);
    this.summary.set(null);
    this.ratingTrend.set([]);
    this.ratingDistributionChartOptions.set({});
    this.reviewsStatusChartOptions.set({});
    this.ratingTrendChartOptions.set({});

    this.dataRequests.add(
      this.analyticsService.getReviewsSummary({ date_range: dateRange })
        .pipe(take(1), defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            if (version !== this.requestVersion) return;
            if (response?.data) {
              this.summary.set(response.data);
              this.updateSummaryCharts();
            } else {
              this.summaryError.set(true);
            }
            this.loading.set(false);
          },
          error: () => {
            if (version !== this.requestVersion) return;
            this.summaryError.set(true);
            this.loading.set(false);
          },
        }),
    );

    this.dataRequests.add(
      this.analyticsService.getRatingTrend({
        date_range: dateRange,
        granularity: this.trendGranularity(),
      })
        .pipe(take(1), defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            if (version !== this.requestVersion) return;
            if (response?.data) {
              this.ratingTrend.set(response.data);
              this.updateTrendChart();
            } else {
              this.trendError.set(true);
            }
            this.trendLoading.set(false);
          },
          error: () => {
            if (version !== this.requestVersion) return;
            this.trendError.set(true);
            this.trendLoading.set(false);
          },
        }),
    );
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportReviewsAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resenas_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => {
        this.exporting.set(false);
      },
    });
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
      this.dateRange.set({
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      });
      this.loadData();
    }
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.loadData();
  }

  /**
   * `null` = no hay base comparable en el período anterior ("Sin base de
   * comparación..." en vez de inventar un 0 %).
   */
  private growthText(
    growthValue: number | null | undefined,
  ): string {
    if (growthValue === undefined || growthValue === null) {
      return `Sin base de comparación vs ${comparisonLabelFor(this.dateRange().preset)}`;
    }
    const sign = growthValue >= 0 ? '+' : '';
    return `${sign}${growthValue.toFixed(1)}% vs ${comparisonLabelFor(this.dateRange().preset)}`;
  }

  readonly averageRatingGrowthText = computed<string>(() =>
    this.growthText(this.summary()?.average_rating_growth),
  );

  readonly totalReviewsGrowthText = computed<string>(() =>
    this.growthText(this.summary()?.total_reviews_growth),
  );

  readonly verifiedPurchaseRateText = computed<string>(() => {
    const rate = this.summary()?.verified_purchase_rate;
    return rate === null || rate === undefined ? '—' : `${rate.toFixed(1)}%`;
  });

  readonly verifiedPurchaseSmallText = computed<string>(() => {
    const approved = this.summary()?.approved_reviews ?? 0;
    return `de ${approved} aprobadas`;
  });

  private updateSummaryCharts(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const data = this.summary();
    if (!data) return;

    const ratingDistribution = data.rating_distribution || {};
    const approvedTotal =
      Object.values(ratingDistribution).reduce((a, b) => a + b, 0) || 0;

    // Rating Distribution Bar Chart
    const stars = [5, 4, 3, 2, 1];
    const counts = stars.map((star) => (ratingDistribution as any)[star] || 0);

    this.ratingDistributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          // `trigger: 'axis'` sends one entry per series. Pick the non-zero
          // one so the tooltip names the star actually under the cursor instead
          // of whichever series happens to come first.
          const hit = (Array.isArray(params) ? params : [params]).find(
            (p: any) => Number(p?.value) > 0,
          );
          const star = hit ?? (Array.isArray(params) ? params[0] : params);
          if (!star) return '';
          const count = Number(star.value) || 0;
          const pct =
            approvedTotal > 0 ? ((count / approvedTotal) * 100).toFixed(1) : '0.0';
          return `${star.name} estrellas: <b>${count}</b> (${pct}%)`;
        },
      },
      legend: {
        data: ['5★', '4★', '3★', '2★', '1★'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '25%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: stars.map((s) => `${s} ★`),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: '5★', type: 'bar' as const, data: [counts[0], 0, 0, 0, 0],
          itemStyle: { color: '#22c55e' }, barMaxWidth: 40,
        },
        {
          name: '4★', type: 'bar' as const, data: [0, counts[1], 0, 0, 0],
          itemStyle: { color: '#84cc16' }, barMaxWidth: 40,
        },
        {
          name: '3★', type: 'bar' as const, data: [0, 0, counts[2], 0, 0],
          itemStyle: { color: '#f59e0b' }, barMaxWidth: 40,
        },
        {
          name: '2★', type: 'bar' as const, data: [0, 0, 0, counts[3], 0],
          itemStyle: { color: '#f97316' }, barMaxWidth: 40,
        },
        {
          name: '1★', type: 'bar' as const, data: [0, 0, 0, 0, counts[4]],
          itemStyle: { color: '#ef4444' }, barMaxWidth: 40,
        },
      ],
    });

    // Reviews Status Line
    this.reviewsStatusChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: <b>${p.value}</b>`;
        },
      },
      legend: {
        data: ['Pendientes', 'Aprobadas', 'Rechazadas'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '10%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: ['Pendientes', 'Aprobadas', 'Rechazadas'],
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary, formatter: (val: string) => truncateLabel(val, 14) },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Pendientes',
          type: 'bar' as const,
          data: [data.pending_reviews || 0],
          itemStyle: { color: '#f59e0b' },
          barMaxWidth: 40,
        },
        {
          name: 'Aprobadas',
          type: 'bar' as const,
          data: [data.approved_reviews || 0],
          itemStyle: { color: '#22c55e' },
          barMaxWidth: 40,
        },
        {
          name: 'Rechazadas',
          type: 'bar' as const,
          data: [data.rejected_reviews || 0],
          itemStyle: { color: '#ef4444' },
          barMaxWidth: 40,
        },
      ],
    });
  }

  private updateTrendChart(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    // Rating Trend Line Chart (solo aprobadas, período local)
    const points = this.ratingTrend();
    const granularity = this.trendGranularity();
    const trendLabels = points.map((p) =>
      truncateLabel(formatChartPeriod(p.period, granularity), 12),
    );
    const trendValues = points.map((p) => Number(p.average_rating.toFixed(1) ?? 0));
    const trendCounts = points.map((p) => p.review_count);

    this.ratingTrendChartOptions.set({
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}<br/>Promedio: <b>${Number(p.value).toFixed(1)}</b><br/>Reseñas: ${trendCounts[p.dataIndex] ?? 0}`;
        },
      },
      legend: {
        data: ['Calificación Promedio'],
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '5%', bottom: '20%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: trendLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 5,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Calificación Promedio',
          type: 'line' as const,
          data: trendValues,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 2, color: '#f59e0b' },
          areaStyle: { opacity: 0.08, color: '#f59e0b' },
        },
      ],
    });
  }
}
