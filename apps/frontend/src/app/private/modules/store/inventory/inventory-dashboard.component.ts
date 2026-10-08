import {Component, OnInit, inject, DestroyRef, signal} from '@angular/core';
import { Subscription, defaultIfEmpty } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RouterModule } from '@angular/router';

// Shared Components
import {
  StatsComponent,
  IconComponent,
  TableComponent,
  TableColumn,
} from '../../../../shared/components/index';

// Services
import { InventoryService, PurchaseOrdersService, SuppliersService } from './services';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';

// Interfaces
import { InventoryStats, PurchaseOrder, Supplier } from './interfaces';

@Component({
  selector: 'app-inventory-dashboard',
  standalone: true,
  imports: [RouterModule, StatsComponent, IconComponent, TableComponent],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      @if (stats_error()) {
        <p role="alert" class="mb-4 p-4 bg-surface border border-border rounded-lg text-text-secondary">No se pudo cargar el resumen de inventario</p>
      } @else {
        <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8">
          <app-stats
            [loading]="is_loading_stats()"
            title="Valor Total Inventario"
            [value]="formatCurrency(stats().total_stock_value)"
            iconName="dollar-sign"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
          ></app-stats>

          <app-stats
            [loading]="is_loading_stats()"
            title="Productos con Stock"
            [value]="stats().total_products"
            iconName="package"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>

          <app-stats
            [loading]="is_loading_stats()"
            title="Stock Bajo"
            [value]="stats().low_stock_items"
            [smallText]="stats().out_of_stock_items + ' agotados'"
            iconName="alert-triangle"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-600"
          ></app-stats>

          <app-stats
            [loading]="is_loading_stats()"
            title="Órdenes Pendientes"
            [value]="stats().pending_orders"
            [smallText]="formatCurrency(stats().incoming_stock) + ' en camino'"
            iconName="truck"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
          ></app-stats>
        </div>

      }

      <!-- Main Content Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Recent Purchase Orders -->
        <div class="bg-surface rounded-lg shadow-sm border border-border">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary flex items-center gap-2">
              <app-icon name="file-text" [size]="18" class="text-primary"></app-icon>
              Órdenes de Compra Recientes
            </h3>
            <a routerLink="./orders" class="text-sm text-primary hover:underline">Ver todas</a>
          </div>
          <div class="p-4">
            @if (orders_error()) {
              <p role="alert" class="text-text-secondary">No se pudieron cargar las órdenes recientes</p>
            } @else {
              <app-table
                [data]="recent_orders()"
                [columns]="order_columns"
                [loading]="is_loading_orders()"
                emptyMessage="No hay órdenes recientes"
                size="sm"
              ></app-table>
            }
          </div>
        </div>

        <!-- Top Suppliers -->
        <div class="bg-surface rounded-lg shadow-sm border border-border">
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary flex items-center gap-2">
              <app-icon name="users" [size]="18" class="text-primary"></app-icon>
              Proveedores Principales
            </h3>
            <a routerLink="./suppliers" class="text-sm text-primary hover:underline">Ver todos</a>
          </div>
          <div class="p-4">
            @if (suppliers_error()) {
              <p role="alert" class="text-text-secondary">No se pudieron cargar los proveedores</p>
            } @else {
              <app-table
                [data]="top_suppliers()"
                [columns]="supplier_columns"
                [loading]="is_loading_suppliers()"
                emptyMessage="No hay proveedores"
                size="sm"
              ></app-table>
            }
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="mt-6 bg-surface rounded-lg shadow-sm border border-border p-4">
        <h3 class="font-semibold text-text-primary mb-4">Acciones Rápidas</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <a
            routerLink="./orders"
            [queryParams]="{ action: 'create' }"
            class="flex flex-col items-center p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <app-icon name="plus-circle" [size]="24" class="text-primary mb-2"></app-icon>
            <span class="text-sm font-medium text-text-primary">Nueva Orden</span>
          </a>
          <a
            routerLink="./adjustments"
            class="flex flex-col items-center p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <app-icon name="edit-3" [size]="24" class="text-primary mb-2"></app-icon>
            <span class="text-sm font-medium text-text-primary">Ajustar Stock</span>
          </a>
          <a
            routerLink="./suppliers"
            class="flex flex-col items-center p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <app-icon name="user-plus" [size]="24" class="text-primary mb-2"></app-icon>
            <span class="text-sm font-medium text-text-primary">Nuevo Proveedor</span>
          </a>
          <a
            routerLink="../products"
            class="flex flex-col items-center p-4 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <app-icon name="package" [size]="24" class="text-primary mb-2"></app-icon>
            <span class="text-sm font-medium text-text-primary">Ver Productos</span>
          </a>
        </div>
      </div>
    </div>
  `,
})
export class InventoryDashboardComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private currencyService = inject(CurrencyFormatService);
  private toastService = inject(ToastService);
  // Stats
  readonly stats = signal<InventoryStats>({
    total_products: 0,
    total_stock_value: 0,
    low_stock_items: 0,
    out_of_stock_items: 0,
    pending_orders: 0,
    incoming_stock: 0,
  });

  // Data
  readonly recent_orders = signal<PurchaseOrder[]>([]);
  readonly top_suppliers = signal<Supplier[]>([]);

  // Loading
  readonly is_loading_stats = signal(false);
  readonly is_loading_orders = signal(false);
  readonly is_loading_suppliers = signal(false);
  readonly stats_error = signal(false);
  readonly orders_error = signal(false);
  readonly suppliers_error = signal(false);
  private statsRequest?: Subscription;
  private ordersRequest?: Subscription;
  private suppliersRequest?: Subscription;

  // Table Columns
  order_columns: TableColumn[] = [
    { key: 'order_number', label: 'No. Orden', width: '100px', priority: 1 },
    { key: 'supplier.name', label: 'Proveedor', defaultValue: '-', priority: 2 },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status' },
      transform: (v: string) => this.getStatusLabel(v),
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (v: number) => this.formatCurrency(v),
    },
  ];

  supplier_columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', priority: 1 },
    { key: 'contact_person', label: 'Contacto', defaultValue: '-', priority: 2 },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status' },
      transform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    },
  ];

  constructor(
    private inventoryService: InventoryService,
    private purchaseOrdersService: PurchaseOrdersService,
    private suppliersService: SuppliersService
  ) {
    this.destroyRef.onDestroy(() => {
      this.statsRequest?.unsubscribe();
      this.ordersRequest?.unsubscribe();
      this.suppliersRequest?.unsubscribe();
    });
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadStats();
    this.loadRecentOrders();
    this.loadTopSuppliers();
  }

  loadStats(): void {
    if (this.destroyRef.destroyed) return;
    this.statsRequest?.unsubscribe();
    this.is_loading_stats.set(true);
    this.stats_error.set(false);
    this.statsRequest = this.inventoryService.getInventoryStats()
      .pipe(defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.success === false ? undefined : response?.data;
          if (data) this.stats.set(data);
          this.stats_error.set(!data);
          this.is_loading_stats.set(false);
        },
        error: (error) => {
          this.stats_error.set(true);
          this.toastService.error(extractApiErrorMessage(error) || 'No se pudo cargar el resumen de inventario');
          this.is_loading_stats.set(false);
        },
      });
  }

  loadRecentOrders(): void {
    if (this.destroyRef.destroyed) return;
    this.ordersRequest?.unsubscribe();
    this.is_loading_orders.set(true);
    this.orders_error.set(false);
    this.ordersRequest = this.purchaseOrdersService.getPurchaseOrders({ limit: 5 })
      .pipe(defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.success === false ? undefined : response?.data;
          if (data) this.recent_orders.set(data);
          this.orders_error.set(!data);
          this.is_loading_orders.set(false);
        },
        error: () => {
          this.orders_error.set(true);
          this.is_loading_orders.set(false);
        },
      });
  }

  loadTopSuppliers(): void {
    if (this.destroyRef.destroyed) return;
    this.suppliersRequest?.unsubscribe();
    this.is_loading_suppliers.set(true);
    this.suppliers_error.set(false);
    this.suppliersRequest = this.suppliersService.getSuppliers({ limit: 5, state: 'active' as const })
      .pipe(defaultIfEmpty(null), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.success === false ? undefined : response?.data;
          if (data) this.top_suppliers.set(data);
          this.suppliers_error.set(!data);
          this.is_loading_suppliers.set(false);
        },
        error: () => {
          this.suppliers_error.set(true);
          this.is_loading_suppliers.set(false);
        },
      });
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value || 0, 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      submitted: 'Enviada',
      ordered: 'Ordenada',
      partial: 'Parcial',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }
}
