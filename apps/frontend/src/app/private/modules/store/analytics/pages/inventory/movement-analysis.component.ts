import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import type { EChartsOption } from 'echarts';

import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  StockMovementReport,
  MovementSummaryItem,
  MovementTrend,
  InventoryAnalyticsQueryDto,
} from '../../interfaces/inventory-analytics.interface';

@Component({
  selector: 'vendix-movement-analysis',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ResponsiveDataViewComponent,
    SelectorComponent,
    IconComponent,
    StatsComponent,
    ChartComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <a routerLink="/admin/reports/inventory" class="hover:text-primary">Inventario</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Análisis de Movimientos</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Análisis de Movimientos</h1>
          <p class="text-text-secondary mt-1">Tendencias, distribución y detalle de movimientos de inventario</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <div class="w-full sm:w-36">
            <app-selector
              [options]="granularityOptions"
              [ngModel]="granularity()"
              (ngModelChange)="onGranularityChange($event)"
              size="sm"
              placeholder="Granularidad"
            ></app-selector>
          </div>
          <!-- Toggle Chart/Table -->
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              (click)="activeView.set('chart')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'chart' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-background'"
            >
              <app-icon name="bar-chart-2" [size]="16"></app-icon>
              Gráficas
            </button>
            <button
              (click)="activeView.set('table')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'table' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-background'"
            >
              <app-icon name="table" [size]="16"></app-icon>
              Tabla
            </button>
          </div>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <app-stats
          title="Total Movimientos"
          [value]="totalMovements()"
          iconName="activity"
          iconBgColor="bg-blue-500/10"
          iconColor="text-blue-500"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Total Entradas"
          [value]="totalIn()"
          iconName="arrow-down-circle"
          iconBgColor="bg-green-500/10"
          iconColor="text-green-500"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Total Salidas"
          [value]="totalOut()"
          iconName="arrow-up-circle"
          iconBgColor="bg-red-500/10"
          iconColor="text-red-500"
          [clickable]="false"
        ></app-stats>
        <app-stats
          title="Ajustes y Transferencias"
          [value]="totalOther()"
          iconName="repeat"
          iconBgColor="bg-purple-500/10"
          iconColor="text-purple-500"
          [clickable]="false"
        ></app-stats>
      </div>

      <!-- Chart View -->
      @if (activeView() === 'chart') {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Trends Line Chart -->
          <div class="bg-surface border border-border rounded-xl p-4">
            <h3 class="font-semibold text-text-primary mb-4">Tendencia de Movimientos</h3>
            <div class="h-[350px]">
              <app-chart
                [options]="trendsChartOptions()"
                [loading]="loadingTrends()"
              ></app-chart>
            </div>
          </div>

          <!-- Distribution Pie/Donut Chart -->
          <div class="bg-surface border border-border rounded-xl p-4">
            <h3 class="font-semibold text-text-primary mb-4">Distribución por Tipo</h3>
            <div class="h-[350px]">
              <app-chart
                [options]="distributionChartOptions()"
                [loading]="loadingSummary()"
              ></app-chart>
            </div>
          </div>
        </div>
      }

      <!-- Table View -->
      @if (activeView() === 'table') {
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">
              Movimientos Detallados
              <span class="text-text-secondary font-normal text-sm ml-2">
                ({{ movements().length }} registros)
              </span>
            </h3>
          </div>

          <div class="p-4">
            <app-responsive-data-view
              [data]="movements()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loadingMovements()"
              emptyMessage="No hay movimientos registrados en este período"
              emptyIcon="activity"
            ></app-responsive-data-view>
          </div>
        </div>
      }
    </div>
  `,
})
export class MovementAnalysisComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  // State
  activeView = signal<'chart' | 'table'>('chart');
  loadingSummary = signal(true);
  loadingTrends = signal(true);
  loadingMovements = signal(false);
  exporting = signal(false);

  summary = signal<MovementSummaryItem[]>([]);
  trends = signal<MovementTrend[]>([]);
  movements = signal<StockMovementReport[]>([]);

  // Computed stats
  totalMovements = signal(0);
  totalIn = signal(0);
  totalOut = signal(0);
  totalOther = signal(0);

  // Chart options
  trendsChartOptions = signal<EChartsOption>({});
  distributionChartOptions = signal<EChartsOption>({});

  // Filters
  granularity = signal<string>('day');
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  granularityOptions: SelectorOption[] = [
    { value: 'day', label: 'Diario' },
    { value: 'week', label: 'Semanal' },
    { value: 'month', label: 'Mensual' },
  ];

  columns: TableColumn[] = [
    {
      key: 'date',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      width: '120px',
      transform: (val) => new Date(val).toLocaleDateString('es-CO'),
    },
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '100px' },
    {
      key: 'movement_type',
      label: 'Tipo',
      align: 'center',
      priority: 1,
      width: '120px',
      badgeConfig: {
        type: 'status',
        colorMap: {
          stock_in: 'success',
          stock_out: 'info',
          sale: 'primary',
          return: 'warn',
          transfer: 'info',
          adjustment: 'default',
          damage: 'danger',
          expiration: 'danger',
        },
      },
    },
    {
      key: 'quantity',
      label: 'Cantidad',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'from_location',
      label: 'Origen',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-',
    },
    {
      key: 'to_location',
      label: 'Destino',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-',
    },
    {
      key: 'user_name',
      label: 'Usuario',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-',
    },
    {
      key: 'reason',
      label: 'Razón',
      priority: 3,
      width: '150px',
      transform: (val) => val || '-',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    badgeKey: 'movement_type',
    badgeConfig: {
      type: 'status',
      colorMap: {
        stock_in: 'success',
        stock_out: 'info',
        sale: 'primary',
        return: 'warn',
        transfer: 'info',
        adjustment: 'default',
        damage: 'danger',
      },
    },
    detailKeys: [
      {
        key: 'quantity',
        label: 'Cantidad',
        transform: (val: any) => `${val} uds`,
      },
      {
        key: 'date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => new Date(val).toLocaleDateString('es-CO'),
      },
    ],
  };

  ngOnInit(): void {
    this.loadChartData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadChartData();
    if (this.activeView() === 'table') {
      this.loadMovements();
    }
  }

  onGranularityChange(value: string): void {
    this.granularity.set(value);
    this.loadTrends();
  }

  private buildQuery(): InventoryAnalyticsQueryDto {
    return {
      date_range: this.dateRange(),
    };
  }

  private loadChartData(): void {
    const query = this.buildQuery();

    this.loadingSummary.set(true);
    this.loadingTrends.set(true);

    forkJoin({
      summary: this.analyticsService.getMovementSummary(query),
      trends: this.analyticsService.getMovementTrends({
        ...query,
        granularity: this.granularity() as any,
      }),
      movements: this.analyticsService.getStockMovements({ ...query, limit: 100 }),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ summary, trends, movements }) => {
          this.summary.set(summary.data);
          this.trends.set(trends.data);
          this.movements.set(movements.data);
          this.updateStats(summary.data);
          this.updateTrendsChart(trends.data);
          this.updateDistributionChart(summary.data);
          this.loadingSummary.set(false);
          this.loadingTrends.set(false);
          this.loadingMovements.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar análisis de movimientos');
          this.loadingSummary.set(false);
          this.loadingTrends.set(false);
          this.loadingMovements.set(false);
        },
      });
  }

  private loadTrends(): void {
    this.loadingTrends.set(true);
    const query = this.buildQuery();

    this.analyticsService
      .getMovementTrends({ ...query, granularity: this.granularity() as any })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.trends.set(response.data);
          this.updateTrendsChart(response.data);
          this.loadingTrends.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar tendencias');
          this.loadingTrends.set(false);
        },
      });
  }

  private loadMovements(): void {
    this.loadingMovements.set(true);
    const query = this.buildQuery();

    this.analyticsService
      .getStockMovements({ ...query, limit: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.movements.set(response.data);
          this.loadingMovements.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar movimientos');
          this.loadingMovements.set(false);
        },
      });
  }

  private updateStats(summary: MovementSummaryItem[]): void {
    const total = summary.reduce((sum, s) => sum + s.count, 0);
    const inTypes = ['stock_in', 'return'];
    const outTypes = ['stock_out', 'sale', 'damage', 'expiration'];

    const totalIn = summary
      .filter((s) => inTypes.includes(s.movement_type))
      .reduce((sum, s) => sum + s.count, 0);
    const totalOut = summary
      .filter((s) => outTypes.includes(s.movement_type))
      .reduce((sum, s) => sum + s.count, 0);

    this.totalMovements.set(total);
    this.totalIn.set(totalIn);
    this.totalOut.set(totalOut);
    this.totalOther.set(total - totalIn - totalOut);
  }

  private updateTrendsChart(trends: MovementTrend[]): void {
    const labels = trends.map((t) => t.period);
    const style = getComputedStyle(document.documentElement);
    const successColor = style.getPropertyValue('--color-success').trim() || '#10b981';
    const dangerColor = style.getPropertyValue('--color-danger').trim() || '#ef4444';
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const warnColor = style.getPropertyValue('--color-warning').trim() || '#f59e0b';

    this.trendsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
      },
      legend: {
        data: ['Entradas', 'Salidas', 'Ajustes', 'Transferencias'],
        bottom: 0,
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          name: 'Entradas',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.stock_in),
          lineStyle: { color: successColor, width: 2 },
          itemStyle: { color: successColor },
        },
        {
          name: 'Salidas',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.stock_out),
          lineStyle: { color: dangerColor, width: 2 },
          itemStyle: { color: dangerColor },
        },
        {
          name: 'Ajustes',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.adjustments),
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor },
        },
        {
          name: 'Transferencias',
          type: 'line',
          smooth: true,
          data: trends.map((t) => t.transfers),
          lineStyle: { color: warnColor, width: 2 },
          itemStyle: { color: warnColor },
        },
      ],
    });
  }

  private updateDistributionChart(summary: MovementSummaryItem[]): void {
    const typeLabels: Record<string, string> = {
      stock_in: 'Entrada',
      stock_out: 'Salida',
      sale: 'Venta',
      return: 'Devolución',
      transfer: 'Transferencia',
      adjustment: 'Ajuste',
      damage: 'Daño',
      expiration: 'Expiración',
    };

    this.distributionChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'center',
      },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 14, fontWeight: 'bold' },
          },
          data: summary.map((s) => ({
            name: typeLabels[s.movement_type] || s.movement_type,
            value: s.count,
          })),
        },
      ],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportMovementsXlsx(this.buildQuery())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const dr = this.dateRange();
          a.download = `analisis_movimientos_${dr.start_date}_${dr.end_date}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        },
      });
  }

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
