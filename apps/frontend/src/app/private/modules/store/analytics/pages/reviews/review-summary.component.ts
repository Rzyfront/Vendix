import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ReviewsSummary, AnalyticsService } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-review-summary',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    ChartComponent,
    IconComponent,
    ExportButtonComponent,
    DateRangeFilterComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="pb-6">
      <!-- Stats Cards -->
      @if (loading()) {
        <div class="stats-container">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total Reseñas"
            [value]="summary()?.total_reviews || 0"
            smallText="Reseñas recibidas"
            iconName="message-square"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Rating Promedio"
            [value]="summary()?.average_rating || 0"
            smallText="Sobre 5 estrellas"
            iconName="star"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Pendientes"
            [value]="summary()?.pending_reviews || 0"
            smallText="Por aprobar"
            iconName="clock"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>

          <app-stats
            title="Aprobadas"
            [value]="summary()?.approved_reviews || 0"
            smallText="Publicadas"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
        </div>
      }

      <!-- Filter Bar -->
      <div
        class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0"
          >
            <app-icon name="star" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h2 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Analíticas de Reseñas
            </h2>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Opiniones, valoraciones y satisfacción del cliente
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

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
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución de Ratings</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Conteo por estrellas</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="ratingDistributionChartOptions()" size="large" [showLegend]="false"></app-chart>
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
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Estado de Reseñas</span>
            <span class="text-xs text-[var(--color-text-secondary)]">Aprobadas, pendientes y rechazadas</span>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart [options]="reviewsStatusChartOptions()" size="large" [showLegend]="false"></app-chart>
            }
          </div>
        </app-card>
      </div>
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
  `,
})
export class ReviewSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading = signal(true);
  exporting = signal(false);
  summary = signal<ReviewsSummary | null>(null);

  ratingDistributionChartOptions= signal<EChartsOption>({});
  reviewsStatusChartOptions= signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly reviewsViews: AnalyticsView[] = getViewsByCategory('reviews');

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService.getReviewsSummary({ date_range: this.dateRange() }).subscribe({
      next: (response) => {
        if (response?.data) {
          this.summary.set(response.data);
          this.updateCharts();
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService.exportReviewsAnalytics({ date_range: this.dateRange() }).subscribe({
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

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  private updateCharts(): void {
    const style = getComputedStyle(document.documentElement);
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const data = this.summary();
    if (!data) return;

    const ratingDistribution = data.rating_distribution || {};

    // Rating Distribution Bar Chart
    const stars = [5, 4, 3, 2, 1];
    const counts = stars.map((star) => (ratingDistribution as any)[star] || 0);

    this.ratingDistributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const star = params[0];
          return `${star.name} estrellas: <b>${star.value}</b>`;
        },
      },
      legend: {
        data: ['Distribución'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '6%',
        bottom: '20%',
        top: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: stars.map((s) => `${s} ★`),
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: '#e5e7eb' } },
      },
      series: [
        {
          name: 'Distribución',
          type: 'line',
          data: counts,
          itemStyle: {
            color: '#f59e0b',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b40' },
                { offset: 1, color: '#f59e0b05' },
              ],
            },
          },
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
        data: ['Estado Reviews'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: { left: '3%', right: '10%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: { type: 'value' },
      yAxis: {
        type: 'category',
        data: ['Pendientes', 'Aprobadas', 'Rechazadas'],
        axisLabel: { color: textSecondary },
      },
      series: [
        {
          name: 'Estado Reviews',
          type: 'line',
          data: [
            { value: data.pending_reviews || 0, itemStyle: { color: '#f59e0b' } },
            { value: data.approved_reviews || 0, itemStyle: { color: '#22c55e' } },
            { value: data.rejected_reviews || 0, itemStyle: { color: '#ef4444' } },
          ],
        },
      ],
    });
  }
}