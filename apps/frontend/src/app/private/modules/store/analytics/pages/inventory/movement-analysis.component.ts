import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import type { EChartsOption } from 'echarts';

import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig} from '../../../../../../shared/components/index';
import { SelectorOption, SelectorComponent } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import {
  getDefaultStartDate,
  getDefaultEndDate} from '../../../../../../shared/utils/date.util';
import {
  StockMovementReport,
  MovementSummaryItem,
  MovementTrend,
  InventoryAnalyticsQueryDto} from '../../interfaces/inventory-analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-movement-analysis',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    CardComponent,
    ResponsiveDataViewComponent,
    IconComponent,
    StatsComponent,
    ChartComponent,
    DateRangeFilterComponent,
    ExportButtonComponent,
    SelectorComponent,
    AnalyticsCardComponent,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
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

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="trending-up" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">
              Análisis de Movimientos
            </h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Tendencias, distribución y detalle de movimientos de inventario
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 md:gap-3 shrink-0">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              (click)="activeView.set('chart')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'chart' ? 'bg-black text-white' : 'bg-surface text-text-secondary hover:bg-background'"
            >
              <app-icon name="bar-chart-2" [size]="16"></app-icon>
              Gráficas
            </button>
            <button
              (click)="activeView.set('table')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="activeView() === 'table' ? 'bg-black text-white' : 'bg-surface text-text-secondary hover:bg-background'"
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

      <!-- Content Grid -->
      <div class="grid grid-cols-1 gap-6">
      <!-- Chart View -->
      @if (activeView() === 'chart') {
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Trends Line Chart -->
          <app-card shadow="none" [responsivePadding]="true">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Tendencia de Movimientos</span
            >
            <div class="h-[350px]">
              <app-chart
                [options]="trendsChartOptions()"
                [loading]="loadingTrends()"
              ></app-chart>
            </div>
          </app-card>

          <!-- Distribution Pie/Donut Chart -->
          <app-card shadow="none" [responsivePadding]="true">
            <span class="text-sm font-bold text-[var(--color-text-primary)]"
              >Distribución por Tipo</span
            >
            <div class="h-[350px]">
              <app-chart
                [options]="distributionChartOptions()"
                [loading]="loadingSummary()"
              ></app-chart>
            </div>
          </app-card>
        </div>
      }

      <!-- Table View -->
      @if (activeView() === 'table') {
        <app-card
          shadow="none"
          [padding]="false"
          overflow="hidden"
          [showHeader]="true"
        >
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">
              Movimientos Detallados
              <span
                class="text-xs text-[var(--color-text-secondary)] font-normal ml-2"
              >
                ({{ movements().length }} registros)
              </span>
            </span>
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
        </app-card>
      }
      </div>

      <!-- Quick Links -->
      <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
        <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Inventario</span>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          @for (view of inventoryViews; track view.key) {
            <app-analytics-card [view]="view"></app-analytics-card>
          }
        </div>
      </app-card>
  </div>
  `})
export class MovementAnalysisComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
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

  readonly typeLabels: Record<string, string> = {
    stock_in: 'Entrada',
    stock_out: 'Salida',
    sale: 'Venta',
    return: 'Devolución',
    transfer: 'Transferencia',
    adjustment: 'Ajuste',
    damage: 'Daño',
    expiration: 'Expiración',
  };

  // Filters
  granularity = signal<string>('day');
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});

  granularityOptions: SelectorOption[] = [
    { value: 'day', label: 'Diario' },
    { value: 'week', label: 'Semanal' },
    { value: 'month', label: 'Mensual' },
  ];

  readonly inventoryViews: AnalyticsView[] = getViewsByCategory('inventory').filter(
    (v) => v.key !== 'inventory_movement_analysis'
  );

  columns: TableColumn[] = [
    {
      key: 'date',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      width: '120px',
      transform: (val) => new Date(val).toLocaleDateString('es-CO')},
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
          expiration: 'danger'}}},
    {
      key: 'quantity',
      label: 'Cantidad',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px'},
    {
      key: 'from_location',
      label: 'Origen',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
    {
      key: 'to_location',
      label: 'Destino',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
    {
      key: 'user_name',
      label: 'Usuario',
      priority: 2,
      width: '120px',
      transform: (val) => val || '-'},
    {
      key: 'reason',
      label: 'Razón',
      priority: 3,
      width: '150px',
      transform: (val) => val || '-'},
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
        damage: 'danger'}},
    detailKeys: [
      {
        key: 'quantity',
        label: 'Cantidad',
        transform: (val: any) => `${val} uds`},
      {
        key: 'date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) => new Date(val).toLocaleDateString('es-CO')},
    ]};

  ngOnInit(): void {
    this.loadChartData();
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
      date_range: this.dateRange()};
  }

  private loadChartData(): void {
    const query = this.buildQuery();

    this.loadingSummary.set(true);
    this.loadingTrends.set(true);

    forkJoin({
      summary: this.analyticsService.getMovementSummary(query),
      trends: this.analyticsService.getMovementTrends({
        ...query,
        granularity: this.granularity() as any}),
      movements: this.analyticsService.getStockMovements({
        ...query,
        limit: 100})})
      .pipe(takeUntilDestroyed(this.destroyRef))
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
        }});
  }

  private loadTrends(): void {
    this.loadingTrends.set(true);
    const query = this.buildQuery();

    this.analyticsService
      .getMovementTrends({ ...query, granularity: this.granularity() as any })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.trends.set(response.data);
          this.updateTrendsChart(response.data);
          this.loadingTrends.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar tendencias');
          this.loadingTrends.set(false);
        }});
  }

  private loadMovements(): void {
    this.loadingMovements.set(true);
    const query = this.buildQuery();

    this.analyticsService
      .getStockMovements({ ...query, limit: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.movements.set(response.data);
          this.loadingMovements.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar movimientos');
          this.loadingMovements.set(false);
        }});
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
    const successColor =
      style.getPropertyValue('--color-success').trim() || '#10b981';
    const dangerColor =
      style.getPropertyValue('--color-danger').trim() || '#ef4444';
    const primaryColor =
      style.getPropertyValue('--color-primary').trim() || '#3b82f6';
    const warnColor =
      style.getPropertyValue('--color-warning').trim() || '#f59e0b';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';

    this.trendsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          return params.map((p: any) => `${p.marker} ${p.seriesName}: ${p.value}`).join('<br/>');
        },
      },
      legend: {
        data: ['Entradas', 'Salidas', 'Ajustes', 'Transferencias'],
        selectedMode: true,
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
        top: '5%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: textSecondary, fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        splitNumber: 5,
        axisLine: { show: false },
        axisLabel: { color: textSecondary, fontSize: 11 },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Entradas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.stock_in),
          itemStyle: { color: successColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${successColor}4D` },
                { offset: 1, color: `${successColor}0D` },
              ],
            },
          },
        },
        {
          name: 'Salidas',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.stock_out),
          itemStyle: { color: dangerColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${dangerColor}4D` },
                { offset: 1, color: `${dangerColor}0D` },
              ],
            },
          },
        },
        {
          name: 'Ajustes',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.adjustments),
          itemStyle: { color: primaryColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primaryColor}4D` },
                { offset: 1, color: `${primaryColor}0D` },
              ],
            },
          },
        },
        {
          name: 'Transferencias',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          data: trends.map((t) => t.transfers),
          itemStyle: { color: warnColor },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${warnColor}4D` },
                { offset: 1, color: `${warnColor}0D` },
              ],
            },
          },
        },
      ],
    });
  }

  private updateDistributionChart(summary: MovementSummaryItem[]): void {
    const colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    const labels = summary.map((s) => this.typeLabels[s.movement_type] || s.movement_type);
    const series = summary.map((s, i) => ({
      name: this.typeLabels[s.movement_type] || s.movement_type,
      type: 'bar' as const,
      data: [s.count],
      itemStyle: { color: colors[i % 6] },
      barMaxWidth: 32,
    }));

    this.distributionChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: <b>${p.value}</b>`;
        }},
      legend: {
        data: labels,
        selectedMode: true,
        bottom: 30,
        left: 'center',
        itemWidth: 14,
        textStyle: { color: '#6b7280' },
      },
      grid: { left: '3%', right: '10%', bottom: '20%', top: '3%', containLabel: true },
      xAxis: { type: 'category', data: ['Tipo'] },
      yAxis: {
        type: 'value',
      },
      series,
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportMovementsXlsx(this.buildQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
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
        }});
  }
}
