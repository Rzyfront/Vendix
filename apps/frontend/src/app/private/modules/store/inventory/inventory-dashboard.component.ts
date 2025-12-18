import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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

// Interfaces
import { InventoryStats, PurchaseOrder, Supplier } from './interfaces';

@Component({
  selector: 'app-inventory-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, StatsComponent, IconComponent, TableComponent],
  template: `
    <div class="p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <app-stats
          title="Valor Total Inventario"
          [value]="formatCurrency(stats.total_stock_value)"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Productos con Stock"
          [value]="stats.total_products"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Stock Bajo"
          [value]="stats.low_stock_items"
          [smallText]="stats.out_of_stock_items + ' agotados'"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Órdenes Pendientes"
          [value]="stats.pending_orders"
          [smallText]="formatCurrency(stats.incoming_stock) + ' en camino'"
          iconName="truck"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
      </div>

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
            <app-table
              [data]="recent_orders"
              [columns]="order_columns"
              [loading]="is_loading_orders"
              emptyMessage="No hay órdenes recientes"
              size="sm"
            ></app-table>
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
            <app-table
              [data]="top_suppliers"
              [columns]="supplier_columns"
              [loading]="is_loading_suppliers"
              emptyMessage="No hay proveedores"
              size="sm"
            ></app-table>
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
  // Stats
  stats: InventoryStats = {
    total_products: 0,
    total_stock_value: 0,
    low_stock_items: 0,
    out_of_stock_items: 0,
    pending_orders: 0,
    incoming_stock: 0,
  };

  // Data
  recent_orders: PurchaseOrder[] = [];
  top_suppliers: Supplier[] = [];

  // Loading
  is_loading_stats = false;
  is_loading_orders = false;
  is_loading_suppliers = false;

  // Table Columns
  order_columns: TableColumn[] = [
    { key: 'order_number', label: 'No. Orden', width: '100px' },
    { key: 'supplier.name', label: 'Proveedor', defaultValue: '-' },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (v: string) => this.getStatusLabel(v),
    },
    {
      key: 'total_amount',
      label: 'Total',
      align: 'right',
      transform: (v: number) => this.formatCurrency(v),
    },
  ];

  supplier_columns: TableColumn[] = [
    { key: 'name', label: 'Nombre' },
    { key: 'contact_person', label: 'Contacto', defaultValue: '-' },
    {
      key: 'is_active',
      label: 'Estado',
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (v: boolean) => (v ? 'Activo' : 'Inactivo'),
    },
  ];

  constructor(
    private inventoryService: InventoryService,
    private purchaseOrdersService: PurchaseOrdersService,
    private suppliersService: SuppliersService
  ) { }

  ngOnInit(): void {
    this.loadStats();
    this.loadRecentOrders();
    this.loadTopSuppliers();
  }

  loadStats(): void {
    this.is_loading_stats = true;
    this.inventoryService.getInventoryStats().subscribe({
      next: (response) => {
        if (response.data) {
          this.stats = response.data;
        }
        this.is_loading_stats = false;
      },
      error: () => {
        this.is_loading_stats = false;
      },
    });
  }

  loadRecentOrders(): void {
    this.is_loading_orders = true;
    this.purchaseOrdersService.getPurchaseOrders({ limit: 5 }).subscribe({
      next: (response) => {
        if (response.data) {
          this.recent_orders = response.data;
        }
        this.is_loading_orders = false;
      },
      error: () => {
        this.is_loading_orders = false;
      },
    });
  }

  loadTopSuppliers(): void {
    this.is_loading_suppliers = true;
    this.suppliersService.getSuppliers({ limit: 5, is_active: true }).subscribe({
      next: (response) => {
        if (response.data) {
          this.top_suppliers = response.data;
        }
        this.is_loading_suppliers = false;
      },
      error: () => {
        this.is_loading_suppliers = false;
      },
    });
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
    }).format(value || 0);
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
