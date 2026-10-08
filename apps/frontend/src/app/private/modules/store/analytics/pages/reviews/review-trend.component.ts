import { Component, DestroyRef, OnInit, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { Subscription, defaultIfEmpty, take } from 'rxjs';
import { EChartsOption } from 'echarts';
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
import { AnalyticsService, ReviewsTrend, ReviewsTrendTotals } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate, formatChartPeriod } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { compactCountAxis, truncateLabel } from '../../../../../../shared/utils/chart-labels.util';
import { comparisonLabelFor } from '../../utils/comparison-label.util';

const TAG_LABELS: Record<string, string> = {
  very_easy: 'Súper fácil',
  normal: 'Normal',
  difficult: 'Difícil',
  none: 'Sin etiqueta',
};

@Component({
  selector: 'vendix-review-trend',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
  ],
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
      @if (loading()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else if (error()) {
        <div role="alert" class="p-4 rounded-xl border border-border bg-surface text-[var(--color-text-secondary)]">
          No se pudo cargar la tendencia de reseñas. Intenta nuevamente desde los filtros.
        </div>
      } @else if (trend()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Reseñas totales"
            [value]="totalReviews()"
            [smallText]="totalGrowthText()"
            iconName="message-square"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
          <app-stats
            title="Promedio productos"
            [value]="avgText(trend()?.totals?.product?.avg)"
            [smallText]="avgDeltaText(trend()?.totals?.product)"
            iconName="star"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>
          <app-stats
            title="Promedio experiencia"
            [value]="avgText(trend()?.totals?.experience?.avg)"
            [smallText]="avgDeltaText(trend()?.totals?.experience)"
            iconName="star"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>
          <app-stats
            title="% Súper fácil"
            [value]="veryEasyText()"
            [smallText]="veryEasySmallText()"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>
      }

      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="trending-up" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Tendencia de reseñas</span>
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
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">Reseñas por periodo</span>
                <span class="text-xs text-[var(--color-text-secondary)]">Productos y experiencia de compra</span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-64 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (error()) {
                  <p role="alert" class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Datos no disponibles.</p>
                } @else if (trend()) {
                  <app-chart [options]="countChartOptions()" size="large" [showLegend]="true"></app-chart>
                }
              </div>
            </app-card>

            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">Calificación promedio</span>
                <span class="text-xs text-[var(--color-text-secondary)]">Solo aprobadas · periodos sin reseñas quedan en blanco</span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-64 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (error()) {
                  <p role="alert" class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Datos no disponibles.</p>
                } @else if (trend()) {
                  <app-chart [options]="avgChartOptions()" size="large" [showLegend]="true"></app-chart>
                }
              </div>
            </app-card>

            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución de estrellas</span>
                <span class="text-xs text-[var(--color-text-secondary)]">Productos vs experiencia de compra</span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-64 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (error()) {
                  <p role="alert" class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Datos no disponibles.</p>
                } @else if (trend()) {
                  <app-chart [options]="distributionChartOptions()" size="large" [showLegend]="true"></app-chart>
                }
              </div>
            </app-card>

            <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
              <div slot="header" class="results-header flex flex-col">
                <span class="text-sm font-bold text-[var(--color-text-primary)]">Reseña rápida</span>
                <span class="text-xs text-[var(--color-text-secondary)]">Etiqueta elegida en la experiencia de compra</span>
              </div>
              <div class="p-4">
                @if (loading()) {
                  <div class="h-64 flex items-center justify-center">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                } @else if (error()) {
                  <p role="alert" class="h-64 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">Datos no disponibles.</p>
                } @else if (trend()) {
                  <app-chart [options]="quickTagChartOptions()" size="large" [showLegend]="false"></app-chart>
                }
              </div>
            </app-card>
          </div>
        </div>
      </app-card>
    </div>
  `,
})
export class ReviewTrendComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);

  private dataRequests = new Subscription();
  private requestVersion = 0;

  loading = signal(true);
  error = signal(false);
  exporting = signal(false);
  trend = signal<ReviewsTrend | null>(null);

  countChartOptions = signal<EChartsOption>({});
  avgChartOptions = signal<EChartsOption>({});
  distributionChartOptions = signal<EChartsOption>({});
  quickTagChartOptions = signal<EChartsOption>({});

  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  /** Granularidad automática según el rango elegido (sin selector extra). */
  readonly trendGranularity = computed<'day' | 'week' | 'month' | 'year'>(() => {
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
  });

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { action: 'export-xlsx', label: 'Exportar XLSX', icon: 'download' },
  ]);

  readonly filterConfigs: FilterConfig[] = [
    { key: 'date_range', label: 'Período', type: 'date-range' },
  ];

  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
    };
  });

  readonly totalReviews = computed<number>(() => {
    const t = this.trend()?.totals;
    return (t?.product?.count ?? 0) + (t?.experience?.count ?? 0);
  });

  readonly totalGrowthText = computed<string>(() => {
    const t = this.trend()?.totals;
    const previous = (t?.product?.previous_count ?? 0) + (t?.experience?.previous_count ?? 0);
    const label = comparisonLabelFor(this.dateRange().preset);
    if (previous <= 0) {
      return `Sin base de comparación vs ${label}`;
    }
    const growth = ((this.totalReviews() - previous) / previous) * 100;
    return `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}% vs ${label}`;
  });

  /** % de "Súper fácil" sobre las experiencias que traen etiqueta. */
  private readonly quickTagCounts = computed(() => {
    const tags = this.trend()?.quick_tags ?? [];
    const countOf = (tag: string) => tags.find((t) => t.tag === tag)?.count ?? 0;
    const veryEasy = countOf('very_easy');
    const tagged = veryEasy + countOf('normal') + countOf('difficult');
    return { veryEasy, tagged };
  });

  readonly veryEasyText = computed<string>(() => {
    const { veryEasy, tagged } = this.quickTagCounts();
    return tagged > 0 ? `${((veryEasy / tagged) * 100).toFixed(1)}%` : '—';
  });

  readonly veryEasySmallText = computed<string>(() => {
    const { veryEasy, tagged } = this.quickTagCounts();
    return `${veryEasy} de ${tagged} experiencias con etiqueta`;
  });

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

    this.loading.set(true);
    this.error.set(false);
    this.trend.set(null);
    this.countChartOptions.set({});
    this.avgChartOptions.set({});
    this.distributionChartOptions.set({});
    this.quickTagChartOptions.set({});

    this.dataRequests.add(
      this.analyticsService
        .getReviewsTrend({
          date_range: { ...this.dateRange() },
          granularity: this.trendGranularity(),
        })
        .pipe(take(1), defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (response) => {
            if (version !== this.requestVersion) return;
            if (response?.data) {
              this.trend.set(response.data);
              this.updateCharts();
            } else {
              this.error.set(true);
            }
            this.loading.set(false);
          },
          error: () => {
            if (version !== this.requestVersion) return;
            this.error.set(true);
            this.loading.set(false);
          },
        }),
    );
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportReviewsTrend({
        date_range: this.dateRange(),
        granularity: this.trendGranularity(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `resenas_tendencia_${this.dateRange().end_date}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
        },
      });
  }

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

  avgText(avg: number | null | undefined): string {
    return avg === null || avg === undefined ? '—' : `${avg.toFixed(1)} ★`;
  }

  /** Delta absoluto en estrellas; sin promedio previo no hay base de comparación. */
  avgDeltaText(totals: ReviewsTrendTotals | undefined): string {
    const label = comparisonLabelFor(this.dateRange().preset);
    if (
      !totals ||
      totals.avg === null ||
      totals.avg === undefined ||
      totals.previous_avg === null ||
      totals.previous_avg === undefined
    ) {
      return `Sin base de comparación vs ${label}`;
    }
    const delta = totals.avg - totals.previous_avg;
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} ★ vs ${label}`;
  }

  private updateCharts(): void {
    const data = this.trend();
    if (!data) return;

    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    // Un acento (productos) + un neutro (experiencia): sin paleta por entidad.
    const accent = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const neutral = '#9ca3af';
    const gridLine = '#e5e7eb';
    const granularity = this.trendGranularity();

    const periods = data.series.map((p) => p.period);
    const labels = periods.map((p) => truncateLabel(formatChartPeriod(p, granularity), 12));

    const baseGrid = { left: '3%', right: '5%', bottom: '20%', top: '5%', containLabel: true };
    const legend = (names: string[]) => ({
      data: names,
      selectedMode: true,
      bottom: 30,
      left: 'center' as const,
      itemWidth: 14,
      textStyle: { color: textSecondary },
    });
    const xAxisTime = {
      type: 'category' as const,
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: gridLine } },
      axisLabel: { color: textSecondary },
    };

    // (a) Reseñas por periodo
    this.countChartOptions.set({
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const title = list[0] ? formatChartPeriod(periods[list[0].dataIndex] ?? '', granularity) : '';
          return `${title}<br/>${list
            .map((p: any) => `${p.marker}${p.seriesName}: <b>${p.value ?? 0}</b>`)
            .join('<br/>')}`;
        },
      },
      legend: legend(['Productos', 'Experiencia']),
      grid: baseGrid,
      xAxis: xAxisTime,
      yAxis: {
        type: 'value',
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: gridLine } },
      },
      series: [
        {
          name: 'Productos',
          type: 'line' as const,
          data: data.series.map((p) => p.product_count),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: accent },
          lineStyle: { width: 2, color: accent },
        },
        {
          name: 'Experiencia',
          type: 'line' as const,
          data: data.series.map((p) => p.experience_count),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: neutral },
          lineStyle: { width: 2, color: neutral },
        },
      ],
    });

    // (b) Calificación promedio (null = hueco, sin conectar)
    this.avgChartOptions.set({
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'line' },
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const title = list[0] ? formatChartPeriod(periods[list[0].dataIndex] ?? '', granularity) : '';
          return `${title}<br/>${list
            .map(
              (p: any) =>
                `${p.marker}${p.seriesName}: <b>${p.value === null || p.value === undefined || p.value === '-' ? 'Sin reseñas' : Number(p.value).toFixed(1)}</b>`,
            )
            .join('<br/>')}`;
        },
      },
      legend: legend(['Productos', 'Experiencia']),
      grid: baseGrid,
      xAxis: xAxisTime,
      yAxis: {
        type: 'value',
        min: 0,
        max: 5,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: gridLine } },
      },
      series: [
        {
          name: 'Productos',
          type: 'line' as const,
          data: data.series.map((p) => p.product_avg),
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: accent },
          lineStyle: { width: 2, color: accent },
        },
        {
          name: 'Experiencia',
          type: 'line' as const,
          data: data.series.map((p) => p.experience_avg),
          connectNulls: false,
          smooth: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: neutral },
          lineStyle: { width: 2, color: neutral },
        },
      ],
    });

    // (c) Distribución de estrellas agrupada producto vs experiencia
    const stars = [1, 2, 3, 4, 5];
    const countByStar = (rows: Array<{ rating: number; count: number }>) =>
      stars.map((s) => rows.find((r) => r.rating === s)?.count ?? 0);
    this.distributionChartOptions.set({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, confine: true },
      legend: legend(['Productos', 'Experiencia']),
      grid: { left: '3%', right: '5%', bottom: '25%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: stars.map((s) => `${s} ★`),
        axisLine: { lineStyle: { color: gridLine } },
        axisLabel: { color: textSecondary },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: gridLine } },
      },
      series: [
        {
          name: 'Productos',
          type: 'bar' as const,
          data: countByStar(data.rating_distribution?.product ?? []),
          itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        },
        {
          name: 'Experiencia',
          type: 'bar' as const,
          data: countByStar(data.rating_distribution?.experience ?? []),
          itemStyle: { color: neutral, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 28,
        },
      ],
    });

    // (d) Reseña rápida (barras horizontales; primer elemento arriba)
    const order = ['very_easy', 'normal', 'difficult', 'none'];
    const tagRows = order.map((tag) => ({
      label: TAG_LABELS[tag],
      count: data.quick_tags?.find((t) => t.tag === tag)?.count ?? 0,
    }));
    this.quickTagChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        confine: true,
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          return `${p.name}: <b>${p.value}</b>`;
        },
      },
      grid: { left: '3%', right: '8%', bottom: '5%', top: '5%', containLabel: true },
      xAxis: {
        type: 'value',
        min: 0,
        minInterval: 1,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, formatter: (v: number) => compactCountAxis(v) },
        splitLine: { lineStyle: { color: gridLine } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: tagRows.map((r) => r.label),
        axisLine: { lineStyle: { color: gridLine } },
        axisLabel: { color: textSecondary },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'Experiencias',
          type: 'bar' as const,
          data: tagRows.map((r) => r.count),
          itemStyle: { color: accent, borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 24,
          label: { show: true, position: 'right', color: textSecondary },
        },
      ],
    });
  }
}
