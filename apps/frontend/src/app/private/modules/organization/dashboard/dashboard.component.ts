import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  ChartData,
  ChartOptions,
  IconComponent,
} from '../../../../shared/components';
import { OrganizationDashboardService } from './services/organization-dashboard.service';
import { ActivatedRoute } from '@angular/router';
import { GlobalFacade } from '../../../../core/store/global.facade';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent, IconComponent],
  template: `
    <div
      class="p-6 space-y-6"
      style="background-color: var(--color-background); min-height: 100vh;"
    >
      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: var(--primary-light);"
            >
              <app-icon
                name="store"
                [size]="24"
                style="color: var(--primary);"
              ></app-icon>
            </div>
            <!-- Placeholder for percentage if needed, or remove -->
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Total Stores
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.total_stores?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.total_stores?.sub_value || 0 }} new this
            month
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: var(--accent-light);"
            >
              <app-icon
                name="users"
                [size]="24"
                style="color: var(--accent);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Active Users
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.active_users?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.active_users?.sub_value || 0 }} online now
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: rgba(251, 146, 60, 0.2);"
            >
              <app-icon
                name="shopping-cart"
                [size]="24"
                style="color: var(--warning);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Monthly Orders
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.monthly_orders?.value || 0 }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            {{ dashboardStats?.stats?.monthly_orders?.sub_value || 0 }} orders
            today
          </p>
        </div>

        <div
          class="rounded-xl shadow-sm p-6 border border-border hover:shadow-md transition-shadow"
          style="background-color: var(--color-surface);"
        >
          <div class="flex items-center justify-between mb-4">
            <div
              class="w-12 h-12 rounded-xl flex items-center justify-center"
              style="background-color: rgba(34, 197, 94, 0.2);"
            >
              <app-icon
                name="dollar-sign"
                [size]="24"
                style="color: var(--success);"
              ></app-icon>
            </div>
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Profit
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">
            {{ dashboardStats?.stats?.revenue?.value || 0 | currency }}
          </p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            <span
              [class.text-green-500]="
                (dashboardStats?.stats?.revenue?.sub_value || 0) >= 0
              "
              [class.text-red-500]="
                (dashboardStats?.stats?.revenue?.sub_value || 0) < 0
              "
            >
              {{
                (dashboardStats?.stats?.revenue?.sub_value || 0) > 0 ? '+' : ''
              }}{{ dashboardStats?.stats?.revenue?.sub_value || 0 | currency }}
            </span>
            vs last month
          </p>
        </div>
      </div>

      <!-- Charts Section -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Revenue Chart -->
        <div
          class="lg:col-span-2 rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-lg font-semibold" style="color: var(--text);">
                  Profit Overview
                </h2>
                <p class="text-sm" style="color: var(--muted-foreground);">
                  Monthly profit trends
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === '6m' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === '6m'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('6m')"
                >
                  6M
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === '1y' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === '1y'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('1y')"
                >
                  1Y
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg transition-colors"
                  [style.background-color]="
                    selectedPeriod === 'all' ? 'var(--primary)' : 'var(--muted)'
                  "
                  [style.color]="
                    selectedPeriod === 'all'
                      ? 'white'
                      : 'var(--muted-foreground)'
                  "
                  (click)="onPeriodChange('all')"
                >
                  All
                </button>
              </div>
            </div>
          </div>
          <div class="p-6">
            <app-chart
              [data]="revenueChartData"
              type="line"
              size="medium"
              [options]="revenueChartOptions"
            >
            </app-chart>
          </div>
        </div>

        <!-- Store Distribution Pie Chart -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Sales Distribution
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              By sales type (Physical vs Online)
            </p>
          </div>
          <div class="p-6">
            <div class="relative h-64">
              <app-chart
                [data]="storeDistributionData"
                type="doughnut"
                size="small"
                [options]="pieChartOptions"
              >
              </app-chart>
              <!-- Center Text Overlay -->
              <div
                class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
              >
                <span class="text-3xl font-bold" style="color: var(--text);">
                  {{ storeDistributionLegend.length }}
                </span>
                <span class="text-sm" style="color: var(--muted-foreground);">
                  Types
                </span>
              </div>
            </div>

            <div class="mt-6 space-y-3">
              <div
                *ngFor="let item of storeDistributionLegend; let i = index"
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-4 h-4 rounded-full shadow-sm"
                    [style.background-color]="
                      storeDistributionColors[
                        i % storeDistributionColors.length
                      ]
                    "
                    [style.box-shadow]="
                      '0 2px 4px ' +
                      storeDistributionColors[
                        i % storeDistributionColors.length
                      ] +
                      '4d'
                    "
                  ></div>
                  <div>
                    <span class="font-medium text-gray-700">{{
                      item.type
                    }}</span>
                    <div class="text-xs text-gray-500">
                      {{ item.percentage }}%
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <span class="font-bold text-gray-900">{{ item.value }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity & Top Performers -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Activity -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Recent Activity
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              Latest updates across your organization
            </p>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--primary-light);"
                >
                  <app-icon
                    name="store"
                    [size]="16"
                    style="color: var(--primary);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    New store launched
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    Downtown location is now live
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    2 hours ago
                  </p>
                </div>
              </div>

              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--success-light);"
                >
                  <app-icon
                    name="user-plus"
                    [size]="16"
                    style="color: var(--success);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    New team member
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    Sarah Johnson joined as Store Manager
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    5 hours ago
                  </p>
                </div>
              </div>

              <div
                class="flex items-start gap-4 p-3 rounded-lg"
                style="background-color: var(--muted);"
              >
                <div
                  class="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style="background-color: var(--accent-light);"
                >
                  <app-icon
                    name="trending-up"
                    [size]="16"
                    style="color: var(--accent);"
                  ></app-icon>
                </div>
                <div class="flex-1">
                  <p class="text-sm font-medium" style="color: var(--text);">
                    Revenue milestone
                  </p>
                  <p class="text-sm" style="color: var(--muted-foreground);">
                    Exceeded $100K monthly target
                  </p>
                  <p
                    class="text-xs mt-1"
                    style="color: var(--muted-foreground);"
                  >
                    1 day ago
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Performing Stores -->
        <div
          class="rounded-xl shadow-sm border border-border"
          style="background-color: var(--color-surface);"
        >
          <div class="p-6 border-b border-border">
            <h2 class="text-lg font-semibold" style="color: var(--text);">
              Top Performing Stores
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              This month's leaders
            </p>
          </div>
          <div class="p-6">
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--warning);"
                  >
                    1
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Downtown Store
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Retail
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $42,180
                  </p>
                  <p class="text-xs" style="color: var(--success);">+18%</p>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--muted);"
                  >
                    2
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Mall Location
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Food & Beverage
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $38,420
                  </p>
                  <p class="text-xs" style="color: var(--success);">+12%</p>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                    style="background-color: var(--muted);"
                  >
                    3
                  </div>
                  <div>
                    <p class="text-sm font-medium" style="color: var(--text);">
                      Airport Branch
                    </p>
                    <p class="text-xs" style="color: var(--muted-foreground);">
                      Services
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-sm font-bold" style="color: var(--text);">
                    $31,980
                  </p>
                  <p class="text-xs" style="color: var(--error);">-5%</p>
                </div>
              </div>
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
export class DashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  isLoading = false;
  organizationId: string = '';
  dashboardStats: any | null = null; // Using any to avoid strict type issues if interface isn't fully aligned yet, or use OrganizationDashboardStats
  selectedPeriod: string = '6m';
  storeDistributionColors = [
    '#7ed7a5',
    '#06b6d4',
    '#fb923c',
    '#a855f7',
    '#ec4899',
  ];
  storeDistributionLegend: any[] = [];

  // Revenue Chart Data - Stacked Line Chart
  revenueChartData: ChartData = {
    labels: [],
    datasets: [],
  };

  constructor(
    private organizationDashboardService: OrganizationDashboardService,
    private route: ActivatedRoute,
    private globalFacade: GlobalFacade,
  ) {}

  ngOnInit(): void {
    // First check route param
    const routeId = this.route.snapshot.paramMap.get('id');
    if (routeId) {
      this.organizationId = routeId;
      this.loadDashboardData();
    } else {
      // Fallback to user context
      this.globalFacade.userContext$
        .pipe(takeUntil(this.destroy$))
        .subscribe((context) => {
          if (context?.organization?.id) {
            this.organizationId = context.organization.id;
            this.loadDashboardData();
          }
        });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadDashboardData(): void {
    if (!this.organizationId) {
      console.warn('No organization ID available for dashboard stats');
      return;
    }

    this.isLoading = true;

    this.organizationDashboardService
      .getDashboardStats(this.organizationId, this.selectedPeriod)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.dashboardStats = data;
          this.updateRevenueChart(data);
          this.updateStoreDistributionChart(data);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading organization dashboard data:', error);
          this.isLoading = false;
        },
      });
  }

  onPeriodChange(period: string): void {
    this.selectedPeriod = period;
    this.loadDashboardData();
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  private updateRevenueChart(data: any): void {
    if (data.profit_trend) {
      const labels = data.profit_trend.map(
        (item: any) => `${item.month} ${item.year}`,
      );
      const revenue = data.profit_trend.map((item: any) => item.revenue || 0);
      const costs = data.profit_trend.map((item: any) => item.costs || 0);
      const profit = data.profit_trend.map((item: any) => item.amount || 0);

      this.revenueChartData = {
        labels: labels,
        datasets: [
          {
            label: 'Revenue',
            data: revenue,
            borderColor: '#3b82f6', // Blue color
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#3b82f6',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Costs',
            data: costs,
            borderColor: '#ef4444', // Red color
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: false,
            tension: 0.4,
            borderWidth: 2,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#ef4444',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: 'Profit',
            data: profit,
            borderColor: '#22c55e', // Success color
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#22c55e',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
        ],
      };
    }
  }

  private updateStoreDistributionChart(data: any): void {
    if (data.store_distribution) {
      const labels = data.store_distribution.map(
        (item: any) => item.type.charAt(0).toUpperCase() + item.type.slice(1),
      );
      const values = data.store_distribution.map(
        (item: any) => item.revenue || 0,
      );

      // Calculate total for percentage
      const total = values.reduce((sum: number, val: number) => sum + val, 0);

      this.storeDistributionData = {
        labels: labels,
        datasets: [
          {
            label: 'Sales Distribution',
            data: values,
            backgroundColor: this.storeDistributionColors,
            borderColor: '#ffffff',
            borderWidth: 3,
            hoverOffset: 8,
            hoverBorderWidth: 3,
            spacing: 2,
          },
        ],
      };

      // Update the display values in the legend
      this.storeDistributionLegend = data.store_distribution.map(
        (item: any) => ({
          type: item.type.charAt(0).toUpperCase() + item.type.slice(1),
          value: this.formatCurrency(item.revenue || 0),
          percentage:
            total > 0 ? (((item.revenue || 0) / total) * 100).toFixed(1) : '0',
        }),
      );
    }
  }

  revenueChartOptions: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          usePointStyle: true,
          boxWidth: 8,
          padding: 20,
        },
      },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        titleColor: '#1e293b',
        bodyColor: '#475569',
        borderColor: '#e2e8f0',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        boxPadding: 4,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: '#94a3b8',
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: '#f1f5f9',
          // drawBorder: false, // Removed as it causes lint error
        },
        border: {
          display: false,
        },
        ticks: {
          color: '#94a3b8',
          callback: (value: any) => '$' + value / 1000 + 'K',
        },
      },
    },
  };

  // Store Distribution Data - Enhanced Doughnut Chart
  storeDistributionData: ChartData = {
    labels: ['Retail', 'Food & Beverage', 'Services'],
    datasets: [
      {
        label: 'Store Distribution',
        data: [45, 30, 25],
        backgroundColor: ['#7ed7a5', '#06b6d4', '#fb923c'],
        borderColor: '#ffffff',
        borderWidth: 3,
        hoverOffset: 8,
        hoverBorderWidth: 3,
        spacing: 2,
      },
    ],
  };

  pieChartOptions: any = {
    // Changed to any to allow 'cutout' property
    responsive: true,
    maintainAspectRatio: false,
    cutout: '75%', // Thinner ring like the example
    plugins: {
      legend: {
        display: false, // Hide default legend to use the custom one below
      },
    },
  };
}
