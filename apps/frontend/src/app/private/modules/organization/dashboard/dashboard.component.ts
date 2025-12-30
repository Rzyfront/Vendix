import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ChartComponent,
  IconComponent,
  StatsComponent,
  CHART_THEMES,
} from '../../../../shared/components';
import { EChartsOption } from 'echarts';
import { OrganizationDashboardService } from './services/organization-dashboard.service';
import { ActivatedRoute } from '@angular/router';
import { GlobalFacade } from '../../../../core/store/global.facade';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-organization-dashboard',
  standalone: true,
  imports: [CommonModule, ChartComponent, IconComponent, StatsComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
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
  CHART_THEMES = CHART_THEMES;

  // Revenue Chart Data - Stacked Line Chart
  revenueChartData: EChartsOption = {};

  constructor(
    private organizationDashboardService: OrganizationDashboardService,
    private route: ActivatedRoute,
    private globalFacade: GlobalFacade,
  ) { }

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
    }).format(value || 0);
  }

  // Helper methods for template
  getRevenueValue(): string {
    const value = this.dashboardStats?.stats?.revenue?.value || 0;
    return this.formatCurrency(value);
  }

  getRevenueTrendText(): string {
    const subValue = this.dashboardStats?.stats?.revenue?.sub_value || 0;
    const sign = subValue > 0 ? '+' : '';
    return `${sign}${this.formatCurrency(subValue)} vs mes pasado`;
  }

  getRevenueIconBg(): string {
    const subValue = this.dashboardStats?.stats?.revenue?.sub_value || 0;
    return subValue >= 0 ? 'bg-green-100' : 'bg-red-100';
  }

  getRevenueIconColor(): string {
    const subValue = this.dashboardStats?.stats?.revenue?.sub_value || 0;
    return subValue >= 0 ? 'text-green-600' : 'text-red-600';
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
        tooltip: {
          trigger: 'axis',
          axisPointer: {
            type: 'cross',
            label: {
              backgroundColor: '#6a7985'
            }
          }
        },
        legend: {
          data: ['Ganancia', 'Costos', 'Ganancia Neta'],
          bottom: 0
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '10%',
          containLabel: true
        },
        xAxis: [
          {
            type: 'category',
            boundaryGap: false,
            data: labels
          }
        ],
        yAxis: [
          {
            type: 'value',
            axisLabel: {
              formatter: (value: any) => '$' + value / 1000 + 'K'
            }
          }
        ],
        series: [
          {
            name: 'Ganancia',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: revenue,
            itemStyle: { color: '#3b82f6' }
          },
          {
            name: 'Costos',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: costs,
            itemStyle: { color: '#ef4444' }
          },
          {
            name: 'Ganancia Neta',
            type: 'line',
            stack: 'Total',
            areaStyle: { opacity: 0.1 },
            emphasis: { focus: 'series' },
            data: profit,
            itemStyle: { color: '#22c55e' },
            label: { show: true, position: 'top' }
          }
        ]
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
        tooltip: {
          trigger: 'item',
          formatter: '{b}: {c} ({d}%)' // Name: Value (Percent)
        },
        legend: {
          show: false
        },
        series: [
          {
            name: 'Distribución de ventas',
            type: 'pie',
            radius: ['50%', '70%'], // Doughnut style
            avoidLabelOverlap: false,
            itemStyle: {
              borderRadius: 10,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: false,
              position: 'center'
            },
            emphasis: {
              label: {
                show: true,
                fontSize: 20,
                fontWeight: 'bold'
              }
            },
            labelLine: {
              show: false
            },
            data: data.store_distribution.map((item: any, index: number) => ({
              value: item.revenue || 0,
              name: item.type.charAt(0).toUpperCase() + item.type.slice(1),
              itemStyle: {
                color: this.storeDistributionColors[index % this.storeDistributionColors.length]
              }
            }))
          }
        ]
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

  // Store Distribution Data - Enhanced Doughnut Chart
  storeDistributionData: EChartsOption = {};
}
