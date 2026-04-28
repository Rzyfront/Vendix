import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-expenses-by-category',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent, ChartComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Gastos</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Gastos por Categoría</h1>
      
      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución por Categoría</span>
        </div>
        <app-chart [options]="chartOptions()" size="large" [showLegend]="true"></app-chart>
      </app-card>
    </div>
  `,
})
export class ExpensesByCategoryComponent {
  chartOptions = signal<EChartsOption>({});

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
        data: ['Operativos', 'Nomina', 'Servicios', 'Alquiler', 'Marketing'],
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
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
          type: 'line',
          data: [0, 0, 0, 0, 0],
          itemStyle: { color: '#f59e0b' },
          lineStyle: { color: '#f59e0b', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b4D' },
                { offset: 1, color: '#f59e0b0D' },
              ],
            },
          },
        },
      ],
    });
  }
}