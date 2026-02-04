import {
  Component,
  Input,
  OnChanges,
  Output,
  EventEmitter,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgxEchartsDirective, provideEchartsCore } from 'ngx-echarts';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart, RadarChart, GaugeChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  DatasetComponent,
  TransformComponent
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, UniversalTransition } from 'echarts/features';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  ScatterChart,
  RadarChart,
  GaugeChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  DataZoomComponent,
  DatasetComponent,
  TransformComponent,
  LabelLayout,
  UniversalTransition,
  CanvasRenderer
]);

// Extended chart types including advanced charts
// Kept for backward compatibility mapping if needed, or simplification
export type ExtendedChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'doughnut'
  | 'area'
  | 'radar'
  | 'polarArea'
  | 'scatter'
  | 'bubble'
  | 'nightingale'
  | 'gauge';

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
  imports: [CommonModule, NgxEchartsDirective],
  providers: [
    provideEchartsCore({ echarts }),
  ],
  template: `
    <div
      class="chart-container"
      [class]="containerClass"
      [style.background-color]="theme.backgroundColor"
    >
      <div *ngIf="loading" class="chart-loading">
        <div class="loading-spinner"></div>
      </div>
      <div 
        echarts 
        [options]="mergedOptions" 
        [theme]="$any(echartsTheme)"
        class="echarts-chart"
        (chartClick)="onChartClick($event)"
        (chartMouseOver)="onChartHover($event)"
      ></div>
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
        overflow: hidden; /* Ensure chart doesn't overflow rounded corners */
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
      
      .echarts-chart {
        width: 100%;
        height: 100%;
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
  // New Input for ECharts options
  @Input() options: EChartsOption = {};

  // Kept mostly for compatibility or container styling
  @Input() size: 'small' | 'medium' | 'large' = 'medium';
  @Input() className = '';
  @Input() theme: ChartTheme = CHART_THEMES['corporate'];
  @Input() loading = false;

  // Deprecated usage
  @Input() type: ExtendedChartType = 'bar';
  @Input() data: any = {};
  @Input() animated = true;
  @Input() showLegend = true;
  @Input() showTooltip = true;
  @Input() exportable = false;

  @Output() chartClick = new EventEmitter<any>();
  @Output() chartHover = new EventEmitter<any>();

  containerClass = '';
  mergedOptions: EChartsOption = {};
  echartsTheme: string | object | undefined;

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
    const baseOptions = { ...this.options };

    if (!baseOptions.color && this.theme.colors) {
      baseOptions.color = this.theme.colors;
    }

    if (!baseOptions.tooltip && this.showTooltip) {
      baseOptions.tooltip = {
        trigger: 'item',
        backgroundColor: this.theme.backgroundColor ? this.theme.backgroundColor + 'dd' : 'rgba(255, 255, 255, 0.9)',
        textStyle: {
          color: this.theme.textColor || '#333'
        }
      };
    }

    if (!baseOptions.legend && this.showLegend) {
      baseOptions.legend = {
        show: true,
        textStyle: {
          color: this.theme.legendColor || this.theme.textColor
        }
      };
    }

    this.mergedOptions = baseOptions;
    this.echartsTheme = this.theme.name === 'Dark' ? 'dark' : undefined;
  }

  onChartClick(event: any): void {
    this.chartClick.emit(event);
  }

  onChartHover(event: any): void {
    this.chartHover.emit(event);
  }
}
