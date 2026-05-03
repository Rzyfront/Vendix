import {Component, OnInit, inject, signal,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import {
  ResponsiveDataViewComponent,
  ItemListCardConfig} from '../../../../../../shared/components/index';
import {
  SelectorComponent,
  SelectorOption} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import {
  StockMovementReport,
  InventoryAnalyticsQueryDto} from '../../interfaces/inventory-analytics.interface';
import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-stock-movements',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    CardComponent,
    ChartComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    IconComponent,
    DateRangeFilterComponent,
    ExportButtonComponent
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Movimientos"
          [value]="data().length"
          smallText=" registros"
          iconName="repeat"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Entradas"
          [value]="getInCount()"
          iconName="arrow-down-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Salidas"
          [value]="getOutCount()"
          iconName="arrow-up-circle"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>

        <app-stats
          title="Neto"
          [value]="getNetCount()"
          iconName="trending-up"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div
        class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sticky top-[99px] z-10 bg-[#ffffff] px-2 py-0.5 md:static md:bg-transparent md:px-6 md:py-1.5 md:border-b md:border-border"
      >
        <div>
          <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
            <a routerLink="/admin/analytics" class="hover:text-primary"
              >Analíticas</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <a routerLink="/admin/analytics/inventory" class="hover:text-primary"
              >Inventario</a
            >
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Movimientos</span>
          </div>
          <h1 class="text-xl font-bold text-text-primary">
            Historial de Movimientos
          </h1>
          <p class="text-text-secondary mt-1">
            Registro de entradas, salidas y ajustes de inventario
          </p>
        </div>
        <div
          class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
        >
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <div class="w-full sm:w-40">
            <app-selector
              [options]="typeOptions"
              [ngModel]="typeFilter()"
              (ngModelChange)="onTypeChange($event)"
              size="sm"
              placeholder="Tipo"
            ></app-selector>
          </div>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
          <!-- Toggle Chart/Table -->
          <div class="flex rounded-lg border border-border overflow-hidden">
            <button
              (click)="activeView.set('chart')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="
                activeView() === 'chart'
                  ? 'bg-black text-white'
                  : 'bg-surface text-text-secondary hover:bg-background'
              "
            >
              <app-icon name="bar-chart-2" [size]="16"></app-icon>
              Gráficas
            </button>
            <button
              (click)="activeView.set('table')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors"
              [class]="
                activeView() === 'table'
                  ? 'bg-black text-white'
                  : 'bg-surface text-text-secondary hover:bg-background'
              "
            >
              <app-icon name="table" [size]="16"></app-icon>
              Tabla
            </button>
          </div>
        </div>
      </div>

      <!-- Main Content Table -->
      @if (activeView() === 'table') {
      <app-card
        shadow="none"
        [padding]="false"
        overflow="hidden"
        [showHeader]="true"
      >
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Movimientos de Inventario
            <span
              class="text-xs text-[var(--color-text-secondary)] font-normal ml-2"
            >
              ({{ data().length }} registros)
            </span>
          </span>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay movimientos registrados"
            emptyIcon="activity"
          ></app-responsive-data-view>
        </div>
      </app-card>
      }

      <!-- Chart -->
      @if (activeView() === 'chart') {
      <app-card shadow="none" [responsivePadding]="true" [showHeader]="true">
        <div slot="header" class="flex flex-col">
          <span class="text-sm font-bold text-[var(--color-text-primary)]">
            Tendencia de Movimientos
          </span>
        </div>
        @if (!loading() && movementsChartOptions()) {
        <app-chart
          [options]="movementsChartOptions()"
          size="large"
          [showLegend]="true"
        ></app-chart>
        }
      </app-card>
      }
    </div>
  `})
export class StockMovementsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  loading = signal(true);
  exporting = signal(false);
  activeView = signal<'chart' | 'table'>('table');
  data = signal<StockMovementReport[]>([]);
  movementsChartOptions = signal<EChartsOption>({});
  typeFilter = signal<string>('');
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'});
  typeOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    { value: 'stock_in', label: 'Entrada' },
    { value: 'stock_out', label: 'Salida' },
    { value: 'sale', label: 'Venta' },
    { value: 'return', label: 'Devolución' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'adjustment', label: 'Ajuste' },
    { value: 'damage', label: 'Daño' },
  ];

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
    this.loadData();
  }
onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  onTypeChange(type: string): void {
    this.typeFilter.set(type);
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: InventoryAnalyticsQueryDto = {
      date_range: this.dateRange(),
      movement_type: this.typeFilter() || undefined,
      limit: 100};

    this.analyticsService
      .getStockMovements(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar movimientos');
          this.loading.set(false);
        }});
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({
        date_range: this.dateRange(),
        movement_type: this.typeFilter() || undefined})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `movimientos_stock_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.toastService.error('Error al exportar');
          this.exporting.set(false);
        }});
  }

  private updateChart(data: StockMovementReport[]): void {
    if (!data.length) return;

    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';
    const textSecondary = style.getPropertyValue('--color-text-secondary').trim() || '#6b7280';

    const types = ['stock_in', 'stock_out', 'sale', 'return', 'transfer', 'adjustment', 'damage'];
    const typeLabels: Record<string, string> = {
      stock_in: 'Entradas',
      stock_out: 'Salidas',
      sale: 'Ventas',
      return: 'Devoluciones',
      transfer: 'Transferencias',
      adjustment: 'Ajustes',
      damage: 'Daños',
    };
    const typeColors: Record<string, string> = {
      stock_in: '#22c55e',
      stock_out: '#3b82f6',
      sale: '#8b5cf6',
      return: '#f59e0b',
      transfer: '#6366f1',
      adjustment: '#6b7280',
      damage: '#ef4444',
    };

    const movementsByType: Record<string, number> = {};
    types.forEach((t) => (movementsByType[t] = 0));
    data.forEach((m) => {
      if (movementsByType[m.movement_type] !== undefined) {
        movementsByType[m.movement_type] += Math.abs(m.quantity);
      }
    });

    const labels = types.map((t) => typeLabels[t]);
    const values = types.map((t) => movementsByType[t]);

    this.movementsChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          return `${p.name}: <b>${p.value}</b> unidades`;
        },
      },
      legend: {
        data: ['Movimientos'],
        bottom: 30,
        textStyle: { color: textSecondary },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '20%',
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
        axisLine: { show: false },
        axisLabel: { color: textSecondary },
        splitLine: { lineStyle: { color: borderColor } },
      },
      series: [
        {
          name: 'Movimientos',
          type: 'line',
          data: values,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { color: '#3b82f6', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#3b82f64D' },
                { offset: 1, color: '#3b82f60D' },
              ],
            },
          },
        },
      ],
    });
  }

  getInCount(): number {
    return this.data().filter(m => m.movement_type === 'in').length;
  }

  getOutCount(): number {
    return this.data().filter(m => m.movement_type === 'out').length;
  }

  getNetCount(): number {
    const inCount = this.getInCount();
    const outCount = this.getOutCount();
    return inCount - outCount;
  }
}
