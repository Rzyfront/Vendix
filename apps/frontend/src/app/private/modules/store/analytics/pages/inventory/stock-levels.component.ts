import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { InventorySummary, StockLevelReport, InventoryAnalyticsQueryDto } from '../../interfaces/inventory-analytics.interface';

@Component({
  selector: 'vendix-stock-levels',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    StatsComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
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
            <span>Niveles de Stock</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Niveles de Stock</h1>
          <p class="text-text-secondary mt-1">Estado actual del inventario</p>
        </div>
        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div class="w-full sm:w-40">
            <app-selector
              [options]="statusOptions"
              [ngModel]="statusFilter()"
              (ngModelChange)="onStatusChange($event)"
              size="sm"
              placeholder="Estado"
            ></app-selector>
          </div>
          <vendix-export-button
            [loading]="exporting()"
            (export)="exportReport()"
          ></vendix-export-button>
        </div>
      </div>

      <!-- Stats Cards -->
      @if (loadingSummary()) {
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container">
          <app-stats
            title="Total SKUs"
            [value]="summary()?.total_sku_count || 0"
            iconName="package"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            title="Valor de Inventario"
            [value]="formatCurrency(summary()?.total_stock_value || 0)"
            iconName="dollar-sign"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>

          <app-stats
            title="Stock Bajo"
            [value]="summary()?.low_stock_count || 0"
            [smallText]="(summary()?.low_stock_percentage || 0).toFixed(1) + '%'"
            iconName="alert-triangle"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>

          <app-stats
            title="Agotado"
            [value]="summary()?.out_of_stock_count || 0"
            [smallText]="(summary()?.out_of_stock_percentage || 0).toFixed(1) + '%'"
            iconName="x-circle"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
          ></app-stats>
        </div>
      }

      <!-- Main Content -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-border">
          <h3 class="font-semibold text-text-primary">
            Detalle de Stock
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
            emptyMessage="No hay productos en inventario"
            emptyIcon="package"
          ></app-responsive-data-view>
        </div>
      </div>
    </div>
  `,
})
export class StockLevelsComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  loadingSummary = signal(true);
  exporting = signal(false);
  data = signal<StockLevelReport[]>([]);
  summary = signal<InventorySummary | null>(null);
  statusFilter = signal<string>('');

  statusOptions: SelectorOption[] = [
    { value: '', label: 'Todos' },
    { value: 'in_stock', label: 'En Stock' },
    { value: 'low_stock', label: 'Stock Bajo' },
    { value: 'out_of_stock', label: 'Agotado' },
    { value: 'overstock', label: 'Exceso' },
  ];

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
      key: 'quantity_on_hand',
      label: 'En Mano',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'quantity_reserved',
      label: 'Reservado',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '100px',
    },
    {
      key: 'quantity_available',
      label: 'Disponible',
      sortable: true,
      align: 'right',
      priority: 1,
      width: '100px',
    },
    {
      key: 'reorder_point',
      label: 'Punto Reorden',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
    },
    {
      key: 'total_value',
      label: 'Valor',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => this.formatCurrency(val),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      width: '100px',
      badgeConfig: {
        type: 'status',
        colorMap: {
          in_stock: 'success',
          low_stock: 'warn',
          out_of_stock: 'danger',
          overstock: 'info',
        },
      },
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'product_name',
    subtitleKey: 'sku',
    avatarKey: 'image_url',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        in_stock: 'success',
        low_stock: 'warn',
        out_of_stock: 'danger',
        overstock: 'info',
      },
    },
    detailKeys: [
      {
        key: 'quantity_available',
        label: 'Disponible',
        transform: (val: any) => `${val} uds`,
      },
      {
        key: 'total_value',
        label: 'Valor',
        transform: (val: any) => this.formatCurrency(val),
      },
    ],
  };

  ngOnInit(): void {
    this.loadSummary();
    this.loadData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onStatusChange(status: string): void {
    this.statusFilter.set(status);
    this.loadData();
  }

  loadSummary(): void {
    this.loadingSummary.set(true);
    this.analyticsService
      .getInventorySummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.summary.set(response.data);
          this.loadingSummary.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar resumen');
          this.loadingSummary.set(false);
        },
      });
  }

  loadData(): void {
    this.loading.set(true);
    const query: InventoryAnalyticsQueryDto = {
      status: this.statusFilter() as any || undefined,
      limit: 100,
    };

    this.analyticsService
      .getStockLevels(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar niveles de stock');
          this.loading.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({ status: this.statusFilter() as any || undefined })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `niveles_stock_${new Date().toISOString().split('T')[0]}.csv`;
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
}
