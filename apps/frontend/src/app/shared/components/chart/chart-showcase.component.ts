import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  CHART_THEMES,
} from '../../../shared/components';
import { EChartsOption } from 'echarts';

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
            [options]="barChartData"
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
            [options]="lineChartData"
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
            [options]="areaChartData"
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
            [options]="doughnutChartData"
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
            [options]="pieChartData"
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
            [options]="radarChartData"
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
            [options]="polarAreaChartData"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Nightingale Rose Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Nightingale Rose Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Category distribution with radial variation
          </p>
          <app-chart
            [options]="nightingaleChartData"
            [theme]="currentTheme"
            size="medium"
          >
          </app-chart>
        </div>

        <!-- Gauge Chart -->
        <div
          class="rounded-xl shadow-sm border border-border p-6"
          style="background-color: var(--color-surface);"
        >
          <h3 class="text-xl font-semibold mb-4" style="color: var(--text);">
            Gauge Chart
          </h3>
          <p class="text-sm mb-4" style="color: var(--muted-foreground);">
            Performance indicator
          </p>
          <app-chart
            [options]="gaugeChartData"
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
            [options]="scatterChartData"
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
            [options]="bubbleChartData"
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
                [options]="barChartData"
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
                [options]="lineChartData"
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
  barChartData: EChartsOption = {
    xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
    yAxis: { type: 'value' },
    series: [
      { type: 'bar', name: 'Product A', data: [12000, 19000, 15000, 25000, 22000, 30000] },
      { type: 'bar', name: 'Product B', data: [8000, 12000, 18000, 14000, 20000, 24000] }
    ]
  };

  // Line Chart Data
  lineChartData: EChartsOption = {
    xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
    yAxis: { type: 'value' },
    series: [
      { type: 'line', name: 'Revenue', data: [30000, 35000, 32000, 42000, 48000, 55000] },
      { type: 'line', name: 'Profit', data: [12000, 15000, 14000, 18000, 22000, 28000] }
    ]
  };

  // Area Chart Data
  areaChartData: EChartsOption = {
    xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
    yAxis: { type: 'value' },
    series: [
      { type: 'line', areaStyle: {}, name: 'Cumulative Revenue', data: [30000, 65000, 97000, 139000, 187000, 242000] }
    ]
  };

  // Doughnut Chart Data
  doughnutChartData: EChartsOption = {
    series: [
      {
        type: 'pie',
        radius: ['50%', '70%'],
        data: [
          { value: 35, name: 'Electronics' },
          { value: 25, name: 'Clothing' },
          { value: 20, name: 'Food' },
          { value: 12, name: 'Books' },
          { value: 8, name: 'Other' }
        ]
      }
    ]
  };

  // Pie Chart Data
  pieChartData: EChartsOption = {
    series: [
      {
        type: 'pie',
        radius: '50%',
        data: [
          { value: 45, name: 'Desktop' },
          { value: 35, name: 'Mobile' },
          { value: 15, name: 'Tablet' },
          { value: 5, name: 'Smart TV' }
        ]
      }
    ]
  };

  // Radar Chart Data
  radarChartData: EChartsOption = {
    radar: {
      indicator: [
        { name: 'Speed', max: 100 },
        { name: 'Reliability', max: 100 },
        { name: 'Comfort', max: 100 },
        { name: 'Safety', max: 100 },
        { name: 'Efficiency', max: 100 }
      ]
    },
    series: [{
      type: 'radar',
      data: [
        { value: [85, 90, 78, 92, 88], name: 'Model A' },
        { value: [78, 85, 92, 80, 90], name: 'Model B' }
      ]
    }]
  };

  // Polar Area Chart Data
  polarAreaChartData: EChartsOption = {
    angleAxis: {},
    radiusAxis: {
      type: 'category',
      data: ['North', 'South', 'East', 'West', 'Central'],
      z: 10
    },
    polar: {},
    series: [{
      type: 'bar',
      data: [42, 38, 35, 28, 45],
      coordinateSystem: 'polar',
      name: 'Sales by Region'
    }]
  };

  // Scatter Chart Data
  scatterChartData: EChartsOption = {
    xAxis: {},
    yAxis: {},
    series: [
      {
        type: 'scatter',
        name: 'Dataset 1',
        data: [[10, 20], [15, 35], [25, 30], [35, 45], [45, 40]]
      },
      {
        type: 'scatter',
        name: 'Dataset 2',
        data: [[20, 25], [30, 40], [40, 35], [50, 50], [60, 45]]
      }
    ]
  };

  // Bubble Chart Data - Approximated with Scatter and size override
  bubbleChartData: EChartsOption = {
    xAxis: {},
    yAxis: {},
    series: [
      {
        type: 'scatter',
        name: 'Product A',
        symbolSize: (data: any) => data[2],
        data: [[20, 30, 30], [40, 50, 40], [30, 40, 24]] // Multiplied size by 2 for visibility
      },
      {
        type: 'scatter',
        name: 'Product B',
        symbolSize: (data: any) => data[2],
        data: [[25, 35, 20], [45, 55, 36], [35, 45, 28]]
      }
    ]
  };

  // Nightingale Rose Chart Data
  nightingaleChartData: EChartsOption = {
    title: {
      text: 'Nightingale Rose Diagram',
      subtext: 'Sales by Category',
      left: 'center'
    },
    legend: {
      bottom: '5%',
      left: 'center'
    },
    series: [{
      type: 'pie',
      radius: ['20%', '70%'],
      center: ['50%', '50%'],
      roseType: 'radius', // This makes it a Nightingale Rose!
      itemStyle: {
        borderRadius: 5
      },
      label: {
        show: true
      },
      data: [
        { value: 40, name: 'Electronics' },
        { value: 33, name: 'Clothing' },
        { value: 28, name: 'Food & Beverage' },
        { value: 22, name: 'Home & Garden' },
        { value: 20, name: 'Sports' },
        { value: 15, name: 'Books' },
        { value: 12, name: 'Toys' },
        { value: 10, name: 'Other' }
      ]
    }]
  };

  // Gauge Chart Data
  gaugeChartData: EChartsOption = {
    series: [{
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 100,
      splitNumber: 10,
      itemStyle: {
        color: '#3b82f6'
      },
      progress: {
        show: true,
        width: 18
      },
      pointer: {
        show: true
      },
      axisLine: {
        lineStyle: {
          width: 18
        }
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: {
        offsetCenter: [0, '20%'],
        fontSize: 16
      },
      detail: {
        fontSize: 30,
        offsetCenter: [0, '50%'],
        valueAnimation: true,
        formatter: '{value}%'
      },
      data: [{ value: 72, name: 'Performance' }]
    }]
  };

  changeTheme(themeName: string): void {
    this.selectedTheme = themeName;
    this.currentTheme = CHART_THEMES[themeName];
  }

  toggleLoading(): void {
    this.loading = !this.loading;
  }

  onChartClick(event: any): void {
    this.lastEvent = `Click: ${event.name || event.seriesName || 'Unknown'} - Value: ${event.value ?? 'N/A'}`;
  }

  onChartHover(event: any): void {
    this.lastEvent = `Hover: ${event.name || event.seriesName || 'Unknown'}`;
  }
}
