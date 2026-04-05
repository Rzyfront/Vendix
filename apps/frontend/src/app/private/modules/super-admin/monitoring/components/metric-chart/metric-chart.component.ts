import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { TimeSeriesPoint } from '../../interfaces';

Chart.register(...registerables);

@Component({
  selector: 'app-metric-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="rounded-lg p-4" style="background: var(--color-background); border: 1px solid var(--color-border);">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-semibold" style="color: var(--color-text-primary);">{{ label }}</span>
        <span *ngIf="latestValue !== null" class="text-xs font-mono px-2 py-0.5 rounded"
          style="color: var(--color-text-muted); background: var(--color-surface);">{{ formatValue(latestValue) }}</span>
      </div>
      <!-- Loading skeleton -->
      <div *ngIf="loading" class="h-52 w-full rounded-lg animate-pulse"
        style="background: var(--color-border); opacity: 0.3;"></div>
      <!-- Chart canvas - always in DOM, hidden when loading -->
      <div class="h-52 w-full" [class.hidden]="loading">
        <canvas #chartCanvas></canvas>
      </div>
    </div>
  `,
})
export class MetricChartComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() label: string = '';
  @Input() datapoints: TimeSeriesPoint[] | undefined | null;
  @Input() unit: string = '';
  @Input() color: string = '#7ed7a5';
  @Input() secondaryDatapoints: TimeSeriesPoint[] | undefined | null;
  @Input() secondaryLabel: string = '';
  @Input() secondaryColor: string = '#ef4444';
  @Input() loading: boolean = false;

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  private chart: Chart | null = null;
  private viewReady = false;

  get latestValue(): number | null {
    if (!this.datapoints || this.datapoints.length === 0) return null;
    return this.datapoints[this.datapoints.length - 1].value;
  }

  formatValue(value: number | null): string {
    if (value === null) return '--';
    if (this.unit === '%') return `${value.toFixed(1)}%`;
    if (this.unit === 'bytes') return this.formatBytes(value);
    if (this.unit === 'ms') return `${value.toFixed(2)} ms`;
    if (this.unit === 'ops') return `${value.toFixed(0)} ops`;
    return `${value.toFixed(1)} ${this.unit}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.createOrUpdateChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewReady && !this.loading) {
      // Use setTimeout to ensure the canvas is visible in the DOM after [class.hidden] updates
      setTimeout(() => this.createOrUpdateChart(), 0);
    }
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private getThemeColors(): {
    border: string;
    textMuted: string;
    surface: string;
  } {
    const style = getComputedStyle(document.documentElement);
    return {
      border:
        style.getPropertyValue('--color-border').trim() ||
        'rgba(200,200,200,0.3)',
      textMuted:
        style.getPropertyValue('--color-text-muted').trim() ||
        'rgba(150,150,150,0.8)',
      surface:
        style.getPropertyValue('--color-surface').trim() ||
        'rgba(255,255,255,1)',
    };
  }

  private createOrUpdateChart(): void {
    if (!this.chartCanvas?.nativeElement) return;
    const points = this.datapoints || [];
    if (points.length === 0) {
      if (this.chart) {
        this.chart.destroy();
        this.chart = null;
      }
      return;
    }

    const colors = this.getThemeColors();

    const datasets: any[] = [
      {
        label: this.label,
        data: points.map((p) => ({ x: new Date(p.timestamp), y: p.value })),
        borderColor: this.color,
        backgroundColor: this.color + '20',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ];

    if (
      this.secondaryDatapoints &&
      this.secondaryDatapoints.length > 0
    ) {
      datasets.push({
        label: this.secondaryLabel || 'Secondary',
        data: this.secondaryDatapoints.map((p) => ({
          x: new Date(p.timestamp),
          y: p.value,
        })),
        borderColor: this.secondaryColor,
        backgroundColor: this.secondaryColor + '20',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
    }

    if (this.chart) {
      this.chart.data.datasets = datasets;
      this.chart.update('none');
      return;
    }

    this.chart = new Chart(this.chartCanvas.nativeElement, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: datasets.length > 1,
            labels: { color: colors.textMuted, boxWidth: 12, padding: 8 },
          },
          tooltip: {
            backgroundColor: colors.surface,
            titleColor: colors.textMuted,
            bodyColor: colors.textMuted,
            borderColor: colors.border,
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            type: 'time',
            grid: { color: colors.border + '40' },
            ticks: { color: colors.textMuted, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: colors.border + '40' },
            ticks: { color: colors.textMuted },
            beginAtZero: true,
          },
        },
      },
    });
  }
}
