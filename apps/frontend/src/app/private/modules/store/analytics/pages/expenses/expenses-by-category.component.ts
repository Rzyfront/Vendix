import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-expenses-by-category',
  standalone: true,
  imports: [RouterModule, IconComponent, CardComponent, ChartComponent, ExportButtonComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1">
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
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

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
  exporting = signal(false);

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
          type: 'bar',
          data: [0, 0, 0, 0, 0],
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#f59e0b' },
                { offset: 1, color: '#f59e0b80' },
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