import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { ChartData, ChartOptions, ChartType } from 'chart.js';

// Re-export Chart.js types for convenience
export type { ChartData, ChartOptions, ChartType };

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  template: `
    <div class="chart-container" [class]="containerClass">
      <canvas 
        baseChart 
        [data]="data" 
        [options]="mergedOptions">
      </canvas>
    </div>
  `,
  styles: [
    `
      .chart-container {
        position: relative;
        height: 100%;
        width: 100%;
        min-height: 200px;
      }

      .chart-container.small {
        min-height: 150px;
      }

      .chart-container.large {
        min-height: 400px;
      }

      canvas {
        max-height: 100%;
        max-width: 100%;
      }
    `,
  ],
})
export class ChartComponent implements OnChanges {
  @Input() data: ChartData = { labels: [], datasets: [] };
  @Input() type: 'bar' | 'line' | 'pie' | 'doughnut' = 'bar';
  @Input() options: ChartOptions = {};
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() className = '';

  containerClass: string = '';
  mergedOptions: ChartOptions = {};

  constructor() {
    this.updateContainerClass();
  }

  ngOnChanges(changes: SimpleChanges): void {
    this.updateContainerClass();
    this.mergeOptions();
  }

  private updateContainerClass(): void {
    const sizeClasses = {
      small: 'small',
      medium: '',
      large: 'large',
    };
    this.containerClass = `${sizeClasses[this.size]} ${this.className}`.trim();
  }

  private mergeOptions(): void {
    const defaultOptions: any = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: {
              size: 12,
            },
            color: '#64748b',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 12,
          borderColor: 'rgba(126, 215, 165, 0.3)',
          borderWidth: 1,
          displayColors: true,
        },
      },
    };

    // Type-specific options
    if (this.type === 'line') {
      defaultOptions.scales = {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#64748b',
            font: {
              size: 12,
            },
          },
        },
        y: {
          beginAtZero: true,
          stacked: true,
          grid: {
            color: 'rgba(148, 163, 184, 0.1)',
          },
          ticks: {
            color: '#64748b',
            font: {
              size: 12,
            },
            callback: (value: any) => '$' + value / 1000 + 'K',
          },
        },
      };
    } else if (this.type === 'bar') {
      defaultOptions.scales = {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: '#64748b',
            font: {
              size: 12,
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(148, 163, 184, 0.1)',
          },
          ticks: {
            color: '#64748b',
            font: {
              size: 12,
            },
          },
        },
      };
    } else if (this.type === 'doughnut') {
      defaultOptions.cutout = '65%';
    }

    this.mergedOptions = { ...defaultOptions, ...this.options };
  }
}
