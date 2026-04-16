import {
  Component,
  ElementRef,
  DestroyRef,
  input,
  viewChild,
  effect,
  afterNextRender,
  inject,
} from '@angular/core';

import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { TimeSeriesPoint } from '../../interfaces';
import { formatBytes } from '../../../../../../core/utils/format.utils';
import { CardComponent } from '../../../../../../shared/components/card/card.component';

Chart.register(...registerables);

@Component({
  selector: 'app-metric-chart',
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-card [padding]="false" customClasses="!p-4">
      <div class="flex items-center justify-between mb-3">
        <span
          class="text-sm font-semibold"
          style="color: var(--color-text-primary);"
          >{{ label() }}</span
        >
        @if (latestValue !== null) {
          <span
            class="text-xs font-mono px-2 py-0.5 rounded"
            style="color: var(--color-text-muted); background: var(--color-surface);"
            >{{ formatValue(latestValue) }}</span
          >
        }
      </div>
      <!-- Loading skeleton -->
      @if (loading()) {
        <div
          class="h-52 w-full rounded-lg animate-pulse"
          style="background: var(--color-border); opacity: 0.3;"
        ></div>
      }
      <!-- Chart canvas - always in DOM, hidden when loading -->
      <div class="h-52 w-full" [class.hidden]="loading()">
        <canvas #chartCanvas></canvas>
      </div>
    </app-card>
  `,
})
export class MetricChartComponent {
  readonly label = input<string>('');
  readonly datapoints = input<TimeSeriesPoint[] | null>(null);
  readonly unit = input<string>('');
  readonly color = input<string>('#7ed7a5');
  readonly secondaryDatapoints = input<TimeSeriesPoint[] | null>(null);
  readonly secondaryLabel = input<string>('');
  readonly secondaryColor = input<string>('#ef4444');
  readonly tertiaryDatapoints = input<TimeSeriesPoint[] | null>(null);
  readonly tertiaryLabel = input<string>('');
  readonly tertiaryColor = input<string>('#eab308');
  readonly loading = input<boolean>(false);

  readonly chartCanvas =
    viewChild.required<ElementRef<HTMLCanvasElement>>('chartCanvas');

  private chart: Chart | null = null;
  private viewReady = false;
  private destroyRef = inject(DestroyRef);

  get latestValue(): number | null {
    const datapoints = this.datapoints();
    if (!datapoints || datapoints.length === 0) return null;
    return datapoints[datapoints.length - 1].value;
  }

  constructor() {
    afterNextRender(() => {
      this.viewReady = true;
      this.createOrUpdateChart();
    });

    effect(() => {
      // Track all signal dependencies
      this.datapoints();
      this.secondaryDatapoints();
      this.tertiaryDatapoints();
      this.loading();
      this.color();
      this.secondaryColor();
      this.tertiaryColor();

      if (this.viewReady && !this.loading()) {
        requestAnimationFrame(() => this.createOrUpdateChart());
      }
    });

    this.destroyRef.onDestroy(() => {
      this.chart?.destroy();
    });
  }

  formatValue(value: number | null): string {
    if (value === null) return '--';
    const unit = this.unit();
    if (unit === '%') return `${value.toFixed(1)}%`;
    if (unit === 'bytes') return formatBytes(value);
    if (unit === 'ms') return `${value.toFixed(2)} ms`;
    if (unit === 'ops') return `${value.toFixed(0)} ops`;
    return `${value.toFixed(1)} ${unit}`;
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
    const chartCanvas = this.chartCanvas();
    if (!chartCanvas?.nativeElement) return;
    const points = this.datapoints() || [];
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
        label: this.label(),
        data: points.map((p) => ({ x: new Date(p.timestamp), y: p.value })),
        borderColor: this.color(),
        backgroundColor: this.color() + '20',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      },
    ];

    const secondaryDatapoints = this.secondaryDatapoints();
    if (secondaryDatapoints && secondaryDatapoints.length > 0) {
      datasets.push({
        label: this.secondaryLabel() || 'Secondary',
        data: secondaryDatapoints.map((p) => ({
          x: new Date(p.timestamp),
          y: p.value,
        })),
        borderColor: this.secondaryColor(),
        backgroundColor: this.secondaryColor() + '20',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
      });
    }

    const tertiaryDatapoints = this.tertiaryDatapoints();
    if (tertiaryDatapoints && tertiaryDatapoints.length > 0) {
      datasets.push({
        label: this.tertiaryLabel() || 'Tertiary',
        data: tertiaryDatapoints.map((p) => ({
          x: new Date(p.timestamp),
          y: p.value,
        })),
        borderColor: this.tertiaryColor(),
        backgroundColor: this.tertiaryColor() + '20',
        borderWidth: 2,
        fill: false,
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

    this.chart = new Chart(chartCanvas.nativeElement, {
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
