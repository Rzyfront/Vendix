import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  ChartData,
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
            <span
              class="text-sm font-medium px-2 py-1 rounded-full"
              style="background-color: var(--success-light); color: var(--success);"
              >+12%</span
            >
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Total Stores
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">24</p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            3 new this month
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
            <span
              class="text-sm font-medium px-2 py-1 rounded-full"
              style="background-color: var(--success-light); color: var(--success);"
              >+8%</span
            >
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Active Users
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">1,428</p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            142 online now
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
            <span
              class="text-sm font-medium px-2 py-1 rounded-full"
              style="background-color: var(--error-light); color: var(--error);"
              >-3%</span
            >
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Monthly Orders
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">8,642</p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            284 today
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
            <span
              class="text-sm font-medium px-2 py-1 rounded-full"
              style="background-color: var(--success-light); color: var(--success);"
              >+23%</span
            >
          </div>
          <h3
            class="text-sm font-medium mb-1"
            style="color: var(--muted-foreground);"
          >
            Revenue
          </h3>
          <p class="text-3xl font-bold" style="color: var(--text);">$124,580</p>
          <p class="text-xs mt-2" style="color: var(--muted-foreground);">
            +$28,420 vs last month
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
                  Revenue Overview
                </h2>
                <p class="text-sm" style="color: var(--muted-foreground);">
                  Monthly revenue trends
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="px-3 py-1 text-sm rounded-lg"
                  style="background-color: var(--primary); color: white;"
                >
                  6M
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg"
                  style="background-color: var(--muted); color: var(--muted-foreground);"
                >
                  1Y
                </button>
                <button
                  class="px-3 py-1 text-sm rounded-lg"
                  style="background-color: var(--muted); color: var(--muted-foreground);"
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
              Store Distribution
            </h2>
            <p class="text-sm" style="color: var(--muted-foreground);">
              By category
            </p>
          </div>
          <div class="p-6">
            <app-chart
              [data]="storeDistributionData"
              type="pie"
              size="small"
              [options]="pieChartOptions"
            >
            </app-chart>
            <div class="mt-6 space-y-3">
              <div
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-4 h-4 rounded-full shadow-sm"
                    style="background-color: #7ed7a5; box-shadow: 0 2px 4px rgba(126, 215, 165, 0.3);"
                  ></div>
                  <span class="font-medium text-gray-700">Retail</span>
                </div>
                <div class="text-right">
                  <span class="font-bold text-gray-900">45%</span>
                  <div class="text-xs text-gray-500">18 stores</div>
                </div>
              </div>
              <div
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-4 h-4 rounded-full shadow-sm"
                    style="background-color: #06b6d4; box-shadow: 0 2px 4px rgba(6, 182, 212, 0.3);"
                  ></div>
                  <span class="font-medium text-gray-700">Food & Beverage</span>
                </div>
                <div class="text-right">
                  <span class="font-bold text-gray-900">30%</span>
                  <div class="text-xs text-gray-500">12 stores</div>
                </div>
              </div>
              <div
                class="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div class="flex items-center gap-3">
                  <div
                    class="w-4 h-4 rounded-full shadow-sm"
                    style="background-color: #fb923c; box-shadow: 0 2px 4px rgba(251, 146, 60, 0.3);"
                  ></div>
                  <span class="font-medium text-gray-700">Services</span>
                </div>
                <div class="text-right">
                  <span class="font-bold text-gray-900">25%</span>
                  <div class="text-xs text-gray-500">10 stores</div>
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
  organizationId: string;

  // Revenue Chart Data - Stacked Line Chart
  revenueChartData: ChartData = {
    labels: [],
    datasets: [],
  };

  constructor(
    private organizationDashboardService: OrganizationDashboardService,
    private route: ActivatedRoute,
    private globalFacade: GlobalFacade,
  ) {
    const context = this.globalFacade.getUserContext();
    this.organizationId =
      this.route.snapshot.paramMap.get('id') || context?.organization?.id || '';
  }

  ngOnInit(): void {
    this.loadDashboardData();
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
      .getDashboardStats(this.organizationId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.updateRevenueChart(data);
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Error loading organization dashboard data:', error);
          this.isLoading = false;
        },
      });
  }

  private updateRevenueChart(data: any): void {
    if (data.revenueBreakdown) {
      this.revenueChartData = {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], // This should come from API
        datasets: data.revenueBreakdown.map((item: any) => ({
          label: item.source.charAt(0).toUpperCase() + item.source.slice(1),
          data: [28000, 32000, 30000, 38000, 45000, 62000], // This should come from API
          borderColor: item.color,
          backgroundColor: item.color + '20',
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointBackgroundColor: item.color,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        })),
      };
    }
  }

  revenueChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
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

  pieChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
  };
}
