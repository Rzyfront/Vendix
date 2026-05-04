import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-expense-summary',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent, ChartComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Gastos</span>
      </div>
      <h1 class="text-xl font-bold text-text-primary">Resumen de Gastos</h1>
      
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
        data: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun'],
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
          data: [0, 0, 0, 0, 0, 0],
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
}