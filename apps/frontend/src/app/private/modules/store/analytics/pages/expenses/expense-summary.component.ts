import { Component, inject, signal, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-expense-summary',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent, ChartComponent, StatsComponent, ExportButtonComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Gastos"
          [value]="totalExpenses()"
          iconName="receipt"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Este Mes"
          [value]="monthlyExpenses()"
          smallText="acumulados"
          iconName="calendar"
          iconBgColor="bg-orange-100"
          iconColor="text-orange-600"
        ></app-stats>

        <app-stats
          title="Promedio Mensual"
          [value]="avgExpenses()"
          iconName="trending-up"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Último Mes"
          [value]="lastMonthExpenses()"
          iconName="clock"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="receipt" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Resumen de Gastos
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Vista general de gastos y tendencias
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Tendencia de Gastos</span>
        </div>
        <app-chart [options]="chartOptions()" size="large" [showLegend]="true"></app-chart>
      </app-card>
    </div>
  `,
})
export class ExpenseSummaryComponent {
  chartOptions = signal<EChartsOption>({});
  exporting = signal(false);

  readonly expensesData = signal([
    { month: 'Ene', value: 0 },
    { month: 'Feb', value: 0 },
    { month: 'Mar', value: 0 },
    { month: 'Abr', value: 0 },
    { month: 'May', value: 0 },
    { month: 'Jun', value: 0 },
  ]);

  readonly totalExpenses = computed(() => this.expensesData().reduce((sum, e) => sum + e.value, 0));
  readonly monthlyExpenses = computed(() => this.expensesData()[4]?.value || 0);
  readonly avgExpenses = computed(() => this.totalExpenses() / 6 || 0);
  readonly lastMonthExpenses = computed(() => this.expensesData()[3]?.value || 0);

  constructor() {
    this.buildChart();
  }

  private buildChart(): void {
    const borderColor = '#e5e7eb';
    const textSecondary = '#6b7280';

    this.chartOptions.set({
      tooltip: { trigger: 'axis' },
      legend: { data: ['Gastos'], bottom: 30, textStyle: { color: textSecondary } },
      grid: { left: '3%', right: '4%', bottom: '20%', containLabel: true },
      xAxis: {
        type: 'category',
        data: this.expensesData().map(e => e.month),
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Gastos',
          type: 'bar',
          data: this.expensesData().map(e => e.value),
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#ef4444' },
                { offset: 1, color: '#ef444480' },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 40,
        },
      ],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    setTimeout(() => this.exporting.set(false), 1000);
  }
}