import {
  Component,
  Input,
  OnChanges,
  Output,
  EventEmitter,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import {
  ChartData,
  ChartOptions,
  ChartType,
  ChartConfiguration,
} from 'chart.js';

// Re-export Chart.js types for convenience
export type { ChartData, ChartOptions, ChartType, ChartConfiguration };

// Extended chart types including advanced charts
export type ExtendedChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area'
  | 'radar'
  | 'polarArea'
  | 'scatter'
  | 'bubble';

// Chart themes
export interface ChartTheme {
  name: string;
  colors: string[];
  backgroundColor?: string;
  gridColor?: string;
  textColor?: string;
  legendColor?: string;
}

// Predefined beautiful themes
export const CHART_THEMES: { [key: string]: ChartTheme } = {
  corporate: {
    name: 'Corporate',
    colors: ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'],
    gridColor: 'rgba(148, 163, 184, 0.1)',
    textColor: '#64748b',
    legendColor: '#64748b',
  },
  vibrant: {
    name: 'Vibrant',
    colors: ['#ec4899', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b'],
    gridColor: 'rgba(148, 163, 184, 0.1)',
    textColor: '#475569',
    legendColor: '#475569',
  },
  dark: {
    name: 'Dark',
    colors: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'],
    backgroundColor: '#1e293b',
    gridColor: 'rgba(71, 85, 105, 0.3)',
    textColor: '#cbd5e1',
    legendColor: '#cbd5e1',
  },
  minimal: {
    name: 'Minimal',
    colors: ['#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#f8fafc'],
    gridColor: 'rgba(148, 163, 184, 0.05)',
    textColor: '#64748b',
    legendColor: '#64748b',
  },
};

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  template: `
    <div
      class="chart-container"
      [class]="containerClass"
      [style.background-color]="theme.backgroundColor"
    >
      <div *ngIf="loading" class="chart-loading">
        <div class="loading-spinner"></div>
      </div>
      <canvas
        baseChart
        [data]="processedData"
        [options]="mergedOptions"
        [type]="chartJsType"
        (chartClick)="onChartClick($event)"
        (chartHover)="onChartHover($event)"
      >
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
        border-radius: 0.75rem;
        transition: all 0.3s ease;
      }

      .chart-container.small {
        min-height: 150px;
      }

      .chart-container.large {
        min-height: 400px;
      }

      .chart-container:hover {
        box-shadow:
          0 4px 6px -1px rgba(0, 0, 0, 0.1),
          0 2px 4px -1px rgba(0, 0, 0, 0.06);
      }

      canvas {
        max-height: 100%;
        max-width: 100%;
      }

      .chart-loading {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.8);
        border-radius: 0.75rem;
        z-index: 10;
      }

      .loading-spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #f3f4f6;
        border-top: 4px solid #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        0% {
          transform: rotate(0deg);
        }
        100% {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class ChartComponent implements OnChanges {
  @Input() data: ChartData = { labels: [], datasets: [] };
  @Input() type: ExtendedChartType = 'bar';
  @Input() options: ChartOptions = {};
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() className = '';
  @Input() theme: ChartTheme = CHART_THEMES['corporate'];
  @Input() loading = false;
  @Input() animated = true;
  @Input() showLegend = true;
  @Input() showTooltip = true;
  @Input() exportable = false;

  @Output() chartClick = new EventEmitter<any>();
  @Output() chartHover = new EventEmitter<any>();

  containerClass = '';
  mergedOptions: ChartOptions = {};
  processedData: ChartData = { labels: [], datasets: [] };
  chartJsType: ChartType = 'bar';

  constructor() {
    this.updateContainerClass();
  }

  ngOnChanges(changes: any): void {
    this.updateContainerClass();
    this.processData();
    this.mergeOptions();
    this.updateChartJsType();
  }

  private updateContainerClass(): void {
    const sizeClasses = {
      small: 'small',
      medium: '',
      large: 'large',
    };
    this.containerClass = `${sizeClasses[this.size]} ${this.className}`.trim();
  }

  private processData(): void {
    const processedDatasets = this.data.datasets.map((dataset, index) => {
      const themeColor = this.theme.colors[index % this.theme.colors.length];

      const processedDataset: any = {
        ...dataset,
        backgroundColor:
          dataset.backgroundColor ||
          (this.type === 'line' || this.type === 'area'
            ? themeColor + '20'
            : themeColor),
        borderColor: dataset.borderColor || themeColor,
        borderWidth:
          dataset.borderWidth ||
          (this.type === 'line' || this.type === 'area' ? 2 : 1),
      };

      if (this.type === 'line' || this.type === 'area') {
        processedDataset.tension =
          (dataset as any).tension !== undefined
            ? (dataset as any).tension
            : 0.4;
        processedDataset.fill =
          (dataset as any).fill !== undefined
            ? (dataset as any).fill
            : this.type === 'area';
      }

      return processedDataset;
    });

    this.processedData = {
      ...this.data,
      datasets: processedDatasets,
    };
  }

  private mergeOptions(): void {
    const defaultOptions: any = {
      responsive: true,
      maintainAspectRatio: false,
      animation: this.animated
        ? {
            duration: 1000,
            easing: 'easeInOutQuart',
          }
        : false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: this.showLegend,
          position: 'top',
          align: 'end',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: {
              size: 12,
            },
            color: this.theme.legendColor || this.theme.textColor,
          },
        },
        tooltip: {
          enabled: this.showTooltip,
          backgroundColor: this.theme.backgroundColor
            ? this.theme.backgroundColor + 'dd'
            : 'rgba(15, 23, 42, 0.9)',
          titleColor: this.theme.textColor || '#fff',
          bodyColor: this.theme.textColor || '#fff',
          padding: 12,
          borderColor: this.theme.colors[0] + '40',
          borderWidth: 1,
          displayColors: true,
          boxPadding: 4,
          callbacks: {
            label: (context: any) => {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                label += new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  minimumFractionDigits: 0,
                }).format(context.parsed.y);
              } else if (context.parsed !== null) {
                label += new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  minimumFractionDigits: 0,
                }).format(context.parsed);
              }
              return label;
            },
          },
        },
      },
    };

    if (this.type === 'line' || this.type === 'area') {
      defaultOptions.scales = {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            color: this.theme.textColor,
            font: {
              size: 12,
            },
          },
        },
        y: {
          beginAtZero: true,
          stacked: this.type === 'area',
          grid: {
            color: this.theme.gridColor,
          },
          ticks: {
            color: this.theme.textColor,
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
            color: this.theme.textColor,
            font: {
              size: 12,
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: this.theme.gridColor,
          },
          ticks: {
            color: this.theme.textColor,
            font: {
              size: 12,
            },
          },
        },
      };
    } else if (this.type === 'doughnut' || this.type === 'polarArea') {
      defaultOptions.cutout = this.type === 'doughnut' ? '65%' : '0%';
    } else if (this.type === 'radar') {
      defaultOptions.scales = {
        r: {
          beginAtZero: true,
          grid: {
            color: this.theme.gridColor,
          },
          ticks: {
            color: this.theme.textColor,
            backdropColor: 'transparent',
          },
          pointLabels: {
            color: this.theme.textColor,
            font: {
              size: 12,
            },
          },
        },
      };
    } else if (this.type === 'scatter' || this.type === 'bubble') {
      defaultOptions.scales = {
        x: {
          type: 'linear',
          position: 'bottom',
          grid: {
            color: this.theme.gridColor,
          },
          ticks: {
            color: this.theme.textColor,
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: this.theme.gridColor,
          },
          ticks: {
            color: this.theme.textColor,
          },
        },
      };
    }

    this.mergedOptions = { ...defaultOptions, ...this.options };
  }

  private updateChartJsType(): void {
    const typeMap: { [key in ExtendedChartType]: ChartType } = {
      bar: 'bar',
      line: 'line',
      pie: 'pie',
      doughnut: 'doughnut',
      area: 'line',
      radar: 'radar',
      polarArea: 'polarArea',
      scatter: 'scatter',
      bubble: 'bubble',
    };
    this.chartJsType = typeMap[this.type];
  }

  onChartClick(event: any): void {
    this.chartClick.emit(event);
  }

  onChartHover(event: any): void {
    this.chartHover.emit(event);
  }
}
