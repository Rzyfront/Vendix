import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router';

import {
    ButtonComponent,
    TableComponent,
    TableColumn,
    TableAction,
    InputsearchComponent,
    StatsComponent,
    IconComponent,
    SelectorComponent,
    SelectorOption,
    ToastService,
    DialogService,
} from '../../../../../shared/components/index';

// Services
import { PurchaseOrdersService } from '../../inventory/services';
import { SuppliersService, InventoryService } from '../../inventory/services';
import { PopCartService } from '../../inventory/pop/services/pop-cart.service';

// Interfaces
import {
    PurchaseOrder,
    PurchaseOrderStatus,
    Supplier,
} from '../../inventory/interfaces';

// Child Components
import { PurchaseOrderCreateModalComponent } from './components/purchase-order-create-modal.component';
import { PurchaseOrderDetailModalComponent } from './components/purchase-order-detail-modal.component';

@Component({
    selector: 'app-purchase-orders',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        ButtonComponent,
        TableComponent,
        InputsearchComponent,
        StatsComponent,
        IconComponent,
        SelectorComponent,
        PurchaseOrderCreateModalComponent,
        PurchaseOrderDetailModalComponent,
    ],
    template: `
    <div class="p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <app-stats
          title="Total Órdenes"
          [value]="stats.total"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Pendientes"
          [value]="stats.pending"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Recibidas"
          [value]="stats.received"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Valor Total"
          [value]="formatCurrency(stats.total_value)"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Orders List Container -->
      <div class="bg-surface rounded-card shadow-card border border-border min-h-[600px]">
        <div class="px-6 py-4 border-b border-border">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0">
              <h2 class="text-lg font-semibold text-text-primary">
                Órdenes de Compra ({{ stats.total }})
              </h2>
            </div>

            <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <app-inputsearch
                class="w-full sm:w-48 flex-shrink-0"
                size="sm"
                placeholder="Buscar orden..."
                (search)="onSearch($event)"
              ></app-inputsearch>

              <app-selector
                class="w-full sm:w-40"
                [options]="status_options"
                [(ngModel)]="current_status"
                placeholder="Estado"
                size="sm"
                (valueChange)="filterByStatus($event)"
              ></app-selector>

              <div class="flex gap-2 items-center ml-auto">
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="loadOrders()"
                  [disabled]="is_loading"
                  title="Refrescar"
                >
                  <app-icon name="refresh" [size]="16" slot="icon"></app-icon>
                </app-button>
                
                  <app-button
                    variant="primary"
                    size="sm"
                    (clicked)="createOrder()"
                    title="Nueva Orden"
                  >
                    <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                    <span class="hidden sm:inline">Nueva Orden</span>
                  </app-button>
                </div>
          </div>
        </div>

        <!-- Loading State -->
        <div *ngIf="is_loading" class="p-8 text-center">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p class="mt-2 text-text-secondary">Cargando órdenes...</p>
        </div>

        <!-- Empty State -->
        <div *ngIf="!is_loading && filtered_orders.length === 0" class="p-12 text-center text-gray-500">
          <app-icon name="file-text" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
          <h3 class="text-lg font-medium text-gray-900">No hay órdenes</h3>
          <p class="mt-1">Comienza creando una nueva orden de compra.</p>
          <div class="mt-6">
            <app-button variant="primary" (clicked)="openCreateModal()">
              <app-icon name="plus" [size]="16" slot="icon"></app-icon>
              Crear Orden
            </app-button>
          </div>
        </div>

        <!-- Table -->
        <div *ngIf="!is_loading && filtered_orders.length > 0" class="p-6">
          <app-table
            [data]="filtered_orders"
            [columns]="table_columns"
            [actions]="table_actions"
            [loading]="is_loading"
            [hoverable]="true"
            [striped]="true"
            size="md"
            emptyMessage="No hay órdenes de compra"
            (rowClick)="openDetailModal($event)"
          ></app-table>
        </div>
      </div>

      <!-- Create Modal -->
      <app-purchase-order-create-modal
        [isOpen]="is_create_modal_open"
        [suppliers]="suppliers"
        [isSubmitting]="is_submitting"
        (cancel)="closeCreateModal()"
        (save)="onCreateOrder($event)"
      ></app-purchase-order-create-modal>

      <!-- Detail Modal -->
      <app-purchase-order-detail-modal
        [isOpen]="is_detail_modal_open"
        [order]="selected_order"
        (close)="closeDetailModal()"
        (receive)="onReceiveOrder($event)"
        (cancel)="onCancelOrder($event)"
        (edit)="onEditOrder($event)"
      ></app-purchase-order-detail-modal>
    </div>
  `,
})
export class PurchaseOrdersComponent implements OnInit, OnDestroy {
    // Data
    orders: PurchaseOrder[] = [];
    filtered_orders: PurchaseOrder[] = [];
    suppliers: Supplier[] = [];
    selected_order: PurchaseOrder | null = null;

    // Stats
    stats = {
        total: 0,
        pending: 0,
        received: 0,
        total_value: 0,
    };

    // Filters
    current_status: PurchaseOrderStatus | 'all' = 'all';
    search_term = '';

    status_options: SelectorOption[] = [
        { value: 'all', label: 'Todos los estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'ordered', label: 'Ordenada' },
        { value: 'partial', label: 'Parcial' },
        { value: 'received', label: 'Recibida' },
        { value: 'cancelled', label: 'Cancelada' },
    ];

    // Table Configuration
    table_columns: TableColumn[] = [
        { key: 'order_number', label: 'No. Orden', sortable: true, width: '120px', priority: 1 },
        {
            key: 'suppliers.name',
            label: 'Proveedor',
            sortable: true,
            defaultValue: '-',
            priority: 2,
        },
        {
            key: 'order_date',
            label: 'Fecha',
            sortable: true,
            priority: 3,
            transform: (value: string) => (value ? new Date(value).toLocaleDateString() : '-'),
        },
        {
            key: 'expected_date',
            label: 'Entrega Esperada',
            priority: 3,
            transform: (value: string) => (value ? new Date(value).toLocaleDateString() : '-'),
        },
        {
            key: 'total_amount',
            label: 'Total',
            align: 'right',
            priority: 1,
            transform: (value: number) => this.formatCurrency(value),
        },
        {
            key: 'status',
            label: 'Estado',
            badge: true,
            priority: 1,
            badgeConfig: {
                type: 'custom',
                colorMap: {
                    draft: 'neutral',
                    submitted: 'warning',
                    approved: 'info',
                    ordered: 'primary',
                    partial: 'warning',
                    received: 'success',
                    cancelled: 'danger',
                }
            },
            transform: (value: PurchaseOrderStatus) => this.getStatusLabel(value),
        },
    ];

    table_actions: TableAction[] = [
        {
            label: 'Ver Detalle',
            icon: 'eye',
            variant: 'ghost',
            action: (item: PurchaseOrder) => this.openDetailModal(item),
        },
        {
            label: 'Cancelar',
            icon: 'x-circle',
            variant: 'danger',
            action: (item: PurchaseOrder) => this.confirmCancel(item),
            show: (item: PurchaseOrder) => ['draft', 'submitted', 'approved', 'ordered'].includes(item.status),
        },
    ];

    // UI State
    is_loading = false;
    is_create_modal_open = false;
    is_detail_modal_open = false;
    is_submitting = false;

    private subscriptions: Subscription[] = [];

    constructor(
        private purchaseOrdersService: PurchaseOrdersService,
        private suppliersService: SuppliersService,
        private toastService: ToastService,
        private dialogService: DialogService,
        private router: Router,
        private popCartService: PopCartService
    ) { }

    ngOnInit(): void {
        this.loadOrders();
        this.loadSuppliers();
    }

    ngOnDestroy(): void {
        this.subscriptions.forEach((sub) => sub.unsubscribe());
    }

    // ============================================================
    // Data Loading
    // ============================================================

    loadOrders(): void {
        this.is_loading = true;
        const query = this.current_status !== 'all' ? { status: this.current_status } : {};

        const sub = this.purchaseOrdersService.getPurchaseOrders(query).subscribe({
            next: (response) => {
                if (response.data) {
                    this.orders = response.data;
                    this.applyFilters();
                    this.calculateStats();
                }
                this.is_loading = false;
            },
            error: (error) => {
                this.toastService.error(error || 'Error al cargar órdenes');
                this.is_loading = false;
            },
        });
        this.subscriptions.push(sub);
    }

    loadSuppliers(): void {
        const sub = this.suppliersService.getSuppliers({ is_active: true }).subscribe({
            next: (response) => {
                if (response.data) {
                    this.suppliers = response.data;
                }
            },
            error: () => {
                // Silent error for supporting data
            },
        });
        this.subscriptions.push(sub);
    }

    applyFilters(): void {
        let filtered = [...this.orders];

        // Status filter
        if (this.current_status !== 'all') {
            filtered = filtered.filter((o) => o.status === this.current_status);
        }

        // Search filter
        if (this.search_term) {
            const term = this.search_term.toLowerCase();
            filtered = filtered.filter(
                (o) =>
                    o.order_number?.toLowerCase().includes(term) ||
                    o.suppliers?.name?.toLowerCase().includes(term)
            );
        }

        this.filtered_orders = filtered;
    }

    calculateStats(): void {
        this.stats.total = this.orders.length;
        this.stats.pending = this.orders.filter((o) =>
            ['draft', 'submitted', 'approved', 'ordered', 'partial'].includes(o.status)
        ).length;
        this.stats.received = this.orders.filter((o) => o.status === 'received').length;
        this.stats.total_value = this.orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    }

    // ============================================================
    // Event Handlers
    // ============================================================

    onSearch(term: string): void {
        this.search_term = term;
        this.applyFilters();
    }

    filterByStatus(status: string | number | null): void {
        this.current_status = (status as PurchaseOrderStatus | 'all') || 'all';
        this.applyFilters();
    }

    getStatusCount(status: PurchaseOrderStatus | 'all'): number {
        if (status === 'all') return this.orders.length;
        return this.orders.filter((o) => o.status === status).length;
    }

    // ============================================================
    // Modal Management
    // ============================================================

    openCreateModal(): void {
        this.is_create_modal_open = true;
    }

    createOrder(): void {
        this.router.navigate(['/admin/inventory/pop']);
    }

    closeCreateModal(): void {
        this.is_create_modal_open = false;
    }

    openDetailModal(order: PurchaseOrder): void {
        this.selected_order = order;
        this.is_detail_modal_open = true;
    }

    closeDetailModal(): void {
        this.is_detail_modal_open = false;
        this.selected_order = null;
    }

    // ============================================================
    // CRUD Operations
    // ============================================================

    onCreateOrder(data: any): void {
        this.is_submitting = true;

        const sub = this.purchaseOrdersService.createPurchaseOrder(data).subscribe({
            next: () => {
                this.toastService.success('Orden de compra creada correctamente');
                this.is_submitting = false;
                this.closeCreateModal();
                this.loadOrders();
            },
            error: (error) => {
                this.toastService.error(error || 'Error al crear orden');
                this.is_submitting = false;
            },
        });
        this.subscriptions.push(sub);
    }

    onReceiveOrder(event: { order_id: number; items: any[] }): void {
        const sub = this.purchaseOrdersService
            .receivePurchaseOrder(event.order_id, event.items)
            .subscribe({
                next: () => {
                    this.toastService.success('Mercancía recibida correctamente');
                    this.closeDetailModal();
                    this.loadOrders();
                },
                error: (error) => {
                    this.toastService.error(error || 'Error al recibir mercancía');
                },
            });
        this.subscriptions.push(sub);
    }

    confirmCancel(order: PurchaseOrder): void {
        this.dialogService
            .confirm({
                title: 'Cancelar Orden',
                message: `¿Está seguro de que desea cancelar la orden "${order.order_number}"?`,
                confirmText: 'Cancelar Orden',
                cancelText: 'Volver',
                confirmVariant: 'danger',
            })
            .then((confirmed) => {
                if (confirmed) {
                    this.onCancelOrder(order.id);
                }
            });
    }

    onCancelOrder(order_id: number): void {
        const sub = this.purchaseOrdersService.cancelPurchaseOrder(order_id).subscribe({
            next: () => {
                this.toastService.success('Orden cancelada correctamente');
                this.closeDetailModal();
                this.loadOrders();
            },
            error: (error) => {
                this.toastService.error(error || 'Error al cancelar orden');
            },
        });
        this.subscriptions.push(sub);
    }

    onEditOrder(order: PurchaseOrder): void {
        this.popCartService.loadOrder(order);
        this.closeDetailModal();
        this.router.navigate(['/admin/inventory/pop']);
    }

    // ============================================================
    // Helpers
    // ============================================================

    getStatusLabel(status: PurchaseOrderStatus): string {
        const labels: Record<PurchaseOrderStatus, string> = {
            draft: 'Borrador',
            submitted: 'Enviada',
            approved: 'Aprobada',
            ordered: 'Ordenada',
            partial: 'Parcial',
            received: 'Recibida',
            cancelled: 'Cancelada',
        };
        return labels[status] || status;
    }

    formatCurrency(value: number): string {
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0,
        }).format(value || 0);
    }

    getTabClasses(status: PurchaseOrderStatus | 'all'): string {
        const base = 'px-3 py-1.5 text-sm font-medium rounded-full transition-colors whitespace-nowrap';
        if (status === this.current_status) {
            return `${base} bg-primary text-white`;
        }
        return `${base} bg-muted/20 text-text-secondary hover:bg-muted/40`;
    }
}
