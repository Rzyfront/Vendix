import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, forkJoin } from 'rxjs';

import {
  TableComponent,
  TableColumn,
  TableAction,
  ButtonComponent,
  IconComponent,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../../../shared/components/index';

import { StoreOrdersService } from '../../services/store-orders.service';
import { CustomersService } from '../../../../store/customers/services/customers.service';
import {
  Order,
  OrderQuery,
  PaginatedOrdersResponse,
  FilterOption,
} from '../../interfaces/order.interface';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule, FormsModule, ResponsiveDataViewComponent],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent implements OnInit, OnDestroy, OnChanges {
  @Input() filters: OrderQuery = {
    search: '',
    status: undefined,
    payment_status: undefined,
    date_range: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

  @Output() viewOrder = new EventEmitter<string>();
  @Output() ordersLoaded = new EventEmitter<any>();
  private destroy$ = new Subject<void>();

  // Data
  orders: Order[] = [];
  totalItems = 0;
  loading = false;

  // Table configuration
  columns: TableColumn[] = [
    { key: 'order_number', label: 'Order ID', sortable: true, priority: 1 },
    {
      key: 'customer_name',
      label: 'Customer',
      sortable: true,
      priority: 2,
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          created: '#6b7280',
          pending_payment: '#f59e0b',
          processing: '#3b82f6',
          shipped: '#06b6d4',
          delivered: '#10b981',
          cancelled: '#ef4444',
          refunded: '#f97316',
          finished: '#8b5cf6',
        },
      },
      transform: (value: any) => this.formatStatus(value),
    },
    {
      key: 'grand_total',
      label: 'Total',
      sortable: true,
      priority: 1,
      transform: (value: any) => `$${(value || 0).toFixed(2)}`,
    },
    {
      key: 'created_at',
      label: 'Date',
      sortable: true,
      priority: 3,
      transform: (value: any) => {
        if (!value) return 'N/A';
        const date = new Date(value);
        return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
      },
    },
  ];

  actions: TableAction[] = [
    {
      label: 'View Details',
      icon: 'eye',
      action: (order: Order) => this.viewOrderDetails(order),
      variant: 'ghost',
    },
    {
      label: 'Cancel Order',
      icon: 'x-circle',
      action: (order: Order) => this.cancelOrder(order),
      variant: 'danger',
      show: (order: Order) => ['created', 'pending_payment', 'processing'].includes(order.state),
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (val: string) => `Order #${val}`,
    subtitleKey: 'customer_name',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        created: '#6b7280',
        pending_payment: '#f59e0b',
        processing: '#3b82f6',
        shipped: '#06b6d4',
        delivered: '#10b981',
        cancelled: '#ef4444',
        refunded: '#f97316',
        finished: '#8b5cf6',
      },
    },
    badgeTransform: (value: any) => this.formatStatus(value),
    detailKeys: [
      { key: 'grand_total', label: 'Total', transform: (value: any) => `$${(value || 0).toFixed(2)}` },
      {
        key: 'created_at',
        label: 'Date',
        transform: (value: any) => {
          if (!value) return 'N/A';
          const date = new Date(value);
          return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
        },
      },
    ],
  };

  // Filter options (now handled by parent component)

  constructor(
    private ordersService: StoreOrdersService,
    private customersService: CustomersService,
    private dialogService: DialogService,
    private toastService: ToastService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filters'] && !changes['filters'].firstChange) {
      this.loadOrders();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading = true;

    this.ordersService
      .getOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Unwrap ResponseService wrapper if present
          const paginatedData = response.data || response;

          const rawOrders = paginatedData.data || paginatedData || [];

          // Normalize numeric strings to numbers
          const normalizedOrders = rawOrders.map((order: any) => ({
            ...order,
            customer_id: typeof order.customer_id === 'string' ? parseInt(order.customer_id) : order.customer_id,
            grand_total: typeof order.grand_total === 'string' ? parseFloat(order.grand_total) : order.grand_total,
            subtotal_amount: typeof order.subtotal_amount === 'string' ? parseFloat(order.subtotal_amount) : order.subtotal_amount,
            tax_amount: typeof order.tax_amount === 'string' ? parseFloat(order.tax_amount) : order.tax_amount,
            shipping_cost: typeof order.shipping_cost === 'string' ? parseFloat(order.shipping_cost) : order.shipping_cost,
            discount_amount: typeof order.discount_amount === 'string' ? parseFloat(order.discount_amount) : order.discount_amount,
          }));

          // Get pagination info safely
          const paginationInfo = paginatedData.pagination || { total: rawOrders.length };
          this.totalItems = paginationInfo.total || 0;

          // Fetch customer details
          const customerIds: number[] = [...new Set<number>(normalizedOrders.map((o: any) => o.customer_id).filter((id: number) => id))];
          if (customerIds.length > 0) {
            forkJoin(customerIds.map(id => this.customersService.getCustomer(id)))
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: (customers) => {
                  const customerMap = new Map(customers.map(c => [c.id, c]));
                  this.orders = normalizedOrders.map((order: any) => ({
                    ...order,
                    // Show "Consumidor Final" for anonymous sales (no customer_id), otherwise show customer name
                    customer_name: order.customer_id ? `${customerMap.get(order.customer_id)?.first_name || ''} ${customerMap.get(order.customer_id)?.last_name || ''}`.trim() || 'N/A' : 'Consumidor Final'
                  }));

                  this.loading = false;
                  this.ordersLoaded.emit({
                    orders: this.orders,
                    totalItems: this.totalItems,
                    filters: this.filters,
                  });
                },
                error: (error) => {
                  console.error('Error loading customers:', error);
                  this.orders = normalizedOrders.map((order: any) => ({
                    ...order,
                    customer_name: order.customer_id ? 'N/A' : 'Consumidor Final'
                  }));
                  this.loading = false;
                  this.ordersLoaded.emit({
                    orders: this.orders,
                    totalItems: this.totalItems,
                    filters: this.filters,
                  });
                }
              });
          } else {
            // No customer IDs to fetch, show "Consumidor Final" for orders without customer
            this.orders = normalizedOrders.map((order: any) => ({
              ...order,
              customer_name: order.customer_id ? 'N/A' : 'Consumidor Final'
            }));
            this.loading = false;
            this.ordersLoaded.emit({
              orders: this.orders,
              totalItems: this.totalItems,
              filters: this.filters,
            });
          }
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading = false;
          this.ordersLoaded.emit({
            orders: [],
            totalItems: 0,
            filters: this.filters,
          });
        },
      });
  }

  // Event handlers
  onPageChange(page: number): void {
    if (this.filters.page !== undefined) {
      this.filters.page = page;
      this.loadOrders();
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (event.direction) {
      this.filters.sort_by = event.column as any;
      this.filters.sort_order = event.direction;
      this.loadOrders();
    }
  }

  // Actions
  handleViewOrder(orderId: string): void {
    this.viewOrder.emit(orderId);
  }

  viewOrderDetails(order: Order): void {
    this.viewOrder.emit(order.id.toString());
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar Orden',
      message: `¿Estás seguro de que deseas cancelar la orden ${order.order_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar Orden',
      cancelText: 'Volver',
    });

    if (confirmed) {
      this.ordersService.updateOrderStatus(order.id.toString(), 'cancelled').pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toastService.success('Orden cancelada exitosamente');
          this.loadOrders();
        },
        error: (error: any) => {
          console.error('Error cancelling order:', error);
          this.toastService.error('Error al cancelar la orden. Por favor intenta nuevamente.');
        }
      });
    }
  }

  exportOrders(): void {
    this.ordersService
      .exportOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Handle file download
          const blob = new Blob([response], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error: any) => {
          console.error('Error exporting orders:', error);
          this.toastService.error('Failed to export orders. Please try again.');
        },
      });
  }

  // Helper methods for formatting
  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  formatPaymentStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  // Math utility for template
  get totalPages(): number {
    return Math.ceil(this.totalItems / (this.filters.limit || 10));
  }
}
