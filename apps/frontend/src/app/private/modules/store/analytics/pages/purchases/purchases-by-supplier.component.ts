import { Component, OnInit, inject, signal, viewChild, effect, TemplateRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TableComponent, TableColumn } from '../../../../../../shared/components/table/table.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, PurchasesBySupplier } from '../../services/analytics.service';
import { EChartsOption } from 'echarts';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ChartComponent, StatsComponent, IconComponent, TableComponent, CurrencyPipe, DateRangeFilterComponent, ExportButtonComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Proveedores"
          [value]="data().length"
          smallText=" proveedores"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total Ordenes"
          [value]="getTotalOrders()"
          iconName="file-text"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Total Gastado"
          [value]="getTotalSpent()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Proveedor Top"
          [value]="getTopSupplier()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Header -->
      <div class="flex items-center justify-between gap-3 sticky top-0 z-10 bg-white px-4 py-3 border-b border-border rounded-lg mx-1 mb-4">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="hidden md:flex w-10 h-10 rounded-lg bg-[var(--color-background)] items-center justify-center border border-[var(--color-border)] shadow-sm shrink-0">
            <app-icon name="truck" class="text-[var(--color-primary)]"></app-icon>
          </div>
          <div class="min-w-0">
            <h1 class="text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight truncate">Compras por Proveedor</h1>
            <p class="hidden sm:block text-xs text-[var(--color-text-secondary)] font-medium truncate">
              Análisis de compras por proveedor
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
      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else {

        @if (activeView() === 'chart') {
        <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
          <div slot="header" class="flex flex-col">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Gasto por Proveedor</span>
          </div>
          <div class="p-4">
            <app-chart [options]="chartOptions()" size="large"></app-chart>
          </div>
        </app-card>
        }

        @if (activeView() === 'table') {
        <app-card shadow="none" [responsivePadding]="true">
          <app-table [data]="data()" [columns]="tableColumns" [loading]="loading()">
          </app-table>
        </app-card>
        }
      }
      </div>
    </div>

    <ng-template #supplierCell let-row>
      <div class="flex items-center gap-2">
        <app-icon name="truck" [size]="16" class="text-text-tertiary"></app-icon>
        <span class="font-medium">{{ row.supplier_name }}</span>
      </div>
    </ng-template>

    <ng-template #orderCountCell let-row>
      <span class="badge bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">{{ row.order_count }} órdenes</span>
    </ng-template>

    <ng-template #totalSpentCell let-row>
      <span class="font-semibold text-text-primary">{{ row.total_spent | currency }}</span>
    </ng-template>

    <ng-template #pendingOrdersCell let-row>
      @if (row.pending_orders > 0) {
        <span class="badge bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">{{ row.pending_orders }} pendientes</span>
      } @else {
        <span class="badge bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Sin pendientes</span>
      }
    </ng-template>

    <ng-template #lastOrderDateCell let-row>
      @if (row.last_order_date) {
        {{ row.last_order_date | date:'shortDate' }}
      } @else {
        <span class="text-text-tertiary">Sin órdenes</span>
      }
    </ng-template>
  `,
})
export class PurchasesBySupplierComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  readonly supplierTemplate = viewChild<TemplateRef<any>>('supplierCell');
  readonly orderCountTemplate = viewChild<TemplateRef<any>>('orderCountCell');
  readonly totalSpentTemplate = viewChild<TemplateRef<any>>('totalSpentCell');
  readonly pendingOrdersTemplate = viewChild<TemplateRef<any>>('pendingOrdersCell');
  readonly lastOrderDateTemplate = viewChild<TemplateRef<any>>('lastOrderDateCell');

  loading = signal(true);
  data = signal<PurchasesBySupplier[]>([]);
  chartOptions = signal<EChartsOption>({});
  activeView = signal<'chart' | 'table'>('chart');
  exporting = signal(false);
  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth'
  });
  tableColumns: TableColumn[] = [
    { key: 'supplier_name', label: 'Proveedor' },
    { key: 'order_count', label: 'Órdenes' },
    { key: 'total_spent', label: 'Total Gastado' },
    { key: 'pending_orders', label: 'Estado' },
    { key: 'last_order_date', label: 'Última Orden' },
  ];

  constructor() {
    effect(() => {
      const supplierTpl = this.supplierTemplate();
      const orderCountTpl = this.orderCountTemplate();
      const totalSpentTpl = this.totalSpentTemplate();
      const pendingTpl = this.pendingOrdersTemplate();
      const lastOrderTpl = this.lastOrderDateTemplate();

      this.tableColumns = this.tableColumns.map(col => {
        if (col.key === 'supplier_name' && supplierTpl) {
          return { ...col, template: supplierTpl };
        }
        if (col.key === 'order_count' && orderCountTpl) {
          return { ...col, template: orderCountTpl };
        }
        if (col.key === 'total_spent' && totalSpentTpl) {
          return { ...col, template: totalSpentTpl };
        }
        if (col.key === 'pending_orders' && pendingTpl) {
          return { ...col, template: pendingTpl };
        }
        if (col.key === 'last_order_date' && lastOrderTpl) {
          return { ...col, template: lastOrderTpl };
        }
        return col;
      });
    });
  }

  ngOnInit(): void {
    this.analyticsService.getPurchasesBySupplier({}).subscribe({
      next: (response) => {
        const responseData = response?.data;
        if (Array.isArray(responseData)) {
          this.data.set(responseData);
          this.updateChart(responseData);
        } else if (responseData && (responseData as any).data) {
          this.data.set((responseData as any).data);
          this.updateChart((responseData as any).data);
        } else {
          this.data.set([]);
          this.updateChart([]);
        }
        this.loading.set(false);
      },
      error: () => {
        this.data.set([]);
        this.updateChart([]);
        this.loading.set(false);
      }
    });
  }

  private updateChart(data: PurchasesBySupplier[]): void {
    const sorted = [...data].sort((a, b) => b.total_spent - a.total_spent);
    const suppliers = sorted.map(s => s.supplier_name);
    const values = sorted.map(s => s.total_spent);

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          let html = `<strong>${params[0].name}</strong><br/>`;
          for (const p of params) {
            if (p.value != null) html += `${p.marker} ${p.seriesName}: <b>$${p.value.toLocaleString('es-CO')}</b><br/>`;
          }
          return html;
        },
      },
      legend: { data: suppliers, bottom: 30, textStyle: { color: '#6b7280' } },
      grid: { left: '3%', right: '4%', bottom: '25%', top: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: suppliers,
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', fontSize: 11, rotate: 30 },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisLabel: { color: '#6b7280', formatter: (v: number) => '$' + Math.round(v).toLocaleString('es-CO', { maximumFractionDigits: 0 }) },
        splitLine: { lineStyle: { color: '#f3f4f6' } },
      },
      series: suppliers.map((supplier, i) => ({
          name: supplier,
          type: 'bar' as const,
          data: [values[i]],
          itemStyle: { color: ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6] },
          barMaxWidth: 40,
        })),
    });
  }

  getTotalOrders(): number {
    return this.data().reduce((sum, s) => sum + (s.order_count || 0), 0);
  }

  getTotalSpent(): string {
    const total = this.data().reduce((sum, s) => sum + (s.total_spent || 0), 0);
    return '$' + total.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  getTopSupplier(): string {
    if (!this.data().length) return '-';
    const top = [...this.data()].sort((a, b) => b.total_spent - a.total_spent)[0];
    return top?.supplier_name?.substring(0, 15) || '-';
  }

  exportReport(): void {
    this.exporting.set(true);
    setTimeout(() => this.exporting.set(false), 1000);
  }

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
  }
}