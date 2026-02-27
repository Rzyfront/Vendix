import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { InventoryValuation } from '../../interfaces/inventory-analytics.interface';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-inventory-valuation',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ChartComponent,
    ResponsiveDataViewComponent,
    IconComponent,
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
            <span>Valoración</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Valoración de Inventario</h1>
          <p class="text-text-secondary mt-1">Valor del inventario por ubicación y categoría</p>
        </div>
        <vendix-export-button
          [loading]="exporting()"
          (export)="exportReport()"
        ></vendix-export-button>
      </div>

      <!-- Total Value Card -->
      @if (!loading()) {
        <div class="bg-gradient-to-r from-green-500 to-green-600 rounded-xl p-6 text-white">
          <p class="text-green-100 text-sm">Valor Total del Inventario</p>
          <p class="text-3xl font-bold mt-1">{{ formatCurrency(totalValue()) }}</p>
          <p class="text-green-100 text-sm mt-2">{{ totalQuantity() }} unidades en {{ data().length }} ubicaciones</p>
        </div>
      }

      <!-- Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Pie Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Distribución por Ubicación</h3>
          </div>
          <div class="p-4">
            @if (loading()) {
              <div class="h-64 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else {
              <app-chart
                [options]="chartOptions()"
                size="large"
              ></app-chart>
            }
          </div>
        </div>

        <!-- Table -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Detalle por Ubicación</h3>
          </div>
          <div class="p-4">
            <app-responsive-data-view
              [data]="data()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              emptyMessage="No hay datos de valoración"
              emptyIcon="dollar-sign"
            ></app-responsive-data-view>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class InventoryValuationComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<InventoryValuation[]>([]);
  chartOptions = signal<EChartsOption>({});
  totalValue = signal(0);
  totalQuantity = signal(0);

  columns: TableColumn[] = [
    { key: 'location_name', label: 'Ubicación', sortable: true, priority: 1 },
    {
      key: 'total_quantity',
      label: 'Cantidad',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'average_cost',
      label: 'Costo Prom.',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'total_value',
      label: 'Valor Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'percentage_of_total',
      label: '% del Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
      transform: (val) => `${val.toFixed(1)}%`,
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'location_name',
    detailKeys: [
      {
        key: 'total_value',
        label: 'Valor',
        transform: (val: any) => this.formatCurrency(val),
      },
      {
        key: 'percentage_of_total',
        label: 'Porcentaje',
        transform: (val: any) => `${val.toFixed(1)}%`,
      },
    ],
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService
      .getInventoryValuation()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.calculateTotals(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar valoración');
          this.loading.set(false);
        },
      });
  }

  private calculateTotals(data: InventoryValuation[]): void {
    const total = data.reduce((sum, item) => sum + item.total_value, 0);
    const quantity = data.reduce((sum, item) => sum + item.total_quantity, 0);
    this.totalValue.set(total);
    this.totalQuantity.set(quantity);
  }

  private updateChart(data: InventoryValuation[]): void {
    const chartData = data.map((item) => ({
      value: item.total_value,
      name: item.location_name,
    }));

    this.chartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          return `${params.name}<br/>Valor: ${this.formatCurrency(params.value)}<br/>Porcentaje: ${params.percent}%`;
        },
      },
      legend: {
        orient: 'vertical',
        right: '5%',
        top: 'middle',
        textStyle: { color: '#6b7280' },
      },
      series: [
        {
          name: 'Valoración',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['35%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
            },
          },
          labelLine: {
            show: false,
          },
          data: chartData,
        },
      ],
      color: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({})
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `valoracion_inventario_${new Date().toISOString().split('T')[0]}.csv`;
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

  formatCurrency(value: number): string {
    return this.currencyService.format(value, 0);
  }
}
