import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { DateRangeFilterComponent } from '../../components/date-range-filter/date-range-filter.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { StockMovementReport, InventoryAnalyticsQueryDto } from '../../interfaces/inventory-analytics.interface';

@Component({
  selector: 'vendix-stock-movements',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ResponsiveDataViewComponent,
    SelectorComponent,
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
            <a routerLink="/admin/reports/inventory" class="hover:text-primary">Inventario</a>
            <app-icon name="chevron-right" [size]="14"></app-icon>
            <span>Movimientos</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Historial de Movimientos</h1>
          <p class="text-text-secondary mt-1">Registro de entradas, salidas y ajustes de inventario</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
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
        </div>
      </div>

      <!-- Main Content -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-border">
          <h3 class="font-semibold text-text-primary">
            Movimientos de Inventario
            <span class="text-text-secondary font-normal text-sm ml-2">
              ({{ data().length }} registros)
            </span>
          </h3>
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
      </div>
    </div>
  `,
})
export class StockMovementsComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<StockMovementReport[]>([]);
  typeFilter = signal<string>('');
  dateRange = signal<DateRangeFilter>({
    start_date: this.getDefaultStartDate(),
    end_date: this.getDefaultEndDate(),
    preset: 'thisMonth',
  });

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

  onTypeChange(type: string): void {
    this.typeFilter.set(type);
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: InventoryAnalyticsQueryDto = {
      date_range: this.dateRange(),
      movement_type: this.typeFilter() || undefined,
      limit: 100,
    };

    this.analyticsService
      .getStockMovements(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar movimientos');
          this.loading.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({
        date_range: this.dateRange(),
        movement_type: this.typeFilter() || undefined,
      })
      .pipe(takeUntil(this.destroy$))
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
