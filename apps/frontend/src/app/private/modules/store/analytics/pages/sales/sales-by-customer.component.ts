import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { SalesByCustomer, SalesAnalyticsQueryDto } from '../../interfaces/sales-analytics.interface';

@Component({
  selector: 'vendix-sales-by-customer',
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
            <span>Por Cliente</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Ventas por Cliente</h1>
          <p class="text-text-secondary mt-1">Top clientes por volumen de compras</p>
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

      <!-- Main Content -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-border">
          <h3 class="font-semibold text-text-primary">
            Top Clientes
            <span class="text-text-secondary font-normal text-sm ml-2">
              ({{ data().length }} clientes)
            </span>
          </h3>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay datos de clientes"
            emptyIcon="users"
          ></app-responsive-data-view>
        </div>
      </div>
    </div>
  `,
})
export class SalesByCustomerComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<SalesByCustomer[]>([]);
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

  columns: TableColumn[] = [
    { key: 'customer_name', label: 'Cliente', sortable: true, priority: 1 },
    { key: 'email', label: 'Email', sortable: true, priority: 2, width: '200px' },
    {
      key: 'total_orders',
      label: 'Órdenes',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'total_spent',
      label: 'Total Gastado',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '140px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'average_order_value',
      label: 'Ticket Prom.',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'last_order_date',
      label: 'Última Compra',
      sortable: true,
      align: 'center',
      priority: 2,
      width: '120px',
      transform: (val) => (val ? new Date(val).toLocaleDateString('es-CO') : '-'),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'customer_name',
    subtitleKey: 'email',
    detailKeys: [
      {
        key: 'total_orders',
        label: 'Órdenes',
        transform: (val: any) => `${val} órdenes`,
      },
      {
        key: 'total_spent',
        label: 'Total',
        transform: (val: any) => this.formatCurrency(val),
      },
    ],
  };

  ngOnInit(): void {
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
      limit: 50,
    };

    this.analyticsService
      .getSalesByCustomer(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar ventas por cliente');
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
          a.download = `ventas_cliente_${new Date().toISOString().split('T')[0]}.csv`;
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
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value);
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
