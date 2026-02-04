import { Component, OnInit, OnDestroy, inject, signal, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { EChartsOption } from 'echarts';

import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { TableComponent, TableColumn, TableAction } from '../../../../../shared/components/table/table.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../analytics/services/analytics.service';
import { ExpensesService } from '../../expenses/services/expenses.service';
import { PurchaseOrdersService } from '../../inventory/services/purchase-orders.service';
import { SalesSummary, SalesTrend } from '../../analytics/interfaces/sales-analytics.interface';
import { Expense, ExpenseSummary } from '../../expenses/interfaces/expense.interface';
import { PurchaseOrder } from '../../inventory/interfaces';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';
import { DashboardTabsComponent, DashboardTab } from './dashboard-tabs.component';

@Component({
  selector: 'app-dashboard-financial',
  standalone: true,
  imports: [CommonModule, StatsComponent, ChartComponent, IconComponent, TableComponent, DashboardTabsComponent],
  template: `
    <div class="space-y-4 md:space-y-6">
      <!-- Stats Cards - Sticky on mobile -->
      @if (loading()) {
        <div class="stats-container !mb-0 md:!mb-8 ">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse min-w-[160px]">
              <div class="h-3 bg-gray-200 rounded w-1/2 mb-3"></div>
              <div class="h-7 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container !mb-0 md:!mb-8 ">
          <app-stats
            title="Ingresos del Mes"
            [value]="formatCurrency(salesSummary()?.total_revenue || 0)"
            [smallText]="getGrowthText(salesSummary()?.revenue_growth)"
            iconName="trending-up"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>

          <app-stats
            title="Gastos del Mes"
            [value]="formatCurrency(expensesSummary()?.total_amount || 0)"
            iconName="trending-down"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>

          <app-stats
            title="Margen Bruto"
            [value]="formatCurrency(grossMargin())"
            [smallText]="getMarginPercentage()"
            iconName="percent"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Costos"
            [value]="formatCurrency(totalPurchaseOrdersCost())"
            [smallText]="purchaseOrdersCount() + ' órdenes'"
            iconName="shopping-bag"
            iconBgColor="bg-teal-100"
            iconColor="text-teal-600"
          ></app-stats>
        </div>
      }

      <!-- Tab Navigation (after stats) -->
      <app-dashboard-tabs
        [tabs]="tabs()"
        [activeTab]="activeTab()"
        (tabChange)="tabChange.emit($event)"
      ></app-dashboard-tabs>

      <!-- Charts Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <!-- Revenue vs Expenses Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Ingresos vs Gastos</h3>
            <p class="text-sm text-text-secondary">Comparativa del período actual</p>
          </div>
          <div class="p-4">
            @if (loadingTrends()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="revenueExpensesChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>

        <!-- Expenses by Category Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Gastos por Categoría</h3>
            <p class="text-sm text-text-secondary">Distribución del mes actual</p>
          </div>
          <div class="p-4">
            @if (loadingExpenses()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (!expensesSummary()?.category_breakdown?.length) {
              <div class="h-64 flex flex-col items-center justify-center text-text-secondary">
                <app-icon name="pie-chart" [size]="48" class="mb-2 opacity-30"></app-icon>
                <p>No hay gastos registrados este mes</p>
              </div>
            } @else {
              <app-chart
                [options]="expensesCategoryChartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Pending Expenses Section -->
      <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
        <div class="p-4 border-b border-border flex justify-between items-center">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
              <app-icon name="clock" [size]="16" class="text-amber-600"></app-icon>
            </div>
            <div>
              <h3 class="font-semibold text-text-primary">Gastos Pendientes</h3>
              <p class="text-sm text-text-secondary">Requieren aprobación</p>
            </div>
          </div>
          <button
            class="text-sm text-primary hover:text-primary/80 font-medium"
            (click)="goToExpenses()"
          >
            Ver todos →
          </button>
        </div>
        <div class="p-4">
          @if (loadingPendingExpenses()) {
            <div class="h-40 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else if (pendingExpenses().length === 0) {
            <div class="py-8 text-center">
              <div class="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <app-icon name="check-circle" [size]="24" class="text-emerald-600"></app-icon>
              </div>
              <p class="text-text-primary font-medium">Sin gastos pendientes</p>
              <p class="text-sm text-text-secondary">Todos los gastos han sido procesados</p>
            </div>
          } @else {
            <app-table
              [data]="pendingExpenses().slice(0, 5)"
              [columns]="expenseColumns"
              [actions]="expenseActions"
              [hoverable]="true"
              size="sm"
            ></app-table>
          }
        </div>
      </div>

      <!-- Financial Summary Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <!-- Revenue Card -->
        <div class="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] p-5 text-white">
          <div class="flex items-center justify-between mb-4">
            <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <app-icon name="dollar-sign" [size]="20" class="text-white"></app-icon>
            </div>
            <span class="text-xs bg-white/20 px-2 py-1 rounded-full">Este mes</span>
          </div>
          <p class="text-emerald-100 text-sm mb-1">Total Ingresos</p>
          <p class="text-2xl font-bold">{{ formatCurrency(salesSummary()?.total_revenue || 0) }}</p>
          <div class="mt-3 pt-3 border-t border-white/20">
            <div class="flex justify-between text-sm">
              <span class="text-emerald-100">Órdenes</span>
              <span class="font-medium">{{ salesSummary()?.total_orders || 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Expenses Card -->
        <div class="bg-gradient-to-br from-red-500 to-red-600 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] p-5 text-white">
          <div class="flex items-center justify-between mb-4">
            <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <app-icon name="credit-card" [size]="20" class="text-white"></app-icon>
            </div>
            <span class="text-xs bg-white/20 px-2 py-1 rounded-full">Este mes</span>
          </div>
          <p class="text-red-100 text-sm mb-1">Total Gastos</p>
          <p class="text-2xl font-bold">{{ formatCurrency(expensesSummary()?.total_amount || 0) }}</p>
          <div class="mt-3 pt-3 border-t border-white/20">
            <div class="flex justify-between text-sm">
              <span class="text-red-100">Registros</span>
              <span class="font-medium">{{ expensesSummary()?.total_count || 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Costs Card (Purchase Orders) -->
        <div class="bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] p-5 text-white">
          <div class="flex items-center justify-between mb-4">
            <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <app-icon name="shopping-bag" [size]="20" class="text-white"></app-icon>
            </div>
            <span class="text-xs bg-white/20 px-2 py-1 rounded-full">Este mes</span>
          </div>
          <p class="text-teal-100 text-sm mb-1">Costos (Compras)</p>
          <p class="text-2xl font-bold">{{ formatCurrency(totalPurchaseOrdersCost()) }}</p>
          <div class="mt-3 pt-3 border-t border-white/20">
            <div class="flex justify-between text-sm">
              <span class="text-teal-100">Órdenes</span>
              <span class="font-medium">{{ purchaseOrdersCount() }}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  `,
})
export class DashboardFinancialComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private expensesService = inject(ExpensesService);
  private purchaseOrdersService = inject(PurchaseOrdersService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private destroy$ = new Subject<void>();

  // Inputs
  storeId = input.required<string>();
  tabs = input.required<DashboardTab[]>();
  activeTab = input.required<string>();
  tabChange = output<string>();

  // Loading states
  loading = signal(true);
  loadingTrends = signal(true);
  loadingExpenses = signal(true);
  loadingPendingExpenses = signal(true);
  loadingPurchaseOrders = signal(true);

  // Data
  salesSummary = signal<SalesSummary | null>(null);
  salesTrends = signal<SalesTrend[]>([]);
  expensesSummary = signal<ExpenseSummary | null>(null);
  pendingExpenses = signal<Expense[]>([]);
  purchaseOrders = signal<PurchaseOrder[]>([]);
  totalPurchaseOrdersCost = signal(0);
  purchaseOrdersCount = signal(0);

  // Chart Options
  revenueExpensesChartOptions = signal<EChartsOption>({});
  expensesCategoryChartOptions = signal<EChartsOption>({});

  // Table configuration
  expenseColumns: TableColumn[] = [
    {
      key: 'description',
      label: 'Descripción',
      transform: (v) => v || 'Sin descripción',
    },
    {
      key: 'expense_categories.name',
      label: 'Categoría',
      defaultValue: 'Sin categoría',
    },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      transform: (v) => this.formatCurrency(v),
    },
    {
      key: 'expense_date',
      label: 'Fecha',
      transform: (v) => this.formatDate(v),
    },
    {
      key: 'state',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pending: '#f59e0b',
          approved: '#10b981',
          rejected: '#ef4444',
          paid: '#3b82f6',
          cancelled: '#6b7280',
        },
      },
      transform: (v) => this.getExpenseStateLabel(v),
    },
  ];

  expenseActions: TableAction[] = [
    {
      label: 'Aprobar',
      icon: 'check',
      action: (item) => this.approveExpense(item),
      variant: 'success',
      show: (item) => item.state === 'pending',
    },
    {
      label: 'Ver',
      icon: 'eye',
      action: (item) => this.viewExpense(item.id),
      variant: 'ghost',
    },
  ];

  // Date range
  private dateRange: DateRangeFilter = {
    start_date: this.getMonthStartDate(),
    end_date: this.getMonthEndDate(),
    preset: 'thisMonth',
  };

  ngOnInit(): void {
    this.loadAllData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAllData(): void {
    // Load Sales Summary
    this.analyticsService
      .getSalesSummary({ date_range: this.dateRange })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.salesSummary.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });

    // Load Sales Trends for comparison chart
    this.analyticsService
      .getSalesTrends({ date_range: this.dateRange, granularity: 'day' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.salesTrends.set(response.data);
          this.updateRevenueExpensesChart(response.data);
          this.loadingTrends.set(false);
        },
        error: () => {
          this.loadingTrends.set(false);
        },
      });

    // Load Expenses Summary
    const monthStart = new Date(this.dateRange.start_date);
    const monthEnd = new Date(this.dateRange.end_date);

    this.expensesService
      .getExpensesSummary(monthStart, monthEnd)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.expensesSummary.set(response.data);
          this.updateExpensesCategoryChart(response.data);
          this.loadingExpenses.set(false);
        },
        error: () => {
          this.loadingExpenses.set(false);
        },
      });

    // Load Pending Expenses
    this.expensesService
      .getExpenses({ state: 'pending', limit: 10 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.pendingExpenses.set(response.data);
          this.loadingPendingExpenses.set(false);
        },
        error: () => {
          this.loadingPendingExpenses.set(false);
        },
      });

    // Load Purchase Orders (Costs)
    this.purchaseOrdersService
      .getPurchaseOrders({
        start_date: this.dateRange.start_date,
        end_date: this.dateRange.end_date,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.purchaseOrders.set(response.data);
          const total = response.data.reduce((sum, po) => sum + (po.total_amount || 0), 0);
          this.totalPurchaseOrdersCost.set(total);
          this.purchaseOrdersCount.set(response.data.length);
          this.loadingPurchaseOrders.set(false);
        },
        error: () => {
          this.loadingPurchaseOrders.set(false);
        },
      });
  }

  private updateRevenueExpensesChart(trends: SalesTrend[]): void {
    if (!trends.length) {
      // Show placeholder chart
      this.revenueExpensesChartOptions.set({
        grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
        xAxis: { type: 'category', data: [] },
        yAxis: { type: 'value' },
        series: [],
      });
      return;
    }

    const labels = trends.map((t) =>
      new Date(t.period).toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
      }),
    );
    const revenues = trends.map((t) => t.revenue);

    // For expenses, we'll show a static daily estimate (simplified)
    const totalExpenses = this.expensesSummary()?.total_amount || 0;
    const dailyExpenseEstimate = totalExpenses / trends.length;
    const expenses = trends.map(() => dailyExpenseEstimate);

    this.revenueExpensesChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const revenue = params[0];
          const expense = params[1];
          return `<strong>${revenue.name}</strong><br/>
            Ingresos: ${this.formatCurrency(revenue.value)}<br/>
            Gastos: ${this.formatCurrency(expense?.value || 0)}`;
        },
      },
      legend: {
        data: ['Ingresos', 'Gastos'],
        bottom: 0,
        textStyle: { color: '#6b7280', fontSize: 12 },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: '#6b7280',
          fontSize: 11,
          formatter: (value: number) => value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value}`,
        },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: [
        {
          name: 'Ingresos',
          type: 'bar',
          data: revenues,
          itemStyle: {
            color: '#10b981',
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 20,
        },
        {
          name: 'Gastos',
          type: 'bar',
          data: expenses,
          itemStyle: {
            color: '#ef4444',
            borderRadius: [4, 4, 0, 0],
          },
          barMaxWidth: 20,
        },
      ],
    });
  }

  private updateExpensesCategoryChart(summary: ExpenseSummary): void {
    if (!summary?.category_breakdown?.length) return;

    const categories = summary.category_breakdown;

    this.expensesCategoryChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          return `<strong>${params.name}</strong><br/>
            Monto: ${this.formatCurrency(params.value)}<br/>
            ${params.percent.toFixed(1)}% del total`;
        },
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'center',
        textStyle: { color: '#6b7280', fontSize: 12 },
      },
      series: [
        {
          name: 'Gastos por Categoría',
          type: 'pie',
          radius: ['40%', '65%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: {
              show: true,
              fontSize: 13,
              fontWeight: 'bold',
            },
          },
          labelLine: { show: false },
          data: categories.map((c) => ({
            value: c.total_amount,
            name: c.category_name,
            itemStyle: { color: c.color || '#6b7280' },
          })),
        },
      ],
    });
  }

  // Computed values
  grossMargin(): number {
    const revenue = this.salesSummary()?.total_revenue || 0;
    const expenses = this.expensesSummary()?.total_amount || 0;
    return revenue - expenses;
  }

  getMarginPercentage(): string {
    const percentage = this.getMarginPercentageNumber();
    if (percentage === 0) return '';
    return `${percentage.toFixed(1)}% del ingreso`;
  }

  getMarginPercentageNumber(): number {
    const revenue = this.salesSummary()?.total_revenue || 0;
    if (revenue === 0) return 0;
    return (this.grossMargin() / revenue) * 100;
  }

  getGrowthText(growth?: number): string {
    if (growth === undefined || growth === null) return '';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs mes anterior`;
  }

  // Utility methods
  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
    });
  }

  getExpenseStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      rejected: 'Rechazado',
      paid: 'Pagado',
      cancelled: 'Cancelado',
    };
    return labels[state] || state;
  }

  // Actions
  approveExpense(expense: Expense): void {
    this.expensesService
      .approveExpense(expense.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Gasto aprobado correctamente');
          // Refresh pending expenses
          this.loadingPendingExpenses.set(true);
          this.expensesService
            .getExpenses({ state: 'pending', limit: 10 })
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: (response) => {
                this.pendingExpenses.set(response.data);
                this.loadingPendingExpenses.set(false);
              },
            });
        },
        error: () => {
          this.toastService.error('Error al aprobar el gasto');
        },
      });
  }

  viewExpense(id: number): void {
    this.router.navigate(['/admin/expenses', id]);
  }

  // Navigation
  goToExpenses(): void {
    this.router.navigate(['/admin/expenses']);
  }

  // Date helpers
  private getMonthStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getMonthEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
