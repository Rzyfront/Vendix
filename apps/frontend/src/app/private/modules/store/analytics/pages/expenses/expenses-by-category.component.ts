import { Component, inject, signal, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { EChartsOption } from 'echarts';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'vendix-expenses-by-category',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent, ChartComponent, StatsComponent, ExportButtonComponent, DateRangeFilterComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Categorías"
          [value]="totalCategories()"
          smallText=" categorías"
          iconName="tag"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Gastos Operativos"
          [value]="operationalExpenses()"
          iconName="briefcase"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Gastos Variables"
          [value]="variableExpenses()"
          iconName="trending-up"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>

        <app-stats
          title="Mayor Gasto"
          [value]="topCategory()"
          iconName="alert-circle"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="tag" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Gastos por Categoría
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Distribución de gastos por categoría
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 md:gap-3 shrink-0">
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
      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución por Categoría</span>
        </div>
        <app-chart [options]="chartOptions()" size="large" [showLegend]="true"></app-chart>
      </app-card>
      </div>
    </div>
  `,
})
export class ExpensesByCategoryComponent {
  chartOptions = signal<EChartsOption>({});
  exporting = signal(false);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  readonly categoriesData = signal([
    { name: 'Operativos', value: 0 },
    { name: 'Nomina', value: 0 },
    { name: 'Servicios', value: 0 },
    { name: 'Alquiler', value: 0 },
    { name: 'Marketing', value: 0 },
  ]);

  readonly totalCategories = computed(() => this.categoriesData().length);
  readonly operationalExpenses = computed(() => this.categoriesData()[0]?.value || 0);
  readonly variableExpenses = computed(() => this.categoriesData().reduce((sum, c) => sum + c.value, 0) - this.operationalExpenses());
  readonly topCategory = computed(() => {
    const sorted = [...this.categoriesData()].sort((a, b) => b.value - a.value);
    return sorted[0]?.name || '-';
  });

  constructor() {
    this.buildChart();
  }

  private buildChart(): void {
    const borderColor = '#e5e7eb';
    const textSecondary = '#6b7280';

    this.chartOptions.set({
      tooltip: { trigger: 'axis' },
      legend: { data: this.categoriesData().map(c => c.name), bottom: 30, textStyle: { color: textSecondary } },
      grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
      xAxis: {
        type: 'category',
        data: this.categoriesData().map(c => c.name),
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1000000,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: this.categoriesData().map((c, i) => ({
          name: c.name,
          type: 'bar' as const,
          data: [c.value],
          itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] },
        })),
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    setTimeout(() => this.exporting.set(false), 1000);
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
  }
}