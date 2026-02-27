import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { TableColumn, TableAction } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { SalesByProduct, SalesAnalyticsQueryDto } from '../../interfaces/sales-analytics.interface';

@Component({
  selector: 'vendix-sales-by-product',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
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
            <span>Por Producto</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Ventas por Producto</h1>
          <p class="text-text-secondary mt-1">Análisis detallado de ventas por producto</p>
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

      <!-- Main Content Card -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-border">
          <h3 class="font-semibold text-text-primary">
            Productos Vendidos
            <span class="text-text-secondary font-normal text-sm ml-2">
              ({{ data().length }} productos)
            </span>
          </h3>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay datos de ventas por producto"
            emptyIcon="package"
          ></app-responsive-data-view>
        </div>
      </div>
    </div>
  `,
})
export class SalesByProductComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<SalesByProduct[]>([]);
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  columns: TableColumn[] = [
    {
      key: 'image_url',
      label: '',
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image',
    },
    { key: 'product_name', label: 'Producto', sortable: true, priority: 1 },
    { key: 'sku', label: 'SKU', sortable: true, priority: 2, width: '120px' },
    {
      key: 'units_sold',
      label: 'Unidades',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'revenue',
      label: 'Ingresos',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'average_price',
      label: 'Precio Prom.',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'profit_margin',
      label: 'Margen',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '100px',
      transform: (val) => (val ? `${val.toFixed(1)}%` : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarKey: 'image_url',
    detailKeys: [
      {
        key: 'units_sold',
        label: 'Unidades',
        transform: (val: any) => `${val} uds`,
      },
      {
        key: 'revenue',
        label: 'Ingresos',
        transform: (val: any) => this.formatCurrency(val),
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
      limit: 100,
    };

    this.analyticsService
      .getSalesByProduct(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar ventas por producto');
          this.loading.set(false);
        },
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
          a.download = `ventas_producto_${new Date().toISOString().split('T')[0]}.csv`;
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
