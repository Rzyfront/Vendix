import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { SalesByPaymentMethod, SalesAnalyticsQueryDto } from '../../interfaces/sales-analytics.interface';

import { EChartsOption } from 'echarts';

@Component({
  selector: 'vendix-sales-by-payment',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ChartComponent,
    ResponsiveDataViewComponent,
    IconComponent,
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
            <a routerLink="/admin/reports/sales" class="hover:text-primary">Ventas</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Por Método de Pago</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Ventas por Método de Pago</h1>
          <p class="text-text-secondary mt-1">Distribución de ventas por forma de pago</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <vendix-date-range-filter
            [value]="dateRange()"
            (valueChange)="onDateRangeChange($event)"
          ></vendix-date-range-filter>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Pie Chart -->
        <div class="bg-surface border border-border rounded-xl overflow-hidden">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary">Distribución por Método</h3>
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
            <h3 class="font-semibold text-text-primary">Detalle por Método</h3>
          </div>
          <div class="p-4">
            <app-responsive-data-view
              [data]="data()"
              [columns]="columns"
              [cardConfig]="cardConfig"
              [loading]="loading()"
              emptyMessage="No hay datos"
              emptyIcon="credit-card"
            ></app-responsive-data-view>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SalesByPaymentComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<SalesByPaymentMethod[]>([]);
  chartOptions = signal<EChartsOption>({});
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  columns: TableColumn[] = [
    { key: 'display_name', label: 'Método', sortable: true, priority: 1 },
    {
      key: 'transaction_count',
      label: 'Transacciones',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '120px',
    },
    {
      key: 'total_amount',
      label: 'Monto Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'percentage',
      label: '% del Total',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
      transform: (val) => `${val.toFixed(1)}%`,
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'display_name',
    detailKeys: [
      {
        key: 'total_amount',
        label: 'Monto',
        transform: (val: any) => this.formatCurrency(val),
      },
      {
        key: 'percentage',
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

  onDateRangeChange(range: DateRangeFilter): void {
    this.dateRange.set(range);
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: SalesAnalyticsQueryDto = {
      date_range: this.dateRange(),
    };

    this.analyticsService
      .getSalesByPaymentMethod(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.updateChart(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar datos');
          this.loading.set(false);
        },
      });
  }

  private updateChart(data: SalesByPaymentMethod[]): void {
    const chartData = data.map((item) => ({
      value: item.total_amount,
      name: item.display_name,
    }));

    this.chartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          return `${params.name}<br/>Monto: ${this.formatCurrency(params.value)}<br/>Porcentaje: ${params.percent}%`;
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
          name: 'Ventas por Método de Pago',
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
      color: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'],
    });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportSalesAnalytics({ date_range: this.dateRange() })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `ventas_metodo_pago_${new Date().toISOString().split('T')[0]}.csv`;
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

  private getDefaultStartDate(): string {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  }

  private getDefaultEndDate(): string {
    return new Date().toISOString().split('T')[0];
  }
}
