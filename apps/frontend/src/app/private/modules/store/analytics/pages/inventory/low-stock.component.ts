import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { TableColumn } from '../../../../../../shared/components/table/table.component';
import { ResponsiveDataViewComponent, ItemListCardConfig } from '../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ExportButtonComponent } from '../../components/export-button/export-button.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import { StockLevelReport } from '../../interfaces/inventory-analytics.interface';

@Component({
  selector: 'vendix-low-stock',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
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
            <span>Stock Bajo</span>
          </div>
          <h1 class="text-2xl font-bold text-text-primary">Alertas de Stock Bajo</h1>
          <p class="text-text-secondary mt-1">Productos que necesitan reabastecimiento</p>
        </div>
        <vendix-export-button
          [loading]="exporting()"
          (export)="exportReport()"
        ></vendix-export-button>
      </div>

      <!-- Alert Banner -->
      @if (!loading() && data().length > 0) {
        <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
          <app-icon name="alert-triangle" [size]="20" class="text-yellow-600 flex-shrink-0 mt-0.5"></app-icon>
          <div>
            <h4 class="font-semibold text-yellow-800">Atención Requerida</h4>
            <p class="text-sm text-yellow-700">
              Hay {{ data().length }} productos con stock bajo o agotado.
              Considera crear órdenes de compra para reabastecerlos.
            </p>
          </div>
        </div>
      }

      <!-- Main Content -->
      <div class="bg-surface border border-border rounded-xl overflow-hidden">
        <div class="p-4 border-b border-border flex justify-between items-center">
          <h3 class="font-semibold text-text-primary">
            Productos con Stock Bajo
            <span class="text-text-secondary font-normal text-sm ml-2">
              ({{ data().length }} alertas)
            </span>
          </h3>
          <a
            routerLink="/admin/inventory/pop"
            class="text-sm text-primary hover:underline flex items-center gap-1"
          >
            <app-icon name="plus" [size]="14"></app-icon>
            Crear Orden de Compra
          </a>
        </div>

        <div class="p-4">
          <app-responsive-data-view
            [data]="data()"
            [columns]="columns"
            [cardConfig]="cardConfig"
            [loading]="loading()"
            emptyMessage="No hay productos con stock bajo"
            emptyIcon="check-circle"
          ></app-responsive-data-view>
        </div>
      </div>
    </div>
  `,
})
export class LowStockComponent implements OnInit, OnDestroy {
  private analyticsService = inject(AnalyticsService);
  private toastService = inject(ToastService);
  private destroy$ = new Subject<void>();

  loading = signal(true);
  exporting = signal(false);
  data = signal<StockLevelReport[]>([]);

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
      priority: 1,
      width: '120px',
    },
    {
      key: 'days_of_stock',
      label: 'Días de Stock',
      sortable: true,
      align: 'right',
      priority: 2,
      width: '120px',
      transform: (val) => (val !== null && val !== undefined ? `${val} días` : '-'),
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
          low_stock: 'warn',
          out_of_stock: 'danger',
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
        low_stock: 'warn',
        out_of_stock: 'danger',
      },
    },
    detailKeys: [
      {
        key: 'quantity_available',
        label: 'Disponible',
        transform: (val: any) => `${val} uds`,
      },
      {
        key: 'reorder_point',
        label: 'Reorden',
        transform: (val: any) => `${val} uds`,
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

  loadData(): void {
    this.loading.set(true);

    this.analyticsService
      .getLowStockAlerts({ limit: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.data.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar alertas de stock');
          this.loading.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportInventoryAnalytics({ status: 'low_stock' })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `stock_bajo_${new Date().toISOString().split('T')[0]}.csv`;
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
}
