import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  ChartData,
  CHART_THEMES,
} from '../../../shared/components';

@Component({
  selector: 'app-chart-showcase',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  template: `
    <div
      class="p-6 space-y-8"
      style="background-color: var(--color-background); min-height: 100vh;"
    >
      <!-- Header -->
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold mb-4" style="color: var(--text);">
          Chart Showcase
        </h1>
        <p class="text-lg" style="color: var(--muted-foreground);">
          Beautiful, configurable charts for your application
        </p>
      </div>

      <!-- Theme Selector -->
      <div class="flex justify-center gap-4 mb-8">
        <button
          *ngFor="let theme of themeKeys"
          class="px-4 py-2 rounded-lg font-medium transition-all"
          [style.background-color]="
            selectedTheme === theme ? 'var(--primary)' : 'var(--muted)'
          "
          [style.color]="
            selectedTheme === theme ? 'white' : 'var(--muted-foreground)'
          "
          (click)="changeTheme(theme)"
        >
          {{ CHART_THEMES[theme].name }}
        </button>
      </div>

      <!-- Charts Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- Bar Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Bar Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Monthly sales comparison
          </p>
          <app-chart
            [data]="barChartData"
            type="bar"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Line Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Line Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Revenue trends over time
          </p>
          <app-chart
            [data]="lineChartData"
            type="line"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Area Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Area Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Cumulative growth visualization
          </p>
          <app-chart
            [data]="areaChartData"
            type="area"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Doughnut Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Doughnut Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Market share distribution
          </p>
          <app-chart
            [data]="doughnutChartData"
            type="doughnut"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Pie Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Pie Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Category breakdown
          </p>
          <app-chart
            [data]="pieChartData"
            type="pie"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Radar Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Radar Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Performance metrics comparison
          </p>
          <app-chart
            [data]="radarChartData"
            type="radar"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Polar Area Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Polar Area Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Multi-dimensional comparison
          </p>
          <app-chart
            [data]="polarAreaChartData"
            type="polarArea"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Scatter Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Scatter Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Correlation analysis
          </p>
          <app-chart
            [data]="scatterChartData"
            type="scatter"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Bubble Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Bubble Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Three-dimensional data visualization
          </p>
          <app-chart
            [data]="bubbleChartData"
            type="bubble"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>
      </div>

      <!-- Interactive Features -->
      <div
        class="mt-12 rounded-xl shadow-sm border border-border p-6"
        style="background-color: var(--color-surface);"
      >
        <h3 class="text-2xl font-semibold mb-6" style="color: var(--text);">
          Interactive Features
        </h3>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <!-- Animated Chart -->
          <div>
            <h4 class="text-lg font-medium mb-4" style="color: var(--text);">
              Animated Loading
            </h4>
            <div class="space-y-4">
              <button
                class="px-4 py-2 rounded-lg font-medium transition-all"
                [style.background-color]="
                  loading ? 'var(--error)' : 'var(--primary)'
                "
                [style.color]="'white'"
                (click)="toggleLoading()"
              >
                {{ loading ? 'Stop Loading' : 'Show Loading' }}
              </button>
              <app-chart
                [data]="barChartData"
                type="bar"
                [theme]="currentTheme"
                [loading]="loading"
                size="small"
              >
              </app-chart>
            </div>
          </div>

          <!-- Events Chart -->
          <div>
            <h4 class="text-lg font-medium mb-4" style="color: var(--text);">
              Chart Events
            </h4>
            <div class="space-y-4">
              <div
                class="p-4 rounded-lg"
                style="background-color: var(--muted);"
              >
                <p class="text-sm font-medium" style="color: var(--text);">
                  Last Event:
                </p>
                <p class="text-sm" style="color: var(--muted-foreground);">
                  {{ lastEvent || 'No events yet' }}
                </p>
              </div>
              <app-chart
                [data]="lineChartData"
                type="line"
                [theme]="currentTheme"
                size="small"
                (chartClick)="onChartClick($event)"
                (chartHover)="onChartHover($event)"
              >
              </app-chart>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ChartShowcaseComponent {
  CHART_THEMES = CHART_THEMES;
  themeKeys = Object.keys(CHART_THEMES);
  selectedTheme = 'corporate';
  currentTheme = CHART_THEMES['corporate'];
  loading = false;
  lastEvent = '';

  // Bar Chart Data
  barChartData: ChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Product A',
        data: [12000, 19000, 15000, 25000, 22000, 30000],
      },
      {
        label: 'Product B',
        data: [8000, 12000, 18000, 14000, 20000, 24000],
      },
    ],
  };

  // Line Chart Data
  lineChartData: ChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Revenue',
        data: [30000, 35000, 32000, 42000, 48000, 55000],
      },
      {
        label: 'Profit',
        data: [12000, 15000, 14000, 18000, 22000, 28000],
      },
    ],
  };

  // Area Chart Data
  areaChartData: ChartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'Cumulative Revenue',
        data: [30000, 65000, 97000, 139000, 187000, 242000],
      },
    ],
  };

  // Doughnut Chart Data
  doughnutChartData: ChartData = {
    labels: ['Electronics', 'Clothing', 'Food', 'Books', 'Other'],
    datasets: [
      {
        label: 'Sales',
        data: [35, 25, 20, 12, 8],
      },
    ],
  };

  // Pie Chart Data
  pieChartData: ChartData = {
    labels: ['Desktop', 'Mobile', 'Tablet', 'Smart TV'],
    datasets: [
      {
        label: 'Traffic Sources',
        data: [45, 35, 15, 5],
      },
    ],
  };

  // Radar Chart Data
  radarChartData: ChartData = {
    labels: ['Speed', 'Reliability', 'Comfort', 'Safety', 'Efficiency'],
    datasets: [
      {
        label: 'Model A',
        data: [85, 90, 78, 92, 88],
      },
      {
        label: 'Model B',
        data: [78, 85, 92, 80, 90],
      },
    ],
  };

  // Polar Area Chart Data
  polarAreaChartData: ChartData = {
    labels: ['North', 'South', 'East', 'West', 'Central'],
    datasets: [
      {
        label: 'Sales by Region',
        data: [42, 38, 35, 28, 45],
      },
    ],
  };

  // Scatter Chart Data
  scatterChartData: ChartData = {
    datasets: [
      {
        label: 'Dataset 1',
        data: [
          { x: 10, y: 20 },
          { x: 15, y: 35 },
          { x: 25, y: 30 },
          { x: 35, y: 45 },
          { x: 45, y: 40 },
        ],
      },
      {
        label: 'Dataset 2',
        data: [
          { x: 20, y: 25 },
          { x: 30, y: 40 },
          { x: 40, y: 35 },
          { x: 50, y: 50 },
          { x: 60, y: 45 },
        ],
      },
    ],
  };

  // Bubble Chart Data
  bubbleChartData: ChartData = {
    datasets: [
      {
        label: 'Product A',
        data: [
          { x: 20, y: 30, r: 15 },
          { x: 40, y: 50, r: 20 },
          { x: 30, y: 40, r: 12 },
        ],
      },
      {
        label: 'Product B',
        data: [
          { x: 25, y: 35, r: 10 },
          { x: 45, y: 55, r: 18 },
          { x: 35, y: 45, r: 14 },
        ],
      },
    ],
  };

  changeTheme(themeName: string): void {
    this.selectedTheme = themeName;
    this.currentTheme = CHART_THEMES[themeName];
  }

  toggleLoading(): void {
    this.loading = !this.loading;
  }

  onChartClick(event: any): void {
    this.lastEvent = `Click: ${JSON.stringify(event.active?.[0]?.label || 'Unknown')}`;
  }

  onChartHover(event: any): void {
    if (event.active?.length > 0) {
      this.lastEvent = `Hover: ${JSON.stringify(event.active[0]?.label || 'Unknown')}`;
    }
  }
}
